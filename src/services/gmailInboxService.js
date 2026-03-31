/**
 * Gmail Inbox service — reads messages via the Gmail API (OAuth2).
 */

const { google } = require('googleapis');
const { getAuthorizedClient } = require('./googleOAuthService');

async function getInboxMessages(maxResults = 20) {
  const auth  = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });

  const listRes = await gmail.users.messages.list({
    userId:     'me',
    maxResults,
    labelIds:   ['INBOX']
  });

  if (!listRes.data.messages || listRes.data.messages.length === 0) return [];

  const details = await Promise.all(
    listRes.data.messages.map(async (m) => {
      try {
        const res = await gmail.users.messages.get({
          userId:          'me',
          id:              m.id,
          format:          'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
        });

        const headers = res.data.payload.headers || [];
        const get     = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';

        return {
          id:       m.id,
          from:     get('From'),
          subject:  get('Subject') || '(no subject)',
          date:     get('Date'),
          snippet:  res.data.snippet || '',
          isUnread: (res.data.labelIds || []).includes('UNREAD'),
          threadId: res.data.threadId
        };
      } catch {
        return null;
      }
    })
  );

  return details.filter(Boolean);
}

async function getUnreadCount() {
  const auth  = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const res   = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
  return res.data.messagesUnread || 0;
}

async function getUserEmail() {
  const auth  = await getAuthorizedClient();
  const gmail = google.gmail({ version: 'v1', auth });
  const res   = await gmail.users.getProfile({ userId: 'me' });
  return res.data.emailAddress;
}

module.exports = { getInboxMessages, getUnreadCount, getUserEmail };
