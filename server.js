require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { WebflowClient } = require('webflow-api');
const { kv } = require('@vercel/kv');

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

// --- ENV ---
const {
  WEBFLOW_CLIENT_ID,
  WEBFLOW_CLIENT_SECRET,
  REDIRECT_URI,
  COLLECTION_ID
} = process.env;

let client = null;

// --- Load token from KV ---
async function getWebflowClient() {
  if (!client) {
    const accessToken = await kv.get('webflow_access_token');
    if (!accessToken) throw new Error('Webflow API not authenticated.');
    client = new WebflowClient({ accessToken });
  }
  return client;
}

// --- Refresh token if expired ---
async function refreshToken() {
  const refreshToken = await kv.get('webflow_refresh_token');
  if (!refreshToken) throw new Error('No refresh token found.');

  const res = await fetch('https://api.webflow.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: WEBFLOW_CLIENT_ID,
      client_secret: WEBFLOW_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });

  const data = await res.json();
  if (data.access_token) {
    await kv.set('webflow_access_token', data.access_token);
    if (data.refresh_token) await kv.set('webflow_refresh_token', data.refresh_token);
    client = new WebflowClient({ accessToken: data.access_token });
  } else {
    console.error('Failed to refresh token:', data);
  }
}

// --- OAuth callback ---
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const response = await fetch('https://api.webflow.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: WEBFLOW_CLIENT_ID,
        client_secret: WEBFLOW_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
        code
      })
    });

    const data = await response.json();
    if (data.access_token) {
      await kv.set('webflow_access_token', data.access_token);
      await kv.set('webflow_refresh_token', data.refresh_token);
      client = new WebflowClient({ accessToken: data.access_token });
      res.send('✅ Webflow Authenticated!');
    } else {
      console.error(data);
      res.status(500).send('OAuth failed.');
    }
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    res.status(500).send('OAuth failed.');
  }
});

// --- Example create CMS item ---
app.post('/create-item', async (req, res) => {
  try {
    let wf = await getWebflowClient();
    const response = await wf.items.create({
      collectionId: COLLECTION_ID,
      fields: req.body
    });
    res.json(response);
  } catch (err) {
    if (err.message.includes('401')) {
      await refreshToken();
      let wf = await getWebflowClient();
      const response = await wf.items.create({
        collectionId: COLLECTION_ID,
        fields: req.body
      });
      res.json(response);
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

app.listen(3000, () => console.log('Server running...'));
