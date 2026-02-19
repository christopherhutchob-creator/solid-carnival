const express = require('express');
const { v4: uuidv4 } = require('uuid');
const store   = require('../data/store');

const router  = express.Router();

const DEFAULT_TEMPLATES = [
  {
    id:      'tpl-initial',
    name:    'Initial Outreach',
    type:    'initial',
    subject: 'Quick question for {{company}}',
    body:    `Hi {{firstName}},

I hope this message finds you well. My name is {{senderName}} and I came across {{company}} — I was really impressed by what you're doing.

I'd love to explore whether there might be a way we could work together. Would you be open to a brief 15-minute call this week?

Looking forward to hearing from you.

Best regards,
{{senderName}}`,
    createdAt: new Date().toISOString()
  },
  {
    id:      'tpl-followup-1',
    name:    'Follow-up #1 (3 days)',
    type:    'followup',
    subject: 'Following up — {{company}}',
    body:    `Hi {{firstName}},

I just wanted to follow up on my previous message in case it got buried.

I'd genuinely love to connect and see if there's an opportunity to collaborate. Even a quick 10-minute chat would be great.

Are you available this week?

Best,
{{senderName}}`,
    createdAt: new Date().toISOString()
  },
  {
    id:      'tpl-followup-2',
    name:    'Follow-up #2 (7 days)',
    type:    'followup',
    subject: 'Last follow-up — {{company}}',
    body:    `Hi {{firstName}},

I don't want to keep filling your inbox, so this will be my last message for now.

If you're ever interested in connecting, feel free to reach out at any time. I'll leave the door open.

Wishing you all the best,
{{senderName}}`,
    createdAt: new Date().toISOString()
  }
];

// Seed default templates on first load
function seedDefaults() {
  const existing = store.templates;
  if (existing.length === 0) {
    store.save({ templates: DEFAULT_TEMPLATES });
  }
}
seedDefaults();

// GET /api/templates
router.get('/', (req, res) => {
  res.json(store.templates);
});

// GET /api/templates/:id
router.get('/:id', (req, res) => {
  const t = store.templates.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(t);
});

// POST /api/templates
router.post('/', (req, res) => {
  const { name, type, subject, body } = req.body;
  if (!name || !subject || !body) {
    return res.status(400).json({ error: 'name, subject and body are required' });
  }

  const template = {
    id:        uuidv4(),
    name,
    type:      type || 'custom',
    subject,
    body,
    createdAt: new Date().toISOString()
  };

  const templates = store.templates;
  store.save({ templates: [...templates, template] });
  res.status(201).json(template);
});

// PUT /api/templates/:id
router.put('/:id', (req, res) => {
  const templates = store.templates;
  const idx       = templates.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Template not found' });

  const updated = {
    ...templates[idx],
    ...req.body,
    id:        templates[idx].id,
    createdAt: templates[idx].createdAt
  };

  const newTemplates = [...templates];
  newTemplates[idx] = updated;
  store.save({ templates: newTemplates });
  res.json(updated);
});

// DELETE /api/templates/:id
router.delete('/:id', (req, res) => {
  const templates = store.templates.filter(t => t.id !== req.params.id);
  store.save({ templates });
  res.json({ success: true });
});

module.exports = router;
