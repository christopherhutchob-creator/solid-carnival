/**
 * WhatsApp service via Twilio API.
 * Uses Node's built-in https module — no extra SDK needed.
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID    - Your Twilio Account SID
 *   TWILIO_AUTH_TOKEN     - Your Twilio Auth Token
 *   TWILIO_WHATSAPP_FROM  - Twilio WhatsApp sender, e.g. whatsapp:+14155238886
 */

const https = require('https');

function isConfigured() {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN  &&
    process.env.TWILIO_WHATSAPP_FROM
  );
}

function twilioRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const sid       = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!sid || !authToken) {
      return reject(new Error('Twilio credentials not configured'));
    }

    const postData = body ? new URLSearchParams(body).toString() : '';
    const auth     = Buffer.from(`${sid}:${authToken}`).toString('base64');

    const options = {
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${sid}/${endpoint}`,
      method,
      headers: {
        'Authorization':  `Basic ${auth}`,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function getMessages(limit = 20) {
  const from = encodeURIComponent(process.env.TWILIO_WHATSAPP_FROM || '');
  const endpoint = `Messages.json?From=${from}&PageSize=${limit}`;
  const res = await twilioRequest('GET', endpoint, null);

  return (res.messages || []).map(m => ({
    id:          m.sid,
    from:        m.from,
    to:          m.to,
    body:        m.body,
    direction:   m.direction,   // 'inbound' | 'outbound-api'
    status:      m.status,
    dateSent:    m.date_sent,
    dateCreated: m.date_created
  }));
}

async function sendMessage(to, body) {
  const from    = process.env.TWILIO_WHATSAPP_FROM;
  if (!from) throw new Error('TWILIO_WHATSAPP_FROM not configured');

  const toAddr = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const res    = await twilioRequest('POST', 'Messages.json', { From: from, To: toAddr, Body: body });

  if (res.status === 'failed' || res.error_code) {
    throw new Error(res.error_message || `Twilio error ${res.error_code}`);
  }
  return { id: res.sid, status: res.status };
}

module.exports = { isConfigured, getMessages, sendMessage };
