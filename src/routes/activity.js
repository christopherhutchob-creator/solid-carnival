/**
 * Activity Dashboard routes
 *
 * Tasks:     GET/POST/PUT/DELETE  /api/activity/tasks[/:id]
 *            PUT                  /api/activity/tasks/:id/complete
 *
 * Email:     GET                  /api/activity/emails        (IMAP)
 *
 * Calendar:  GET                  /api/activity/calendar      (ICS feeds)
 *            GET                  /api/activity/calendar/urls
 *            POST                 /api/activity/calendar/urls
 *            DELETE               /api/activity/calendar/urls/:index
 *
 * WhatsApp:  GET                  /api/activity/whatsapp/status
 *            GET                  /api/activity/whatsapp/qr
 *            POST                 /api/activity/whatsapp/init
 *            POST                 /api/activity/whatsapp/disconnect
 *            GET                  /api/activity/whatsapp
 *            POST                 /api/activity/whatsapp/send
 *
 * Status:    GET                  /api/activity/status
 * Feed:      GET                  /api/activity/feed
 */

const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const store    = require('../data/store');

const imapService  = require('../services/imapService');
const icsService   = require('../services/icsCalendarService');
const waService    = require('../services/whatsappWebService');

const router = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getTasks() { return store.tasks || []; }
function saveTasks(tasks) { store.save({ tasks }); }

// ── Status ────────────────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  const imapCfg = imapService.getConfig();
  res.json({
    imap: {
      configured: imapService.isConfigured(),
      user:       imapCfg.user || null,
      host:       imapCfg.host
    },
    calendar: {
      urls: icsService.getCalendarUrls()
    },
    whatsapp: waService.getStatus()
  });
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

router.get('/tasks', (req, res) => {
  const { priority, category } = req.query;
  let tasks = getTasks();
  if (priority) tasks = tasks.filter(t => t.priority === priority);
  if (category) tasks = tasks.filter(t => t.category === category);

  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
    if (a.dueDate)  return -1;
    if (b.dueDate)  return 1;
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

// ── IMAP Email ────────────────────────────────────────────────────────────────

router.get('/emails', async (req, res) => {
  if (!imapService.isConfigured()) {
    return res.status(400).json({
      error:       'Email not configured',
      needsSetup:  true,
      hint:        'Set EMAIL_USER and EMAIL_APP_PASSWORD (or IMAP_USER / IMAP_PASS) in your .env file'
    });
  }
  try {
    const limit    = Math.min(parseInt(req.query.limit || '20', 10), 50);
    const [messages, unread] = await Promise.all([
      imapService.getInboxMessages(limit),
      imapService.getUnreadCount()
    ]);
    res.json({ messages, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ICS Calendar ──────────────────────────────────────────────────────────────

router.get('/calendar/urls', (req, res) => {
  res.json(icsService.getCalendarUrls());
});

router.post('/calendar/urls', (req, res) => {
  const { label, url } = req.body;
  if (!url || !url.trim()) return res.status(400).json({ error: 'URL is required' });
  try {
    const urls = icsService.addCalendarUrl(label, url.trim());
    res.status(201).json(urls);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/calendar/urls/:index', (req, res) => {
  try {
    const idx  = parseInt(req.params.index, 10);
    const urls = icsService.removeCalendarUrl(idx);
    res.json(urls);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/calendar', async (req, res) => {
  try {
    const days   = Math.min(parseInt(req.query.days || '7', 10), 60);
    const events = await icsService.getUpcomingEvents(days);
    const today  = await icsService.getTodayEventCount();
    res.json({ events, todayCount: today });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp (whatsapp-web.js) ─────────────────────────────────────────────────

router.get('/whatsapp/status', (req, res) => {
  res.json(waService.getStatus());
});

router.get('/whatsapp/qr', (req, res) => {
  const qr = waService.getQR();
  if (!qr) return res.status(404).json({ error: 'QR code not ready yet' });
  res.json({ qr });
});

router.post('/whatsapp/init', (req, res) => {
  try {
    waService.init();
    res.json({ success: true, message: 'WhatsApp client initialising — poll /status for QR code' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/whatsapp/disconnect', async (req, res) => {
  try {
    await waService.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/whatsapp', async (req, res) => {
  const { status } = waService.getStatus();
  if (status !== 'ready') {
    return res.status(400).json({ error: `WhatsApp is ${status}`, status });
  }
  try {
    const limit    = Math.min(parseInt(req.query.limit || '20', 10), 50);
    const messages = await waService.getMessages(limit);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/whatsapp/send', async (req, res) => {
  const { to, body } = req.body;
  if (!to || !body) return res.status(400).json({ error: 'to and body are required' });
  try {
    const result = await waService.sendMessage(to, body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Unified Activity Feed ──────────────────────────────────────────────────────

router.get('/feed', async (req, res) => {
  const items = [];

  // Open tasks → show as upcoming items
  getTasks()
    .filter(t => !t.completed)
    .slice(0, 15)
    .forEach(t => items.push({
      type:     'task',
      id:       t.id,
      title:    t.title,
      subtitle: t.description || (t.dueDate ? `Due ${t.dueDate}` : null),
      time:     t.dueDate || t.createdAt,
      priority: t.priority,
      category: t.category
    }));

  // Recent emails
  if (imapService.isConfigured()) {
    try {
      const { messages } = await Promise.race([
        imapService.getInboxMessages(10).then(m => ({ messages: m })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
      ]);
      messages.forEach(e => items.push({
        type:     'email',
        id:       e.id,
        title:    e.subject,
        subtitle: e.from,
        time:     e.date,
        isUnread: e.isUnread
      }));
    } catch { /* non-critical */ }
  }

  // Upcoming calendar events
  if (icsService.getCalendarUrls().length > 0) {
    try {
      const events = await icsService.getUpcomingEvents(7);
      events.slice(0, 10).forEach(e => items.push({
        type:     'calendar',
        id:       e.id,
        title:    e.title,
        subtitle: e.location || e.calendarLabel || null,
        time:     e.start,
        meetLink: e.meetLink
      }));
    } catch { /* non-critical */ }
  }

  // Recent WhatsApp messages (in-memory, no async needed)
  const { status } = waService.getStatus();
  if (status === 'ready') {
    try {
      const msgs = await waService.getMessages(10);
      msgs.forEach(m => items.push({
        type:     'whatsapp',
        id:       m.id,
        title:    m.body,
        subtitle: m.direction === 'inbound' ? m.fromName || m.from : `To: ${m.to}`,
        time:     m.timestamp
      }));
    } catch { /* non-critical */ }
  }

  items.sort((a, b) => {
    const tA = a.time ? new Date(a.time).getTime() : 0;
    const tB = b.time ? new Date(b.time).getTime() : 0;
    return tB - tA;
  });

  res.json(items.slice(0, 50));
});

module.exports = router;
