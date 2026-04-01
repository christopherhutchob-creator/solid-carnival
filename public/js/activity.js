/* ─────────────────────────────────────────────────────────────────────────
 * Activity Dashboard — IMAP email · ICS calendar · WhatsApp Web · Tasks
 * ───────────────────────────────────────────────────────────────────────── */

const Activity = (() => {

  // ── State ──────────────────────────────────────────────────────────────────
  const S = {
    tasks:        [],
    emails:       [],
    calEvents:    [],
    calUrls:      [],
    waStatus:     'disconnected',
    waMessages:   [],
    imapOk:       false,
    _waPollTimer: null
  };

  // ── Tiny helpers ───────────────────────────────────────────────────────────

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function spinner() {
    return `<div class="act-loading"><div class="act-spinner"></div> Loading…</div>`;
  }

  function errBox(msg) {
    return `<div class="act-error">${esc(msg)}</div>`;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  }

  function relTime(val) {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d)) return String(val);
    const diff = Date.now() - d.getTime();
    if (diff < 0) {
      const s = Math.abs(diff) / 1000;
      if (s < 3600)  return `in ${Math.round(s/60)}m`;
      if (s < 86400) return `in ${Math.round(s/3600)}h`;
      return `in ${Math.round(s/86400)}d`;
    }
    const s = diff / 1000;
    if (s < 60)     return 'just now';
    if (s < 3600)   return `${Math.round(s/60)}m ago`;
    if (s < 86400)  return `${Math.round(s/3600)}h ago`;
    if (s < 604800) return `${Math.round(s/86400)}d ago`;
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  }

  function isOverdue(due) {
    if (!due) return false;
    return new Date(due) < new Date(new Date().toDateString());
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    await refresh();
  }

  async function refresh() {
    await checkStatus();
    await Promise.all([loadTasks(), loadEmails(), loadCalendar(), renderWaPanel()]);
    loadFeed();
  }

  async function checkStatus() {
    try {
      const s = await api('GET', '/api/activity/status');
      S.imapOk   = s.imap?.configured || false;
      S.calUrls  = s.calendar?.urls || [];
      S.waStatus = s.whatsapp?.status || 'disconnected';
    } catch {
      S.imapOk = false;
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async function loadTasks() {
    setEl('act-tasks-list', spinner());
    try {
      const filter = document.getElementById('act-task-filter')?.value || '';
      S.tasks = await api('GET', `/api/activity/tasks${filter ? `?priority=${filter}` : ''}`);
      renderTasks();
      setEl('act-stat-tasks', S.tasks.filter(t => !t.completed).length);
    } catch (err) {
      setEl('act-tasks-list', errBox(err.message));
    }
  }

  function filterTasks() { loadTasks(); }

  function renderTasks() {
    const list = document.getElementById('act-tasks-list');
    if (!list) return;
    if (!S.tasks.length) {
      list.innerHTML = `<div class="act-placeholder"><span>✓</span><p>No tasks yet — type one above and press Enter.</p></div>`;
      return;
    }
    list.innerHTML = S.tasks.map(t => {
      const ov = !t.completed && isOverdue(t.dueDate);
      return `
        <div class="act-task-item${t.completed ? ' completed' : ''}">
          <div class="act-task-check${t.completed ? ' done' : ''}"
               onclick="Activity.toggleTask('${t.id}')" title="${t.completed ? 'Mark incomplete' : 'Complete'}"></div>
          <div class="act-task-body">
            <div class="act-task-title">${esc(t.title)}</div>
            <div class="act-task-meta">
              <span class="prio-pill prio-${t.priority}">${t.priority}</span>
              <span class="cat-pill">${t.category}</span>
              ${t.dueDate
                ? `<span class="act-task-due${ov ? ' overdue' : ''}">${ov ? '⚠ Overdue · ' : ''}Due ${fmtDate(t.dueDate)}</span>`
                : ''}
            </div>
          </div>
          <div class="act-task-actions">
            <button class="btn btn-ghost btn-sm" onclick="Activity.openTaskModal('${t.id}')" title="Edit">✎</button>
            <button class="btn btn-ghost btn-sm" onclick="Activity.deleteTask('${t.id}')"    title="Delete">✕</button>
          </div>
        </div>`;
    }).join('');
  }

  async function quickAddTask() {
    const el = document.getElementById('act-quick-task');
    const title = el?.value?.trim();
    if (!title) return;
    try {
      await api('POST', '/api/activity/tasks', { title, priority: 'medium', category: 'general' });
      el.value = '';
      await loadTasks();
      toast('Task added', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function toggleTask(id) {
    try {
      await api('PUT', `/api/activity/tasks/${id}/complete`);
      await loadTasks();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function deleteTask(id) {
    try {
      await api('DELETE', `/api/activity/tasks/${id}`);
      await loadTasks();
      toast('Task deleted', 'info');
    } catch (err) { toast(err.message, 'error'); }
  }

  function openTaskModal(id) {
    const modal = document.getElementById('task-modal-overlay');
    if (!modal) return;
    document.getElementById('task-modal-title').textContent = id ? 'Edit Task' : 'Add Task';
    document.getElementById('task-modal-id').value          = id || '';
    if (id) {
      const t = S.tasks.find(x => x.id === id);
      if (t) {
        document.getElementById('tm-task-title').value    = t.title;
        document.getElementById('tm-task-desc').value     = t.description || '';
        document.getElementById('tm-task-priority').value = t.priority;
        document.getElementById('tm-task-category').value = t.category;
        document.getElementById('tm-task-due').value      = t.dueDate ? t.dueDate.slice(0,10) : '';
      }
    } else {
      document.getElementById('tm-task-title').value    = '';
      document.getElementById('tm-task-desc').value     = '';
      document.getElementById('tm-task-priority').value = 'medium';
      document.getElementById('tm-task-category').value = 'general';
      document.getElementById('tm-task-due').value      = '';
    }
    modal.classList.remove('hidden');
    document.getElementById('tm-task-title').focus();
  }

  async function saveTask() {
    const id       = document.getElementById('task-modal-id').value;
    const title    = document.getElementById('tm-task-title').value.trim();
    const desc     = document.getElementById('tm-task-desc').value.trim();
    const priority = document.getElementById('tm-task-priority').value;
    const category = document.getElementById('tm-task-category').value;
    const dueDate  = document.getElementById('tm-task-due').value;
    if (!title) { toast('Title is required', 'error'); return; }
    try {
      const body = { title, description: desc, priority, category, dueDate: dueDate || null };
      await api(id ? 'PUT' : 'POST', id ? `/api/activity/tasks/${id}` : '/api/activity/tasks', body);
      App.closeModal('task-modal-overlay');
      await loadTasks();
      toast(id ? 'Task updated' : 'Task created', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── Email (IMAP) ───────────────────────────────────────────────────────────

  async function loadEmails() {
    if (!S.imapOk) {
      setEl('act-email-list', `
        <div class="act-placeholder">
          <span>&#9993;</span>
          <p>Add <code>EMAIL_USER</code> and <code>EMAIL_APP_PASSWORD</code> to your <code>.env</code> to read your inbox.</p>
          <p class="hint" style="margin-top:4px">For Gmail: enable 2FA then create an App Password at myaccount.google.com/apppasswords</p>
        </div>`);
      setEl('act-stat-unread', '—');
      return;
    }
    setEl('act-email-list', spinner());
    try {
      const data     = await api('GET', '/api/activity/emails?limit=20');
      S.emails       = data.messages || [];
      const unread   = data.unread   || 0;
      setEl('act-stat-unread', unread);
      const badge = document.getElementById('act-email-unread-badge');
      if (badge) {
        badge.textContent    = unread > 0 ? unread : '';
        badge.style.display  = unread > 0 ? '' : 'none';
      }
      renderEmails();
    } catch (err) {
      setEl('act-email-list', errBox(err.message));
    }
  }

  function renderEmails() {
    const list = document.getElementById('act-email-list');
    if (!list) return;
    if (!S.emails.length) {
      list.innerHTML = `<div class="act-placeholder"><span>&#9993;</span><p>Inbox is empty.</p></div>`;
      return;
    }
    list.innerHTML = S.emails.map(e => `
      <div class="act-email-item${e.isUnread ? ' unread' : ''}">
        <div class="act-email-dot"></div>
        <div class="act-email-body">
          <div class="act-email-subject">${esc(e.subject)}</div>
          <div class="act-email-from">${esc(e.from)}</div>
        </div>
        <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;margin-top:2px">${relTime(e.date)}</span>
      </div>`).join('');
  }

  // ── Calendar (ICS feeds) ───────────────────────────────────────────────────

  async function loadCalendar() {
    const urls = S.calUrls;
    if (!urls.length) {
      setEl('act-cal-list', `
        <div class="act-placeholder">
          <span>&#128197;</span>
          <p>Click <strong>+ Cal</strong> to add a calendar ICS feed URL.</p>
        </div>`);
      setEl('act-stat-events', '—');
      return;
    }
    setEl('act-cal-list', spinner());
    try {
      const days = document.getElementById('act-cal-days')?.value || 7;
      const data = await api('GET', `/api/activity/calendar?days=${days}`);
      S.calEvents = data.events || [];
      setEl('act-stat-events', data.todayCount ?? '—');
      renderCalendar();
    } catch (err) {
      setEl('act-cal-list', errBox(err.message));
    }
  }

  function renderCalendar() {
    const list = document.getElementById('act-cal-list');
    if (!list) return;
    if (!S.calEvents.length) {
      list.innerHTML = `<div class="act-placeholder"><span>&#128197;</span><p>No upcoming events in this range.</p></div>`;
      return;
    }
    list.innerHTML = S.calEvents.map(ev => {
      const d   = new Date(ev.start);
      const day = isNaN(d) ? '' : d.getDate();
      const mon = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { month:'short' });
      const time = ev.allDay ? 'All day' : d.toLocaleString('en-GB', { weekday:'short', hour:'2-digit', minute:'2-digit' });
      return `
        <div class="act-cal-item">
          <div class="act-cal-date">
            <div class="act-cal-day">${day}</div>
            <div class="act-cal-mon">${mon}</div>
          </div>
          <div class="act-cal-body">
            <div class="act-cal-title">${esc(ev.title)}</div>
            <div class="act-cal-time">${esc(time)}${ev.calendarLabel ? ` · <em>${esc(ev.calendarLabel)}</em>` : ''}</div>
            ${ev.location ? `<div class="act-cal-loc">&#128205; ${esc(ev.location)}</div>` : ''}
            ${ev.meetLink ? `<a class="act-cal-meet" href="${esc(ev.meetLink)}" target="_blank" rel="noopener">&#128249; Join meeting</a>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function openAddCalModal() {
    document.getElementById('cal-add-label').value = '';
    document.getElementById('cal-add-url').value   = '';
    document.getElementById('add-cal-modal-overlay').classList.remove('hidden');
    document.getElementById('cal-add-label').focus();
  }

  async function addCalendarUrl() {
    const label = document.getElementById('cal-add-label').value.trim();
    const url   = document.getElementById('cal-add-url').value.trim();
    if (!url) { toast('URL is required', 'error'); return; }
    try {
      await api('POST', '/api/activity/calendar/urls', { label, url });
      App.closeModal('add-cal-modal-overlay');
      toast('Calendar added!', 'success');
      await checkStatus();   // refresh S.calUrls
      await loadCalendar();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function removeCalendarUrl(index) {
    try {
      await api('DELETE', `/api/activity/calendar/urls/${index}`);
      await checkStatus();
      await loadCalendar();
      toast('Calendar removed', 'info');
    } catch (err) { toast(err.message, 'error'); }
  }

  // ── WhatsApp (whatsapp-web.js) ─────────────────────────────────────────────

  async function renderWaPanel() {
    const actionsEl = document.getElementById('act-wa-panel-actions');
    const listEl    = document.getElementById('act-wa-list');
    if (!actionsEl || !listEl) return;

    const { status } = await api('GET', '/api/activity/whatsapp/status').catch(() => ({ status: 'disconnected' }));
    S.waStatus = status;

    // Build action buttons
    if (status === 'ready') {
      actionsEl.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="Activity.openWaSendModal()">Send</button>
        <button class="btn btn-ghost btn-sm" onclick="Activity.loadWhatsapp()">Refresh</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Activity.disconnectWhatsapp()">Disconnect</button>`;
    } else if (status === 'initializing' || status === 'connecting' || status === 'qr_ready') {
      actionsEl.innerHTML = `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="Activity.disconnectWhatsapp()">Cancel</button>`;
    } else {
      actionsEl.innerHTML = `<button class="btn btn-primary btn-sm" onclick="Activity.initWhatsapp()">Connect</button>`;
    }

    // Build panel body
    if (status === 'ready') {
      await loadWhatsapp();
    } else if (status === 'qr_ready') {
      await showQrCode();
    } else if (status === 'initializing' || status === 'connecting') {
      listEl.innerHTML = `
        <div class="act-placeholder">
          <div class="act-spinner" style="width:24px;height:24px;border-width:3px;margin-bottom:8px"></div>
          <p>Starting WhatsApp Web… this may take 10–20 seconds.</p>
        </div>`;
      startWaPoll();
    } else if (status === 'error') {
      const { error } = await api('GET', '/api/activity/whatsapp/status').catch(() => ({}));
      listEl.innerHTML = errBox(error || 'WhatsApp encountered an error. Try reconnecting.');
    } else {
      listEl.innerHTML = `
        <div class="act-placeholder">
          <span>&#128172;</span>
          <p>Click <strong>Connect</strong> to link WhatsApp by scanning a QR code — no API keys needed.</p>
          <button class="btn btn-primary btn-sm" onclick="Activity.initWhatsapp()">Connect WhatsApp</button>
        </div>`;
    }
  }

  async function initWhatsapp() {
    try {
      await api('POST', '/api/activity/whatsapp/init');
      await renderWaPanel();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function disconnectWhatsapp() {
    stopWaPoll();
    try {
      await api('POST', '/api/activity/whatsapp/disconnect');
      await renderWaPanel();
      toast('WhatsApp disconnected', 'info');
    } catch (err) { toast(err.message, 'error'); }
  }

  async function showQrCode() {
    const listEl = document.getElementById('act-wa-list');
    if (!listEl) return;
    try {
      const { qr } = await api('GET', '/api/activity/whatsapp/qr');
      listEl.innerHTML = `
        <div class="act-qr-wrap">
          <p class="act-qr-hint">Open WhatsApp on your phone → Menu → Linked Devices → Link a Device</p>
          <img src="${esc(qr)}" class="act-qr-img" alt="WhatsApp QR code" />
          <p class="act-qr-sub">QR code refreshes automatically</p>
        </div>`;
      startWaPoll();
    } catch {
      listEl.innerHTML = `
        <div class="act-placeholder">
          <div class="act-spinner" style="width:24px;height:24px;border-width:3px;margin-bottom:8px"></div>
          <p>Generating QR code…</p>
        </div>`;
      startWaPoll();
    }
  }

  function startWaPoll() {
    stopWaPoll();
    S._waPollTimer = setInterval(async () => {
      try {
        const { status } = await api('GET', '/api/activity/whatsapp/status');
        if (status !== S.waStatus) {
          S.waStatus = status;
          stopWaPoll();
          await renderWaPanel();
          if (status === 'ready') {
            toast('WhatsApp connected!', 'success');
            setEl('act-stat-wa', '✓');
          }
        } else if (status === 'qr_ready') {
          await showQrCode(); // refresh QR image in case it rotated
        }
      } catch { /* ignore transient errors */ }
    }, 3000);
  }

  function stopWaPoll() {
    if (S._waPollTimer) { clearInterval(S._waPollTimer); S._waPollTimer = null; }
  }

  async function loadWhatsapp() {
    const listEl = document.getElementById('act-wa-list');
    if (!listEl) return;
    listEl.innerHTML = spinner();
    try {
      const data = await api('GET', '/api/activity/whatsapp?limit=20');
      S.waMessages = data.messages || [];
      setEl('act-stat-wa', S.waMessages.length);
      renderWhatsapp();
    } catch (err) {
      listEl.innerHTML = errBox(err.message);
    }
  }

  function renderWhatsapp() {
    const listEl = document.getElementById('act-wa-list');
    if (!listEl) return;
    if (!S.waMessages.length) {
      listEl.innerHTML = `<div class="act-placeholder"><span>&#128172;</span><p>No messages yet.</p></div>`;
      return;
    }
    listEl.innerHTML = S.waMessages.map(m => {
      const dir      = m.direction === 'inbound' ? 'inbound' : 'outbound';
      const contact  = dir === 'inbound' ? (m.fromName || m.from) : m.to;
      const dirLabel = dir === 'inbound' ? '&#8592; received' : '&#8594; sent';
      return `
        <div class="act-wa-item ${dir}">
          <div class="act-wa-header">
            <span class="act-wa-from">${esc(contact)}</span>
            <span class="act-wa-dir">${dirLabel}</span>
          </div>
          <div class="act-wa-body">${esc(m.body)}</div>
          <div class="act-wa-time">${relTime(m.timestamp)}</div>
        </div>`;
    }).join('');
  }

  function openWaSendModal() {
    if (S.waStatus !== 'ready') { toast('WhatsApp is not connected', 'error'); return; }
    document.getElementById('wa-send-to').value   = '';
    document.getElementById('wa-send-body').value = '';
    document.getElementById('wa-send-modal-overlay').classList.remove('hidden');
    document.getElementById('wa-send-to').focus();
  }

  async function sendWhatsapp() {
    const to   = document.getElementById('wa-send-to').value.trim();
    const body = document.getElementById('wa-send-body').value.trim();
    if (!to || !body) { toast('Phone number and message are required', 'error'); return; }
    try {
      await api('POST', '/api/activity/whatsapp/send', { to, body });
      App.closeModal('wa-send-modal-overlay');
      toast('Message sent!', 'success');
      await loadWhatsapp();
    } catch (err) { toast(`Send failed: ${err.message}`, 'error'); }
  }

  // ── Activity Feed ──────────────────────────────────────────────────────────

  async function loadFeed() {
    setEl('act-feed-list', spinner());
    try {
      const items = await api('GET', '/api/activity/feed');
      renderFeed(items);
    } catch (err) {
      setEl('act-feed-list', errBox(err.message));
    }
  }

  function renderFeed(items) {
    const list = document.getElementById('act-feed-list');
    if (!list) return;
    if (!items?.length) {
      list.innerHTML = `
        <div class="act-placeholder" style="padding:20px">
          <p>Your activity feed will appear here as you add tasks, emails arrive, calendar events approach, and WhatsApp messages come in.</p>
        </div>`;
      return;
    }
    const icons  = { task:'✓', email:'✉', calendar:'📅', whatsapp:'💬' };
    const labels = { task:'Task', email:'Email', calendar:'Event', whatsapp:'WhatsApp' };
    list.innerHTML = items.map(item => `
      <div class="act-feed-item act-feed-type-${esc(item.type)}">
        <div class="act-feed-icon">${icons[item.type] || '•'}</div>
        <div class="act-feed-body">
          <div class="act-feed-title">${esc(item.title || '')}</div>
          ${item.subtitle ? `<div class="act-feed-sub">${esc(item.subtitle)}</div>` : ''}
          <div class="act-feed-sub" style="margin-top:3px">
            <span class="cat-pill">${labels[item.type] || item.type}</span>
            ${item.priority ? `<span class="prio-pill prio-${esc(item.priority)}" style="margin-left:4px">${item.priority}</span>` : ''}
          </div>
        </div>
        <div class="act-feed-time">${relTime(item.time)}</div>
      </div>`).join('');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init, refresh,
    // tasks
    filterTasks, quickAddTask, toggleTask, deleteTask, openTaskModal, saveTask,
    // email
    loadEmails,
    // calendar
    loadCalendar, openAddCalModal, addCalendarUrl, removeCalendarUrl,
    // whatsapp
    initWhatsapp, disconnectWhatsapp, loadWhatsapp, openWaSendModal, sendWhatsapp,
    // feed
    loadFeed
  };
})();
