// --- SCL-HUB USER API ---
// Load environment variables
require('dotenv').config();

// --- DEPENDENCIES ---
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { WebflowClient } = require('webflow-api');
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
    KV_REST_API_TOKEN,
    VERCEL_URL
} = process.env;

const REDIRECT_URI = 'https://sclhub-user-api.vercel.app/auth/callback';

// --- DATABASE SETUP ---
const kvClient = createClient({
    url: KV_URL,
    token: KV_REST_API_TOKEN,
});

const TOKEN_KEY = 'webflow_access_token';
const REFRESH_TOKEN_KEY = 'webflow_refresh_token';

// --- HELPER: Get an authenticated Webflow client ---
async function getWebflowClient() {
    let accessToken = await kvClient.get(TOKEN_KEY);
    const refreshToken = await kvClient.get(REFRESH_TOKEN_KEY);

    if (!accessToken) {
        if (!refreshToken) {
            throw new Error("Webflow API is not authenticated. Please re-authorize the app by visiting the root URL.");
        }

        // Refresh the token if expired
        console.log("Refreshing Webflow access token...");
        const refreshed = await WebflowClient.refreshAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            refreshToken
        });

        accessToken = refreshed.accessToken;
        await kvClient.set(TOKEN_KEY, refreshed.accessToken);
        if (refreshed.refreshToken) {
            await kvClient.set(REFRESH_TOKEN_KEY, refreshed.refreshToken);
        }
    }

    return new WebflowClient({ accessToken });
}

// --- ROUTES ---

// 1. Install / Start OAuth flow
app.get('/', (req, res) => {
    const installUrl = WebflowClient.authorizeURL({
        clientId: WEBFLOW_CLIENT_ID,
        scope: "cms:read cms:write assets:write",
        redirect_uri: process.env.WEBFLOW_REDIRECT_URI

    });
    res.redirect(installUrl);
});

// 2. OAuth Callback
app.get('/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send("Authorization code is missing.");

        const tokenData = await WebflowClient.getAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            code,
            redirect_uri: process.env.WEBFLOW_REDIRECT_URI

        });

        // Store tokens persistently
        await kvClient.set(TOKEN_KEY, tokenData.accessToken);
        if (tokenData.refreshToken) {
            await kvClient.set(REFRESH_TOKEN_KEY, tokenData.refreshToken);
        }

        console.log("SUCCESS: Webflow Access Token received and stored.");
        res.send("<h1>Authentication Successful!</h1><p>You can close this window now.</p>");
    } catch (error) {
        console.error("OAuth Callback Error:", error.response?.data || error.message);
        res.status(500).send("Authentication failed.");
    }
});

// 3. GET all clusters for a user
app.get('/api/get-my-clusters', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { uid } = req.query;
        if (!uid) return res.status(400).json({ error: "UID is required." });

        const { items } = await webflow.items.listItems({ collectionId: COLLECTION_ID });
        const userItems = items.filter(item => item.fieldData['firebase-uid'] === uid);

        res.status(200).json(userItems);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. GET one cluster
app.get('/api/get-single-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId } = req.query;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });

        const item = await webflow.items.getItem({ collectionId: COLLECTION_ID, itemId });
        res.status(200).json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. CREATE a cluster
app.post('/api/create-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { uid, fieldData } = req.body;
        if (!uid || !fieldData) return res.status(400).json({ error: "Missing data." });

        fieldData['firebase-uid'] = uid;
        if (!fieldData.name) return res.status(400).json({ error: "Name is required." });

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

// 6. UPDATE a cluster
app.patch('/api/update-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId, fieldData } = req.body;
        if (!itemId || !fieldData) return res.status(400).json({ error: "Missing data." });

        const updatedItem = await webflow.items.patchItem({ collectionId: COLLECTION_ID, itemId, fieldData });
        res.status(200).json(updatedItem);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. DELETE a cluster
app.delete('/api/delete-cluster', async (req, res) => {
    try {
        const webflow = await getWebflowClient();
        const { itemId } = req.body;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });

        await webflow.items.removeItem({ collectionId: COLLECTION_ID, itemId });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. UPLOAD image
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
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- START SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API running on port ${port}`));
