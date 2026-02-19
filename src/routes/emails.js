const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const store    = require('../data/store');
const { renderTemplate, sendEmail } = require('../services/emailService');
const { scheduleFollowUps }         = require('../services/followUpService');
const { updateClientRow }           = require('../services/sheetsService');

const router = express.Router();

// ── GET /api/emails ──────────────────────────────────────────────────────────
// List emails — filter by status, clientId
router.get('/', (req, res) => {
  let emails = store.emails;
  const { status, clientId } = req.query;
  if (status)   emails = emails.filter(e => e.status   === status);
  if (clientId) emails = emails.filter(e => e.clientId === clientId);

  // Enrich with client name for display
  const clients = store.clients;
  emails = emails.map(e => {
    const client = clients.find(c => c.id === e.clientId) || {};
    return { ...e, clientName: client.name || '', clientEmail: client.email || '' };
  });

  res.json(emails);
});

// ── GET /api/emails/:id ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const email = store.emails.find(e => e.id === req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  res.json(email);
});

// ── POST /api/emails/compose ─────────────────────────────────────────────────
// Compose emails for one or more clients using a template.
// Creates queue items with status: 'pending' (awaiting review).
router.post('/compose', (req, res) => {
  const { clientIds, templateId, scheduleFollowUpsFlag } = req.body;

  if (!clientIds || !clientIds.length) {
    return res.status(400).json({ error: 'clientIds is required' });
  }
  if (!templateId) {
    return res.status(400).json({ error: 'templateId is required' });
  }

  const template  = store.templates.find(t => t.id === templateId);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const clients   = store.clients;
  const existing  = store.emails;
  const created   = [];

  clientIds.forEach(clientId => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;

    const renderedSubject = renderTemplate(template.subject, client);
    const renderedBody    = renderTemplate(template.body,    client);

    const item = {
      id:              uuidv4(),
      clientId:        client.id,
      templateId:      template.id,
      subject:         renderedSubject,
      body:            renderedBody,
      status:          'pending',   // must be approved before send
      followUpNumber:  0,
      previousEmailId: null,
      scheduledFor:    null,
      createdAt:       new Date().toISOString(),
      sentAt:          null,
      scheduleFollowUpsOnSend: scheduleFollowUpsFlag !== false
    };

    created.push(item);
  });

  store.save({ emails: [...existing, ...created] });
  res.status(201).json({ created: created.length, items: created });
});

// ── PUT /api/emails/:id ──────────────────────────────────────────────────────
// Edit a pending email (subject / body) before approval.
router.put('/:id', (req, res) => {
  const emails = store.emails;
  const idx    = emails.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Email not found' });

  if (!['pending', 'rejected'].includes(emails[idx].status)) {
    return res.status(400).json({ error: 'Only pending or rejected emails can be edited' });
  }

  const updated = {
    ...emails[idx],
    subject: req.body.subject ?? emails[idx].subject,
    body:    req.body.body    ?? emails[idx].body,
    status:  'pending'  // editing resets to pending
  };

  const newEmails = [...emails];
  newEmails[idx]  = updated;
  store.save({ emails: newEmails });
  res.json(updated);
});

// ── POST /api/emails/:id/approve ─────────────────────────────────────────────
// Mark email as approved — it will send immediately.
router.post('/:id/approve', async (req, res) => {
  const emails = store.emails;
  const idx    = emails.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Email not found' });

  const item = emails[idx];
  if (item.status !== 'pending') {
    return res.status(400).json({ error: 'Email is not in pending state' });
  }

  const clients = store.clients;
  const client  = clients.find(c => c.id === item.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  try {
    const result = await sendEmail({
      to:      client.email,
      toName:  client.name,
      subject: item.subject,
      body:    item.body
    });

    // Mark email as sent
    const sentItem = {
      ...item,
      status:    'sent',
      sentAt:    new Date().toISOString(),
      messageId: result.messageId
    };
    const newEmails = [...emails];
    newEmails[idx]  = sentItem;

    // Update client stats
    const clientIdx = clients.findIndex(c => c.id === client.id);
    const updatedClient = {
      ...client,
      emailsSent:      (client.emailsSent || 0) + 1,
      lastContactedAt: new Date().toISOString(),
      status:          client.status === 'new' ? 'contacted' : client.status
    };
    const newClients  = [...clients];
    newClients[clientIdx] = updatedClient;

    // Schedule follow-ups if requested
    const templates = store.templates;
    if (item.scheduleFollowUpsOnSend && item.followUpNumber === 0) {
      // temporarily save so scheduleFollowUps can read templates
      store.save({ emails: newEmails, clients: newClients });
      scheduleFollowUps(sentItem, updatedClient, templates);
    } else {
      store.save({ emails: newEmails, clients: newClients });
    }

    // Async sheet sync
    updateClientRow(updatedClient).catch(() => {});

    res.json({ success: true, email: sentItem, client: updatedClient });
  } catch (err) {
    // Mark as failed so user can retry
    const failedItem = { ...item, status: 'failed', errorMessage: err.message };
    const newEmails  = [...emails];
    newEmails[idx]   = failedItem;
    store.save({ emails: newEmails });
    res.status(500).json({ error: `Send failed: ${err.message}` });
  }
});

// ── POST /api/emails/:id/reject ──────────────────────────────────────────────
router.post('/:id/reject', (req, res) => {
  const emails = store.emails;
  const idx    = emails.findIndex(e => e.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Email not found' });

  const updated = { ...emails[idx], status: 'rejected', rejectedReason: req.body.reason || '' };
  const newEmails = [...emails];
  newEmails[idx] = updated;
  store.save({ emails: newEmails });
  res.json(updated);
});

// ── DELETE /api/emails/:id ───────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const emails = store.emails.filter(e => e.id !== req.params.id);
  store.save({ emails });
  res.json({ success: true });
});

// ── GET /api/emails/stats/summary ───────────────────────────────────────────
router.get('/stats/summary', (req, res) => {
  const emails  = store.emails;
  const clients = store.clients;

  res.json({
    totalClients:   clients.length,
    totalEmails:    emails.length,
    pending:        emails.filter(e => e.status === 'pending').length,
    sent:           emails.filter(e => e.status === 'sent').length,
    failed:         emails.filter(e => e.status === 'failed').length,
    rejected:       emails.filter(e => e.status === 'rejected').length,
    clientsByStatus: {
      new:            clients.filter(c => c.status === 'new').length,
      contacted:      clients.filter(c => c.status === 'contacted').length,
      responded:      clients.filter(c => c.status === 'responded').length,
      interested:     clients.filter(c => c.status === 'interested').length,
      converted:      clients.filter(c => c.status === 'converted').length,
      not_interested: clients.filter(c => c.status === 'not_interested').length
    }
  });
});

module.exports = router;
