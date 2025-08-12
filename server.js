import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { kv } from '@vercel/kv';

const app = express();
app.use(cors());
app.use(express.json());

const {
  WEBFLOW_CLIENT_ID,
  WEBFLOW_CLIENT_SECRET,
  WEBFLOW_REDIRECT_URI, // e.g. "https://yourapp.vercel.app/oauth/callback"
  COLLECTION_ID,
  SITE_ID
} = process.env;

if (!WEBFLOW_CLIENT_ID || !WEBFLOW_CLIENT_SECRET || !WEBFLOW_REDIRECT_URI) {
  console.error('❌ Missing required environment variables.');
  process.exit(1);
}

const WEBFLOW_AUTH_URL = 'https://webflow.com/oauth/authorize';
const WEBFLOW_TOKEN_URL = 'https://api.webflow.com/oauth/access_token';
const WEBFLOW_API_BASE = 'https://api.webflow.com';

// Step 1: Redirect to Webflow OAuth
app.get('/auth', (req, res) => {
  const authUrl = `${WEBFLOW_AUTH_URL}?client_id=${WEBFLOW_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(WEBFLOW_REDIRECT_URI)}`;
  res.redirect(authUrl);
});

// Step 2: OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing code');

  try {
    const tokenRes = await fetch(WEBFLOW_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: WEBFLOW_CLIENT_ID,
        client_secret: WEBFLOW_CLIENT_SECRET,
        grant_type: 'authorization_code',
        redirect_uri: WEBFLOW_REDIRECT_URI,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (tokenData.error) {
      console.error('OAuth Error:', tokenData);
      return res.status(400).send(tokenData);
    }

    // Save tokens in KV
    await kv.set('webflow_tokens', tokenData);
    res.send('✅ Webflow authenticated and tokens saved in KV.');
  } catch (err) {
    console.error('OAuth Callback Error:', err);
    res.status(500).send('OAuth callback failed.');
  }
});

// Helper: Get valid token (refresh if expired)
async function getValidToken() {
  const tokens = await kv.get('webflow_tokens');
  if (!tokens) throw new Error('No tokens stored. Please authenticate.');

  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at && now > tokens.expires_at - 60) {
    console.log('🔄 Refreshing expired token...');
    const refreshRes = await fetch(WEBFLOW_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: WEBFLOW_CLIENT_ID,
        client_secret: WEBFLOW_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token
      })
    });

    const newTokens = await refreshRes.json();
    if (newTokens.error) throw new Error('Token refresh failed');

    newTokens.expires_at = now + newTokens.expires_in;
    await kv.set('webflow_tokens', newTokens);
    return newTokens.access_token;
  }

  return tokens.access_token;
}

// Example API call
app.post('/create-item', async (req, res) => {
  try {
    const accessToken = await getValidToken();
    const response = await fetch(`${WEBFLOW_API_BASE}/collections/${COLLECTION_ID}/items`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'accept-version': '1.0.0',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          name: 'Test Item',
          slug: `test-item-${Date.now()}`,
          _archived: false,
          _draft: false
        }
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('Create Item Error:', err);
    res.status(500).send('Failed to create item.');
  }
});

app.listen(3000, () => {
  console.log('✅ Server running on port 3000');
});
