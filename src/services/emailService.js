const nodemailer = require('nodemailer');
const Handlebars = require('handlebars');

let transporter = null;

function buildTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  // Default: Gmail App Password
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });
}

function getTransporter() {
  if (!transporter) transporter = buildTransporter();
  return transporter;
}

/**
 * Render a Handlebars template string with client variables.
 * Available variables: {{name}}, {{firstName}}, {{lastName}},
 * {{email}}, {{company}}, {{phone}}, {{today}}, and any custom fields.
 */
function renderTemplate(template, client) {
  const vars = {
    name:      client.name      || '',
    firstName: (client.name || '').split(' ')[0] || '',
    lastName:  (client.name || '').split(' ').slice(1).join(' ') || '',
    email:     client.email     || '',
    company:   client.company   || '',
    phone:     client.phone     || '',
    today:     new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' }),
    ...client.customFields
  };
  return Handlebars.compile(template)(vars);
}

/**
 * Send an email for a queue item.
 * Returns { messageId } on success, throws on failure.
 */
async function sendEmail({ to, toName, subject, body }) {
  const t = getTransporter();
  const fromName = process.env.EMAIL_FROM_NAME || process.env.EMAIL_USER || 'Outreach';
  const fromAddr = process.env.EMAIL_USER || process.env.SMTP_USER;

  const info = await t.sendMail({
    from:    `"${fromName}" <${fromAddr}>`,
    to:      toName ? `"${toName}" <${to}>` : to,
    subject,
    html:    body.replace(/\n/g, '<br>'),
    text:    body
  });

  return { messageId: info.messageId };
}

/**
 * Verify SMTP credentials — useful for the settings page.
 */
async function verifyConnection() {
  const t = getTransporter();
  await t.verify();
  return true;
}

module.exports = { renderTemplate, sendEmail, verifyConnection };
