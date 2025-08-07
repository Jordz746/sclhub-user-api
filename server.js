// SCL-HUB USER API - The Complete Backend Server
// This file handles user authentication bridges, CMS operations, and secure file uploads.
// ---------------------------------------------------------------------------------

// Load secret keys from the .env file for local development
require('dotenv').config();

// Import all necessary libraries
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const stream = require('stream');

// --- INITIALIZE THE APP ---
const app = express();
app.use(cors());       // Enable Cross-Origin Resource Sharing for your Webflow site
app.use(express.json()); // Allow the server to read incoming JSON data

// --- CONFIGURATION ---
const WEBFLOW_API_KEY = process.env.WEBFLOW_API_KEY;
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const SITE_ID = process.env.WEBFLOW_SITE_ID;
const WEBFLOW_API_URL = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;
const WEBFLOW_SITE_URL = `https://api.webflow.com/v2/sites/${SITE_ID}`;

// --- MULTER SETUP ---
// This tells our app how to handle files that are uploaded in memory
const upload = multer({ storage: multer.memoryStorage() });

// --- API ENDPOINTS (The "Doors" to Our Backend) ---

// 1. A simple root endpoint to confirm the server is running
app.get('/', (req, res) => res.status(200).json({ status: "ok", message: "SCL-HUB User API is online." }));

// 2. Endpoint to handle image uploads directly to the Webflow Asset Manager
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file was uploaded." });

    try {
        const assetUploadUrl = `${WEBFLOW_SITE_URL}/assets/upload`;
        const prepareUploadResponse = await axios.post(
            assetUploadUrl,
            { fileName: req.file.originalname, size: req.file.size },
            { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' } }
        );

        const { uploadUrl, main, fallback } = prepareUploadResponse.data;
        
        const form = new FormData();
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);
        form.append('file', bufferStream, { filename: req.file.originalname });

        await axios.post(uploadUrl, form, { headers: { ...form.getHeaders() } });

        const assetUrl = main?.url || fallback?.url;
        if (!assetUrl) throw new Error("Webflow did not return a final asset URL.");
        
        res.status(200).json({ url: assetUrl });
    } catch (error) {
        console.error('Webflow Asset Upload Error:', error.response?.data);
        res.status(500).json({ error: 'Failed to upload image to Webflow.' });
    }
});

// 3. Endpoint to CREATE a new cluster item in the CMS
app.post('/api/create-cluster', async (req, res) => {
    const { uid, fieldData } = req.body;
    if (!uid || !fieldData) return res.status(400).json({ error: "Missing required data for creation." });
    
    fieldData['firebase-uid'] = uid; // Inject the user's Firebase ID for ownership

    try {
        const createResponse = await axios.post(WEBFLOW_API_URL, { fieldData }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });

        // Immediately update the new item with its own Webflow Item ID
        const newItem = createResponse.data.item;
        await axios.patch(`${WEBFLOW_API_URL}/${newItem.id}`, {
            fieldData: { 'webflow-item-id': newItem.id, '_archived': false, '_draft': false }
        }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });

        res.status(200).json(newItem);
    } catch (error) {
        console.error('Create Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to create cluster in CMS." });
    }
});

// 4. Endpoint to GET ALL clusters owned by a specific user
app.get('/api/get-my-clusters', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Firebase UID is required to fetch clusters." });

    try {
        const listItemsResponse = await axios.get(WEBFLOW_API_URL, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` }
        });
        const userItems = listItemsResponse.data.items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.status(200).json(userItems);
    } catch (error) {
        console.error('Get My Clusters Error:', error.response?.data);
        res.status(500).json({ error: "Failed to fetch user's cluster data." });
    }
});

// 5. Endpoint to GET ONE specific cluster for the edit page
app.get('/api/get-single-cluster', async (req, res) => {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "Webflow Item ID is required." });

    try {
        const itemResponse = await axios.get(`${WEBFLOW_API_URL}/${itemId}`, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` }
        });
        res.status(200).json(itemResponse.data.item);
    } catch (error) {
        console.error('Get Single Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to fetch single cluster data." });
    }
});

// 6. Endpoint to UPDATE an existing cluster
app.patch('/api/update-cluster', async (req, res) => {
    const { itemId, fieldData } = req.body;
    if (!itemId || !fieldData) return res.status(400).json({ error: "Missing required data for update." });
    
    try {
        const updateResponse = await axios.patch(`${WEBFLOW_API_URL}/${itemId}`, { fieldData }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });
        res.status(200).json(updateResponse.data);
    } catch (error) {
        console.error('Update Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to update cluster." });
    }
});

// 7. Endpoint to DELETE a cluster
app.delete('/api/delete-cluster', async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "Webflow Item ID is required for deletion." });

    try {
        await axios.delete(`${WEBFLOW_API_URL}/${itemId}`, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` }
        });
        res.status(200).json({ success: true, message: "Cluster successfully deleted." });
    } catch (error) {
        console.error('Delete Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to delete cluster." });
    }
});

// --- START THE SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => {
    console.log(`SCL-HUB User API is running and listening on port ${port}`);
});