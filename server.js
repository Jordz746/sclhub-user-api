// SCL-HUB USER API - The Complete Backend Server (with OAuth)
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { WebflowClient } = require('webflow-api'); // Import the official Webflow SDK

const app = express();
app.use(cors());
app.use(express.json());

// --- CONFIGURATION ---
const { WEBFLOW_CLIENT_ID, WEBFLOW_CLIENT_SECRET, COLLECTION_ID, SITE_ID } = process.env;

// --- A simple in-memory store for the token (for this example) ---
let webflowAccessToken = null;

// --- API ENDPOINTS ---

// 1. The Root Endpoint (for health checks)
app.get('/', (req, res) => res.status(200).json({ status: "ok" }));

// 2. The OAuth Handshake Endpoint
// This is where Webflow sends the user after they authorize the app.
app.get('/auth/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) return res.status(400).send("Authorization code is missing.");

        // Exchange the temporary code for a permanent access token
        const token = await WebflowClient.getAccessToken({
            clientId: WEBFLOW_CLIENT_ID,
            clientSecret: WEBFLOW_CLIENT_SECRET,
            code: code,
        });
        
        // Store the token securely on the server
        webflowAccessToken = token;
        console.log("SUCCESS: Webflow Access Token received and stored.");

        // Send a success message to the user's browser
        res.send("<h1>Authentication Successful!</h1><p>Your SCL-HUB application is now connected to your Webflow site. You can close this window.</p>");

    } catch (error) {
        console.error("OAuth Callback Error:", error);
        res.status(500).send("An error occurred during authentication.");
    }
});

// A helper function to get an authenticated API client
function getWebflowClient() {
    if (!webflowAccessToken) {
        throw new Error("Webflow API is not authenticated. Please re-install the app.");
    }
    return new WebflowClient({ accessToken: webflowAccessToken });
}

// 3. All your other API endpoints now use the authenticated client
app.post('/api/create-cluster', async (req, res) => {
    try {
        const webflow = getWebflowClient();
        const { uid, fieldData } = req.body;
        // ... (rest of your create logic using webflow.items.create...)
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ... (Update your other endpoints: /get-my-clusters, /update-cluster, etc. in the same way)

// --- START THE SERVER ---
const port = process.env.PORT || 3004;
app.listen(port, () => console.log(`SCL-HUB User API is running on port ${port}`));