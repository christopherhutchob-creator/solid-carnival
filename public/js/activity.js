/* ─────────────────────────────────────────────────────────────────────────
 * Activity Dashboard — Gmail, Google Calendar, WhatsApp, Tasks
 * ───────────────────────────────────────────────────────────────────────── */

const Activity = (() => {
  // ── Local state ────────────────────────────────────────────────────────────
  const S = {
    tasks:          [],
    emails:         [],
    calEvents:      [],
    waMessages:     [],
    googleConnected: false,
    waConfigured:   false,
    editingTaskId:  null,
    setupDismissed: false
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function loading(html = '') {
    return html || `<div class="act-loading"><div class="act-spinner"></div> Loading…</div>`;
  }

  function errBox(msg) {
    return `<div class="act-error">${escHtml(msg)}</div>`;
  }

  function setEl(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function relTime(isoOrRfc) {
    if (!isoOrRfc) return '';
    const d = new Date(isoOrRfc);
    if (isNaN(d)) return isoOrRfc;
    const now  = Date.now();
    const diff = now - d.getTime();
    if (diff < 0) {
      // future
      const secs = Math.abs(diff) / 1000;
      if (secs < 3600) return `in ${Math.round(secs/60)}m`;
      if (secs < 86400) return `in ${Math.round(secs/3600)}h`;
      return `in ${Math.round(secs/86400)}d`;
    }
    const secs = diff / 1000;
    if (secs < 60)    return 'just now';
    if (secs < 3600)  return `${Math.round(secs/60)}m ago`;
    if (secs < 86400) return `${Math.round(secs/3600)}h ago`;
    if (secs < 86400*7) return `${Math.round(secs/86400)}d ago`;
    return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  }

  function fmtEventTime(isoOrDate, allDay) {
    if (!isoOrDate) return '';
    if (allDay) {
      const d = new Date(isoOrDate);
      return d.toLocaleDateString('en-GB', { weekday:'short', day:'2-digit', month:'short' });
    }
    const d = new Date(isoOrDate);
    return d.toLocaleString('en-GB', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  }

  function isOverdue(dueDate) {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date(new Date().toDateString());
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    // Listen for Google auth popup success
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'google_auth_success') {
        toast('Google account connected!', 'success');
        S.googleConnected = true;
        refresh();
      }
    });

    await refresh();
  }

  async function refresh() {
    await checkStatus();
    renderSetupBanner();
    await Promise.all([loadTasks(), loadEmails(), loadCalendar(), loadWhatsapp()]);
    await loadFeed();
  }

  async function checkStatus() {
    try {
      const status = await api('GET', '/api/activity/status');
      S.googleConnected = status.google.connected;
      S.waConfigured    = status.whatsapp.configured;
    } catch {
      S.googleConnected = false;
      S.waConfigured    = false;
    }
  }

  function renderSetupBanner() {
    const banner = document.getElementById('act-setup-banner');
    if (!banner || S.setupDismissed) return;
    const needsGoogle = !S.googleConnected;
    const needsWa     = !S.waConfigured;
    if (!needsGoogle && !needsWa) {
      banner.classList.add('hidden');
      return;
    }
    const msgs = [];
    if (needsGoogle) msgs.push('Connect Google to see Gmail & Calendar');
    if (needsWa)     msgs.push('Configure Twilio in .env for WhatsApp');

    setEl('act-setup-msg', msgs.join(' · '));

    const googleBtn = document.getElementById('act-google-btn');
    if (googleBtn) {
      if (S.googleConnected) {
        googleBtn.textContent  = '✓ Google Connected';
        googleBtn.disabled     = true;
        googleBtn.className    = 'btn btn-ghost btn-sm';
      } else {
        googleBtn.textContent  = 'Connect Google';
        googleBtn.disabled     = false;
        googleBtn.className    = 'btn btn-primary btn-sm';
      }
    }
    banner.classList.remove('hidden');
  }

  function dismissSetup() {
    S.setupDismissed = true;
    const banner = document.getElementById('act-setup-banner');
    if (banner) banner.classList.add('hidden');
  }

  // ── Google connect ─────────────────────────────────────────────────────────

  async function connectGoogle() {
    try {
      const data = await api('GET', '/api/activity/auth/google');
      if (data.url) {
        window.open(data.url, 'google_oauth', 'width=500,height=650,left=200,top=100');
      }
    } catch (err) {
      toast(`Cannot connect Google: ${err.message}`, 'error');
    }
  }

  async function disconnectGoogle() {
    try {
      await api('DELETE', '/api/activity/auth/google');
      S.googleConnected = false;
      toast('Google account disconnected', 'info');
      refresh();
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────

  async function loadTasks() {
    setEl('act-tasks-list', loading());
    try {
      const filter = document.getElementById('act-task-filter')?.value || '';
      let url = '/api/activity/tasks';
      if (filter) url += `?priority=${filter}`;
      S.tasks = await api('GET', url);
      renderTasks();
      const open = S.tasks.filter(t => !t.completed).length;
      setEl('act-stat-tasks', open);
    } catch (err) {
      setEl('act-tasks-list', errBox(err.message));
    }
  }

  function filterTasks() { loadTasks(); }

  function renderTasks() {
    const list = document.getElementById('act-tasks-list');
    if (!list) return;
    if (S.tasks.length === 0) {
      list.innerHTML = `<div class="act-placeholder"><span>✓</span><p>No tasks yet. Add one above!</p></div>`;
      return;
    }
    list.innerHTML = S.tasks.map(t => {
      const overdue = !t.completed && isOverdue(t.dueDate);
      return `
        <div class="act-task-item ${t.completed ? 'completed' : ''}" id="task-${t.id}">
          <div class="act-task-check ${t.completed ? 'done' : ''}"
               onclick="Activity.toggleTask('${t.id}')" title="${t.completed ? 'Mark incomplete' : 'Mark complete'}">
          </div>
          <div class="act-task-body">
            <div class="act-task-title" title="${escHtml(t.title)}">${escHtml(t.title)}</div>
            <div class="act-task-meta">
              <span class="prio-pill prio-${t.priority}">${t.priority}</span>
              <span class="cat-pill">${t.category}</span>
              ${t.dueDate ? `<span class="act-task-due ${overdue ? 'overdue' : ''}">
                ${overdue ? '⚠ Overdue · ' : ''}Due ${fmtDate(t.dueDate)}</span>` : ''}
            </div>
          </div>
          <div class="act-task-actions">
            <button class="btn btn-ghost btn-sm" onclick="Activity.openTaskModal('${t.id}')" title="Edit">✎</button>
            <button class="btn btn-ghost btn-sm" onclick="Activity.deleteTask('${t.id}')" title="Delete">✕</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short' });
  }

  async function quickAddTask() {
    const input = document.getElementById('act-quick-task');
    const title = input?.value?.trim();
    if (!title) return;
    try {
      await api('POST', '/api/activity/tasks', { title, priority: 'medium', category: 'general' });
      input.value = '';
      await loadTasks();
      toast('Task added', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function toggleTask(id) {
    try {
      await api('PUT', `/api/activity/tasks/${id}/complete`);
      await loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function deleteTask(id) {
    try {
      await api('DELETE', `/api/activity/tasks/${id}`);
      await loadTasks();
      toast('Task deleted', 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function openTaskModal(id) {
    S.editingTaskId = id || null;
    const modal = document.getElementById('task-modal-overlay');
    if (!modal) return;

    document.getElementById('task-modal-title').textContent = id ? 'Edit Task' : 'Add Task';
    document.getElementById('task-modal-id').value          = id || '';

    if (id) {
      const task = S.tasks.find(t => t.id === id);
      if (task) {
        document.getElementById('tm-task-title').value    = task.title;
        document.getElementById('tm-task-desc').value     = task.description || '';
        document.getElementById('tm-task-priority').value = task.priority;
        document.getElementById('tm-task-category').value = task.category;
        document.getElementById('tm-task-due').value      = task.dueDate ? task.dueDate.slice(0, 10) : '';
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

    const body = { title, description: desc, priority, category, dueDate: dueDate || null };

    try {
      if (id) {
        await api('PUT', `/api/activity/tasks/${id}`, body);
        toast('Task updated', 'success');
      } else {
        await api('POST', '/api/activity/tasks', body);
        toast('Task created', 'success');
      }
      App.closeModal('task-modal-overlay');
      await loadTasks();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ── Gmail ──────────────────────────────────────────────────────────────────

  async function loadEmails() {
    if (!S.googleConnected) {
      showEmailPlaceholder(true);
      return;
    }
    showEmailPlaceholder(false);
    setEl('act-email-list', loading());
    try {
      const data = await api('GET', '/api/activity/emails?limit=20');
      S.emails = data.messages || [];
      const unread = data.unread || 0;

      const badge = document.getElementById('act-email-unread-badge');
      if (badge) badge.textContent = unread > 0 ? unread : '';

      setEl('act-stat-unread', unread);
      renderEmails();
    } catch (err) {
      setEl('act-email-list', errBox(err.message));
    }
  }

  function showEmailPlaceholder(show) {
    const ph = document.getElementById('act-email-placeholder');
    const list = document.getElementById('act-email-list');
    if (!ph || !list) return;
    if (show) {
      list.innerHTML = ph.outerHTML.replace('hidden', '');
    } else {
      if (ph) ph.style.display = 'none';
    }
  }

  function renderEmails() {
    const list = document.getElementById('act-email-list');
    if (!list) return;
    if (S.emails.length === 0) {
      list.innerHTML = `<div class="act-placeholder"><span>&#9993;</span><p>Your inbox is empty.</p></div>`;
      return;
    }
    list.innerHTML = S.emails.map(e => `
      <div class="act-email-item ${e.isUnread ? 'unread' : ''}">
        <div class="act-email-dot"></div>
        <div class="act-email-body">
          <div class="act-email-subject" title="${escHtml(e.subject)}">${escHtml(e.subject)}</div>
          <div class="act-email-from">${escHtml(e.from)}</div>
          <div class="act-email-snippet">${escHtml(e.snippet)}</div>
        </div>
        <span style="font-size:10px;color:var(--text-muted);flex-shrink:0;margin-top:2px">${relTime(e.date)}</span>
      </div>
    `).join('');
  }

  // ── Calendar ───────────────────────────────────────────────────────────────

  async function loadCalendar() {
    if (!S.googleConnected) {
      showCalPlaceholder(true);
      setEl('act-stat-events', '—');
      return;
    }
    showCalPlaceholder(false);
    setEl('act-cal-list', loading());
    try {
      const days = document.getElementById('act-cal-days')?.value || 7;
      const data = await api('GET', `/api/activity/calendar?days=${days}`);
      S.calEvents = data.events || [];
      setEl('act-stat-events', data.todayCount);
      renderCalendar();
    } catch (err) {
      setEl('act-cal-list', errBox(err.message));
    }
  }

  function showCalPlaceholder(show) {
    const ph = document.getElementById('act-cal-placeholder');
    const list = document.getElementById('act-cal-list');
    if (!ph || !list) return;
    if (show) {
      list.innerHTML = ph.outerHTML.replace('hidden', '');
    }
  }

  function renderCalendar() {
    const list = document.getElementById('act-cal-list');
    if (!list) return;
    if (S.calEvents.length === 0) {
      list.innerHTML = `<div class="act-placeholder"><span>&#128197;</span><p>No upcoming events.</p></div>`;
      return;
    }
    list.innerHTML = S.calEvents.map(ev => {
      const d = new Date(ev.start);
      const day = isNaN(d) ? '' : d.getDate();
      const mon = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { month: 'short' });
      const timeStr = ev.allDay ? 'All day' : fmtEventTime(ev.start, false);
      return `
        <div class="act-cal-item">
          <div class="act-cal-date">
            <div class="act-cal-day">${day}</div>
            <div class="act-cal-mon">${mon}</div>
          </div>
          <div class="act-cal-body">
            <div class="act-cal-title" title="${escHtml(ev.title)}">${escHtml(ev.title)}</div>
            <div class="act-cal-time">${escHtml(timeStr)}</div>
            ${ev.location ? `<div class="act-cal-loc">&#128205; ${escHtml(ev.location)}</div>` : ''}
            ${ev.meetLink ? `<a class="act-cal-meet" href="${escHtml(ev.meetLink)}" target="_blank" rel="noopener">&#128249; Join meeting</a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  function fmtEventTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { weekday:'short', hour:'2-digit', minute:'2-digit' });
  }

  // ── WhatsApp ───────────────────────────────────────────────────────────────

  async function loadWhatsapp() {
    if (!S.waConfigured) {
      showWaPlaceholder(true);
      setEl('act-stat-wa', '—');
      return;
    }
    showWaPlaceholder(false);
    setEl('act-wa-list', loading());
    try {
      const data = await api('GET', '/api/activity/whatsapp?limit=20');
      const all  = [...(data.incoming || []), ...(data.messages || [])];
      // Sort by date descending
      all.sort((a, b) => new Date(b.dateSent || b.receivedAt || 0) - new Date(a.dateSent || a.receivedAt || 0));
      S.waMessages = all;
      setEl('act-stat-wa', all.length);
      renderWhatsapp();
    } catch (err) {
      setEl('act-wa-list', errBox(err.message));
    }
  }

  function showWaPlaceholder(show) {
    const ph = document.getElementById('act-wa-placeholder');
    const list = document.getElementById('act-wa-list');
    if (!ph || !list) return;
    if (show) {
      list.innerHTML = ph.outerHTML.replace('hidden', '');
    }
  }

  function renderWhatsapp() {
    const list = document.getElementById('act-wa-list');
    if (!list) return;
    if (S.waMessages.length === 0) {
      list.innerHTML = `<div class="act-placeholder"><span>&#128172;</span><p>No WhatsApp messages yet.</p></div>`;
      return;
    }
    list.innerHTML = S.waMessages.map(m => {
      const dir       = m.direction === 'inbound' ? 'inbound' : 'outbound';
      const dirLabel  = dir === 'inbound' ? '&#8592; Received' : '&#8594; Sent';
      const contact   = dir === 'inbound' ? m.from : m.to;
      const timeStr   = relTime(m.dateSent || m.receivedAt || m.dateCreated);
      return `
        <div class="act-wa-item ${dir}">
          <div class="act-wa-header">
            <span class="act-wa-from">${escHtml(contact || '—')}</span>
            <span class="act-wa-dir">${dirLabel}</span>
          </div>
          <div class="act-wa-body">${escHtml(m.body || '')}</div>
          <div class="act-wa-time">${timeStr}</div>
        </div>
      `;
    }).join('');
  }

  function openWaSendModal() {
    if (!S.waConfigured) {
      toast('WhatsApp is not configured. Add Twilio credentials to .env', 'error');
      return;
    }
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
      toast('WhatsApp message sent!', 'success');
      await loadWhatsapp();
    } catch (err) {
      toast(`Send failed: ${err.message}`, 'error');
    }
  }

  // ── Activity Feed ──────────────────────────────────────────────────────────

  async function loadFeed() {
    setEl('act-feed-list', loading());
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
    if (!items || items.length === 0) {
      list.innerHTML = `<div class="act-placeholder" style="max-height:120px">
        <p>Your activity feed will appear here once you have tasks, emails, calendar events, or WhatsApp messages.</p>
      </div>`;
      return;
    }

    const typeIcons = { task: '✓', email: '✉', calendar: '📅', whatsapp: '💬' };
    const typeLabels = { task: 'Task', email: 'Email', calendar: 'Event', whatsapp: 'WhatsApp' };

    list.innerHTML = items.map(item => `
      <div class="act-feed-item act-feed-type-${item.type}">
        <div class="act-feed-icon">${typeIcons[item.type] || '•'}</div>
        <div class="act-feed-body">
          <div class="act-feed-title">${escHtml(item.title || '')}</div>
          ${item.subtitle ? `<div class="act-feed-sub">${escHtml(item.subtitle)}</div>` : ''}
          <div class="act-feed-sub" style="margin-top:2px">
            <span class="cat-pill">${typeLabels[item.type] || item.type}</span>
            ${item.priority ? `<span class="prio-pill prio-${item.priority}" style="margin-left:4px">${item.priority}</span>` : ''}
          </div>
        </div>
        <div class="act-feed-time">${relTime(item.time)}</div>
      </div>
    `).join('');
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    refresh,
    filterTasks,
    quickAddTask,
    toggleTask,
    deleteTask,
    openTaskModal,
    saveTask,
    loadEmails,
    loadCalendar,
    loadWhatsapp,
    loadFeed,
    connectGoogle,
    disconnectGoogle,
    dismissSetup,
    openWaSendModal,
    sendWhatsapp
  };
})();
