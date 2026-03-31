require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const clientRoutes   = require('./src/routes/clients');
const templateRoutes = require('./src/routes/templates');
const emailRoutes    = require('./src/routes/emails');
const sheetsRoutes   = require('./src/routes/sheets');
const activityRoutes = require('./src/routes/activity');
const { startFollowUpCron } = require('./src/services/followUpService');

// Ensure required directories exist
['uploads', 'src/data'].forEach(dir => {
  const p = path.join(__dirname, dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/clients',   clientRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/emails',    emailRoutes);
app.use('/api/sheets',    sheetsRoutes);
app.use('/api/activity',  activityRoutes);

// Email verify endpoint
app.get('/api/verify-email', async (req, res) => {
  try {
    const { verifyConnection } = require('./src/services/emailService');
    await verifyConnection();
    res.json({ success: true, message: 'Email connection verified' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start follow-up cron scheduler
startFollowUpCron();

app.listen(PORT, () => {
  console.log(`\n🚀 Email Outreach App running at http://localhost:${PORT}`);
  console.log(`   Review pending emails before they send at http://localhost:${PORT}/#queue\n`);
});
