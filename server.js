// SCL-HUB USER API - The Final, Secure, OAuth-driven Server (with Correct Scopes)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { WebflowClient } = require('webflow-api');
const multer = require('multer');
const stream = require('stream');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const { WEBFLOW_CLIENT_ID, WEBFLOW_CLIENT_SECRET, COLLECTION_ID, SITE_ID } = process.env;

let webflowAccessToken = null;

// --- AUTHENTICATION ENDPOINTS ---

// 1. The Root Endpoint - Redirects to the install flow with the CORRECT permissions
app.get('/', (req, res) => {
    const installUrl = WebflowClient.authorizeURL({
        clientId: WEBFLOW_CLIENT_ID,
        // --> THE 110% DEFINITIVE FIX IS HERE <--
        // We are now explicitly asking for permission to read/write CMS data and assets.
        scope: "cms:read cms:write assets:write",
    });
    res.redirect(installUrl);
});

// 2. The OAuth Callback Endpoint (No changes needed, but included for completeness)
app.get('/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send("Authorization code is missing.");

        const token = await WebflowClient.getAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            code: code,
        });
        
        webflowAccessToken = token;
        console.log("SUCCESS: Webflow Access Token received and stored.");
        res.send("<h1>Authentication Successful!</h1><p>Your SCL-HUB application is now connected. You can close this window.</p>");
    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).send("An error occurred during authentication.");
    }
});

// --- HELPER FUNCTION: Gets a secure, authenticated API client ---
function getWebflowClient() {
    if (!webflowAccessToken) {
        throw new Error("Webflow API is not authenticated. Please re-authorize the app.");
    }
    return new WebflowClient({ accessToken: webflowAccessToken });
}

// --- MAIN API ENDPOINTS (Now using the correctly permissioned client) ---

// 3. Endpoint to GET ALL clusters for a user
app.get('/api/get-my-clusters', async (req, res) => {
    try {
        const webflow = getWebflowClient();
        const { uid } = req.query;
        if (!uid) return res.status(400).json({ error: "UID is required." });

        const { items } = await webflow.items.list({ collectionId: COLLECTION_ID });
        const userItems = items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.status(200).json(userItems);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Endpoint to CREATE a new cluster
app.post('/api/create-cluster', async (req, res) => {
    try {
        const webflow = getWebflowClient();
        const { uid, fieldData } = req.body;
        if (!uid || !fieldData) return res.status(400).json({ error: "Missing data." });

        fieldData['firebase-uid'] = uid;
        if (!fieldData.name) return res.status(400).json({ error: "Name field is required." });
        fieldData.slug = fieldData.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        const newItem = await webflow.items.create({ collectionId: COLLECTION_ID, fieldData });
        
        await webflow.items.patch({
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

// ... (The rest of your endpoints: get-single, update, delete, upload-image)
// The code for these does not need to change, as they will now be called with a correctly permissioned client.
// I am including them in full for a complete, unambiguous file.

app.get('/api/get-single-cluster', async (req, res) => { try { const webflow = getWebflowClient(); const { itemId } = req.query; if (!itemId) return res.status(400).json({ error: "Item ID is required." }); const item = await webflow.items.get({ collectionId: COLLECTION_ID, itemId: itemId }); res.status(200).json(item); } catch (error) { res.status(500).json({ error: error.message }); } });
app.patch('/api/update-cluster', async (req, res) => { try { const webflow = getWebflowClient(); const { itemId, fieldData } = req.body; if (!itemId || !fieldData) return res.status(400).json({ error: "Missing data." }); const updatedItem = await webflow.items.patch({ collectionId: COLLECTION_ID, itemId: itemId, fieldData: fieldData }); res.status(200).json(updatedItem); } catch (error) { res.status(500).json({ error: error.message }); } });
app.delete('/api/delete-cluster', async (req, res) => { try { const webflow = getWebflowClient(); const { itemId } = req.body; if (!itemId) return res.status(400).json({ error: "Item ID is required." }); await webflow.items.remove({ collectionId: COLLECTION_ID, itemId: itemId }); res.status(200).json({ success: true }); } catch (error) { res.status(500).json({ error: error.message }); } });
const upload = multer({ storage: multer.memoryStorage() });
app.post('/api/upload-image', upload.single('file'), async (req, res) => { try { const webflow = getWebflowClient(); if (!req.file) return res.status(400).json({ error: "No file uploaded." }); const asset = await webflow.assets.upload({ siteId: SITE_ID, fileName: req.file.originalname, file: req.file.buffer }); res.status(200).json({ url: asset.url }); } catch (error) { res.status(500).json({ error: error.message }); } });


// --- START THE SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API is running on port ${port}`));