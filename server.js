// SCL-HUB USER API - The Final, Complete, and Robust Server
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const stream = require('stream');

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const { WEBFLOW_API_KEY, COLLECTION_ID, SITE_ID } = process.env;
const WEBFLOW_API_URL = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;
const WEBFLOW_SITE_URL = `https://api.webflow.com/v2/sites/${SITE_ID}`;

const upload = multer({ storage: multer.memoryStorage() });

// --- API ENDPOINTS ---

// 1. Root Endpoint for Health Checks
app.get('/', (req, res) => res.status(200).json({ status: "ok", message: "SCL-HUB User API is online." }));

// 2. Endpoint to handle image uploads
app.post('/api/upload-image', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file was uploaded." });
    try {
        const prepareUploadResponse = await axios.post(
            `${WEBFLOW_SITE_URL}/assets/upload`,
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

// 3. Endpoint to CREATE a new cluster item
app.post('/api/create-cluster', async (req, res) => {
    const { uid, fieldData } = req.body;
    if (!uid || !fieldData) {
        return res.status(400).json({ error: "Missing required data for creation." });
    }
    
    fieldData['firebase-uid'] = uid;

    try {
        const createResponse = await axios.post(WEBFLOW_API_URL, { fieldData }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });

        const newItem = createResponse.data.item;
        await axios.patch(`${WEBFLOW_API_URL}/${newItem.id}`, {
            fieldData: { 'webflow-item-id': newItem.id }
        }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });

        res.status(200).json(newItem);
    } catch (error) {
        console.error('Create Cluster Error:', error.response?.data);
        const errorMsg = error.response?.data?.details ? JSON.stringify(error.response.data.details) : "Failed to create cluster in CMS.";
        res.status(500).json({ error: errorMsg });
    }
});

// 4. Endpoint to GET ALL clusters for a user
app.get('/api/get-my-clusters', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Firebase UID is required." });
    try {
        const listItemsResponse = await axios.get(WEBFLOW_API_URL, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` } });
        const userItems = listItemsResponse.data.items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.status(200).json(userItems);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch user's cluster data." });
    }
});

// 5. Endpoint to GET ONE specific cluster
app.get('/api/get-single-cluster', async (req, res) => {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "Webflow Item ID is required." });
    try {
        const itemResponse = await axios.get(`${WEBFLOW_API_URL}/${itemId}`, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` } });
        res.status(200).json(itemResponse.data.item);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch single cluster data." });
    }
});

// 6. Endpoint to UPDATE an existing cluster
app.patch('/api/update-cluster', async (req, res) => {
    const { itemId, fieldData } = req.body;
    if (!itemId || !fieldData) return res.status(400).json({ error: "Missing data for update." });
    try {
        const updateResponse = await axios.patch(`${WEBFLOW_API_URL}/${itemId}`, { fieldData }, {
            headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }
        });
        res.status(200).json(updateResponse.data);
    } catch (error) {
        res.status(500).json({ error: "Failed to update cluster." });
    }
});

// 7. Endpoint to DELETE a cluster
app.delete('/api/delete-cluster', async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "Webflow Item ID is required." });
    try {
        await axios.delete(`${WEBFLOW_API_URL}/${itemId}`, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` } });
        res.status(200).json({ success: true, message: "Cluster deleted." });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete cluster." });
    }
});

// --- START THE SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => {
    console.log(`SCL-HUB User API is running and listening on port ${port}`);
});