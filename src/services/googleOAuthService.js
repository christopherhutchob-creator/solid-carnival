/**
 * Google OAuth2 service — manages tokens for Gmail + Calendar access.
 * Tokens are persisted to src/data/google_token.json (git-ignored).
 */

const { google } = require('googleapis');
const fs   = require('fs');
const path = require('path');

const TOKEN_PATH = path.join(__dirname, '../data/google_token.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/userinfo.email'
];

function getOAuth2Client() {
  const clientId     = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_OAUTH_REDIRECT || 'http://localhost:3000/api/activity/auth/google/callback';
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function getAuthUrl() {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });
}

function saveToken(token) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2));
}

function loadToken() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function getAuthorizedClient() {
  const token = loadToken();
  if (!token) throw new Error('Google account not connected. Please authorize via the Activity Dashboard.');

  const client = getOAuth2Client();
  client.setCredentials(token);

  // Persist refreshed tokens automatically
  client.on('tokens', (tokens) => {
    const current = loadToken() || {};
    saveToken({ ...current, ...tokens });
  });

  return client;
}

async function handleCallback(code) {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);
  saveToken(tokens);
  client.setCredentials(tokens);
  return client;
}

function isConnected() {
  return !!loadToken();
}

function disconnect() {
  if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

module.exports = { getAuthUrl, getAuthorizedClient, handleCallback, isConnected, disconnect, isConfigured };
