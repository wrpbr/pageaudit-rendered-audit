/* GERADO por scripts/monta-ui.mjs — fonte: ui/. Não edite. npm run ui */
const SITEKEY = '0x4AAAAAAELg3GNAnLSUGtpD';
const GUEST_KEY = 'pageaudit_guest';
const SESS_KEY = 'pageaudit_session';
let turnstileWidgetId = null;
const supportModal = new bootstrap.Modal('#support-modal');
const authModal = new bootstrap.Modal('#auth-modal');
const tabModal = new bootstrap.Modal('#tab-modal');
const verifyModal = new bootstrap.Modal('#verify-modal');
const apiModal = new bootstrap.Modal('#api-modal');
let verifyWidgetId = null;
let verifyPending = null;
let CHECKS = null;
let PREVIEW = null;
let SHARE = null;
let paywall = null;

/* Tabs live on the server. This object is only a render cache. */
const state = {
  tabs: [],
  results: {},
  shares: {},
  subtab: {},
  running: new Set(),
  loading: new Set(),
  limit: 30,
  signedIn: false,
  mode: 'create',
  editing: null,
  gate: null,
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------- auth */

async function ensureGuest() {
  let t = null;
  try { t = localStorage.getItem(GUEST_KEY); } catch (_) { /* ignore */ }
  if (t) return t;
  const res = await fetch('/api/guest', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'guest failed');
  try { localStorage.setItem(GUEST_KEY, data.token); } catch (_) { /* ignore */ }
  return data.token;
}
function sessionToken() {
  try { return localStorage.getItem(SESS_KEY); } catch (_) { return null; }
}
function guestToken() {
  try { return localStorage.getItem(GUEST_KEY); } catch (_) { return null; }
}
function authHeaders(extra) {
  const h = { 'Content-Type': 'application/json', ...(extra || {}) };
  const s = sessionToken();
  if (s) h.Authorization = 'Bearer ' + s;
  const g = guestToken();
  if (g) h['X-Guest-Token'] = g;
  if (window.X402Paywall) Object.assign(h, window.X402Paywall.withDevHeaders({}));
  return h;
}
async function apiRaw(path, opts) {
  const o = opts || {};
  return fetch(path, {
    method: o.method || 'GET',
    headers: authHeaders(o.headers || {}),
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
}
async function api(path, opts) {
  const res = await apiRaw(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}
paywall = window.X402Paywall && window.X402Paywall.bindPaywall({
  modalId: 'paywall-modal',
  api: apiRaw,
  onSuccess: async function (data) {
    if (data.tab) {
      upsertTab(data.tab);
      renderStrip();
      syncPanes();
      renderTabsMeta();
      focusTab(data.tab.id);
      runTab(data.tab.id);
    } else {
      await loadTabs();
    }
  },
});

async function refreshMe() {
  const s = sessionToken();
  const label = $('auth-label');
  const btn = $('auth-btn');
  const outBtn = $('auth-logout');
  const hint = $('account-hint');
  const signinBtn = $('start-signin');
  if (!s) {
    state.signedIn = false;
    label.hidden = true; btn.hidden = false; outBtn.hidden = true;
    $('auth-trial').hidden = true;
    $('paywall-trial').hidden = false;
    hint.textContent = 'Right now your tabs are tied to this browser. Sign in with your email and they follow your account on any device — confirming the email also gives you 90 days of full access, free.';
    signinBtn.hidden = false;
    renderHistory(null);
    return;
  }
  let data;
  try {
    data = await api('/api/me');
  } catch (_) {
    try { localStorage.removeItem(SESS_KEY); } catch (_e) { /* ignore */ }
    state.signedIn = false;
    label.hidden = true; btn.hidden = false; outBtn.hidden = true;
    signinBtn.hidden = false;
    renderHistory(null);
    return;
  }
  state.signedIn = true;
  label.textContent = data.user.email;
  label.hidden = false; btn.hidden = true; outBtn.hidden = false;
  hint.textContent = 'Signed in as ' + data.user.email + '. Your tabs and audits are stored with your account.';
  signinBtn.hidden = true;
  // Estado do trial vem do /api/me — a mesma fonte que o agente lê.
  const trialBadge = $('auth-trial');
  if (data.trial && data.trial.active) {
    $('auth-trial-text').textContent = 'Trial · ' + data.trial.days_left + (data.trial.days_left === 1 ? ' day left' : ' days left');
    trialBadge.hidden = false;
    hint.textContent += ' Trial: ' + data.trial.days_left + (data.trial.days_left === 1 ? ' day' : ' days') + ' of free full access left.';
  } else {
    trialBadge.hidden = true;
  }
  $('paywall-trial').hidden = true;
  renderHistory(data.audits || []);
}

function renderHistory(audits) {
  const body = $('history-rows');
  body.textContent = '';
  if (!audits) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'text-body-secondary small';
    td.textContent = 'Sign in to see every audit you have run.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  if (!audits.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'text-body-secondary small';
    td.textContent = 'No audits yet. Open a URL to run your first one.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const a of audits) {
    const tr = document.createElement('tr');

    const urlTd = document.createElement('td');
    urlTd.className = 'text-break small';
    urlTd.textContent = a.url;
    tr.appendChild(urlTd);

    const scoreTd = document.createElement('td');
    scoreTd.className = 'text-end';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (a.score >= 80 ? 'text-bg-success' : a.score >= 55 ? 'text-bg-warning' : 'text-bg-danger');
    badge.textContent = a.score == null ? '—' : String(a.score);
    scoreTd.appendChild(badge);
    tr.appendChild(scoreTd);

    const whenTd = document.createElement('td');
    whenTd.className = 'small text-body-secondary text-nowrap';
    whenTd.textContent = fmtTime(a.created_at);
    tr.appendChild(whenTd);

    const actTd = document.createElement('td');
    actTd.className = 'text-end';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn-sm btn-outline-secondary';
    open.innerHTML = '<i class="bi bi-window-plus" aria-hidden="true"></i>';
    open.title = 'Open in a tab';
    open.setAttribute('aria-label', 'Open ' + a.url + ' in a tab');
    open.addEventListener('click', () => openUrl(a.url));
    actTd.appendChild(open);
    tr.appendChild(actTd);

    body.appendChild(tr);
  }
}
/* ---------------------------------------------------------- auth modal */

function openAuth() {
  $('auth-msg').hidden = true;
  $('auth-email-step').hidden = false;
  $('auth-code-step').hidden = true;
  authModal.show();
  setTimeout(() => $('auth-email').focus(), 200);
}
// O paywall é o momento de conversão: quem bate no muro vê a saída grátis (trial de 90 dias
// por e-mail confirmado) ao lado do preço — não só o pedido de cartão/wallet.
$('paywall-signin-btn').addEventListener('click', () => {
  try { bootstrap.Modal.getOrCreateInstance('#paywall-modal').hide(); } catch (_) { /* ignore */ }
  openAuth();
});
$('auth-btn').addEventListener('click', openAuth);
$('auth-back').addEventListener('click', () => {
  $('auth-email-step').hidden = false;
  $('auth-code-step').hidden = true;
});
$('auth-send').addEventListener('click', async () => {
  const msg = $('auth-msg');
  msg.hidden = true;
  const email = $('auth-email').value.trim();
  try {
    const res = await fetch('/api/auth/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    $('auth-email-step').hidden = true;
    $('auth-code-step').hidden = false;
    $('auth-code').focus();
    msg.className = 'alert alert-success mt-3 mb-0 py-2';
    msg.textContent = data.message || 'Code sent.';
    msg.hidden = false;
  } catch (err) {
    msg.className = 'alert alert-danger mt-3 mb-0 py-2';
    msg.textContent = err.message || String(err);
    msg.hidden = false;
  }
});
$('auth-verify').addEventListener('click', async () => {
  const msg = $('auth-msg');
  msg.hidden = true;
  try {
    const guest = await ensureGuest().catch(() => null);
    const res = await fetch('/api/auth/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('auth-email').value.trim(),
        code: $('auth-code').value.trim(),
        guest_token: guest,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);
    try { localStorage.setItem(SESS_KEY, data.session_token); } catch (_) { /* ignore */ }
    authModal.hide();
    await refreshMe();
    await loadTabs();
  } catch (err) {
    msg.className = 'alert alert-danger mt-3 mb-0 py-2';
    msg.textContent = err.message || String(err);
    msg.hidden = false;
  }
});
$('auth-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() }).catch(() => { /* sessão local some mesmo se a API falhar */ });
  try { localStorage.removeItem(SESS_KEY); } catch (_) { /* ignore */ }
  state.results = {};
  await refreshMe();
  await loadTabs();
});
/* ---------------------------------------------------------------- tabs */

function tabById(id) {
  return state.tabs.find((t) => t.id === id) || null;
}
function paneId(id) { return 'pane-' + id; }
function triggerId(id) { return 'trigger-' + id; }

function upsertTab(tab) {
  if (!tab) return;
  const i = state.tabs.findIndex((t) => t.id === tab.id);
  if (i >= 0) state.tabs[i] = tab;
  else state.tabs.push(tab);
  state.tabs.sort((a, b) => a.position - b.position);
}

function statusIcon(tab) {
  if (state.running.has(tab.id)) return 'bi-arrow-repeat';
  if (tab.status === 'error') return 'bi-exclamation-triangle text-status-error';
  if (tab.status === 'ok') return 'bi-globe2';
  return 'bi-hourglass-split';
}

// Ícone da aba: o favicon do site auditado quando existe, senão o globo.
// O favicon vem do próprio run (summary.favicon), não de serviço de terceiro.
function tabIconEl(tab) {
  const fallback = () => {
    const i = document.createElement('i');
    i.className = 'bi ' + statusIcon(tab);
    i.setAttribute('aria-hidden', 'true');
    return i;
  };
  // Enquanto roda ou depois de falhar, o estado vale mais que a marca do site.
  if (state.running.has(tab.id) || tab.status !== 'ok' || !tab.favicon) return fallback();
  const img = document.createElement('img');
  img.className = 'pa-tab-favicon';
  img.src = tab.favicon;
  img.alt = '';
  img.width = 16;
  img.height = 16;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  // Muita página declara um favicon que já não existe (e o nosso palpite
  // /favicon.ico erra ainda mais); sem isto sobraria o ícone quebrado.
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function fmtTime(ts) {
  if (!ts) return '';
  const raw = String(ts);
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? raw : d.toLocaleString();
}

async function loadTabs() {
  let data;
  try {
    data = await api('/api/tabs');
  } catch (err) {
    $('tabs-meta').textContent = 'Could not load your tabs: ' + err.message;
    return;
  }
  state.tabs = data.tabs || [];
  state.limit = data.limit || 30;
  if (data.gate) state.gate = data.gate;
  if (data.active_id && data.active_result) {
    state.results[data.active_id] = data.active_result;
    rememberShare(data.active_id, data.active_result);
  }
  renderStrip();
  syncPanes();
  renderTabsMeta();
  if (data.active_id && tabById(data.active_id)) focusTab(data.active_id);
  else showStart();
}

function renderTabsMeta() {
  const n = state.tabs.length;
  $('tabs-meta').textContent = n
    ? n + ' of ' + state.limit + ' tabs open · restored from your account on every visit'
    : 'No tabs open yet — add a URL and it stays here until you close it.';
}

function renderStrip() {
  const strip = $('tab-strip');
  // Bootstrap tracks the shown tab through the .active class on the trigger.
  // Rebuilding the strip must carry it over, or the old pane never closes.
  const activeEl = strip.querySelector('li.pa-tab .nav-link.active');
  const activeId = activeEl ? activeEl.id.slice('trigger-'.length) : null;
  strip.querySelectorAll('li.pa-tab').forEach((li) => li.remove());
  const addItem = $('tab-add-item');
  for (const t of state.tabs) {
    const isActive = t.id === activeId;
    const li = document.createElement('li');
    li.className = 'nav-item pa-tab position-relative';
    li.dataset.id = t.id;
    li.setAttribute('role', 'presentation');

    const btn = document.createElement('button');
    btn.className = isActive ? 'nav-link active' : 'nav-link';
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.id = triggerId(t.id);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('data-bs-toggle', 'tab');
    btn.setAttribute('data-bs-target', '#' + paneId(t.id));
    btn.setAttribute('aria-controls', paneId(t.id));
    btn.title = t.url;

    const icon = tabIconEl(t);
    const label = document.createElement('span');
    label.className = 'pa-tab-label';
    label.textContent = t.alias;
    btn.append(icon, label);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-close pa-tab-x';
    close.title = 'Close tab';
    close.setAttribute('aria-label', 'Close tab ' + t.alias);
    close.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTab(t.id);
    });

    li.append(btn, close);
    strip.insertBefore(li, addItem);
  }
}

function syncPanes() {
  const wrap = $('tab-panes');
  const ids = new Set(state.tabs.map((t) => t.id));
  wrap.querySelectorAll('.pa-pane').forEach((p) => {
    if (!ids.has(p.dataset.id)) p.remove();
  });
  for (const t of state.tabs) {
    let pane = $(paneId(t.id));
    if (!pane) {
      pane = document.createElement('div');
      pane.className = 'tab-pane fade pa-pane';
      pane.id = paneId(t.id);
      pane.dataset.id = t.id;
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', triggerId(t.id));
      pane.setAttribute('tabindex', '0');
      wrap.appendChild(pane);
    }
    renderPane(t);
  }
}

function renderPane(tab) {
  if (!tab) return;
  const pane = $(paneId(tab.id));
  if (!pane) return;
  pane.textContent = '';

  const head = document.createElement('div');
  head.className = 'd-flex flex-wrap gap-2 align-items-start justify-content-between mb-3';

  const info = document.createElement('div');
  info.className = 'flex-grow-1';
  const name = document.createElement('div');
  name.className = 'fw-semibold d-flex align-items-center gap-2';
  const nicon = tabIconEl(tab);
  const nameText = document.createElement('span');
  nameText.textContent = tab.alias;
  name.append(nicon, nameText);
  const link = document.createElement('a');
  link.className = 'small text-body-secondary text-break';
  link.href = tab.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = tab.url;
  info.append(name, link);
  if (tab.last_run_at) {
    const meta = document.createElement('div');
    meta.className = 'small text-body-secondary';
    meta.textContent = 'Last run ' + fmtTime(tab.last_run_at) + ' · ' + tab.runs + (tab.runs === 1 ? ' run' : ' runs');
    info.appendChild(meta);
  }
  head.appendChild(info);

  const actions = document.createElement('div');
  actions.className = 'btn-group';
  actions.setAttribute('role', 'group');
  actions.setAttribute('aria-label', 'Tab actions');

  const rerun = document.createElement('button');
  rerun.type = 'button';
  rerun.className = 'btn btn-sm btn-outline-primary';
  rerun.innerHTML = '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Re-run';
  rerun.disabled = state.running.has(tab.id);
  rerun.addEventListener('click', () => runTab(tab.id));

  const rename = document.createElement('button');
  rename.type = 'button';
  rename.className = 'btn btn-sm btn-outline-secondary';
  rename.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i> Rename';
  rename.addEventListener('click', () => openTabModal('rename', tab));

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'btn btn-sm btn-outline-secondary';
  share.innerHTML = '<i class="bi bi-share" aria-hidden="true"></i> Share';
  share.disabled = !(state.results[tab.id] && state.results[tab.id].audit_id);
  share.addEventListener('click', () => toggleShare(tab.id));

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn btn-sm btn-outline-secondary';
  close.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i> Close';
  close.addEventListener('click', () => closeTab(tab.id));

  actions.append(rerun, rename, share, close);
  head.appendChild(actions);
  pane.appendChild(head);

  const shareInfo = state.shares[tab.id];
  if (shareInfo) {
    pane.appendChild(
      SHARE
        ? SHARE.shareBlock(shareInfo, { onRevoke: () => toggleShare(tab.id) })
        : fallbackShareBlock(shareInfo)
    );
  }

  if (state.running.has(tab.id)) {
    pane.appendChild(busyBlock('Auditing ' + tab.alias + '…'));
    return;
  }
  if (state.loading.has(tab.id)) {
    pane.appendChild(busyBlock('Loading saved result…'));
    return;
  }
  if (tab.status === 'error') {
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger mb-0';
    const strong = document.createElement('div');
    strong.className = 'fw-semibold';
    strong.textContent = 'Last run failed';
    const detail = document.createElement('div');
    detail.className = 'small';
    detail.textContent = tab.last_error || 'Unknown error';
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-sm btn-danger mt-2';
    retry.innerHTML = '<i class="bi bi-arrow-repeat" aria-hidden="true"></i> Try again';
    retry.addEventListener('click', () => runTab(tab.id));
    alert.append(strong, detail, retry);
    pane.appendChild(alert);
    return;
  }

  const result = state.results[tab.id];
  if (!result) {
    const empty = document.createElement('div');
    empty.className = 'text-body-secondary';
    const p = document.createElement('p');
    p.textContent = 'This tab has not been audited yet.';
    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'btn btn-primary';
    run.innerHTML = '<i class="bi bi-play-fill" aria-hidden="true"></i> Run audit';
    run.addEventListener('click', () => runTab(tab.id));
    empty.append(p, run);
    pane.appendChild(empty);
    return;
  }
  pane.appendChild(resultBlock(tab.id, result));
}
function showStart() {
  bootstrap.Tab.getOrCreateInstance($('tab-start')).show();
}
function focusTab(id) {
  const trigger = $(triggerId(id));
  if (trigger) bootstrap.Tab.getOrCreateInstance(trigger).show();
}

async function openUrl(url, alias) {
  const body = { url, alias: alias || undefined };
  try {
    const data = await api('/api/tabs', { method: 'POST', body: body });
    upsertTab(data.tab);
    renderStrip();
    syncPanes();
    renderTabsMeta();
    focusTab(data.tab.id);
    runTab(data.tab.id);
    return data;
  } catch (err) {
    if (err.status === 402 && paywall) {
      paywall.show(err.data || {}, { method: 'POST', path: '/api/tabs', body: body });
      return null;
    }
    throw err;
  }
}

function normalizeAuditUrl(raw) {
  try {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const value = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : 'https://' + trimmed;
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch (_) {
    return null;
  }
}

$('quick-audit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('quick-audit-url');
  const message = $('quick-audit-msg');
  const submit = $('quick-audit-submit');
  const url = normalizeAuditUrl(input.value);
  message.hidden = true;
  if (!url) {
    message.textContent = 'Enter a valid public HTTP(S) URL.';
    message.hidden = false;
    input.focus();
    return;
  }
  input.value = url;
  submit.disabled = true;
  try {
    await ensureGuest().catch(() => { /* POST /api/tabs pede token se existir */ });
    await openUrl(url, '');
  } catch (err) {
    message.textContent = err.message || String(err);
    message.hidden = false;
  } finally {
    submit.disabled = false;
  }
});

/* Abre o desafio e resolve com o token; a decisão é sempre do servidor. */
function requestVerification() {
  return new Promise((resolve) => {
    verifyPending = resolve;
    $('verify-msg').hidden = true;
    const slot = $('verify-slot');
    slot.innerHTML = '';
    verifyWidgetId = null;
    const mount = () => {
      if (!window.turnstile) return setTimeout(mount, 80);
      verifyWidgetId = turnstile.render(slot, {
        sitekey: SITEKEY,
        theme: currentTheme() === 'dark' ? 'dark' : 'light',
        callback: (token) => {
          verifyModal.hide();
          const done = verifyPending;
          verifyPending = null;
          if (done) done(token);
        },
        'error-callback': () => {
          const msg = $('verify-msg');
          msg.textContent = 'Check failed to load. Close and try again.';
          msg.hidden = false;
        },
      });
    };
    verifyModal.show();
    mount();
  });
}
$('verify-modal').addEventListener('hidden.bs.modal', () => {
  if (window.turnstile && verifyWidgetId != null) {
    try { turnstile.remove(verifyWidgetId); } catch (_) { /* ignore */ }
  }
  verifyWidgetId = null;
  $('verify-slot').innerHTML = '';
  const pending = verifyPending;
  verifyPending = null;
  if (pending) pending(null); // fechou sem resolver
});

async function runTab(id) {
  const tab = tabById(id);
  if (!tab || state.running.has(id)) return;
  state.running.add(id);
  renderStrip();
  renderPane(tab);
  try {
    let data;
    try {
      data = await api('/api/tabs/' + id + '/run', { method: 'POST' });
    } catch (err) {
      // 402 (franquia esgotada, com accepts[] para agente) ou 403: para a pessoa,
      // os dois querem dizer "resolva o Turnstile".
      if ((err.status === 403 || err.status === 402) && err.data && err.data.code) {
        if (err.data.gate) state.gate = err.data.gate;
        const token = await requestVerification();
        // Fechou o desafio: não é erro da aba — preserva o resultado anterior.
        if (!token) return;
        data = await api('/api/tabs/' + id + '/run', {
          method: 'POST',
          body: { cf_turnstile_response: token },
        });
      } else {
        throw err;
      }
    }
    if (data.gate) state.gate = data.gate;
    if (data.tab) upsertTab(data.tab);
    if (data.ok && data.result) state.results[id] = data.result;
    else delete state.results[id];
  } catch (err) {
    const t = tabById(id);
    if (t) {
      t.status = 'error';
      t.last_error = err.message;
    }
  } finally {
    state.running.delete(id);
    renderStrip();
    renderPane(tabById(id));
    renderTabsMeta();
    if (state.signedIn) refreshMe().catch(() => { /* histórico é best-effort */ });
  }
}

async function closeTab(id) {
  let data = null;
  try {
    data = await api('/api/tabs/' + id, { method: 'DELETE' });
  } catch (err) {
    if (err.status !== 404) {
      $('tabs-meta').textContent = 'Could not close the tab: ' + err.message;
      return;
    }
  }
  state.tabs = state.tabs.filter((t) => t.id !== id);
  delete state.results[id];
  state.running.delete(id);
  state.loading.delete(id);
  renderStrip();
  syncPanes();
  renderTabsMeta();
  const next = data && data.active_id;
  if (next && tabById(next)) focusTab(next);
  else showStart();
}

async function ensureResult(id) {
  const tab = tabById(id);
  if (!tab || state.results[id] || state.running.has(id) || state.loading.has(id)) return;
  if (!tab.last_audit_id) return;
  state.loading.add(id);
  renderPane(tab);
  try {
    const data = await api('/api/tabs/' + id);
    // A run started meanwhile owns the pane — never overwrite it with the
    // result this request was already fetching.
    if (state.running.has(id)) return;
    if (data.tab) upsertTab(data.tab);
    if (data.result) {
      state.results[id] = data.result;
      rememberShare(id, data.result);
    }
  } catch (_) {
    /* pane falls back to its empty state */
  } finally {
    state.loading.delete(id);
    renderPane(tabById(id));
  }
}

$('tab-strip').addEventListener('shown.bs.tab', (e) => {
  const el = e.target;
  if (!el || !el.id || el.id.indexOf('trigger-') !== 0) return;
  const id = el.id.slice('trigger-'.length);
  if (!tabById(id)) return;
  api('/api/tabs/' + id, { method: 'PATCH', body: { active: true } }).catch(() => { /* foco local já mudou */ });
  ensureResult(id);
});

/* ---------------------------------------------------- new / rename modal */

function openTabModal(mode, tab) {
  state.mode = mode;
  state.editing = tab || null;
  const isRename = mode === 'rename';
  $('tab-modal-title').innerHTML = isRename
    ? '<i class="bi bi-pencil" aria-hidden="true"></i> Rename tab'
    : '<i class="bi bi-plus-lg" aria-hidden="true"></i> New audit';
  $('tab-modal-sub').textContent = isRename
    ? 'Only the label changes. The saved URL and its results stay untouched.'
    : 'The page opens in its own tab and stays saved to your account.';
  $('tab-submit').innerHTML = isRename
    ? '<i class="bi bi-check2" aria-hidden="true"></i> Save name'
    : '<i class="bi bi-play-fill" aria-hidden="true"></i> Open &amp; audit';
  $('tab-url-field').hidden = isRename;
  $('tab-url').required = !isRename;
  $('tab-url').value = isRename ? (tab ? tab.url : '') : '';
  $('tab-alias').value = isRename && tab ? tab.alias : '';
  $('tab-modal-msg').hidden = true;
  tabModal.show();
  setTimeout(() => $(isRename ? 'tab-alias' : 'tab-url').focus(), 200);
}

$('tab-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('tab-modal-msg');
  const btn = $('tab-submit');
  msg.hidden = true;
  btn.disabled = true;
  try {
    if (state.mode === 'rename' && state.editing) {
      const data = await api('/api/tabs/' + state.editing.id, {
        method: 'PATCH',
        body: { alias: $('tab-alias').value },
      });
      upsertTab(data.tab);
      renderStrip();
      renderPane(data.tab);
    } else {
      await ensureGuest().catch(() => { /* POST /api/tabs pede token se existir */ });
      await openUrl($('tab-url').value, $('tab-alias').value.trim());
    }
    tabModal.hide();
  } catch (err) {
    msg.textContent = err.message || String(err);
    msg.hidden = false;
  } finally {
    btn.disabled = false;
  }
});
/* Compartilhar é opt-in e revogável: nada vira público sem clique. */
function rememberShare(tabId, resultOrSlug) {
  if (!SHARE) return;
  if (typeof resultOrSlug === 'string') {
    state.shares[tabId] = SHARE.shareState(resultOrSlug, location.origin);
    return;
  }
  const adopted = SHARE.adoptShare(resultOrSlug, location.origin);
  if (adopted) state.shares[tabId] = adopted;
}

async function toggleShare(tabId) {
  const result = state.results[tabId];
  if (!result || !result.audit_id) return;
  const existing = state.shares[tabId];
  try {
    if (existing && existing.slug) {
      await api('/api/audits/' + result.audit_id + '/share', { method: 'DELETE' });
      delete state.shares[tabId];
    } else {
      const data = await api('/api/audits/' + result.audit_id + '/share', { method: 'POST' });
      rememberShare(tabId, data.slug);
    }
  } catch (err) {
    state.shares[tabId] = { error: err.message };
  }
  renderPane(tabById(tabId));
}

function fallbackShareBlock(info) {
  const box = document.createElement('div');
  box.className = 'alert alert-secondary py-2 small';
  box.textContent = info.error || info.url || '';
  return box;
}

function busyBlock(text) {
  const wrap = document.createElement('div');
  wrap.className = 'd-flex align-items-center gap-2 text-body-secondary py-4';
  const spin = document.createElement('div');
  spin.className = 'spinner-border spinner-border-sm';
  spin.setAttribute('role', 'status');
  const label = document.createElement('span');
  label.textContent = text;
  wrap.append(spin, label);
  return wrap;
}

const STATUS_UI = {
  pass: { icon: 'bi-check-circle-fill', cls: 'ok', label: 'OK' },
  warn: { icon: 'bi-exclamation-triangle-fill', cls: 'warn', label: 'Should fix' },
  fail: { icon: 'bi-x-circle-fill', cls: 'fail', label: 'Fix this' },
  info: { icon: 'bi-info-circle-fill', cls: 'info', label: 'Optional' },
};

function checkRow(k) {
  const ui = STATUS_UI[k.status] || STATUS_UI.info;
  const box = document.createElement('div');
  box.className = 'check check-' + ui.cls;

  const head = document.createElement('div');
  head.className = 'check-head';
  const icon = document.createElement('i');
  icon.className = 'bi ' + ui.icon;
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'check-label';
  label.textContent = k.label;
  const status = document.createElement('span');
  status.className = 'check-status';
  status.textContent = ui.label;
  head.append(icon, label, status);
  box.appendChild(head);

  const val = document.createElement('div');
  val.className = k.value ? 'check-val' : 'check-val missing';
  val.textContent = k.value || 'not set';
  box.appendChild(val);

  for (const text of [k.detail, k.note]) {
    if (!text) continue;
    const d = document.createElement('div');
    d.className = 'check-detail';
    d.textContent = text;
    box.appendChild(d);
  }

  const why = document.createElement('p');
  why.className = 'check-why';
  why.innerHTML = '<strong>Why it matters.</strong> ';
  why.append(document.createTextNode(k.why));
  box.appendChild(why);

  if (k.status !== 'pass') {
    const fix = document.createElement('p');
    fix.className = 'check-fix';
    fix.innerHTML = '<strong>How to fix.</strong> ';
    fix.append(document.createTextNode(k.fix));
    box.appendChild(fix);
  }
  return box;
}

/**
 * As URLs de API deste recurso, dentro do próprio painel.
 *
 * O produto é para agente antes de ser para gente: quem estiver lendo a tela
 * (pessoa ou modelo) precisa conseguir sair daqui direto para o JSON sem
 * adivinhar caminho nem abrir documentação.
 */
function apiBlock(tabId, result) {
  const base = location.origin;
  const tab = tabById(tabId);
  const box = document.createElement('details');
  box.className = 'mt-3 border rounded p-2';

  const sm = document.createElement('summary');
  sm.className = 'small text-body-secondary';
  sm.innerHTML = '<i class="bi bi-braces-asterisk" aria-hidden="true"></i> API — este relatório em JSON';
  box.appendChild(sm);

  const inner = document.createElement('div');
  inner.className = 'mt-2';
  if (result.audit_id) {
    inner.appendChild(apiUrlRow('GET', base + '/api/audits/' + result.audit_id, 'este relatório', true));
  }
  if (tab) {
    inner.appendChild(apiUrlRow('GET', base + '/api/tabs/' + tab.id, 'aba + último resultado', true));
    inner.appendChild(apiUrlRow('POST', base + '/api/tabs/' + tab.id + '/run', 're-auditar', true));
  }
  const share = state.shares[tabId];
  if (share && share.slug) {
    // Compartilhado: aqui não há credencial, o slug é o segredo — então o
    // link abre de verdade, e é por ele que um agente lê sem token nenhum.
    inner.appendChild(apiUrlRow('GET', base + '/api/shared/' + share.slug, 'público, sem auth', false));
    inner.appendChild(apiUrlRow('GET', base + '/api/badge/' + share.slug, 'badge (JSON)', false));
    inner.appendChild(apiUrlRow('GET', base + '/badge/' + share.slug + '.svg', 'badge SVG', false));
  }

  const foot = document.createElement('div');
  foot.className = 'small text-body-secondary mt-2';
  const a = document.createElement('a');
  a.href = '/api/';
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = 'toda a API';
  foot.append(document.createTextNode('Índice com '), a, document.createTextNode(' — auto-descrita, sem chave para começar.'));
  inner.appendChild(foot);

  box.appendChild(inner);
  return box;
}

function resultBlock(tabId, result) {
  const wrap = document.createElement('div');

  const top = document.createElement('div');
  top.className = 'd-flex gap-3 align-items-center flex-wrap';
  const score = document.createElement('div');
  const s = result.score == null ? 0 : result.score;
  score.className = 'score ' + (s >= 80 ? 'good' : s >= 55 ? 'mid' : 'bad');
  score.textContent = result.score == null ? '—' : String(result.score);
  const side = document.createElement('div');
  const counts = document.createElement('div');
  counts.className = 'text-body-secondary';
  const c = result.counts || { errors: 0, warnings: 0, info: 0 };
  counts.textContent = c.errors + ' errors · ' + c.warnings + ' warnings · ' + c.info + ' info';
  const finalLine = document.createElement('div');
  finalLine.className = 'small text-body-secondary text-break';
  const sum = result.summary || {};
  finalLine.textContent = (sum.finalUrl || result.url || '') + (sum.status ? ' · HTTP ' + sum.status : '');
  side.append(counts, finalLine);
  top.append(score, side);
  wrap.appendChild(top);

  wrap.appendChild(apiBlock(tabId, result));

  if (!CHECKS) {   // catálogo ainda carregando: não deixa o painel vazio
    const p = document.createElement('p');
    p.className = 'text-body-secondary mt-3 mb-0';
    p.textContent = 'Loading report…';
    wrap.appendChild(p);
    return wrap;
  }

  const built = CHECKS.buildChecks(result.summary || {}, result.issues || []);
  const groups = built.categories.filter((cat) =>
    built.checks.some((k) => k.category === cat.id)
  );
  const current = state.subtab[tabId] || groups[0]?.id || 'raw';

  const nav = document.createElement('ul');
  nav.className = 'nav nav-pills gap-1 mt-3 mb-3';
  nav.setAttribute('role', 'tablist');

  const body = document.createElement('div');

  const renderGroup = (catId) => {
    body.textContent = '';
    if (catId === 'raw') {
      const pre = document.createElement('pre');
      pre.className = 'app-pre';
      pre.textContent = JSON.stringify(result.summary || {}, null, 2);
      body.appendChild(pre);
      return;
    }
    if (catId === 'social' && PREVIEW) {
      body.appendChild(PREVIEW.montarPainel(result.summary || {}));
    }
    for (const k of built.checks.filter((x) => x.category === catId)) {
      body.appendChild(checkRow(k));
    }
  };

  const makePill = (id, label, icon, counts) => {
    const li = document.createElement('li');
    li.className = 'nav-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nav-link' + (id === current ? ' active' : '');
    const i = document.createElement('i');
    i.className = 'bi ' + icon;
    i.setAttribute('aria-hidden', 'true');
    btn.append(i, document.createTextNode(' ' + label));
    if (counts) {
      const problems = (counts.fail || 0) + (counts.warn || 0);
      const badge = document.createElement('span');
      badge.className = 'badge ms-1 ' + (problems ? 'text-bg-danger' : 'text-bg-success');
      badge.textContent = problems ? String(problems) : '✓';
      btn.appendChild(badge);
    }
    btn.addEventListener('click', () => {
      state.subtab[tabId] = id;
      nav.querySelectorAll('.nav-link').forEach((n) => n.classList.remove('active'));
      btn.classList.add('active');
      renderGroup(id);
    });
    li.appendChild(btn);
    return li;
  };

  for (const cat of groups) nav.appendChild(makePill(cat.id, cat.label, cat.icon, cat.counts));
  nav.appendChild(makePill('raw', 'Raw', 'bi-braces', null));

  wrap.append(nav, body);
  renderGroup(current);
  return wrap;
}
/* ----------------------------------------------------------- API modal */

function copyBtn(text, label) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-sm btn-outline-secondary flex-shrink-0';
  const idle = '<i class="bi bi-clipboard" aria-hidden="true"></i>' + (label ? ' ' + label : '');
  b.innerHTML = idle;
  b.title = 'Copy';
  b.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      b.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i>' + (label ? ' Copied' : '');
      setTimeout(() => { b.innerHTML = idle; }, 1500);
    } catch (_) {
      /* clipboard bloqueado — a URL continua visível e selecionável ao lado */
    }
  });
  return b;
}

/**
 * Linha "MÉTODO <url completa>" de um recurso da API.
 *
 * Endpoint autenticado não vira link: clicar abriria sem o header e daria 404.
 * Nesses o botão copia um curl pronto, já com o token — que é o que um agente
 * usaria de qualquer forma. O token vai só para o clipboard, nunca para a URL
 * nem para o DOM: URL vaza em log, histórico e print.
 */
function apiUrlRow(method, url, note, needsAuth) {
  const row = document.createElement('div');
  row.className = 'd-flex align-items-center gap-2 flex-wrap mb-1';
  const verb = document.createElement('span');
  verb.className = 'badge text-bg-secondary flex-shrink-0';
  verb.textContent = method;
  row.appendChild(verb);

  if (needsAuth) {
    const code = document.createElement('code');
    code.className = 'small text-break flex-grow-1';
    code.textContent = url;
    row.appendChild(code);
  } else {
    const a = document.createElement('a');
    a.className = 'font-monospace small text-break flex-grow-1';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = url;
    row.appendChild(a);
  }

  if (note) {
    const n = document.createElement('span');
    n.className = 'small text-body-secondary';
    n.textContent = note;
    row.appendChild(n);
  }

  const tok = sessionToken() || guestToken();
  let curl = 'curl -s ' + (method === 'GET' ? '' : '-X ' + method + ' ') + "'" + url + "'";
  if (needsAuth && tok) {
    const header = tok.startsWith('sess_') ? 'Authorization: Bearer ' : 'X-Guest-Token: ';
    curl += " -H '" + header + tok + "'";
  }
  row.appendChild(copyBtn(curl, 'curl'));
  return row;
}

let apiDocCache = null;

async function openApiModal() {
  apiModal.show();
  const body = $('api-modal-body');
  if (!apiDocCache) {
    body.textContent = '';
    const loading = document.createElement('div');
    loading.className = 'text-body-secondary small';
    loading.textContent = 'Loading /api/ …';
    body.appendChild(loading);
    try {
      const res = await fetch('/api/', { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      apiDocCache = await res.json();
    } catch (err) {
      body.textContent = '';
      const e = document.createElement('div');
      e.className = 'alert alert-danger py-2 mb-0';
      e.textContent = 'Could not load /api/: ' + (err.message || err);
      body.appendChild(e);
      return;
    }
  }
  renderApiDoc(apiDocCache);
}

function renderApiDoc(doc) {
  const body = $('api-modal-body');
  body.textContent = '';

  const section = (title, icon) => {
    const h = document.createElement('h3');
    h.className = 'h6 mt-4 mb-2';
    h.innerHTML = '<i class="bi ' + icon + '" aria-hidden="true"></i> ' + title;
    body.appendChild(h);
  };

  const lead = document.createElement('p');
  lead.className = 'small mb-3';
  lead.textContent = doc.description || '';
  body.appendChild(lead);

  section('Descoberta', 'bi-compass');
  const disc = document.createElement('div');
  disc.className = 'mb-2';
  disc.append(
    apiUrlRow('GET', doc.base_url + '/api/', 'este índice'),
    apiUrlRow('GET', doc.docs.llms, 'llms.txt'),
    apiUrlRow('GET', doc.docs.openapi, 'OpenAPI 3.1')
  );
  body.appendChild(disc);
  const hubNote = document.createElement('p');
  hubNote.className = 'small text-body-secondary';
  hubNote.innerHTML = '<i class="bi bi-robot" aria-hidden="true"></i> Resource hub for agents: same links live in the page footer.';
  body.appendChild(hubNote);

  section('Comece por aqui', 'bi-terminal');
  for (const cmd of doc.quickstart || []) {
    const wrap = document.createElement('div');
    wrap.className = 'd-flex align-items-start gap-2 mb-1';
    const pre = document.createElement('pre');
    pre.className = 'app-pre flex-grow-1 mb-0';
    pre.textContent = cmd;
    wrap.append(pre, copyBtn(cmd));
    body.appendChild(wrap);
  }

  section('Endpoints', 'bi-diagram-3');
  const table = document.createElement('div');
  table.className = 'table-responsive';
  const t = document.createElement('table');
  t.className = 'table table-sm align-middle mb-0';
  t.innerHTML =
    '<thead><tr><th scope="col">Método</th><th scope="col">Caminho</th>' +
    '<th scope="col">Auth</th><th scope="col">O que faz</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const e of doc.endpoints || []) {
    const tr = document.createElement('tr');
    const td = (fill) => { const c = document.createElement('td'); fill(c); tr.appendChild(c); };
    td((c) => {
      const b = document.createElement('span');
      b.className = 'badge text-bg-secondary';
      b.textContent = e.method;
      c.appendChild(b);
    });
    td((c) => {
      const a = document.createElement('a');
      a.className = 'font-monospace small text-break';
      a.href = e.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = e.path;
      c.appendChild(a);
    });
    td((c) => {
      c.className = 'small text-body-secondary';
      c.textContent = e.auth;
      c.title = e.auth_detail || '';
    });
    td((c) => {
      c.className = 'small';
      c.textContent = e.summary;
      if (e.returns) {
        const r = document.createElement('div');
        r.className = 'font-monospace text-body-secondary';
        r.style.fontSize = '.75rem';
        r.textContent = e.returns;
        c.appendChild(r);
      }
    });
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  table.appendChild(t);
  body.appendChild(table);

  section('Autenticação', 'bi-key');
  const dl = document.createElement('dl');
  dl.className = 'row small mb-0';
  for (const [k, v] of Object.entries(doc.auth || {})) {
    const dt = document.createElement('dt');
    dt.className = 'col-sm-2 font-monospace';
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.className = 'col-sm-10';
    dd.textContent = v;
    dl.append(dt, dd);
  }
  body.appendChild(dl);

  section('O que fica guardado', 'bi-database');
  const ret = document.createElement('div');
  ret.className = 'small';
  const p1 = document.createElement('p');
  p1.className = 'mb-2';
  p1.textContent = doc.data_retention.stored;
  ret.appendChild(p1);
  const ul = document.createElement('ul');
  ul.className = 'mb-2';
  for (const s of doc.data_retention.not_stored || []) {
    const li = document.createElement('li');
    li.textContent = 'Não guardado: ' + s;
    ul.appendChild(li);
  }
  ret.appendChild(ul);
  const p2 = document.createElement('p');
  p2.className = 'mb-0 text-body-secondary';
  p2.textContent = doc.data_retention.truncation;
  ret.appendChild(p2);
  body.appendChild(ret);
}

$('api-btn').addEventListener('click', openApiModal);
const openApiHub = $('open-api-hub');
if (openApiHub) openApiHub.addEventListener('click', openApiModal);
const openApiHubFooter = $('open-api-hub-footer');
if (openApiHubFooter) openApiHubFooter.addEventListener('click', openApiModal);
$('tab-add').addEventListener('click', () => openTabModal('create'));
$('start-new').addEventListener('click', () => openTabModal('create'));
$('start-reload').addEventListener('click', () => loadTabs());
$('start-signin').addEventListener('click', () => openAuth());
/* -------------------------------------------------------------- theme */

function currentTheme() {
  return document.documentElement.getAttribute('data-bs-theme') || 'light';
}
function applyTheme(t) {
  document.documentElement.setAttribute('data-bs-theme', t);
  try { localStorage.setItem('theme', t); } catch (_) { /* ignore */ }
  $('theme-toggle').setAttribute(
    'aria-label', t === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  );
}
$('theme-toggle').addEventListener('click', () => {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('theme')) applyTheme(e.matches ? 'dark' : 'light');
  });
} catch (_) { /* ignore */ }

var skipVisit = false;
try {
  var q = new URLSearchParams(location.search);
  skipVisit = (navigator.webdriver === true) || q.has('smoke') || q.get('mm_smoke') === '1';
} catch (_) { /* ignore */ }
// Visita conta só depois de sinal humano (pointerdown/keydown/touchstart) —
// bots de datacenter que só carregam a página inflavam o painel (16/08).
if (!skipVisit) {
  var visitaEnviada = false;
  var enviaVisita = function () {
    if (visitaEnviada) return;
    visitaEnviada = true;
    try {
      navigator.sendBeacon('/api/visit', new Blob([JSON.stringify({ p: location.pathname })], { type: 'application/json' }));
    } catch (_) {
      fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: location.pathname }), keepalive: true }).catch(() => { /* ping best-effort */ });
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, enviaVisita, { once: true, capture: true, passive: true });
  });
}
/* ------------------------------------------------------------ support */

const formView = $('support-form-view');
const okView = $('support-ok-view');
const errView = $('support-err-view');
const contactMsg = $('contact-msg');

function showView(which) {
  formView.hidden = which !== 'form';
  okView.hidden = which !== 'ok';
  errView.hidden = which !== 'err';
}
function mountTurnstile() {
  const slot = $('turnstile-slot');
  slot.innerHTML = '';
  turnstileWidgetId = null;
  if (!window.turnstile) return;
  turnstileWidgetId = turnstile.render(slot, {
    sitekey: SITEKEY,
    theme: currentTheme() === 'dark' ? 'dark' : 'light',
    // Token expira (~5min): sem isto o widget morre "expirado" e nunca mais envia.
    'expired-callback': () => { if (turnstileWidgetId != null) turnstile.reset(turnstileWidgetId); },
  });
}
function openSupport() {
  showView('form');
  contactMsg.hidden = true;
  $('contact-form').reset();
  $('form-ts').value = String(Date.now());
  supportModal.show();
  const tryMount = () => {
    if (window.turnstile) mountTurnstile();
    else setTimeout(tryMount, 80);
  };
  tryMount();
  setTimeout(() => $('c-name').focus(), 200);
}
$('support-modal').addEventListener('hidden.bs.modal', () => {
  if (window.turnstile && turnstileWidgetId != null) {
    try { turnstile.remove(turnstileWidgetId); } catch (_) { /* ignore */ }
    turnstileWidgetId = null;
  }
  $('turnstile-slot').innerHTML = '';
});
$('open-support').addEventListener('click', openSupport);
$('support-retry').addEventListener('click', () => {
  showView('form');
  contactMsg.hidden = true;
  $('form-ts').value = String(Date.now());
  mountTurnstile();
});
$('contact-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('contact-btn');
  contactMsg.hidden = true;
  let token = '';
  if (window.turnstile && turnstileWidgetId != null) {
    try { token = turnstile.getResponse(turnstileWidgetId) || ''; } catch (_) { /* ignore */ }
  }
  // Contrato universal do contato (hub AGENTS.md § Contato): humano sem captcha não
  // chama a API — senão cai no caminho do agente e vê "X-PAYMENT header required".
  if (!token) {
    contactMsg.textContent = 'Complete the verification before sending.';
    contactMsg.hidden = false;
    return;
  }
  btn.disabled = true;
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: $('c-name').value,
        email: $('c-email').value,
        message: $('c-msg').value,
        website: document.querySelector('#contact-form [name="website"]').value,
        form_ts: Number($('form-ts').value),
        cf_turnstile_response: token,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) { showView('ok'); return; }
    if (res.status === 400) {
      // Validação antes do gate: o token segue vivo — NÃO remonta o widget (era o bug do
      // captcha "validando de novo" a cada campo errado). Mensagem inline, form intacto.
      contactMsg.textContent = data.error || 'Check the fields and try again.';
      contactMsg.hidden = false;
      return;
    }
    // 403/429/5xx: o verify queimou o token — widget novo, senão o reenvio falha pra sempre.
    mountTurnstile();
    throw new Error(data.error || res.statusText);
  } catch (err) {
    $('support-err-text').textContent = err.message || String(err);
    showView('err');
  } finally {
    btn.disabled = false;
  }
});
/* --------------------------------------------------------------- boot */

(async function boot() {
  // Mesmo catálogo que o Worker usa para renderizar /r/:slug.
  try { CHECKS = await import('/checks.js'); } catch (_) { CHECKS = null; }
  try { PREVIEW = await import('/preview-social.js'); } catch (_) { PREVIEW = null; }
  try { SHARE = await import('/share-panel.js'); } catch (_) { SHARE = null; }
  try { await ensureGuest(); } catch (_) { /* ignore */ }
  await refreshMe().catch(() => { /* boot segue sem /api/me */ });
  await loadTabs();
})();
