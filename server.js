require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const stream = require('stream');
const { WebflowClient } = require('webflow-api');

const app = express();
app.use(cors());
app.use(express.json());

// --- ENV CONFIG ---
const {
    WEBFLOW_CLIENT_ID,
    WEBFLOW_CLIENT_SECRET,
    COLLECTION_ID,
    SITE_ID,
    REDIRECT_URI // Must match exactly in Webflow App settings
} = process.env;

// --- TOKEN STORAGE ---
let webflowAccessToken = process.env.WEBFLOW_ACCESS_TOKEN || null;

// --- WEBFLOW CLIENT HELPER ---
function getWebflowClient() {
    if (!webflowAccessToken) throw new Error("Webflow API not authenticated.");
    return new WebflowClient({ accessToken: webflowAccessToken });
}

// --- OAUTH FLOW ---
app.get('/', (req, res) => {
    const installUrl = WebflowClient.authorizeURL({
        clientId: WEBFLOW_CLIENT_ID,
        redirectUri: REDIRECT_URI,
        scope: 'cms:read cms:write assets:write'
    });
    res.redirect(installUrl);
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;

    if (!code) {
        return res.status(400).send("Authorization code missing.");
    }

    if (webflowAccessToken) {
        return res.send("<h1>Already authenticated</h1><p>Your Webflow app is connected. You can close this window.</p>");
    }

    try {
        const tokenData = await WebflowClient.getAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            code,
            redirectUri: REDIRECT_URI
        });

        webflowAccessToken = tokenData.access_token;

        // TODO: Persist token to DB or file
        console.log("✅ Webflow Access Token stored");

        res.send("<h1>Authentication successful!</h1><p>You can now close this window.</p>");
    } catch (error) {
        console.error("OAuth Callback Error:", error.body || error.message);
        res.status(500).send("OAuth authentication failed.");
    }
});

// --- MULTER UPLOAD CONFIG ---
const upload = multer({ storage: multer.memoryStorage() });

// --- API ROUTES ---

// GET all clusters for a user
app.get('/api/get-my-clusters', async (req, res) => {
    try {
        const { uid } = req.query;
        if (!uid) return res.status(400).json({ error: "UID is required." });

        const webflow = getWebflowClient();
        const resp = await webflow.items.list({ collectionId: COLLECTION_ID });

        const userItems = resp.items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.json(userItems);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET single cluster
app.get('/api/get-single-cluster', async (req, res) => {
    try {
        const { itemId } = req.query;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });

        const webflow = getWebflowClient();
        const item = await webflow.items.get({ collectionId: COLLECTION_ID, itemId });
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CREATE a new cluster
app.post('/api/create-cluster', async (req, res) => {
    try {
        const { uid, fieldData } = req.body;
        if (!uid || !fieldData || !fieldData.name) {
            return res.status(400).json({ error: "Missing required data." });
        }

        const webflow = getWebflowClient();
        fieldData['firebase-uid'] = uid;
        fieldData.slug = fieldData.name.toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');

        const newItem = await webflow.items.createItem({
            collectionId: COLLECTION_ID,
            fields: fieldData
        });

        res.status(201).json(newItem);
    } catch (err) {
        console.error("Create Cluster Error:", err.body || err.message);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE an existing cluster
app.patch('/api/update-cluster', async (req, res) => {
    try {
        const { itemId, fieldData } = req.body;
        if (!itemId || !fieldData) return res.status(400).json({ error: "Missing required data." });

        const webflow = getWebflowClient();
        const updatedItem = await webflow.items.patchItem({
            collectionId: COLLECTION_ID,
            itemId,
            fields: fieldData
        });

        res.json(updatedItem);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE a cluster
app.delete('/api/delete-cluster', async (req, res) => {
    try {
        const { itemId } = req.body;
        if (!itemId) return res.status(400).json({ error: "Item ID is required." });

        const webflow = getWebflowClient();
        await webflow.items.removeItem({ collectionId: COLLECTION_ID, itemId });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// UPLOAD image asset
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded." });

        const webflow = getWebflowClient();
        const readStream = stream.Readable.from(req.file.buffer);

        const asset = await webflow.assets.uploadAsset({
            siteId: SITE_ID,
            fileName: req.file.originalname,
            file: readStream
        });

        res.json({ url: asset.url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- START SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API running on port ${port}`));
