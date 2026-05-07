/* ============================================================
   MDT Workflow — Main App
   ============================================================ */

const App = (() => {
  // ---------- Default Config ----------
  // ฝัง Web App URL ไว้ให้แอปเชื่อม Google Sheet ได้ทันที
  const DEFAULT_SHEET_URL = 'https://script.google.com/macros/s/AKfycbzrR1m8CF5frMfD-eA56vtLaPZFGORoq-b5LhjTDU7iKi1j5BqNQIzIKpjC39sZNPJIHQ/exec';
  const DEFAULT_SECRET = '';
  const MT_CHANNELS = [
    'B2S',
    'Betrend',
    'CDS (701)',
    'CDS (709)',
    'HomePro',
    'OFM',
    "Lotus's",
    'PWB',
    'SB',
    'SCG',
    'SE-ED',
    'Tops Care',
    'TWD',
    'Bestbalm',
  ];
  const MT_WORK_CATEGORIES = [
    'Replenishment / เติมของ',
    'Return / RTV / รับของกลับ',
    'Promotion',
    'Order / PO',
    'Delivery / Receiving',
    'Pricing / Cost / GP',
    'Assortment / Listing',
    'Store Operation',
    'Billing / Payment',
    'Portal / System',
    'Commercial Terms',
    'Issue / Escalation',
  ];

  // ---------- State ----------
  const state = {
    workflows: [],
    currentWorkflow: null,      // editing copy
    currentStepIndex: null,
    settings: {
      sheetUrl: DEFAULT_SHEET_URL,
      secret: DEFAULT_SECRET,
      googleClientId: '155556775648-uf1ld89gffj6m4m1mbfgj1q0iis6c8nu.apps.googleusercontent.com',
    },
    session: {
      role: 'viewer',
      token: null,
      email: null,
      name: null,
    },
    view: 'workflows',
    filter: { search: '', channel: '' },
    connected: false,
  };

  // In-memory storage (sandboxed iframe blocks localStorage)
  // Data persistence relies on Google Sheets sync or JSON export
  const STORAGE_KEY = 'mt_workflow_v1';

  // ---------- Utilities ----------
  const uid = () => 'w_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const stepUid = () => 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const escapeHtml = (str = '') =>
    String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const isAdmin = () => state.session.role === 'admin';

  function getChannelList() {
    return [...MT_CHANNELS];
  }

  function getChannelCounts() {
    return state.workflows.reduce((counts, w) => {
      const key = w.channel || 'Other';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  const toast = (msg, type = '') => {
    const container = $('#toastContainer');
    const el = document.createElement('div');
    el.className = `toast ${type ? 'toast-' + type : ''}`;
    el.innerHTML = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.style.animation = 'toastOut 220ms forwards';
      setTimeout(() => el.remove(), 240);
    }, 2800);
  };

  // ---------- Auth (Google Sign-In) ----------
  function initGoogleSignIn(clientId) {
    if (!clientId) return;
    if (!window.google?.accounts?.id) {
      window._gsiReady = () => initGoogleSignIn(clientId);
      return;
    }
    google.accounts.id.initialize({
      client_id: clientId,
      callback: handleSignInResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    const container = $('#gsiBtn');
    if (container) {
      container.innerHTML = '';
      google.accounts.id.renderButton(container, {
        theme: 'filled_black',
        size: 'medium',
        type: 'standard',
        text: 'signin_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: 180,
      });
    }
    const fallback = $('#btnSignIn');
    if (fallback && !isAdmin()) fallback.style.display = '';
  }

  function _decodeJwt(token) {
    try {
      const payload = token.split('.')[1];
      return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    } catch { return null; }
  }

  async function handleSignInResponse(response) {
    const idToken = response.credential;
    const claims = _decodeJwt(idToken);
    if (!claims?.email) { toast('Sign in ไม่สำเร็จ: อ่าน token ไม่ได้', 'error'); return; }
    if (!state.settings.sheetUrl) {
      toast('กรุณาตั้งค่า Apps Script URL ก่อน', 'error');
      return;
    }
    const btn = $('#btnSignIn');
    const modalBtn = $('#btnModalSignIn');
    const btnLabel = btn?.querySelector('span');
    const modalBtnLabel = modalBtn?.querySelector('span');
    const setLoading = (on) => {
      if (btn) { btn.disabled = on; if (btnLabel) btnLabel.textContent = on ? 'กำลังตรวจสอบ...' : 'Sign in with Google'; }
      if (modalBtn) { modalBtn.disabled = on; if (modalBtnLabel) modalBtnLabel.textContent = on ? 'กำลังตรวจสอบ...' : 'Sign in with Google'; }
    };
    setLoading(true);
    try {
      const res = await fetch(state.settings.sheetUrl + '?action=checkRole&email=' + encodeURIComponent(claims.email));
      const data = await res.json();
      if (!data.ok) {
        setLoading(false);
        toast('ตรวจสอบสิทธิ์ไม่สำเร็จ: ' + (data.error || ''), 'error'); return;
      }
      if (data.role !== 'admin') {
        setLoading(false);
        toast('บัญชีนี้ไม่มีสิทธิ์ Admin', 'error'); return;
      }
      state.session.role = 'admin';
      state.session.token = idToken;
      state.session.email = claims.email;
      state.session.name = claims.name || claims.email;
      closeSignInModal();
      updateAuthUI();
      renderAll();
      toast('✓ ' + (claims.name || claims.email) + ' — เข้าสู่ระบบแล้ว', 'success');
    } catch (err) {
      setLoading(false);
      toast('Sign in ไม่สำเร็จ: ' + err.message, 'error');
    }
  }

  function openSignInModal() {
    $('#signInModal').hidden = false;
    $('#signInOverlay').hidden = false;
  }

  function closeSignInModal() {
    $('#signInModal').hidden = true;
    $('#signInOverlay').hidden = true;
  }

  function triggerSignIn() {
    if (!state.settings.googleClientId) {
      toast('กรุณาตั้งค่า Google Client ID ใน Settings ก่อน', 'error');
      if (state.settings.sheetUrl) switchView('settings');
      return;
    }
    openSignInModal();
  }

  function signOut() {
    state.session = { role: 'viewer', token: null, email: null, name: null };
    if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
    if (state.view === 'settings') switchView('workflows');
    updateAuthUI();
    renderAll();
    toast('ออกจากระบบแล้ว', '');
  }

  function updateAuthUI() {
    const adm = isAdmin();
    const fallback = $('#btnSignIn');
    if (fallback) fallback.style.display = adm ? 'none' : '';
    $('#userChip').hidden = !adm;
    const navSettings = $('#navSettings');
    if (navSettings) navSettings.hidden = !adm;
    if (adm) {
      $('#userAvatar').textContent = (state.session.name || 'A')[0].toUpperCase();
      $('#userName').textContent = state.session.name || state.session.email || 'Admin';
    }
  }

  function ensureAdmin(message = 'เมนูนี้สำหรับ admin เท่านั้น') {
    if (isAdmin()) return true;
    toast(message + ' — กรุณา Sign in', 'error');
    return false;
  }

  // ---------- Admin management ----------
  async function loadAdminList() {
    if (!state.settings.sheetUrl || !state.session.token) return;
    try {
      const url = state.settings.sheetUrl + '?action=listAdmins&token=' + encodeURIComponent(state.session.token);
      const res = await fetch(url);
      const data = await res.json();
      if (!data.ok) return;
      renderAdminList(data.admins || []);
      $('#adminMgmtSection').hidden = false;
    } catch (err) { console.error(err); }
  }

  function renderAdminList(admins) {
    const el = $('#adminList');
    if (!el) return;
    if (!admins.length) {
      el.innerHTML = '<p style="color:var(--text-faint);font-size:var(--text-sm)">ยังไม่มี Admin (เพิ่มได้จากด้านล่าง)</p>';
      return;
    }
    el.innerHTML = admins.map((a) => `
      <div class="admin-row">
        <div class="admin-row-info">
          <div style="font-weight:600">${escapeHtml(a.name || a.email)}</div>
          <div class="admin-row-email">${escapeHtml(a.email)}</div>
        </div>
        ${a.email !== state.session.email
          ? `<button class="btn btn-danger-ghost btn-sm" data-remove-admin="${escapeHtml(a.email)}">ลบ</button>`
          : '<span style="font-size:var(--text-xs);color:var(--text-faint)">(คุณ)</span>'}
      </div>`).join('');
    $$('[data-remove-admin]', el).forEach((btn) => {
      btn.addEventListener('click', () => removeAdminUser(btn.dataset.removeAdmin));
    });
  }

  async function addAdminUser() {
    const input = $('#addAdminEmail');
    const email = input?.value.trim().toLowerCase();
    if (!email || !state.session.token) return;
    try {
      const res = await fetch(state.settings.sheetUrl, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'addAdmin', token: state.session.token, email }),
      });
      const data = await res.json();
      if (!data.ok) { toast('เพิ่มไม่สำเร็จ: ' + data.error, 'error'); return; }
      if (input) input.value = '';
      renderAdminList(data.admins || []);
      toast('✓ เพิ่ม Admin แล้ว', 'success');
    } catch (err) { toast('เกิดข้อผิดพลาด: ' + err.message, 'error'); }
  }

  async function removeAdminUser(email) {
    if (!confirm(`ลบ ${email} ออกจาก Admin ใช่ไหม?`)) return;
    if (!state.session.token) return;
    try {
      const res = await fetch(state.settings.sheetUrl, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'removeAdmin', token: state.session.token, email }),
      });
      const data = await res.json();
      if (!data.ok) { toast('ลบไม่สำเร็จ: ' + data.error, 'error'); return; }
      renderAdminList(data.admins || []);
      toast('ลบ Admin แล้ว', 'orange');
    } catch (err) { toast('เกิดข้อผิดพลาด: ' + err.message, 'error'); }
  }

  function saveGoogleClientId() {
    const clientId = $('#googleClientId')?.value.trim();
    if (!clientId) return;
    state.settings.googleClientId = clientId;
    initGoogleSignIn(clientId);
    toast('✓ บันทึก Client ID แล้ว', 'success');
  }

  // ---------- Persistence (in-memory + Sheets) ----------
  // We cannot use localStorage (sandbox restriction in some deploys).
  // Data lives in memory + persists to Google Sheet on save/sync.
  // On load, we pull from Sheet if configured.

  async function saveToSheet(workflowsArray = state.workflows) {
    if (!state.settings.sheetUrl) return false;
    try {
      updateSyncStatus('syncing');
      const res = await fetch(state.settings.sheetUrl, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'save',
          secret: state.settings.secret,
          token: state.session.token,
          workflows: workflowsArray,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Sync failed');
      updateSyncStatus('online');
      return true;
    } catch (err) {
      console.error(err);
      updateSyncStatus('offline');
      toast('⚠️ Sync Sheet ไม่สำเร็จ: ' + err.message, 'error');
      return false;
    }
  }

  async function loadFromSheet() {
    if (!state.settings.sheetUrl) return null;
    try {
      updateSyncStatus('syncing');
      const url = state.settings.sheetUrl + '?action=load&secret=' + encodeURIComponent(state.settings.secret);
      const res = await fetch(url);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Load failed');
      if (data.clientId && !state.settings.googleClientId) {
        state.settings.googleClientId = data.clientId;
        const input = $('#googleClientId');
        if (input) input.value = data.clientId;
        initGoogleSignIn(data.clientId);
      }
      updateSyncStatus('online');
      return data.workflows || [];
    } catch (err) {
      console.error(err);
      updateSyncStatus('offline');
      return null;
    }
  }

  function updateSyncStatus(status) {
    const el = $('#syncStatus');
    const dot = $('.dot', el);
    const label = $('.sync-label', el);
    const sub = $('.sync-sub', el);
    dot.className = 'dot dot-' + status;
    if (status === 'online') {
      label.textContent = 'เชื่อมต่อแล้ว';
      sub.textContent = 'Synced with Google Sheet';
      state.connected = true;
    } else if (status === 'syncing') {
      label.textContent = 'กำลัง Sync...';
      sub.textContent = 'บันทึกข้อมูล';
    } else {
      label.textContent = 'ยังไม่ได้เชื่อม Sheet';
      sub.textContent = 'ทำงานแบบ Local';
      state.connected = false;
    }
  }

  // In-memory only (sandboxed iframe blocks storage APIs).
  // Persistence = Google Sheets or JSON export.
  function persistSettings() { /* in-memory in state.settings */ }
  function loadSettings() { /* noop */ }
  function persistLocal() { /* noop */ }
  function loadLocal() { /* noop */ }

  async function persist() {
    persistLocal();
    if (state.settings.sheetUrl) {
      await saveToSheet();
    }
  }

  // ---------- Rendering ----------
  function renderAll() {
    renderChannelControls();
    renderCategoryControls();
    renderChannelContext();
    renderWorkflowGrid();
    renderTimeline();
  }

  function renderCategoryControls() {
    const categorySelect = $('#wfCategory');
    if (!categorySelect) return;

    const current = categorySelect.value || state.currentWorkflow?.category || '';
    categorySelect.innerHTML = [
      '<option value="">เลือกหมวดหมู่ / ประเภทงาน</option>',
      ...MT_WORK_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`),
    ].join('');
    categorySelect.value = MT_WORK_CATEGORIES.includes(current) ? current : '';
  }

  function renderChannelControls() {
    const channels = getChannelList();
    const counts = getChannelCounts();
    const filterSelect = $('#filterChannel');
    const editorSelect = $('#wfChannel');
    const submenu = $('#channelSubmenu');

    if (filterSelect) {
      filterSelect.innerHTML = [
        '<option value="">ทุกช่องทาง / ลูกค้า</option>',
        ...channels.map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`),
      ].join('');
      filterSelect.value = state.filter.channel;
    }

    if (editorSelect) {
      const current = editorSelect.value || state.currentWorkflow?.channel || "Lotus's";
      editorSelect.innerHTML = channels
        .map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`)
        .join('');
      editorSelect.value = channels.includes(current) ? current : "Lotus's";
    }

    if (submenu) {
      const total = state.workflows.length;
      submenu.innerHTML = `
        ${channelSubitem({ value: '', label: 'ทั้งหมด', count: total })}
        ${channels.map((channel) => channelSubitem({
          value: channel,
          label: channel,
          count: counts[channel] || 0,
        })).join('')}
      `;

      $$('[data-channel-filter]', submenu).forEach((btn) => {
        btn.addEventListener('click', () => setChannelFilter(btn.dataset.channelFilter || ''));
      });
    }
  }

  function channelSubitem(item) {
    const isActive = state.filter.channel === item.value;
    const isEmpty = item.count === 0 && item.value;
    return `
      <button class="nav-subitem ${isActive ? 'active' : ''} ${isEmpty ? 'is-empty' : ''}" data-channel-filter="${escapeHtml(item.value)}">
        <span>${escapeHtml(item.label)}</span>
        <span class="nav-subcount">${item.count}</span>
      </button>
    `;
  }

  function renderChannelContext() {
    const box = $('#channelContext');
    if (!box) return;

    const channel = state.filter.channel;
    if (!channel) {
      box.hidden = true;
      return;
    }

    const channelRows = state.workflows.filter((w) => w.channel === channel);
    const visibleRows = getFilteredWorkflows();
    $('#channelContextTitle').textContent = channel;
    $('#channelContextMeta').textContent = `พบ ${visibleRows.length} เรื่องจาก ${channelRows.length} เรื่องในช่องทางนี้`;
    box.hidden = false;
  }

  function setChannelFilter(channel) {
    state.filter.channel = channel;
    const filterSelect = $('#filterChannel');
    if (filterSelect) filterSelect.value = channel;
    switchView(state.view === 'timeline' ? 'timeline' : 'workflows');
    renderChannelControls();
    renderChannelContext();
    renderWorkflowGrid();
    renderTimeline();
  }

  function getFilteredWorkflows() {
    const { search, channel } = state.filter;
    return state.workflows.filter((w) => {
      if (channel && w.channel !== channel) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = [w.name, w.description, w.channel, (w.tags || []).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function channelBadge(chan) {
    const label = chan || 'Other';
    return `<span class="badge badge-orange">${escapeHtml(label)}</span>`;
  }

  function renderWorkflowGrid() {
    const grid = $('#workflowGrid');
    const empty = $('#emptyState');
    const list = getFilteredWorkflows();

    if (list.length === 0) {
      grid.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    grid.innerHTML = list
      .map((w) => {
        const steps = w.steps || [];
        const tags = (w.tags || []).slice(0, 4);
        return `
          <article class="wf-card" data-id="${w.id}">
            <div class="wf-card-head">
              <div style="flex:1;min-width:0">
                <h3 class="wf-card-title">${escapeHtml(w.name || 'ไม่มีชื่อ')}</h3>
                <div class="wf-card-meta" style="margin-top:6px">
                  ${channelBadge(w.channel)}
                  ${w.category ? `<span class="badge">${escapeHtml(w.category)}</span>` : ''}
                </div>
              </div>
            </div>
            ${w.description ? `<p class="wf-card-desc">${escapeHtml(w.description)}</p>` : ''}
            ${tags.length ? `<div class="tags-list">${tags.map((t) => `<span class="tag-pill">#${escapeHtml(t)}</span>`).join('')}</div>` : ''}
            <div class="wf-card-footer">
              <span>${steps.length} หัวข้อย่อย</span>
            </div>
          </article>
        `;
      })
      .join('');

    $$('.wf-card', grid).forEach((card) => {
      card.addEventListener('click', () => openStepNavigator(card.dataset.id));
    });
  }

  function renderTimeline() {
    const summary = $('#timelineSummary');
    const listEl = $('#timelineList');
    if (!summary || !listEl) return;

    const list = [...getFilteredWorkflows()].sort(
      (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)
    );
    const totalSteps = list.reduce((sum, w) => sum + (w.steps || []).length, 0);
    const selectedChannel = state.filter.channel || 'ทุกช่องทาง';

    summary.innerHTML = `
      <div class="timeline-summary-card">
        <span>Workflow</span>
        <strong>${list.length}</strong>
      </div>
      <div class="timeline-summary-card">
        <span>หัวข้อย่อย</span>
        <strong>${totalSteps}</strong>
      </div>
      <div class="timeline-summary-card wide">
        <span>มุมมองปัจจุบัน</span>
        <strong>${escapeHtml(selectedChannel)}</strong>
      </div>
    `;

    if (!list.length) {
      listEl.innerHTML = `
        <div class="empty-state">
          <h3>ยังไม่มี workflow สำหรับไทม์ไลน์นี้</h3>
          <p>ลองล้าง filter หรือเพิ่มข้อมูล workflow ใหม่</p>
        </div>
      `;
      return;
    }

    const grouped = list.reduce((acc, w) => {
      const channel = w.channel || 'ไม่ระบุช่องทาง';
      if (!acc[channel]) acc[channel] = [];
      acc[channel].push(w);
      return acc;
    }, {});
    const knownChannels = MT_CHANNELS.filter((channel) => grouped[channel]);
    const extraChannels = Object.keys(grouped).filter((channel) => !MT_CHANNELS.includes(channel)).sort();
    const channelOrder = [...knownChannels, ...extraChannels];

    listEl.innerHTML = channelOrder.map((channel) => {
      const workflows = grouped[channel];
      const channelStepCount = workflows.reduce((sum, w) => sum + (w.steps || []).length, 0);
      return `
        <section class="timeline-channel-group">
          <div class="timeline-channel-head">
            <div>
              <span class="timeline-channel-label">Channel</span>
              <h2>${escapeHtml(channel)}</h2>
            </div>
            <div class="timeline-channel-stats">
              <span>${workflows.length} workflow</span>
              <span>${channelStepCount} steps</span>
            </div>
          </div>
          <div class="timeline-channel-list">
            ${workflows.map((w, wfIndex) => renderTimelineWorkflow(w, wfIndex)).join('')}
          </div>
        </section>
      `;
    }).join('');

    $$('[data-open-workflow]', listEl).forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStepNavigator(btn.dataset.openWorkflow);
      });
    });
    $$('.timeline-item', listEl).forEach((item) => {
      item.addEventListener('click', () => openStepNavigator(item.dataset.id));
    });
  }

  function renderTimelineWorkflow(w, wfIndex) {
    const steps = w.steps || [];
    return `
      <article class="timeline-item" data-id="${w.id}">
        <div class="timeline-marker">${String(wfIndex + 1).padStart(2, '0')}</div>
        <div class="timeline-card">
          <div class="timeline-card-head">
            <div>
              <h3>${escapeHtml(w.name || 'ไม่มีชื่อ')}</h3>
              <div class="wf-card-meta">
                ${w.category ? `<span class="badge">${escapeHtml(w.category)}</span>` : ''}
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" data-open-workflow="${w.id}">เปิดดู</button>
          </div>
          ${w.description ? `<p class="timeline-desc">${escapeHtml(w.description)}</p>` : ''}
          <div class="timeline-steps">
            ${steps.length ? steps.map((s, stepIndex) => `
              <div class="timeline-step">
                <span class="timeline-step-index">${stepIndex + 1}</span>
                <div>
                  <strong>${escapeHtml(s.title || 'ยังไม่มีชื่อหัวข้อ')}</strong>
                </div>
              </div>
            `).join('') : '<div class="timeline-step muted">ยังไม่มีหัวข้อย่อย</div>'}
          </div>
        </div>
      </article>
    `;
  }

  // ---------- Pricing tools ----------
  const moneyFormatter = new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

  const numberValue = (selector, fallback = 0) => {
    const value = Number($(selector)?.value);
    return Number.isFinite(value) ? value : fallback;
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const money = (value) => moneyFormatter.format(Number.isFinite(value) ? value : 0);
  const percent = (value) => `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
  const tierPresets = {
    base: [
      { min: 5, discount: 10 },
      { min: 11, discount: 15 },
      { min: 21, discount: 20 },
    ],
    plus5: [
      { min: 5, discount: 15 },
      { min: 11, discount: 20 },
      { min: 21, discount: 25 },
    ],
  };

  function setPricingTab(name) {
    $$('.pricing-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.pricingTab === name));
    $$('.pricing-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.pricingPanel === name));
    renderPricingCalculator();
  }

  function renderPricingCalculator() {
    renderDiscountCalculator();
    renderPromoCalculator();
    renderTierCalculator();
    renderCostCalculator();
  }

  function renderDiscountCalculator() {
    if (!$('#discountBasePrice')) return;
    const base = Math.max(numberValue('#discountBasePrice'), 0);
    const sale = Math.max(numberValue('#discountSalePrice'), 0);
    const qty = Math.max(Math.floor(numberValue('#discountQty', 1)), 1);
    const unitDiscount = Math.max(base - sale, 0);
    const discountPct = base > 0 ? (unitDiscount / base) * 100 : 0;

    $('#discountPercentResult').textContent = percent(discountPct);
    $('#discountPerUnitResult').textContent = money(unitDiscount);
    $('#discountTotalSaveResult').textContent = money(unitDiscount * qty);
    $('#discountNetResult').textContent = money(sale * qty);
  }

  function renderPromoCalculator() {
    if (!$('#promoUnitPrice')) return;
    const price = Math.max(numberValue('#promoUnitPrice'), 0);
    const qty = Math.max(Math.floor(numberValue('#promoQty', 1)), 1);
    const type = $('#promoType').value;
    const value = Math.max(numberValue('#promoValue'), 0);
    let netTotal = price * qty;
    let freeUnits = 0;

    $$('.promo-value-field').forEach((el) => { el.hidden = type === 'bogo'; });
    $$('.promo-bogo-field').forEach((el) => { el.hidden = type !== 'bogo'; });
    $('#promoValueLabel').textContent = type === 'amount' ? 'ลดบาท / ชิ้น' : '% ส่วนลด';

    if (type === 'percent') {
      netTotal = price * qty * (1 - clamp(value, 0, 100) / 100);
    } else if (type === 'amount') {
      netTotal = Math.max(price - value, 0) * qty;
    } else if (type === 'bogo') {
      const buy = Math.max(Math.floor(numberValue('#promoBuyQty', 1)), 1);
      const get = Math.max(Math.floor(numberValue('#promoFreeQty', 1)), 1);
      const setSize = buy + get;
      freeUnits = Math.floor(qty / setSize) * get;
      netTotal = Math.max(qty - freeUnits, 0) * price;
    }

    const gross = price * qty;
    const effectiveDiscount = gross > 0 ? ((gross - netTotal) / gross) * 100 : 0;
    const netUnit = qty > 0 ? netTotal / qty : 0;

    $('#promoEffectiveDiscountResult').textContent = percent(effectiveDiscount);
    $('#promoNetUnitResult').textContent = money(netUnit);
    $('#promoNetTotalResult').textContent = money(netTotal);
    $('#promoFreeUnitsResult').textContent = `${freeUnits} ชิ้น`;
  }

  function getTierRows() {
    return $$('.tier-row:not(.tier-head)').map((row) => ({
      min: Math.max(Number($('.tier-min', row).value) || 0, 0),
      discount: clamp(Number($('.tier-discount', row).value) || 0, 0, 100),
    })).filter((tier) => tier.min > 0).sort((a, b) => a.min - b.min);
  }

  function applyTierPreset(name) {
    const preset = tierPresets[name] || tierPresets.base;
    const rows = $$('.tier-row:not(.tier-head)');
    rows.forEach((row, index) => {
      const tier = preset[index];
      if (!tier) return;
      $('.tier-min', row).value = tier.min;
      $('.tier-discount', row).value = tier.discount;
    });
    $$('.tier-preset').forEach((btn) => btn.classList.toggle('active', btn.dataset.tierPreset === name));
    renderTierCalculator();
  }

  function renderTierCalculator() {
    if (!$('#tierUnitPrice')) return;
    const price = Math.max(numberValue('#tierUnitPrice'), 0);
    const qty = Math.max(Math.floor(numberValue('#tierQty', 1)), 1);
    const matched = getTierRows().reduce((best, tier) => (qty >= tier.min ? tier : best), null);
    const discount = matched ? matched.discount : 0;
    const netUnit = price * (1 - discount / 100);
    const netTotal = netUnit * qty;

    $('#tierMatchedResult').textContent = matched ? `${matched.min}+ ชิ้น` : '-';
    $('#tierDiscountResult').textContent = percent(discount);
    $('#tierNetUnitResult').textContent = money(netUnit);
    $('#tierNetTotalResult').textContent = money(netTotal);
  }

  function workflowSearchText(workflow) {
    const steps = workflow.steps || [];
    return [
      workflow.name,
      workflow.category,
      workflow.channel,
      workflow.description,
      (workflow.tags || []).join(' '),
      ...steps.flatMap((step) => [
        step.title,
        step.description,
        step.tools,
        step.documents,
        step.notes,
        ...(step.checklist || []).map((item) => item.text),
      ]),
    ].filter(Boolean).join(' ');
  }

  function extractGpFromText(text) {
    const patterns = [
      /(?:gp|g\.p\.|gp%|gross profit|margin|กำไรขั้นต้น)\s*(?:%|percent|เปอร์เซ็นต์)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\s*%?/i,
      /([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:gp|g\.p\.|gross profit|margin|กำไรขั้นต้น)/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return clamp(Number(match[1]), 0, 100);
    }
    return null;
  }

  function getChannelGpPercent(channel) {
    if (!channel) return null;
    const rows = state.workflows.filter((workflow) => workflow.channel === channel);
    const prioritizedRows = [
      ...rows.filter((workflow) => /gp|pricing|cost|ราคา|ต้นทุน/i.test(workflow.category || '')),
      ...rows.filter((workflow) => !/gp|pricing|cost|ราคา|ต้นทุน/i.test(workflow.category || '')),
    ];
    for (const workflow of prioritizedRows) {
      const gp = extractGpFromText(workflowSearchText(workflow));
      if (gp !== null) return gp;
    }
    return null;
  }

  function renderCostChannelOptions() {
    const select = $('#costChannel');
    if (!select) return;
    const current = select.value;
    select.innerHTML = getChannelList()
      .map((channel) => `<option value="${escapeHtml(channel)}">${escapeHtml(channel)}</option>`)
      .join('');
    select.value = current && getChannelList().includes(current) ? current : getChannelList()[0];
    syncGpFromSelectedChannel();
  }

  function syncGpFromSelectedChannel() {
    const select = $('#costChannel');
    const input = $('#costGpPercent');
    const source = $('#costGpSource');
    if (!select || !input || !source) return;
    const channel = select.value;
    const gp = getChannelGpPercent(channel);
    if (gp !== null) {
      input.value = gp;
      source.textContent = `ดึง GP% จาก workflow ของ ${channel}`;
    } else {
      source.textContent = `ไม่พบ GP% ใน workflow ของ ${channel} · กรอกเองได้`;
    }
    renderCostCalculator();
  }

  function renderCostCalculator() {
    if (!$('#costSellingPrice')) return;
    const price = Math.max(numberValue('#costSellingPrice'), 0);
    const qty = Math.max(Math.floor(numberValue('#costQty', 1)), 1);
    const gp = clamp(numberValue('#costGpPercent'), 0, 100);
    const costUnit = price * (1 - gp / 100);
    const profitUnit = price - costUnit;

    $('#costUnitResult').textContent = money(costUnit);
    $('#costProfitUnitResult').textContent = money(profitUnit);
    $('#costTotalResult').textContent = money(costUnit * qty);
    $('#costProfitTotalResult').textContent = money(profitUnit * qty);
  }

  function normalizeStepLink(link) {
    const value = String(link || '').trim();
    if (!value) return '';
    if (/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value)) return value;
    if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(value)) return `https://${value}`;
    return value;
  }

  function stepLinkLabel(link, index) {
    const value = String(link || '').trim();
    if (!value) return `Link ${index + 1}`;
    try {
      const parsed = new URL(normalizeStepLink(value), window.location.href);
      return parsed.hostname && parsed.hostname !== window.location.hostname
        ? parsed.hostname.replace(/^www\./, '')
        : `Link ${index + 1}`;
    } catch (_err) {
      return `Link ${index + 1}`;
    }
  }

  // ---------- View switching ----------
  function switchView(name) {
    state.view = name;
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.viewContent === name));
    $('#sidebar').classList.remove('open');
    if (name === 'timeline') renderTimeline();
    if (name === 'pricing') renderPricingCalculator();
    if (name === 'settings' && isAdmin()) loadAdminList();
  }

  // ---------- Workflow editor (drawer) ----------
  function openWorkflowEditor(id = null) {
    if (id) {
      const wf = state.workflows.find((w) => w.id === id);
      if (!wf) return;
      state.currentWorkflow = JSON.parse(JSON.stringify(wf));
    } else {
      state.currentWorkflow = {
        id: uid(),
        name: '',
        category: '',
        channel: 'Lotus\'s',
        owner: '',
        description: '',
        tags: [],
        steps: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    renderChannelControls();
    renderCategoryControls();
    populateEditor();
    $('#drawer').hidden = false;
    $('#drawerOverlay').hidden = false;
    $('#btnDeleteWorkflow').hidden = !id;
    $('#drawerBreadcrumb').textContent = id ? 'แก้ไขข้อมูล' : 'ข้อมูลใหม่';
    setTimeout(() => $('#wfName').focus(), 200);
  }

  function closeDrawer() {
    $('#drawer').hidden = true;
    $('#drawerOverlay').hidden = true;
    state.currentWorkflow = null;
  }

  function populateEditor() {
    const w = state.currentWorkflow;
    $('#wfName').value = w.name || '';
    $('#wfCategory').value = w.category || '';
    $('#wfChannel').value = w.channel || 'Lotus\'s';
    $('#wfOwner').value = w.owner || '';
    $('#wfDescription').value = w.description || '';
    $('#wfTags').value = (w.tags || []).join(', ');
    renderSteps();
  }

  function collectEditor() {
    const w = state.currentWorkflow;
    w.name = $('#wfName').value.trim();
    w.category = $('#wfCategory').value.trim();
    w.channel = $('#wfChannel').value;
    w.owner = $('#wfOwner').value.trim();
    w.description = $('#wfDescription').value.trim();
    w.tags = $('#wfTags').value.split(',').map((t) => t.trim()).filter(Boolean);
    w.updatedAt = new Date().toISOString();
    return w;
  }

  async function saveWorkflow() {
    const w = collectEditor();
    if (!w.name) {
      toast('⚠️ กรุณาใส่หัวข้อความรู้', 'error');
      $('#wfName').focus();
      return;
    }
    const existingIdx = state.workflows.findIndex((x) => x.id === w.id);
    if (existingIdx >= 0) state.workflows[existingIdx] = w;
    else state.workflows.unshift(w);

    $('#saveIndicator').textContent = 'กำลังบันทึก...';
    await persist();
    $('#saveIndicator').textContent = '✓ บันทึกแล้ว';
    setTimeout(() => ($('#saveIndicator').textContent = ''), 2000);

    toast('✓ บันทึกข้อมูลแล้ว', 'success');
    renderAll();
    renderCostChannelOptions();
    closeDrawer();
    if (!$('#stepNav').hidden && _navWfId === w.id) renderStepNav();
  }

  async function deleteWorkflow() {
    if (!state.currentWorkflow) return;
    if (!confirm('ต้องการลบข้อมูลเรื่องนี้ใช่ไหม?')) return;
    state.workflows = state.workflows.filter((w) => w.id !== state.currentWorkflow.id);
    await persist();
    toast('🗑 ลบแล้ว', 'orange');
    renderAll();
    closeDrawer();
    if (!$('#stepNav').hidden) closeStepNavigator();
  }

  // ---------- Step Navigator ----------
  let _navWfId = null;

  function openStepNavigator(id) {
    const wf = state.workflows.find((w) => w.id === id);
    if (!wf) return;
    _navWfId = id;
    renderStepNav();
    $('#stepNavOverlay').hidden = false;
    $('#stepNav').hidden = false;
  }

  function closeStepNavigator() {
    const nav = $('#stepNav');
    nav.classList.add('is-closing');
    $('#stepNavOverlay').hidden = true;
    setTimeout(() => {
      nav.classList.remove('is-closing');
      nav.hidden = true;
      _navWfId = null;
    }, 280);
  }

  function renderStepNav() {
    const wf = state.workflows.find((w) => w.id === _navWfId);
    if (!wf) return;

    $('#navBadges').innerHTML = `${channelBadge(wf.channel)}${wf.category ? `<span class="badge">${escapeHtml(wf.category)}</span>` : ''}`;
    $('#navWfTitle').textContent = wf.name || 'ไม่มีชื่อ';

    const descEl = $('#navWfDesc');
    if (wf.description) {
      descEl.textContent = wf.description;
      descEl.hidden = false;
    } else {
      descEl.hidden = true;
    }

    const steps = wf.steps || [];
    if (steps.length === 0) {
      $('#navContent').innerHTML = '<div class="step-nav-empty">เรื่องนี้ยังไม่มีหัวข้อย่อย</div>';
      return;
    }

    $('#navContent').innerHTML = `<div class="chain">${steps.map((s, i) => {
      const isLast = i === steps.length - 1;
      const descHtml = s.description ? `<p class="chain-desc">${escapeHtml(s.description)}</p>` : '';

      const checklist = s.checklist || [];
      const checklistHtml = checklist.length ? `
        <div class="chain-checklist">
          ${checklist.map((c, ci) => `
            <label class="chain-check-item${c.done ? ' done' : ''}">
              <input type="checkbox" data-step="${i}" data-chk="${ci}" ${c.done ? 'checked' : ''} />
              <span>${escapeHtml(c.text)}</span>
            </label>`).join('')}
        </div>` : '';

      const infoHtml = (s.tools || s.documents) ? `
        <div class="chain-info">
          ${s.tools ? `<span><span class="chain-info-label">Tools</span>${escapeHtml(s.tools)}</span>` : ''}
          ${s.documents ? `<span><span class="chain-info-label">เอกสาร</span>${escapeHtml(s.documents)}</span>` : ''}
        </div>` : '';

      const notesHtml = s.notes ? `<div class="chain-notes">${escapeHtml(s.notes)}</div>` : '';

      const links = s.links || [];
      const linksHtml = links.length ? `
        <div class="chain-links">
          <span class="chain-info-label">Links</span>
          ${links.map((link, li) => {
            const href = normalizeStepLink(link);
            return href ? `<a class="chain-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(stepLinkLabel(link, li))}</a>` : '';
          }).join('')}
        </div>` : '';

      const attachments = s.attachments || [];
      const attachHtml = attachments.length ? `
        <div class="chain-attachments">
          <span class="chain-info-label">ไฟล์แนบ</span>
          ${attachments.map((f) => `<a class="chain-attachment-link" href="${f.data}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>`).join('')}
        </div>` : '';

      return `
        <div class="chain-step">
          <div class="chain-node">
            <div class="chain-number">${i + 1}</div>
            ${!isLast ? '<div class="chain-line"></div>' : ''}
          </div>
          <div class="chain-content">
            <h3 class="chain-title">${escapeHtml(s.title || 'ยังไม่มีชื่อ')}</h3>
            ${descHtml}${checklistHtml}${infoHtml}${linksHtml}${notesHtml}${attachHtml}
          </div>
        </div>`;
    }).join('')}</div>`;

    $$('[data-chk]', $('#navContent')).forEach((cb) => {
      cb.addEventListener('change', () => {
        const wf = state.workflows.find((w) => w.id === _navWfId);
        if (!wf) return;
        wf.steps[Number(cb.dataset.step)].checklist[Number(cb.dataset.chk)].done = cb.checked;
        cb.closest('.chain-check-item').classList.toggle('done', cb.checked);
      });
    });
  }

  // ---------- Steps ----------
  function renderSteps() {
    const list = $('#stepsList');
    const steps = state.currentWorkflow.steps || [];
    $('#stepCount').textContent = `${steps.length} หัวข้อย่อย`;

    if (steps.length === 0) {
      list.innerHTML = '<div style="text-align:center;padding:var(--space-6);color:var(--text-muted);font-size:var(--text-sm)">ยังไม่มีหัวข้อย่อย · กดปุ่มด้านล่างเพื่อเพิ่ม</div>';
      return;
    }

    list.innerHTML = steps
      .map((s, i) => {
        const chk = s.checklist && s.checklist.length
          ? `<span>☑ ${s.checklist.filter((c) => c.done).length}/${s.checklist.length}</span>` : '';
        return `
          <div class="step-card" draggable="true" data-index="${i}">
            <div class="step-handle" title="ลากเพื่อจัดเรียง">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg>
            </div>
            <div class="step-number">${i + 1}</div>
            <div class="step-main">
              <span class="step-title">${escapeHtml(s.title || 'ยังไม่มีชื่อ')}</span>
              <div class="step-sub">
                ${chk}
              </div>
            </div>
            <div class="step-actions">
              <button class="icon-btn" data-action="edit" aria-label="แก้ไข">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="icon-btn" data-action="delete" aria-label="ลบ">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    // Click handlers
    $$('.step-card', list).forEach((card) => {
      const idx = Number(card.dataset.index);
      card.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (btn) {
          e.stopPropagation();
          if (btn.dataset.action === 'edit') openStepModal(idx);
          else if (btn.dataset.action === 'delete') deleteStep(idx);
          return;
        }
        openStepModal(idx);
      });

      // Drag reorder
      card.addEventListener('dragstart', (e) => {
        card.classList.add('dragging');
        e.dataTransfer.setData('text/plain', idx);
      });
      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        $$('.step-card').forEach((c) => c.classList.remove('drag-over'));
      });
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        card.classList.add('drag-over');
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData('text/plain'));
        const to = idx;
        if (from === to) return;
        const arr = state.currentWorkflow.steps;
        const [moved] = arr.splice(from, 1);
        arr.splice(to, 0, moved);
        renderSteps();
      });
    });
  }

  function addStep() {
    const s = {
      id: stepUid(),
      title: '',
      description: '',
      checklist: [],
      tools: '',
      documents: '',
      links: [],
      notes: '',
      attachments: [],
    };
    state.currentWorkflow.steps.push(s);
    openStepModal(state.currentWorkflow.steps.length - 1, true);
  }

  function deleteStep(i) {
    if (!confirm('ลบหัวข้อย่อยนี้ใช่ไหม?')) return;
    state.currentWorkflow.steps.splice(i, 1);
    renderSteps();
  }

  // ---------- Step modal ----------
  function openStepModal(i, isNew = false) {
    state.currentStepIndex = i;
    const s = state.currentWorkflow.steps[i];
    $('#stepModalEyebrow').textContent = `หัวข้อย่อยที่ ${i + 1}`;
    $('#stepModalTitle').textContent = isNew ? 'เพิ่มหัวข้อย่อยใหม่' : 'รายละเอียดหัวข้อย่อย';
    $('#stepTitle').value = s.title || '';
    $('#stepDescription').value = s.description || '';
    $('#stepTools').value = s.tools || '';
    $('#stepDocuments').value = s.documents || '';
    $('#stepLinks').value = (s.links || []).join(', ');
    $('#stepNotes').value = s.notes || '';
    renderChecklist();
    renderAttachments();
    $('#stepModal').hidden = false;
    $('#stepModalOverlay').hidden = false;
    setTimeout(() => $('#stepTitle').focus(), 120);
  }

  function closeStepModal(save = false) {
    if (save) saveStep();
    $('#stepModal').hidden = true;
    $('#stepModalOverlay').hidden = true;
    state.currentStepIndex = null;
  }

  function saveStep() {
    if (state.currentStepIndex == null) return;
    const s = state.currentWorkflow.steps[state.currentStepIndex];
    s.title = $('#stepTitle').value.trim();
    s.description = $('#stepDescription').value.trim();
    s.tools = $('#stepTools').value.trim();
    s.documents = $('#stepDocuments').value.trim();
    s.links = $('#stepLinks').value.split(',').map((l) => l.trim()).filter(Boolean);
    s.notes = $('#stepNotes').value.trim();
    renderSteps();
    toast('✓ บันทึกหัวข้อย่อย', 'success');
  }

  function renderChecklist() {
    const s = state.currentWorkflow.steps[state.currentStepIndex];
    const el = $('#stepChecklist');
    const items = s.checklist || [];
    if (!items.length) {
      el.innerHTML = '<div style="color:var(--text-muted);font-size:var(--text-xs);padding:var(--space-2)">ยังไม่มีรายการย่อย</div>';
      return;
    }
    el.innerHTML = items
      .map(
        (c, i) => `
      <div class="checklist-item ${c.done ? 'checked' : ''}">
        <input type="checkbox" ${c.done ? 'checked' : ''} data-chk="${i}" />
        <span class="checklist-item-text">${escapeHtml(c.text)}</span>
        <button class="icon-btn" data-chk-del="${i}" aria-label="ลบ">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`
      )
      .join('');
    $$('[data-chk]', el).forEach((cb) => {
      cb.addEventListener('change', () => {
        const i = Number(cb.dataset.chk);
        s.checklist[i].done = cb.checked;
        renderChecklist();
      });
    });
    $$('[data-chk-del]', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.chkDel);
        s.checklist.splice(i, 1);
        renderChecklist();
      });
    });
  }

  function addChecklistItem() {
    const input = $('#checklistInput');
    const txt = input.value.trim();
    if (!txt) return;
    const s = state.currentWorkflow.steps[state.currentStepIndex];
    s.checklist = s.checklist || [];
    s.checklist.push({ text: txt, done: false });
    input.value = '';
    renderChecklist();
  }

  // ---------- Attachments ----------
  function renderAttachments() {
    if (state.currentStepIndex == null) return;
    const s = state.currentWorkflow.steps[state.currentStepIndex];
    const el = $('#stepAttachments');
    if (!el) return;
    const items = s.attachments || [];
    if (!items.length) {
      el.innerHTML = '<div class="attachment-empty">ยังไม่มีไฟล์แนบ</div>';
      return;
    }
    el.innerHTML = items.map((f, i) => `
      <div class="attachment-item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
        <a class="attachment-name" href="${f.data}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>
        <span class="attachment-size">${(f.size / 1024).toFixed(0)} KB</span>
        <button class="icon-btn" data-remove-attachment="${i}" aria-label="ลบ">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>`).join('');
    $$('[data-remove-attachment]', el).forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.removeAttachment);
        s.attachments.splice(idx, 1);
        renderAttachments();
      });
    });
  }

  // ---------- Settings actions ----------
  async function testConnection() {
    if (!ensureAdmin('ต้องเป็น admin จึงจะเปลี่ยนการตั้งค่าได้')) return;
    const url = $('#sheetUrl').value.trim();
    const secret = $('#sheetSecret').value.trim();
    if (!url) {
      toast('กรุณาใส่ Apps Script URL', 'error');
      return;
    }
    state.settings.sheetUrl = url;
    state.settings.secret = secret;
    persistSettings();

    const status = $('#connectionStatus');
    status.className = 'connection-status show pending';
    status.textContent = '⏳ กำลังทดสอบการเชื่อมต่อ...';

    try {
      const testUrl = url + '?action=ping&secret=' + encodeURIComponent(secret);
      const res = await fetch(testUrl);
      const data = await res.json();
      if (data.ok) {
        status.className = 'connection-status show success';
        status.textContent = '✅ เชื่อมต่อสำเร็จ — พร้อมใช้งาน';
        updateSyncStatus('online');
        toast('✓ เชื่อมต่อสำเร็จ', 'success');
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (err) {
      status.className = 'connection-status show error';
      status.textContent = '❌ เชื่อมต่อไม่สำเร็จ: ' + err.message;
      updateSyncStatus('offline');
    }
  }

  async function syncNow() {
    if (!ensureAdmin('ต้องเป็น admin จึงจะ sync ข้อมูลได้')) return;
    if (!state.settings.sheetUrl) {
      toast('กรุณาตั้งค่า Apps Script URL ก่อน', 'error');
      return;
    }
    const ok = await saveToSheet();
    if (ok) toast('✓ Sync ข้อมูลขึ้น Sheet แล้ว', 'success');
  }

  async function pullFromSheet() {
    if (!ensureAdmin('ต้องเป็น admin จึงจะดึงข้อมูลจาก Sheet ได้')) return;
    if (!state.settings.sheetUrl) {
      toast('กรุณาตั้งค่า Apps Script URL ก่อน', 'error');
      return;
    }
    const data = await loadFromSheet();
    if (data !== null) {
      state.workflows = data;
      persistLocal();
      renderAll();
      renderCostChannelOptions();
      toast(`✓ ดึงข้อมูล ${data.length} รายการจาก Sheet`, 'success');
    }
  }

  function exportJson() {
    const data = JSON.stringify(state.workflows, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mt-workflow-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✓ Export แล้ว', 'success');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!Array.isArray(data)) throw new Error('Invalid format');
        state.workflows = data;
        persist();
        renderAll();
        renderCostChannelOptions();
        toast(`✓ Import ${data.length} รายการ`, 'success');
      } catch (err) {
        toast('❌ ไฟล์ไม่ถูกต้อง', 'error');
      }
    };
    reader.readAsText(file);
  }

  function clearData() {
    if (!ensureAdmin('ต้องเป็น admin จึงจะล้างข้อมูลได้')) return;
    if (!confirm('ลบข้อมูลทั้งหมดใช่ไหม? (ข้อมูลใน Google Sheet จะไม่ถูกลบ)')) return;
    state.workflows = [];
    persistLocal();
    renderAll();
    toast('🗑 ล้างข้อมูลแล้ว', 'orange');
  }

  // ---------- Apps Script code (shown in settings) ----------
  const APPS_SCRIPT_CODE = `/**
 * MDT Workflow — Google Apps Script Backend (v2 with Auth)
 *
 * ขั้นตอนการตั้งค่า:
 * 1. ใส่ GOOGLE_CLIENT_ID ที่ได้จาก Google Cloud Console ด้านล่าง
 * 2. Deploy: Execute as Me · Who has access: Anyone
 * 3. เพิ่ม Admin คนแรกในแท็บ AdminUsers ของ Google Sheet โดยตรง
 *    → สร้าง sheet ชื่อ "AdminUsers" → Row 1: Email | Name | Added At | Added By
 *    → Row 2: ใส่ email ของ admin คนแรก
 */

const SECRET = '';
const SHEET_NAME = 'Workflows';
const ADMIN_SHEET = 'AdminUsers';
const GOOGLE_CLIENT_ID = '155556775648-uf1ld89gffj6m4m1mbfgj1q0iis6c8nu.apps.googleusercontent.com';

function doGet(e) {
  try {
    const params = e.parameter || {};
    if (SECRET && params.secret !== SECRET) return _json({ ok: false, error: 'Invalid secret' });
    if (params.action === 'ping') return _json({ ok: true, msg: 'pong' });

    if (params.action === 'checkRole') {
      const email = (params.email || '').trim().toLowerCase();
      if (!email) return _json({ ok: false, error: 'No email' });
      return _json({ ok: true, email, role: _isAdmin(email) ? 'admin' : 'viewer' });
    }

    if (params.action === 'listAdmins') {
      if (!_requireAdmin(params.token)) return _json({ ok: false, error: 'Unauthorized' });
      return _json({ ok: true, admins: _getAdmins() });
    }

    if (params.action === 'load') {
      const sheet = _getSheet();
      const data = sheet.getRange(1, 1).getValue();
      const workflows = data ? JSON.parse(data) : [];
      return _json({ ok: true, workflows, clientId: GOOGLE_CLIENT_ID });
    }

    return _json({ ok: false, error: 'Unknown action' });
  } catch (err) { return _json({ ok: false, error: String(err) }); }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (SECRET && body.secret !== SECRET) return _json({ ok: false, error: 'Invalid secret' });

    if (body.action === 'checkRole') {
      const user = _validateGoogleToken(body.token);
      if (!user) return _json({ ok: false, error: 'Invalid token' });
      return _json({ ok: true, email: user.email, name: user.name, role: _isAdmin(user.email) ? 'admin' : 'viewer' });
    }

    if (body.action === 'save') {
      const user = _requireAdmin(body.token);
      if (!user) return _json({ ok: false, error: 'Unauthorized — ต้องเป็น Admin' });
      const sheet = _getSheet();
      sheet.getRange(1, 1).setValue(JSON.stringify(body.workflows || []));
      _writeReadable(body.workflows || []);
      return _json({ ok: true, count: (body.workflows || []).length });
    }

    if (body.action === 'addAdmin') {
      const user = _requireAdmin(body.token);
      if (!user) return _json({ ok: false, error: 'Unauthorized' });
      const email = (body.email || '').trim().toLowerCase();
      if (!email) return _json({ ok: false, error: 'No email' });
      _addAdmin(email, body.name || email, user.email);
      return _json({ ok: true, admins: _getAdmins() });
    }

    if (body.action === 'removeAdmin') {
      const user = _requireAdmin(body.token);
      if (!user) return _json({ ok: false, error: 'Unauthorized' });
      const email = (body.email || '').trim().toLowerCase();
      if (email === user.email.toLowerCase()) return _json({ ok: false, error: 'ไม่สามารถลบตัวเองได้' });
      _removeAdmin(email);
      return _json({ ok: true, admins: _getAdmins() });
    }

    return _json({ ok: false, error: 'Unknown action' });
  } catch (err) { return _json({ ok: false, error: String(err) }); }
}

// ── Auth helpers ──────────────────────────────────────────────

function _validateGoogleToken(idToken) {
  if (!idToken) return null;
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString());
    if (payload.exp * 1000 < Date.now()) return null;
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss)) return null;
    if (GOOGLE_CLIENT_ID && payload.aud !== GOOGLE_CLIENT_ID) return null;
    return { email: payload.email, name: payload.name || payload.email };
  } catch (err) { return null; }
}

function _isAdmin(email) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ADMIN_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return false;
    const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues().flat().map(e => String(e).toLowerCase().trim()).filter(Boolean);
    return emails.includes(email.toLowerCase().trim());
  } catch (err) { return false; }
}

function _requireAdmin(token) {
  const user = _validateGoogleToken(token);
  if (!user || !_isAdmin(user.email)) return null;
  return user;
}

function _getAdmins() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ADMIN_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return [];
    return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
      .filter(r => r[0]).map(r => ({ email: r[0], name: r[1], addedAt: r[2], addedBy: r[3] }));
  } catch (err) { return []; }
}

function _addAdmin(email, name, addedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(ADMIN_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(ADMIN_SHEET);
    sheet.getRange(1, 1, 1, 4).setValues([['Email', 'Name', 'Added At', 'Added By']]).setFontWeight('bold');
  }
  if (_isAdmin(email)) return;
  sheet.appendRow([email, name, new Date().toISOString(), addedBy]);
}

function _removeAdmin(email) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ADMIN_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (String(values[i][0]).toLowerCase().trim() === email.toLowerCase())
      sheet.deleteRow(i + 2);
  }
}

// ── Sheet helpers ─────────────────────────────────────────────

function _getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1).setNote('JSON data — อย่าแก้ไขโดยตรง');
  }
  return sheet;
}

function _writeReadable(workflows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('ReadableView');
  if (!sheet) sheet = ss.insertSheet('ReadableView');
  sheet.clear();
  const headers = ['Workflow', 'หมวดหมู่', 'ช่องทาง', 'ผู้รับผิดชอบ',
                   'ขั้นตอนที่', 'ชื่อขั้นตอน',
                   'รายละเอียด', 'Checklist', 'หมายเหตุ', 'Updated'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#FFE0CC').setFontColor('#A63E0D');
  const rows = [];
  workflows.forEach(w => {
    if (!w.steps || !w.steps.length) {
      rows.push([w.name, w.category, w.channel, w.owner, '', '', w.description, '', '', w.updatedAt]);
    } else {
      w.steps.forEach((s, i) => {
        const chk = (s.checklist || []).map(c => (c.done ? '☑ ' : '☐ ') + c.text).join('\\n');
        rows.push([w.name, w.category, w.channel, w.owner,
                   i + 1, s.title, s.description, chk, s.notes, w.updatedAt]);
      });
    }
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows).setWrap(true).setVerticalAlignment('top');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, headers.length);
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;

  // ---------- Init / Wire up ----------
  function init() {
    // Theme (in-memory)
    const toggle = $$('[data-theme-toggle]');
    let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    toggle.forEach((t) => {
      t.addEventListener('click', () => {
        theme = theme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', theme);
      });
    });

    // Nav
    $$('.nav-item').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.view)));
    $('#menuToggle')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));

    // Workflow actions
    $('#btnNewWorkflow').addEventListener('click', () => openWorkflowEditor());
    $('#btnCloseDrawer').addEventListener('click', closeDrawer);
    $('#drawerOverlay').addEventListener('click', closeDrawer);
    $('#btnSaveWorkflow').addEventListener('click', saveWorkflow);
    $('#btnDeleteWorkflow').addEventListener('click', deleteWorkflow);

    // Steps
    $('#btnAddStep').addEventListener('click', addStep);

    // Step modal
    $('#btnCloseStepModal').addEventListener('click', () => closeStepModal(false));
    $('#stepModalOverlay').addEventListener('click', () => closeStepModal(false));
    $('#btnCancelStep').addEventListener('click', () => closeStepModal(false));
    $('#btnSaveStep').addEventListener('click', () => closeStepModal(true));
    $('#btnDeleteStep').addEventListener('click', () => {
      if (state.currentStepIndex != null) {
        deleteStep(state.currentStepIndex);
        closeStepModal(false);
      }
    });
    $('#btnSignIn').addEventListener('click', triggerSignIn);
    $('#btnSignOut').addEventListener('click', signOut);
    $('#btnCloseSignIn').addEventListener('click', closeSignInModal);
    $('#signInOverlay').addEventListener('click', closeSignInModal);
    $('#btnModalSignIn').addEventListener('click', () => {
      if (!window.google?.accounts?.id) { toast('Google Sign-In ยังโหลดไม่เสร็จ ลองอีกครั้ง', 'error'); return; }
      google.accounts.id.prompt();
    });
    $('#btnSaveClientId').addEventListener('click', saveGoogleClientId);
    $('#btnAddAdmin').addEventListener('click', addAdminUser);
    $('#addAdminEmail').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addAdminUser(); }
    });
    $('#btnAddChecklist').addEventListener('click', addChecklistItem);
    $('#checklistInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addChecklistItem(); }
    });

    $('#stepFileInput').addEventListener('change', (e) => {
      if (state.currentStepIndex == null) return;
      const s = state.currentWorkflow.steps[state.currentStepIndex];
      s.attachments = s.attachments || [];
      const MAX = 2 * 1024 * 1024;
      let oversized = 0;
      const readers = Array.from(e.target.files).map((file) => new Promise((resolve) => {
        if (file.size > MAX) { oversized++; resolve(); return; }
        const reader = new FileReader();
        reader.onload = (evt) => {
          s.attachments.push({ id: stepUid(), name: file.name, type: file.type, size: file.size, data: evt.target.result });
          resolve();
        };
        reader.readAsDataURL(file);
      }));
      Promise.all(readers).then(() => {
        e.target.value = '';
        if (oversized) toast(`⚠️ ${oversized} ไฟล์ใหญ่เกิน 2 MB (ข้ามไป)`, 'error');
        renderAttachments();
      });
    });

    // Filters
    $('#searchInput').addEventListener('input', (e) => { state.filter.search = e.target.value; renderChannelContext(); renderWorkflowGrid(); renderTimeline(); });
    $('#filterChannel').addEventListener('change', (e) => setChannelFilter(e.target.value));
    $('#btnClearChannelFilter').addEventListener('click', () => setChannelFilter(''));

    // Pricing tools
    $$('.pricing-tab').forEach((tab) => tab.addEventListener('click', () => setPricingTab(tab.dataset.pricingTab)));
    $$('.view-pricing input, .view-pricing select').forEach((input) => {
      input.addEventListener('input', renderPricingCalculator);
      input.addEventListener('change', renderPricingCalculator);
    });
    $$('.tier-preset').forEach((btn) => btn.addEventListener('click', () => applyTierPreset(btn.dataset.tierPreset)));
    $('#costChannel').addEventListener('change', syncGpFromSelectedChannel);

    // Settings
    $('#appsScriptCode').textContent = APPS_SCRIPT_CODE;
    $('#btnCopyScript').addEventListener('click', () => {
      navigator.clipboard.writeText(APPS_SCRIPT_CODE).then(() => toast('✓ คัดลอกสคริปต์แล้ว · ไปวางใน Apps Script ได้เลย', 'success'));
    });
    $('#btnSaveSettings').addEventListener('click', testConnection);
    $('#btnSyncNow').addEventListener('click', syncNow);
    $('#btnPullFromSheet').addEventListener('click', pullFromSheet);
    $('#btnExportJson').addEventListener('click', exportJson);
    $('#btnImportJson').addEventListener('click', () => $('#fileImport').click());
    $('#fileImport').addEventListener('change', (e) => { if (e.target.files[0]) importJson(e.target.files[0]); });
    $('#btnClearData').addEventListener('click', clearData);

    // Populate settings inputs from state
    loadSettings();
    $('#sheetUrl').value = state.settings.sheetUrl || '';
    $('#sheetSecret').value = state.settings.secret || '';

    // Load data
    loadLocal();

    // Initial render
    updateAuthUI();
    initGoogleSignIn(state.settings.googleClientId);
    renderAll();
    renderCostChannelOptions();
    renderPricingCalculator();

    // Auto-load from sheet if configured
    if (state.settings.sheetUrl) {
      (async () => {
        const data = await loadFromSheet();
        if (data !== null) {
          state.workflows = data;
          persistLocal();
          renderAll();
          renderCostChannelOptions();
        }
      })();
    }

    // Step navigator
    $('#btnCloseStepNav').addEventListener('click', closeStepNavigator);
    $('#stepNavOverlay').addEventListener('click', closeStepNavigator);
    $('#btnNavEdit').addEventListener('click', () => { if (_navWfId) openWorkflowEditor(_navWfId); });

    // ESC to close
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('#stepModal').hidden) closeStepModal(false);
        else if (!$('#drawer').hidden) closeDrawer();
        else if (!$('#stepNav').hidden) closeStepNavigator();
      }
    });
  }

  // Expose public API
  return {
    init,
    openWorkflowEditor,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
