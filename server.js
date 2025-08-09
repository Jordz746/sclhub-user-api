// Full server.js for clarity:
// SCL-HUB USER API - The Complete Backend Server
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
const WEBFLOW_API_KEY = process.env.WEBFLOW_API_KEY;
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID;
const SITE_ID = process.env.WEBFLOW_SITE_ID;
const WEBFLOW_API_URL = `https://api.webflow.com/v2/collections/${COLLECTION_ID}/items`;
const WEBFLOW_SITE_URL = `https://api.webflow.com/v2/sites/${SITE_ID}`;
const upload = multer({ storage: multer.memoryStorage() });
app.get('/', (req, res) => res.status(200).json({ status: "ok", message: "SCL-HUB User API is online." }));
app.post('/api/upload-image', upload.single('file'), async (req, res) => { /* ... no change ... */ });
app.post('/api/create-cluster', async (req, res) => {
    const { uid, fieldData } = req.body;
    if (!uid || !fieldData) return res.status(400).json({ error: "Missing required data." });
    fieldData['firebase-uid'] = uid;
    try {
        const payload = { items: [{ fieldData: fieldData }] };
        const createResponse = await axios.post(WEBFLOW_API_URL, payload, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }});
        const newItem = createResponse.data.items[0];
        await axios.patch(`${WEBFLOW_API_URL}/${newItem.id}`, { fieldData: { 'webflow-item-id': newItem.id } }, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' }});
        res.status(200).json(newItem);
    } catch (error) {
        console.error('Create Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to create cluster." });
    }
});
app.get('/api/get-my-clusters', async (req, res) => { /* ... no change ... */ });
app.get('/api/get-single-cluster', async (req, res) => { /* ... no change ... */ });
app.patch('/api/update-cluster', async (req, res) => { /* ... no change ... */ });
app.delete('/api/delete-cluster', async (req, res) => { /* ... no change ... */ });
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API is running and listening on port ${port}`));
// These unchanged parts are collapsed but you should paste the full working code from our previous exchanges for them.
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
app.get('/api/get-my-clusters', async (req, res) => {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: "Firebase UID is required." });
    try {
        const response = await axios.get(WEBFLOW_API_URL);
        const userItems = response.data.items.filter(item => item.fieldData['firebase-uid'] === uid);
        res.status(200).json(userItems);
    } catch (error) {
        console.error('Get My Clusters Error:', error.response?.data);
        res.status(500).json({ error: "Failed to fetch clusters." });
    }
});
app.get('/api/get-single-cluster', async (req, res) => {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: "Webflow Item ID is required." });
    try {
        const itemResponse = await axios.get(`${WEBFLOW_API_URL}/${itemId}`, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` } });
        res.status(200).json(itemResponse.data.item);
    } catch (error) {
        console.error('Get Single Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to fetch cluster data." });
    }
});
app.patch('/api/update-cluster', async (req, res) => {
    const { itemId, fieldData } = req.body;
    if (!itemId || !fieldData) return res.status(400).json({ error: "Missing data." });
    try {
        const updateResponse = await axios.patch(`${WEBFLOW_API_URL}/${itemId}`, { fieldData }, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}`, 'Content-Type': 'application/json' } });
        res.status(200).json(updateResponse.data);
    } catch (error) {
        console.error('Update Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to update cluster." });
    }
});
app.delete('/api/delete-cluster', async (req, res) => {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: "Item ID is required." });
    try {
        await axios.delete(`${WEBFLOW_API_URL}/${itemId}`, { headers: { 'Authorization': `Bearer ${WEBFLOW_API_KEY}` } });
        res.status(200).json({ success: true, message: "Cluster deleted." });
    } catch (error) {
        console.error('Delete Cluster Error:', error.response?.data);
        res.status(500).json({ error: "Failed to delete cluster." });
    }
});