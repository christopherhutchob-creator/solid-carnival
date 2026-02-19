const cron     = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const store    = require('../data/store');
const { renderTemplate } = require('./emailService');

/**
 * Called after an email is marked as sent.
 * Schedules follow-up queue entries based on settings.
 */
function scheduleFollowUps(sentEmail, client, templates) {
  const db       = store;
  const settings = db.settings;
  const days     = settings.followupDays || [3, 7, 14];

  const currentEmails   = db.emails;
  const currentFollowups = db.followups;

  // Pick follow-up templates (type: 'followup')
  const followupTemplates = templates.filter(t => t.type === 'followup');

  const newFollowups = [];
  const newEmails    = [];

  days.forEach((d, idx) => {
    const template = followupTemplates[idx] || followupTemplates[followupTemplates.length - 1];
    if (!template) return; // no follow-up template configured

    const scheduledFor = new Date();
    scheduledFor.setDate(scheduledFor.getDate() + d);

    const renderedSubject = renderTemplate(template.subject, client);
    const renderedBody    = renderTemplate(template.body,    client);

    const emailItem = {
      id:              uuidv4(),
      clientId:        client.id,
      templateId:      template.id,
      subject:         renderedSubject,
      body:            renderedBody,
      status:          'pending',          // waits for approval
      followUpNumber:  idx + 1,
      previousEmailId: sentEmail.id,
      scheduledFor:    scheduledFor.toISOString(),
      createdAt:       new Date().toISOString(),
      sentAt:          null
    };

    const followupRecord = {
      id:           uuidv4(),
      clientId:     client.id,
      emailId:      emailItem.id,
      parentEmailId: sentEmail.id,
      followUpNumber: idx + 1,
      scheduledFor:  scheduledFor.toISOString(),
      status:        'pending'
    };

    newEmails.push(emailItem);
    newFollowups.push(followupRecord);
  });

  db.save({
    emails:    [...currentEmails,    ...newEmails],
    followups: [...currentFollowups, ...newFollowups]
  });

  return newEmails;
}

/**
 * Cron job: runs every hour, moves due follow-up emails from
 * 'pending_scheduled' → 'pending' so they appear in the review queue.
 */
function startFollowUpCron() {
  cron.schedule('0 * * * *', () => {
    const db     = store;
    const now    = new Date();
    const emails = db.emails;

    let changed = false;
    const updated = emails.map(e => {
      if (
        e.status === 'pending_scheduled' &&
        e.scheduledFor &&
        new Date(e.scheduledFor) <= now
      ) {
        changed = true;
        return { ...e, status: 'pending' };
      }
      return e;
    });

    if (changed) db.save({ emails: updated });
  });

  console.log('Follow-up cron scheduler started (runs every hour)');
}

module.exports = { scheduleFollowUps, startFollowUpCron };
