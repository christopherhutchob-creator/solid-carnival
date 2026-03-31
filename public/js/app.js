/* ─────────────────────────────────────────────────────────────────────────
 * OutreachPro — browser-side single-page application
 * All communication with the Express API is via fetch().
 * ───────────────────────────────────────────────────────────────────────── */

const API = '';   // same origin — server.js serves both

// ── Utility helpers ──────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res  = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let _toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

function statusBadge(status) {
  return `<span class="status-badge s-${status}">${status.replace('_', ' ')}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── App state ────────────────────────────────────────────────────────────────

const State = {
  clients:      [],
  templates:    [],
  emailQueue:   [],        // pending
  sentHistory:  [],
  filterStatus: '',
  searchQuery:  '',
  composeClients: new Set(),
  editingEmailId: null,
  editingClientId: null,
  editingTemplateId: null
};

// ── Navigation ────────────────────────────────────────────────────────────────

const App = {
  showView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));

    const view = document.getElementById(`view-${name}`);
    if (view) view.classList.remove('hidden');

    const link = document.querySelector(`.nav-link[data-view="${name}"]`);
    if (link) link.classList.add('active');

    window.location.hash = name;

    // Load data for the view
    switch (name) {
      case 'dashboard':  App.refreshDashboard(); break;
      case 'clients':    App.loadClients();       break;
      case 'compose':    App.loadCompose();       break;
      case 'queue':      App.loadQueue();         break;
      case 'history':    App.loadHistory();       break;
      case 'templates':  App.loadTemplates();        break;
      case 'settings':   App.loadSettings();         break;
      case 'activity':   Activity.init();            break;
    }
  },

  closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  },

  // ── Dashboard ──────────────────────────────────────────────────────────────

  async refreshDashboard() {
    try {
      const [summary, pending] = await Promise.all([
        api('GET', '/api/emails/stats/summary'),
        api('GET', '/api/emails?status=pending')
      ]);

      document.getElementById('stat-clients').textContent   = summary.totalClients;
      document.getElementById('stat-pending').textContent   = summary.pending;
      document.getElementById('stat-sent').textContent      = summary.sent;
      document.getElementById('stat-converted').textContent = summary.clientsByStatus.converted;

      // Update queue badge
      const badge = document.getElementById('queue-badge');
      if (summary.pending > 0) {
        badge.textContent = summary.pending;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }

      // Pending list
      const pendingEl = document.getElementById('dash-pending-list');
      if (pending.length === 0) {
        pendingEl.innerHTML = '<p class="muted" style="font-size:13px">No emails pending review.</p>';
      } else {
        pendingEl.innerHTML = pending.slice(0, 5).map(e => `
          <div class="compact-item">
            <div>
              <div class="ci-name">${esc(e.clientName || e.clientEmail)}</div>
              <div class="ci-sub">${esc(e.subject)}</div>
            </div>
            <div class="ci-actions">
              <button class="btn btn-sm btn-primary" onclick="App.openEmailModal('${e.id}')">Review</button>
            </div>
          </div>`).join('') + (pending.length > 5 ? `<p class="muted hint">+ ${pending.length - 5} more in queue</p>` : '');
      }

      // Pipeline
      const pipe = document.getElementById('dash-pipeline');
      const statuses = [
        ['new', 'New Leads'], ['contacted', 'Contacted'],
        ['responded', 'Responded'], ['interested', 'Interested'],
        ['converted', 'Converted'], ['not_interested', 'Not Interested']
      ];
      pipe.innerHTML = statuses.map(([s, l]) => `
        <div class="pipeline-row">
          <span class="pip-label">${l}</span>
          <span class="pip-count">${summary.clientsByStatus[s] || 0}</span>
        </div>`).join('');
    } catch (err) {
      toast(`Dashboard error: ${err.message}`, 'error');
    }
  },

  // ── Clients ────────────────────────────────────────────────────────────────

  async loadClients() {
    try {
      let url = '/api/clients';
      const params = new URLSearchParams();
      if (State.filterStatus) params.set('status', State.filterStatus);
      if (State.searchQuery)  params.set('search', State.searchQuery);
      if ([...params].length) url += '?' + params;

      State.clients = await api('GET', url);
      App.renderClientsTable();
    } catch (err) {
      toast(`Failed to load clients: ${err.message}`, 'error');
    }
  },

  renderClientsTable() {
    const tbody = document.getElementById('clients-tbody');
    if (State.clients.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-muted)">No clients found. Add one or import a CSV.</td></tr>`;
      return;
    }
    tbody.innerHTML = State.clients.map(c => `
      <tr>
        <td><input type="checkbox" class="client-checkbox" value="${c.id}" onchange="App.updateBulkBar()" /></td>
        <td>${esc(c.name || '—')}</td>
        <td>${esc(c.email)}</td>
        <td>${esc(c.company || '—')}</td>
        <td>${statusBadge(c.status || 'new')}</td>
        <td>${c.emailsSent || 0}</td>
        <td>${fmtDate(c.lastContactedAt)}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="App.openClientModal('${c.id}')">Edit</button>
          <button class="btn btn-sm btn-primary"   onclick="App.composeSingle('${c.id}')">Compose</button>
          <button class="btn btn-sm btn-danger"    onclick="App.deleteClient('${c.id}')">Del</button>
        </td>
      </tr>`).join('');
  },

  filterClients(status) {
    State.filterStatus = status;
    document.querySelectorAll('.filter-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.status === status));
    App.loadClients();
  },

  searchClients(q) {
    State.searchQuery = q;
    App.loadClients();
  },

  updateBulkBar() {
    const checked = document.querySelectorAll('.client-checkbox:checked');
    const bar     = document.getElementById('bulk-bar');
    const count   = document.getElementById('bulk-count');
    if (checked.length > 0) {
      bar.style.display = 'flex';
      count.textContent = `${checked.length} selected`;
    } else {
      bar.style.display = 'none';
    }
  },

  toggleSelectAll(cb) {
    document.querySelectorAll('.client-checkbox').forEach(c => c.checked = cb.checked);
    App.updateBulkBar();
  },

  getSelectedClientIds() {
    return [...document.querySelectorAll('.client-checkbox:checked')].map(c => c.value);
  },

  bulkCompose() {
    const ids = App.getSelectedClientIds();
    State.composeClients = new Set(ids);
    App.showView('compose');
  },

  async bulkDelete() {
    const ids = App.getSelectedClientIds();
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} client(s)?`)) return;
    try {
      await Promise.all(ids.map(id => api('DELETE', `/api/clients/${id}`)));
      toast(`Deleted ${ids.length} client(s)`, 'success');
      App.loadClients();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async deleteClient(id) {
    if (!confirm('Delete this client?')) return;
    try {
      await api('DELETE', `/api/clients/${id}`);
      toast('Client deleted', 'success');
      App.loadClients();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  openClientModal(id) {
    State.editingClientId = id || null;
    const title = document.getElementById('client-modal-title');
    title.textContent = id ? 'Edit Client' : 'Add Client';
    // Clear form
    ['cm-name','cm-email','cm-company','cm-phone','cm-tags','cm-notes'].forEach(i =>
      document.getElementById(i).value = '');
    document.getElementById('client-modal-id').value = '';
    document.getElementById('cm-status').value = 'new';

    if (id) {
      const c = State.clients.find(c => c.id === id);
      if (c) {
        document.getElementById('client-modal-id').value = c.id;
        document.getElementById('cm-name').value    = c.name    || '';
        document.getElementById('cm-email').value   = c.email   || '';
        document.getElementById('cm-company').value = c.company || '';
        document.getElementById('cm-phone').value   = c.phone   || '';
        document.getElementById('cm-tags').value    = (c.tags || []).join(', ');
        document.getElementById('cm-notes').value   = c.notes   || '';
        document.getElementById('cm-status').value  = c.status  || 'new';
      }
    }

    document.getElementById('client-modal-overlay').classList.remove('hidden');
  },

  async saveClient() {
    const id      = document.getElementById('client-modal-id').value;
    const payload = {
      name:    document.getElementById('cm-name').value.trim(),
      email:   document.getElementById('cm-email').value.trim(),
      company: document.getElementById('cm-company').value.trim(),
      phone:   document.getElementById('cm-phone').value.trim(),
      tags:    document.getElementById('cm-tags').value.trim(),
      notes:   document.getElementById('cm-notes').value.trim(),
      status:  document.getElementById('cm-status').value
    };

    if (!payload.email) { toast('Email is required', 'error'); return; }

    try {
      if (id) {
        await api('PUT', `/api/clients/${id}`, payload);
        toast('Client updated', 'success');
      } else {
        await api('POST', '/api/clients', payload);
        toast('Client added', 'success');
      }
      App.closeModal('client-modal-overlay');
      App.loadClients();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async importCSV(event) {
    const file = event.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const res  = await fetch('/api/clients/import/csv', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast(`Imported ${data.imported} clients`, 'success');
      App.loadClients();
    } catch (err) {
      toast(err.message, 'error');
    }
    event.target.value = '';
  },

  // ── Compose ────────────────────────────────────────────────────────────────

  async loadCompose() {
    try {
      const [clients, templates] = await Promise.all([
        api('GET', '/api/clients'),
        api('GET', '/api/templates')
      ]);
      State.clients   = clients;
      State.templates = templates;

      // Render client checklist
      App.renderComposeClients(clients);

      // Render template select
      const sel = document.getElementById('compose-template');
      sel.innerHTML = '<option value="">— Select a template —</option>' +
        templates.map(t => `<option value="${t.id}">${esc(t.name)} (${t.type})</option>`).join('');

      App.updateComposeSummary();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  renderComposeClients(clients) {
    const list = document.getElementById('compose-client-list');
    if (clients.length === 0) {
      list.innerHTML = '<p class="muted hint">No clients yet. Add some first.</p>';
      return;
    }
    list.innerHTML = clients.map(c => `
      <div class="client-checklist-item ${State.composeClients.has(c.id) ? 'selected' : ''}"
           onclick="App.toggleComposeClient(this, '${c.id}')">
        <input type="checkbox" ${State.composeClients.has(c.id) ? 'checked' : ''}
               onclick="event.stopPropagation()" onchange="App.toggleComposeClient(this.closest('.client-checklist-item'), '${c.id}')" />
        <div>
          <div class="cci-name">${esc(c.name || c.email)}</div>
          <div class="cci-sub">${esc(c.company || c.email)} · ${statusBadge(c.status || 'new')}</div>
        </div>
      </div>`).join('');
  },

  toggleComposeClient(el, id) {
    if (State.composeClients.has(id)) {
      State.composeClients.delete(id);
      el.classList.remove('selected');
      el.querySelector('input[type=checkbox]').checked = false;
    } else {
      State.composeClients.add(id);
      el.classList.add('selected');
      el.querySelector('input[type=checkbox]').checked = true;
    }
    App.updateComposeSummary();
  },

  searchComposeClients(q) {
    const filtered = State.clients.filter(c =>
      !q ||
      (c.name    || '').toLowerCase().includes(q.toLowerCase()) ||
      (c.email   || '').toLowerCase().includes(q.toLowerCase()) ||
      (c.company || '').toLowerCase().includes(q.toLowerCase())
    );
    App.renderComposeClients(filtered);
  },

  previewTemplate() {
    const id = document.getElementById('compose-template').value;
    const t  = State.templates.find(t => t.id === id);
    const preview = document.getElementById('template-preview');
    if (!t) { preview.classList.add('hidden'); return; }
    document.getElementById('preview-subject-text').textContent = t.subject;
    document.getElementById('preview-body-text').textContent    = t.body;
    preview.classList.remove('hidden');
    App.updateComposeSummary();
  },

  updateComposeSummary() {
    const count      = State.composeClients.size;
    const templateId = document.getElementById('compose-template').value;
    const t          = State.templates.find(t => t.id === templateId);
    const el         = document.getElementById('compose-summary');
    if (count === 0 || !t) {
      el.textContent = count === 0
        ? 'Select at least one client.'
        : 'Select a template.';
      return;
    }
    el.innerHTML = `<strong>${count}</strong> email${count !== 1 ? 's' : ''} will be added to the Review Queue using template <em>${esc(t.name)}</em>. You can edit each before sending.`;
  },

  async queueEmails() {
    const clientIds  = [...State.composeClients];
    const templateId = document.getElementById('compose-template').value;
    const followups  = document.getElementById('compose-followups').checked;

    if (!clientIds.length) { toast('Select at least one client', 'error'); return; }
    if (!templateId)       { toast('Select a template', 'error');          return; }

    const btn = document.getElementById('compose-btn');
    btn.disabled = true;
    try {
      const result = await api('POST', '/api/emails/compose', {
        clientIds,
        templateId,
        scheduleFollowUpsFlag: followups
      });
      toast(`${result.created} email(s) added to Review Queue`, 'success');
      State.composeClients.clear();
      App.showView('queue');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  },

  composeSingle(clientId) {
    State.composeClients = new Set([clientId]);
    App.showView('compose');
  },

  // ── Review Queue ──────────────────────────────────────────────────────────

  async loadQueue() {
    try {
      const emails = await api('GET', '/api/emails?status=pending');
      State.emailQueue = emails;

      const list  = document.getElementById('queue-list');
      const empty = document.getElementById('queue-empty');

      // Update badge
      const badge = document.getElementById('queue-badge');
      if (emails.length > 0) {
        badge.textContent  = emails.length;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }

      if (emails.length === 0) {
        list.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');

      list.innerHTML = emails.map(e => `
        <div class="queue-card" id="qcard-${e.id}">
          <div class="queue-card-header">
            <div>
              <div class="qc-to">To: ${esc(e.clientName || e.clientEmail)} &lt;${esc(e.clientEmail)}&gt;</div>
              <div class="qc-meta">${e.followUpNumber > 0 ? `Follow-up #${e.followUpNumber}` : 'Initial email'}
                ${e.scheduledFor ? ` · Scheduled: ${fmtDate(e.scheduledFor)}` : ''}</div>
            </div>
            ${statusBadge('pending')}
          </div>
          <div class="queue-card-body">
            <div class="qc-subject">${esc(e.subject)}</div>
            <div class="qc-body">${esc(e.body)}</div>
          </div>
          <div class="queue-card-footer">
            <button class="btn btn-sm btn-ghost"     onclick="App.rejectEmailById('${e.id}')">Reject</button>
            <button class="btn btn-sm btn-secondary"  onclick="App.openEmailModal('${e.id}')">Edit &amp; Review</button>
            <button class="btn btn-sm btn-success"    onclick="App.approveEmailById('${e.id}')">Approve &amp; Send</button>
          </div>
        </div>`).join('');
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async openEmailModal(id) {
    try {
      // Try state first, else fetch
      let e = State.emailQueue.find(e => e.id === id);
      if (!e) e = await api('GET', `/api/emails/${id}`);

      State.editingEmailId = id;
      document.getElementById('email-modal-id').value  = id;
      document.getElementById('em-to').textContent     = `${e.clientName || ''} <${e.clientEmail || ''}>`;
      document.getElementById('em-followup').textContent = e.followUpNumber === 0 ? 'Initial' : `#${e.followUpNumber}`;
      document.getElementById('em-subject').value      = e.subject;
      document.getElementById('em-body').value         = e.body;
      document.getElementById('email-modal-overlay').classList.remove('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async saveEmailEdits() {
    const id      = document.getElementById('email-modal-id').value;
    const subject = document.getElementById('em-subject').value.trim();
    const body    = document.getElementById('em-body').value.trim();
    try {
      await api('PUT', `/api/emails/${id}`, { subject, body });
      toast('Email updated', 'success');
      App.closeModal('email-modal-overlay');
      App.loadQueue();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async approveEmail() {
    const id = document.getElementById('email-modal-id').value;
    // Save any edits first
    await App.saveEmailEdits();
    await App.approveEmailById(id);
  },

  async approveEmailById(id) {
    const btn = document.querySelector(`#qcard-${id} .btn-success`);
    if (btn) btn.disabled = true;
    try {
      await api('POST', `/api/emails/${id}/approve`);
      toast('Email sent!', 'success');
      App.closeModal('email-modal-overlay');
      App.loadQueue();
      App.refreshDashboard();
    } catch (err) {
      toast(`Send failed: ${err.message}`, 'error');
      if (btn) btn.disabled = false;
    }
  },

  async rejectEmail() {
    const id = document.getElementById('email-modal-id').value;
    App.closeModal('email-modal-overlay');
    await App.rejectEmailById(id);
  },

  async rejectEmailById(id) {
    try {
      await api('POST', `/api/emails/${id}/reject`);
      toast('Email rejected', 'info');
      App.loadQueue();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  // ── History ────────────────────────────────────────────────────────────────

  async loadHistory() {
    try {
      const [sent, clients] = await Promise.all([
        api('GET', '/api/emails?status=sent'),
        api('GET', '/api/clients')
      ]);
      const cMap  = Object.fromEntries(clients.map(c => [c.id, c]));
      const tbody = document.getElementById('history-tbody');

      if (sent.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted)">No emails sent yet.</td></tr>`;
        return;
      }
      tbody.innerHTML = sent.map(e => {
        const c = cMap[e.clientId] || {};
        return `<tr>
          <td>${esc(e.clientName || c.name || '—')}</td>
          <td>${esc(e.subject)}</td>
          <td>${e.followUpNumber === 0 ? 'Initial' : `Follow-up #${e.followUpNumber}`}</td>
          <td>${fmtDateTime(e.sentAt)}</td>
          <td>${statusBadge(c.status || 'contacted')}</td>
        </tr>`;
      }).join('');
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async exportExcel() {
    window.open('/api/sheets/export', '_blank');
  },

  async syncSheets() {
    const btn = event.target;
    btn.disabled = true;
    try {
      const res = await api('POST', '/api/sheets/sync');
      toast(`Synced ${res.synced} clients to Google Sheets`, 'success');
      document.getElementById('sheets-result').innerHTML =
        `<span style="color:var(--success)">Synced ${res.synced} clients at ${new Date().toLocaleTimeString()}</span>`;
    } catch (err) {
      toast(`Sheets sync failed: ${err.message}`, 'error');
      const el = document.getElementById('sheets-result');
      if (el) el.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  },

  // ── Templates ──────────────────────────────────────────────────────────────

  async loadTemplates() {
    try {
      State.templates = await api('GET', '/api/templates');
      App.renderTemplates();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  renderTemplates() {
    const grid = document.getElementById('templates-grid');
    if (State.templates.length === 0) {
      grid.innerHTML = '<p class="muted">No templates yet.</p>';
      return;
    }
    grid.innerHTML = State.templates.map(t => `
      <div class="template-card">
        <div class="tc-name">${esc(t.name)}</div>
        <div class="tc-type">${t.type}</div>
        <div class="tc-subject">${esc(t.subject)}</div>
        <div class="tc-body">${esc(t.body)}</div>
        <div class="tc-actions">
          <button class="btn btn-sm btn-secondary" onclick="App.openTemplateModal('${t.id}')">Edit</button>
          <button class="btn btn-sm btn-danger"    onclick="App.deleteTemplate('${t.id}')">Delete</button>
        </div>
      </div>`).join('');
  },

  openTemplateModal(id) {
    State.editingTemplateId = id || null;
    document.getElementById('template-modal-title').textContent = id ? 'Edit Template' : 'New Template';
    ['tm-name','tm-subject','tm-body'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('template-modal-id').value = '';
    document.getElementById('tm-type').value = 'initial';

    if (id) {
      const t = State.templates.find(t => t.id === id);
      if (t) {
        document.getElementById('template-modal-id').value = t.id;
        document.getElementById('tm-name').value    = t.name    || '';
        document.getElementById('tm-type').value    = t.type    || 'custom';
        document.getElementById('tm-subject').value = t.subject || '';
        document.getElementById('tm-body').value    = t.body    || '';
      }
    }
    document.getElementById('template-modal-overlay').classList.remove('hidden');
  },

  async saveTemplate() {
    const id      = document.getElementById('template-modal-id').value;
    const payload = {
      name:    document.getElementById('tm-name').value.trim(),
      type:    document.getElementById('tm-type').value,
      subject: document.getElementById('tm-subject').value.trim(),
      body:    document.getElementById('tm-body').value.trim()
    };
    if (!payload.name || !payload.subject || !payload.body) {
      toast('Name, subject and body are required', 'error'); return;
    }
    try {
      if (id) {
        await api('PUT', `/api/templates/${id}`, payload);
        toast('Template updated', 'success');
      } else {
        await api('POST', '/api/templates', payload);
        toast('Template created', 'success');
      }
      App.closeModal('template-modal-overlay');
      App.loadTemplates();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async deleteTemplate(id) {
    if (!confirm('Delete this template?')) return;
    try {
      await api('DELETE', `/api/templates/${id}`);
      toast('Template deleted', 'success');
      App.loadTemplates();
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  // ── Settings ───────────────────────────────────────────────────────────────

  async loadSettings() {
    try {
      const settings = await api('GET', '/api/sheets/settings');
      const days     = settings.followupDays || [3, 7, 14];
      document.getElementById('fu-day-1').value = days[0] ?? 3;
      document.getElementById('fu-day-2').value = days[1] ?? 7;
      document.getElementById('fu-day-3').value = days[2] ?? 14;
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async saveSettings() {
    const days = [
      parseInt(document.getElementById('fu-day-1').value),
      parseInt(document.getElementById('fu-day-2').value),
      parseInt(document.getElementById('fu-day-3').value)
    ];
    try {
      await api('PUT', '/api/sheets/settings', { followupDays: days });
      toast('Settings saved', 'success');
      document.getElementById('settings-result').innerHTML =
        `<span style="color:var(--success)">Saved at ${new Date().toLocaleTimeString()}</span>`;
    } catch (err) {
      toast(err.message, 'error');
    }
  },

  async verifyEmail() {
    const el  = document.getElementById('email-verify-result');
    const btn = event.target;
    btn.disabled = true;
    el.textContent = 'Testing connection…';
    try {
      const res = await api('GET', '/api/verify-email');
      el.innerHTML = `<span style="color:var(--success)">${res.message}</span>`;
    } catch (err) {
      el.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  }
};

// ── XSS escape ───────────────────────────────────────────────────────────────
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Router ────────────────────────────────────────────────────────────────────
function routeFromHash() {
  const hash = (window.location.hash || '#dashboard').slice(1);
  const valid = ['dashboard','clients','compose','queue','history','templates','settings'];
  App.showView(valid.includes(hash) ? hash : 'dashboard');
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    App.showView(link.dataset.view);
  });
});

window.addEventListener('hashchange', routeFromHash);

routeFromHash();
