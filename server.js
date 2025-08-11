// SCL-HUB USER API - The Final, Definitive, and Persistent Server
require('dotenv').config();

// --- DEPENDENCIES ---
const express = require('express');
const cors = require('cors');
const { WebflowClient } = require('webflow-api');
const multer = require('multer');
const stream = require('stream');
const { createClient } = require('@vercel/kv');

// --- INITIALIZATION ---
const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const { 
    WEBFLOW_CLIENT_ID, 
    WEBFLOW_CLIENT_SECRET, 
    COLLECTION_ID, 
    SITE_ID,
    KV_URL,
    KV_REST_API_TOKEN
} = process.env;

// --- DATABASE SETUP ---
const kvClient = createClient({
  url: KV_URL,
  token: KV_REST_API_TOKEN,
});
const TOKEN_KEY = 'webflow_access_token'; // The key for storing our token in the database

// --- AUTHENTICATION & SETUP ---

// 1. The Root Endpoint - Redirects to the install flow for easy authorization
app.get('/', (req, res) => {
    const installUrl = WebflowClient.authorizeURL({
        clientId: WEBFLOW_CLIENT_ID,
        scope: "cms:read cms:write assets:write",
    });
    res.redirect(installUrl);
});

// 2. The OAuth Callback Endpoint - Where Webflow sends the user after they approve
app.get('/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send("Authorization code is missing.");
        
        const token = await WebflowClient.getAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            code: code,
        });
        
        // Store the token persistently in the Vercel KV database
        await kvClient.set(TOKEN_KEY, token);
        
        console.log("SUCCESS: Webflow Access Token received and stored persistently.");
        res.send("<h1>Authentication Successful!</h1><p>Your SCL-HUB application is now connected. You can close this window.</p>");
    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).send("An error occurred during authentication.");
    }
});

// --- HELPER FUNCTION: Gets a secure, authenticated API client ---
async function getWebflowClient() {
    const accessToken = await kvClient.get(TOKEN_KEY);
    if (!accessToken) {
        throw new Error("Webflow API is not authenticated. Please re-authorize the app by visiting the root URL.");
    }
    return new WebflowClient({ accessToken });
}

// --- MAIN API ENDPOINTS ---

// 3. Endpoint to GET ALL clusters owned by a specific user
app.get('/api/get-my-clusters', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { uid } = req.query;
        if (!uid) return res.status(400).json({ error: "UID is required." });
        const { items } = await webflow.items.listItems({ collectionId: COLLECTION_ID });
        const userItems = items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.status(200).json(userItems);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Endpoint to GET ONE specific cluster for the edit page
app.get('/api/get-single-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId } = req.query;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });
        const item = await webflow.items.getItem({ collectionId: COLLECTION_ID, itemId: itemId });
        res.status(200).json(item);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. Endpoint to CREATE a new cluster
app.post('/api/create-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { uid, fieldData } = req.body;
        if (!uid || !fieldData) return res.status(400).json({ error: "Missing data." });
        fieldData['firebase-uid'] = uid;
        if (!fieldData.name) return res.status(400).json({ error: "Name field is required." });
        fieldData.slug = fieldData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        
        const newItem = await webflow.items.createItem({ collectionId: COLLECTION_ID, fieldData });
        
        await webflow.items.patchItem({
            collectionId: COLLECTION_ID,
            itemId: newItem.id,
            fieldData: { 'webflow-item-id': newItem.id, '_archived': false, '_draft': false }
        });
        res.status(200).json(newItem);
    } catch (error) {
        console.error("Create Cluster Error:", error.response?.data || error.message);
        res.status(500).json({ error: error.message });
    }
});

// 6. Endpoint to UPDATE an existing cluster
app.patch('/api/update-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId, fieldData } = req.body;
        if (!itemId || !fieldData) return res.status(400).json({ error: "Missing data." });
        const updatedItem = await webflow.items.patchItem({ collectionId: COLLECTION_ID, itemId: itemId, fieldData: fieldData });
        res.status(200).json(updatedItem);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 7. Endpoint to DELETE a cluster
app.delete('/api/delete-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId } = req.body;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });
        await webflow.items.removeItem({ collectionId: COLLECTION_ID, itemId: itemId });
        res.status(200).json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 8. Endpoint to handle image uploads
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        if (!req.file) return res.status(400).json({ error: "No file uploaded." });
        const asset = await webflow.assets.uploadAsset({
            siteId: SITE_ID,
            fileName: req.file.originalname,
            file: req.file.buffer
        });
        res.status(200).json({ url: asset.url });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- START THE SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API is running on port ${port}`));

// --- START THE SERVER ---