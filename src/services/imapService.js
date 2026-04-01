/**
 * IMAP inbox reader using imapflow.
 *
 * Uses IMAP_* env vars if set, otherwise falls back to the existing
 * EMAIL_USER / EMAIL_APP_PASSWORD credentials already configured for sending.
 *
 * Provider defaults (override with IMAP_HOST / IMAP_PORT):
 *   Gmail   → imap.gmail.com:993
 *   Outlook → outlook.office365.com:993
 *   iCloud  → imap.mail.me.com:993
 */

const { ImapFlow } = require('imapflow');

function getConfig() {
  const user = process.env.IMAP_USER || process.env.EMAIL_USER;
  const pass = process.env.IMAP_PASS || process.env.EMAIL_APP_PASSWORD;
  const host = process.env.IMAP_HOST || 'imap.gmail.com';
  const port = parseInt(process.env.IMAP_PORT || '993', 10);
  return { host, port, user, pass };
}

function isConfigured() {
  const { user, pass } = getConfig();
  return !!(user && pass);
}

async function getInboxMessages(maxResults = 20) {
  const { host, port, user, pass } = getConfig();

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
    // Suppress connection errors from flooding logs
    emitLogs: false
  });

  await client.connect();

  const messages = [];
  const lock = await client.getMailboxLock('INBOX');

  try {
    const total = client.mailbox.exists;
    if (total === 0) return [];

    // Fetch last N messages (highest sequence numbers)
    const start = Math.max(1, total - maxResults + 1);
    const range  = `${start}:${total}`;

    for await (const msg of client.fetch(range, {
      envelope: true,
      flags:    true,
      uid:      true
    })) {
      const from    = msg.envelope.from?.[0];
      const fromStr = from
        ? (from.name ? `${from.name} <${from.address}>` : from.address)
        : '';

      messages.push({
        id:       String(msg.uid),
        subject:  msg.envelope.subject || '(no subject)',
        from:     fromStr,
        date:     msg.envelope.date?.toISOString() || null,
        isUnread: !msg.flags.has('\\Seen')
      });
    }
  } finally {
    lock.release();
  }

  await client.logout();

  // Return newest first
  return messages.reverse();
}

async function getUnreadCount() {
  const { host, port, user, pass } = getConfig();

  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user, pass },
    logger: false,
    emitLogs: false
  });

  await client.connect();
  const status = await client.status('INBOX', { unseen: true });
  await client.logout();
  return status.unseen || 0;
}

module.exports = { isConfigured, getConfig, getInboxMessages, getUnreadCount };
