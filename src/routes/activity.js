/**
 * Activity Dashboard routes
 *
 * Tasks:      GET/POST/PUT/DELETE  /api/activity/tasks[/:id]
 *             PUT                  /api/activity/tasks/:id/complete
 * Gmail:      GET                  /api/activity/emails
 * Calendar:   GET                  /api/activity/calendar
 * WhatsApp:   GET                  /api/activity/whatsapp
 *             POST                 /api/activity/whatsapp/send
 *             POST                 /api/activity/whatsapp/webhook
 * Google Auth:GET                  /api/activity/auth/google
 *             GET                  /api/activity/auth/google/callback
 *             DELETE               /api/activity/auth/google
 * Status:     GET                  /api/activity/status
 * Feed:       GET                  /api/activity/feed
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const store    = require('../data/store');
const router   = express.Router();

const googleOAuth    = require('../services/googleOAuthService');
const gmailService   = require('../services/gmailInboxService');
const calService     = require('../services/googleCalendarService');
const waService      = require('../services/whatsappService');

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTasks() {
  const db = store;
  return db.tasks || [];
}

function saveTasks(tasks) {
  store.save({ tasks });
}

// ── Integration status ────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({
    google: {
      configured: googleOAuth.isConfigured(),
      connected:  googleOAuth.isConnected()
    },
    whatsapp: {
      configured: waService.isConfigured()
    }
  });
});

// ── Google OAuth ──────────────────────────────────────────────────────────────

router.get('/auth/google', (req, res) => {
  if (!googleOAuth.isConfigured()) {
    return res.status(400).json({
      error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
    });
  }
  const url = googleOAuth.getAuthUrl();
  res.json({ url });
});

router.get('/auth/google/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).send('Missing authorization code');
    await googleOAuth.handleCallback(code);
    // Redirect back to the activity dashboard
    res.send(`
      <html><body>
        <script>
          window.opener && window.opener.postMessage({ type: 'google_auth_success' }, '*');
          window.close();
        </script>
        <p>Google account connected! You can close this tab.</p>
      </body></html>
    `);
  } catch (err) {
    res.status(500).send(`Authorization failed: ${err.message}`);
  }
});

router.delete('/auth/google', (req, res) => {
  googleOAuth.disconnect();
  res.json({ success: true });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

router.get('/tasks', (req, res) => {
  const { status, priority, category } = req.query;
  let tasks = getTasks();
  if (status)   tasks = tasks.filter(t => t.completed === (status === 'completed'));
  if (priority) tasks = tasks.filter(t => t.priority === priority);
  if (category) tasks = tasks.filter(t => t.category === category);
  // Sort: incomplete first, then by due date, then by creation date
  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  res.json(tasks);
});

router.post('/tasks', (req, res) => {
  const { title, description, priority, category, dueDate } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });

  const task = {
    id:          uuidv4(),
    title:       title.trim(),
    description: (description || '').trim(),
    priority:    ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
    category:    ['email', 'calendar', 'whatsapp', 'general'].includes(category) ? category : 'general',
    dueDate:     dueDate || null,
    completed:   false,
    createdAt:   new Date().toISOString(),
    completedAt: null
  };

  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
  res.status(201).json(task);
});

router.put('/tasks/:id', (req, res) => {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });

  const { title, description, priority, category, dueDate } = req.body;
  const task = tasks[idx];

  if (title !== undefined)       task.title       = title.trim();
  if (description !== undefined) task.description = description.trim();
  if (priority !== undefined)    task.priority    = priority;
  if (category !== undefined)    task.category    = category;
  if (dueDate !== undefined)     task.dueDate     = dueDate || null;

  saveTasks(tasks);
  res.json(task);
});

router.put('/tasks/:id/complete', (req, res) => {
  const tasks = getTasks();
  const task  = tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  task.completed   = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  saveTasks(tasks);
  res.json(task);
});

router.delete('/tasks/:id', (req, res) => {
  const tasks = getTasks();
  const idx   = tasks.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Task not found' });
  tasks.splice(idx, 1);
  saveTasks(tasks);
  res.json({ success: true });
});

// ── Gmail Inbox ───────────────────────────────────────────────────────────────

router.get('/emails', async (req, res) => {
  if (!googleOAuth.isConnected()) {
    return res.status(401).json({ error: 'Google account not connected', needsAuth: true });
  }
  try {
    const limit    = parseInt(req.query.limit || '20', 10);
    const messages = await gmailService.getInboxMessages(limit);
    const unread   = await gmailService.getUnreadCount();
    res.json({ messages, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Google Calendar ───────────────────────────────────────────────────────────

router.get('/calendar', async (req, res) => {
  if (!googleOAuth.isConnected()) {
    return res.status(401).json({ error: 'Google account not connected', needsAuth: true });
  }
  try {
    const days   = parseInt(req.query.days || '7', 10);
    const events = await calService.getUpcomingEvents(30, days);
    const today  = await calService.getTodayEvents();
    res.json({ events, todayCount: today.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp ──────────────────────────────────────────────────────────────────

router.get('/whatsapp', async (req, res) => {
  if (!waService.isConfigured()) {
    return res.status(401).json({ error: 'Twilio WhatsApp not configured', needsSetup: true });
  }
  try {
    const limit    = parseInt(req.query.limit || '20', 10);
    const messages = await waService.getMessages(limit);
    // Also include locally stored incoming webhook messages
    const db = store;
    const incoming = (db.whatsappMessages || []).slice(-limit);
    res.json({ messages, incoming });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/whatsapp/send', async (req, res) => {
  if (!waService.isConfigured()) {
    return res.status(401).json({ error: 'Twilio WhatsApp not configured' });
  }
  try {
    const { to, body } = req.body;
    if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
    const result = await waService.sendMessage(to, body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Twilio webhook for incoming WhatsApp messages
router.post('/whatsapp/webhook', express.urlencoded({ extended: false }), (req, res) => {
  const { From, Body, MessageSid } = req.body;
  if (From && Body) {
    const db       = store;
    const messages = db.whatsappMessages || [];
    messages.push({
      id:          MessageSid || uuidv4(),
      from:        From,
      body:        Body,
      direction:   'inbound',
      receivedAt:  new Date().toISOString()
    });
    // Keep last 500 messages
    if (messages.length > 500) messages.splice(0, messages.length - 500);
    store.save({ whatsappMessages: messages });
  }
  // Twilio expects a TwiML response
  res.set('Content-Type', 'text/xml');
  res.send('<Response></Response>');
});

// ── Unified Activity Feed ─────────────────────────────────────────────────────

router.get('/feed', async (req, res) => {
  const items = [];

  // Tasks (recent 10)
  const tasks = getTasks()
    .filter(t => !t.completed)
    .slice(0, 10)
    .map(t => ({
      type:      'task',
      id:        t.id,
      title:     t.title,
      subtitle:  t.description,
      time:      t.dueDate || t.createdAt,
      priority:  t.priority,
      category:  t.category,
      icon:      '✓'
    }));
  items.push(...tasks);

  // Emails (if connected)
  if (googleOAuth.isConnected()) {
    try {
      const emails = await gmailService.getInboxMessages(10);
      emails.slice(0, 10).forEach(e => items.push({
        type:     'email',
        id:       e.id,
        title:    e.subject,
        subtitle: e.from,
        time:     e.date,
        isUnread: e.isUnread,
        icon:     '✉'
      }));
    } catch { /* not critical */ }

    // Calendar (if connected)
    try {
      const { events } = await calService.getUpcomingEvents(10, 7).then(ev => ({ events: ev }));
      events.slice(0, 10).forEach(e => items.push({
        type:     'calendar',
        id:       e.id,
        title:    e.title,
        subtitle: e.location || (e.attendees.length ? `${e.attendees.length} attendee(s)` : ''),
        time:     e.start,
        meetLink: e.meetLink,
        icon:     '📅'
      }));
    } catch { /* not critical */ }
  }

  // WhatsApp incoming messages
  const waMessages = (store.whatsappMessages || []).slice(-10);
  waMessages.reverse().forEach(m => items.push({
    type:     'whatsapp',
    id:       m.id,
    title:    m.body,
    subtitle: m.from,
    time:     m.receivedAt,
    icon:     '💬'
  }));

  // Sort everything by time descending
  items.sort((a, b) => {
    const tA = a.time ? new Date(a.time).getTime() : 0;
    const tB = b.time ? new Date(b.time).getTime() : 0;
    return tB - tA;
  });

  res.json(items.slice(0, 50));
});

module.exports = router;
