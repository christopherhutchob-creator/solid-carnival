const express = require('express');
const XLSX    = require('xlsx');
const store   = require('../data/store');
const { syncClients } = require('../services/sheetsService');

const router = express.Router();

// POST /api/sheets/sync  — push all clients to Google Sheets
router.post('/sync', async (req, res) => {
  try {
    const result = await syncClients(store.clients);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sheets/export  — download Excel file
router.get('/export', (req, res) => {
  const clients = store.clients;
  const emails  = store.emails;

  // ── Sheet 1: Clients ──────────────────────────────────────────────────────
  const clientRows = clients.map(c => ({
    ID:             c.id,
    Name:           c.name,
    Email:          c.email,
    Company:        c.company       || '',
    Phone:          c.phone         || '',
    Status:         c.status        || 'new',
    Tags:           (c.tags || []).join(', '),
    Notes:          c.notes         || '',
    'Emails Sent':  c.emailsSent    || 0,
    'Last Contacted': c.lastContactedAt ? new Date(c.lastContactedAt).toLocaleString() : '',
    'Created At':     c.createdAt       ? new Date(c.createdAt).toLocaleString()       : ''
  }));

  // ── Sheet 2: Email History ────────────────────────────────────────────────
  const emailRows = emails
    .filter(e => e.status === 'sent')
    .map(e => {
      const client = clients.find(c => c.id === e.clientId) || {};
      return {
        'Email ID':      e.id,
        'Client Name':   client.name  || '',
        'Client Email':  client.email || '',
        Subject:         e.subject,
        'Follow-up #':   e.followUpNumber,
        'Sent At':       e.sentAt ? new Date(e.sentAt).toLocaleString() : ''
      };
    });

  const wb  = XLSX.utils.book_new();
  const ws1 = XLSX.utils.json_to_sheet(clientRows.length  ? clientRows  : [{ Message: 'No clients yet' }]);
  const ws2 = XLSX.utils.json_to_sheet(emailRows.length   ? emailRows   : [{ Message: 'No sent emails yet' }]);

  XLSX.utils.book_append_sheet(wb, ws1, 'Clients');
  XLSX.utils.book_append_sheet(wb, ws2, 'Email History');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="outreach-tracker.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// GET /api/sheets/settings  — get follow-up settings
router.get('/settings', (req, res) => {
  res.json(store.settings);
});

// PUT /api/sheets/settings  — update follow-up settings
router.put('/settings', (req, res) => {
  const current = store.settings;
  const updated = { ...current, ...req.body };
  store.save({ settings: updated });
  res.json(updated);
});

module.exports = router;
