const express = require('express');
const multer  = require('multer');
const csv     = require('csv-parser');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const store   = require('../data/store');
const { updateClientRow } = require('../services/sheetsService');

const router  = express.Router();
const upload  = multer({ dest: 'uploads/' });

// GET /api/clients
router.get('/', (req, res) => {
  let clients = store.clients;

  // Optional filters
  const { status, search } = req.query;
  if (status) clients = clients.filter(c => c.status === status);
  if (search) {
    const q = search.toLowerCase();
    clients = clients.filter(c =>
      (c.name    || '').toLowerCase().includes(q) ||
      (c.email   || '').toLowerCase().includes(q) ||
      (c.company || '').toLowerCase().includes(q)
    );
  }

  res.json(clients);
});

// GET /api/clients/:id
router.get('/:id', (req, res) => {
  const client = store.clients.find(c => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  res.json(client);
});

// POST /api/clients
router.post('/', (req, res) => {
  const { name, email, company, phone, notes, tags } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const clients = store.clients;
  if (clients.find(c => c.email === email)) {
    return res.status(409).json({ error: 'A client with that email already exists' });
  }

  const client = {
    id:              uuidv4(),
    name:            name    || '',
    email,
    company:         company || '',
    phone:           phone   || '',
    notes:           notes   || '',
    tags:            Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []),
    status:          'new',
    emailsSent:      0,
    lastContactedAt: null,
    createdAt:       new Date().toISOString(),
    customFields:    {}
  };

  store.save({ clients: [...clients, client] });

  // Async sheet sync (don't block response)
  updateClientRow(client).catch(() => {});

  res.status(201).json(client);
});

// PUT /api/clients/:id
router.put('/:id', (req, res) => {
  const clients = store.clients;
  const idx     = clients.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Client not found' });

  const allowed = ['name', 'email', 'company', 'phone', 'notes', 'tags', 'status', 'customFields'];
  const updated = { ...clients[idx] };
  allowed.forEach(k => {
    if (req.body[k] !== undefined) updated[k] = req.body[k];
  });

  if (req.body.tags && !Array.isArray(req.body.tags)) {
    updated.tags = req.body.tags.split(',').map(t => t.trim());
  }

  const newClients = [...clients];
  newClients[idx] = updated;
  store.save({ clients: newClients });

  updateClientRow(updated).catch(() => {});

  res.json(updated);
});

// DELETE /api/clients/:id
router.delete('/:id', (req, res) => {
  const clients = store.clients.filter(c => c.id !== req.params.id);
  store.save({ clients });
  res.json({ success: true });
});

// POST /api/clients/import/csv  — bulk import from CSV file
router.post('/import/csv', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const results  = [];
  const existing = store.clients;
  const existingEmails = new Set(existing.map(c => c.email));

  fs.createReadStream(req.file.path)
    .pipe(csv())
    .on('data', row => {
      // Accepts columns: name, email, company, phone, notes, tags
      const email = (row.email || row.Email || '').trim();
      if (!email || existingEmails.has(email)) return;
      existingEmails.add(email);

      results.push({
        id:              uuidv4(),
        name:            row.name    || row.Name    || '',
        email,
        company:         row.company || row.Company || '',
        phone:           row.phone   || row.Phone   || '',
        notes:           row.notes   || row.Notes   || '',
        tags:            (row.tags   || row.Tags    || '').split(',').map(t => t.trim()).filter(Boolean),
        status:          'new',
        emailsSent:      0,
        lastContactedAt: null,
        createdAt:       new Date().toISOString(),
        customFields:    {}
      });
    })
    .on('end', () => {
      fs.unlinkSync(req.file.path);
      const allClients = [...existing, ...results];
      store.save({ clients: allClients });
      res.json({ imported: results.length, total: allClients.length });
    })
    .on('error', err => {
      res.status(500).json({ error: err.message });
    });
});

module.exports = router;
