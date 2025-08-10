require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const stream = require('stream');
const { WebflowClient } = require('webflow-api');

const app = express();
app.use(cors());
app.use(express.json());

const {
  WEBFLOW_CLIENT_ID,
  WEBFLOW_CLIENT_SECRET,
  COLLECTION_ID,
  SITE_ID,
  REDIRECT_URI, // Ensure this matches your registered OAuth redirect URI
} = process.env;

// Simple in-memory token—replace with DB or persistent store if needed
let webflowAccessToken = process.env.WEBFLOW_ACCESS_TOKEN || null;

// Helper to create Webflow SDK instance
function getWebflowClient() {
  if (!webflowAccessToken) throw new Error('Webflow API not authenticated');
  return new WebflowClient({ accessToken: webflowAccessToken });
}

// OAuth - redirect to Webflow for authentication
app.get('/', (req, res) => {
  const installUrl = WebflowClient.authorizeURL({
    clientId: WEBFLOW_CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: 'cms:read cms:write assets:write',
  });
  res.redirect(installUrl);
});

// OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code.');

  try {
    const tokenResponse = await WebflowClient.getAccessToken({
      clientId: WEBFLOW_CLIENT_ID,
      clientSecret: WEBFLOW_CLIENT_SECRET,
      code,
      redirectUri: REDIRECT_URI,
    });
    webflowAccessToken = tokenResponse.access_token;
    // Optionally persist token here (DB or file)
    res.send('<h1>Authenticated.</h1><p>You may now close this window.</p>');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('Authentication failed.');
  }
});

const upload = multer({ storage: multer.memoryStorage() });

// GET all clusters for user
app.get('/api/get-my-clusters', async (req, res) => {
  try {
    const { uid } = req.query;
    if (!uid) return res.status(400).json({ error: 'UID is required.' });

    const webflow = getWebflowClient();
    const resp = await webflow.items.list({ collectionId: COLLECTION_ID });
    const userItems = resp.items.filter(i => i.fieldData['firebase-uid'] === uid);
    res.json(userItems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET single cluster
app.get('/api/get-single-cluster', async (req, res) => {
  try {
    const { itemId } = req.query;
    if (!itemId) return res.status(400).json({ error: 'Item ID is required.' });

    const webflow = getWebflowClient();
    const item = await webflow.items.get({ collectionId: COLLECTION_ID, itemId });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE cluster
app.post('/api/create-cluster', async (req, res) => {
  try {
    const { uid, fieldData } = req.body;
    if (!uid || !fieldData || !fieldData.name) {
      return res.status(400).json({ error: 'Missing required data.' });
    }

    const webflow = getWebflowClient();
    fieldData['firebase-uid'] = uid;
    fieldData.slug = fieldData.name.toLowerCase()
      .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const newItem = await webflow.items.createItem({
      collectionId: COLLECTION_ID,
      fields: fieldData,
    });

    // Optionally publish if needed by calling relevant SDK method

    res.status(201).json(newItem);
  } catch (err) {
    console.error('Create error:', err.body || err.message);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE cluster
app.patch('/api/update-cluster', async (req, res) => {
  try {
    const { itemId, fieldData } = req.body;
    if (!itemId || !fieldData) return res.status(400).json({ error: 'Missing required data.' });

    const webflow = getWebflowClient();
    const updated = await webflow.items.patchItem({
      collectionId: COLLECTION_ID,
      itemId,
      fields: fieldData,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE cluster
app.delete('/api/delete-cluster', async (req, res) => {
  try {
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'Item ID required.' });

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
    if (!req.file) return res.status(400).json({ error: 'File is required.' });
    const webflow = getWebflowClient();

    const readStream = stream.Readable.from(req.file.buffer);

    const asset = await webflow.assets.uploadAsset({
      siteId: SITE_ID,
      fileName: req.file.originalname,
      file: readStream,
    });

    res.json({ url: asset.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`API running on port ${port}`));
