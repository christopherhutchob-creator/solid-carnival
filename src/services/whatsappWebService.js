/**
 * WhatsApp service using whatsapp-web.js (no Twilio, no API keys).
 *
 * Connects via WhatsApp Web protocol — scan QR code once and the session
 * persists in src/data/wwebjs_auth/ so you won't need to re-scan.
 *
 * Flow:
 *   1. Call init() to start the client
 *   2. Poll getStatus() — when 'qr_ready', call getQR() to get a base64 PNG
 *   3. Display the QR in the browser and scan with your phone
 *   4. Status changes to 'ready' — messages are now accessible
 */

const path  = require('path');
const qrGen = require('qrcode');

// Lazy-load whatsapp-web.js so the server still starts even if Chrome
// isn't configured — the module is only required when the user starts a session.
let WAClient, LocalAuth;
function loadWWebJS() {
  if (!WAClient) {
    ({ Client: WAClient, LocalAuth } = require('whatsapp-web.js'));
  }
}

// ── Singleton state ────────────────────────────────────────────────────────

let client    = null;
let qrDataUrl = null;   // base64 PNG data URL while waiting for scan
let waStatus  = 'disconnected'; // 'disconnected' | 'initializing' | 'qr_ready' | 'ready' | 'error'
let lastError = null;
const recentMessages = [];  // in-memory ring buffer (max 100)

const CHROME_PATH = process.env.CHROME_EXECUTABLE_PATH ||
  '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome';

// ── Init / destroy ─────────────────────────────────────────────────────────

function init() {
  if (client || waStatus === 'initializing') return;

  loadWWebJS();
  waStatus  = 'initializing';
  qrDataUrl = null;
  lastError = null;

  client = new WAClient({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '../data/wwebjs_auth')
    }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ]
    }
  });

  client.on('qr', async (qr) => {
    try {
      qrDataUrl = await qrGen.toDataURL(qr);
      waStatus  = 'qr_ready';
    } catch (err) {
      lastError = err.message;
      waStatus  = 'error';
    }
  });

  client.on('authenticated', () => {
    qrDataUrl = null;
    waStatus  = 'connecting';
  });

  client.on('ready', () => {
    waStatus  = 'ready';
    qrDataUrl = null;
  });

  client.on('auth_failure', (msg) => {
    lastError = msg;
    waStatus  = 'error';
    client    = null;
  });

  client.on('disconnected', () => {
    waStatus = 'disconnected';
    client   = null;
  });

  // Store incoming messages in ring buffer
  client.on('message', async (msg) => {
    try {
      const contact = await msg.getContact();
      recentMessages.unshift({
        id:         msg.id.id,
        from:       msg.from,
        fromName:   contact.pushname || contact.name || msg.from,
        body:       msg.body,
        direction:  'inbound',
        timestamp:  new Date(msg.timestamp * 1000).toISOString()
      });
      if (recentMessages.length > 100) recentMessages.pop();
    } catch { /* non-critical */ }
  });

  client.initialize().catch(err => {
    lastError = err.message;
    waStatus  = 'error';
    client    = null;
  });
}

async function disconnect() {
  if (client) {
    try { await client.destroy(); } catch { /* ignore */ }
    client   = null;
  }
  waStatus  = 'disconnected';
  qrDataUrl = null;
}

// ── Public accessors ───────────────────────────────────────────────────────

function getStatus() {
  return { status: waStatus, error: lastError };
}

function getQR() {
  return qrDataUrl;
}

async function getMessages(limit = 20) {
  if (waStatus !== 'ready' || !client) {
    throw new Error('WhatsApp is not connected');
  }

  // Merge in-memory inbound messages with recent sent messages from chats
  const chats = await client.getChats();
  const sent  = [];

  for (const chat of chats.slice(0, 10)) {
    const msgs = await chat.fetchMessages({ limit: 5 });
    for (const m of msgs) {
      if (m.fromMe) {
        sent.push({
          id:        m.id.id,
          from:      'me',
          to:        m.to,
          body:      m.body,
          direction: 'outbound',
          timestamp: new Date(m.timestamp * 1000).toISOString()
        });
      }
    }
  }

  const all = [...recentMessages, ...sent].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  // Deduplicate by id
  const seen = new Set();
  return all.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  }).slice(0, limit);
}

async function sendMessage(to, body) {
  if (waStatus !== 'ready' || !client) {
    throw new Error('WhatsApp is not connected. Please scan the QR code first.');
  }
  // whatsapp-web.js expects number@c.us or a group ID
  const chatId = to.includes('@') ? to : `${to.replace(/\D/g, '')}@c.us`;
  const result = await client.sendMessage(chatId, body);

  // Add to ring buffer so it shows immediately in the dashboard
  recentMessages.unshift({
    id:        result.id.id,
    from:      'me',
    to:        chatId,
    body,
    direction: 'outbound',
    timestamp: new Date().toISOString()
  });
  if (recentMessages.length > 100) recentMessages.pop();

  return { id: result.id.id };
}

module.exports = { init, disconnect, getStatus, getQR, getMessages, sendMessage };
