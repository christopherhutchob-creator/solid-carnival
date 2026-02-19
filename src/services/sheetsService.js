const { google } = require('googleapis');

const SHEET_TITLE = 'Outreach Tracker';
const HEADERS = [
  'Client ID', 'Name', 'Email', 'Company', 'Phone',
  'Status', 'Tags', 'Notes', 'Emails Sent',
  'Last Contacted', 'Created At'
];

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google Sheets credentials not configured in .env');
  }
  return new google.auth.JWT(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/spreadsheets']
  );
}

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

/**
 * Ensure header row exists in the spreadsheet.
 */
async function ensureHeaders(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TITLE}!A1:K1`
  });
  if (!res.data.values || res.data.values.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TITLE}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] }
    });
  }
}

/**
 * Sync all clients to Google Sheets (full overwrite after headers).
 */
async function syncClients(clients) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEET_ID not set in .env');

  const sheets = getSheetsClient();
  await ensureHeaders(sheets, spreadsheetId);

  const rows = clients.map(c => [
    c.id,
    c.name          || '',
    c.email         || '',
    c.company       || '',
    c.phone         || '',
    c.status        || 'new',
    (c.tags || []).join(', '),
    c.notes         || '',
    c.emailsSent    || 0,
    c.lastContactedAt ? new Date(c.lastContactedAt).toLocaleString() : '',
    c.createdAt       ? new Date(c.createdAt).toLocaleString()       : ''
  ]);

  // Clear existing data rows (keep header)
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_TITLE}!A2:K`
  });

  if (rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TITLE}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: rows }
    });
  }

  return { synced: rows.length };
}

/**
 * Update a single client's row by matching on Client ID column.
 */
async function updateClientRow(client) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;

  const sheets = getSheetsClient();
  await ensureHeaders(sheets, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TITLE}!A:A`
  });

  const ids = (res.data.values || []).map(r => r[0]);
  const rowIndex = ids.findIndex(id => id === client.id);

  const row = [
    client.id,
    client.name          || '',
    client.email         || '',
    client.company       || '',
    client.phone         || '',
    client.status        || 'new',
    (client.tags || []).join(', '),
    client.notes         || '',
    client.emailsSent    || 0,
    client.lastContactedAt ? new Date(client.lastContactedAt).toLocaleString() : '',
    client.createdAt       ? new Date(client.createdAt).toLocaleString()       : ''
  ];

  if (rowIndex > 0) {
    // Row already exists — update it
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TITLE}!A${rowIndex + 1}`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  } else {
    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_TITLE}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [row] }
    });
  }
}

module.exports = { syncClients, updateClientRow };
