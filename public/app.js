(() => {
  'use strict';

  const STORAGE_KEY = 'apiTestStudio.v3';
  const THEME_KEY = 'apiTestStudio.theme';
  const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
  };
  const DEFAULT_TOKEN_PROFILES = [
    { key: 'admin', label: 'Tenant admin', varName: 'ADMIN_TOKEN', scope: 'TenantRole.TENANT_ADMIN', locked: true },
    { key: 'platform_admin', label: 'Platform admin', varName: 'PLATFORM_ADMIN_TOKEN', scope: 'UserRole.PLATFORM_ADMIN', locked: true },
    { key: 'creator', label: 'Creator', varName: 'CREATOR_TOKEN', scope: 'UserRole.CREATOR', locked: true },
    { key: 'student', label: 'Student', varName: 'STUDENT_TOKEN', scope: 'UserRole.STUDENT', locked: true },
  ];
  const DEFAULT_TEMPLATE = {
    base_url: 'http://localhost:3000/api/v1',
    tokens: Object.fromEntries(DEFAULT_TOKEN_PROFILES.map((profile) => [profile.varName, ''])),
    vars: {},
    steps: [
      {
        name: 'register admin and capture token',
        stage: 0,
        method: 'POST',
        path: '/auth/register',
        body: {
          email: 'api-admin-${RUN_ID}@example.com',
          password: 'Str0ngPass!${RUN_ID}',
          name: 'API Admin',
          role: 'CREATOR',
          tenantType: 'INDIVIDUAL_CREATOR',
        },
        expect_status: 201,
        capture: { ADMIN_TOKEN: '.data.access_token' },
      },
      {
        name: 'read current user and capture tenant',
        stage: 10,
        method: 'GET',
        path: '/auth/me',
        auth_var: 'ADMIN_TOKEN',
        expect_status: 200,
        capture: {
          TENANT_ID: '.data.memberships[0].tenant.id',
          ADMIN_USER_ID: '.data.id',
        },
      },
      {
        name: 'authenticated endpoint example',
        stage: 20,
        method: 'GET',
        path: '/admin/courses/queue?tab=ALL',
        auth_var: 'ADMIN_TOKEN',
        headers: { 'x-tenant-id': '${TENANT_ID}' },
        expect_status: 200,
      },
    ],
  };

  const el = (id) => document.getElementById(id);

  const state = {
    baseUrl: 'http://localhost:3000/api/v1',
    tenantId: '',
    sendTenantHeader: true,
    tokens: Object.fromEntries(DEFAULT_TOKEN_PROFILES.map((profile) => [profile.key, ''])),
    tokenProfiles: DEFAULT_TOKEN_PROFILES.map((profile) => ({ ...profile })),
    rows: [],
    laneOrder: [], // array of lane ids, in the order they execute — this replaces numeric "stage"
    endpointSearch: '',
  };

  // Static vars seeded from an imported suite's top-level "vars" object.
  let suiteStaticVars = {};

  // Live variable store for ${VAR} substitution and captures.
  let VARS = {};
  let tokensVisible = false;
  let runInProgress = false;

  let nextId = 1;
  const newRowId = () => `r${nextId++}`;
  let nextLaneNum = 1;
  const newLaneId = () => `lane-${nextLaneNum++}`;

  function emptyRow(over = {}) {
    return {
      id: newRowId(),
      laneId: null,
      method: 'GET',
      path: '',
      role: 'none',
      authVar: '',
      headers: {},
      body: '',
      expect: '',
      assert: [],
      capture: {},
      softFailIfContains: [],
      continueOnFail: false,
      note: '',
      result: null,
      expanded: false,
      ...over,
    };
  }

  function lastLaneId() {
    if (!state.laneOrder.length) state.laneOrder.push(newLaneId());
    return state.laneOrder[state.laneOrder.length - 1];
  }

  // Empty lanes are a valid, persistent state (e.g. "+ Add group" creates one
  // on purpose as a drop target) — they're only removed via the explicit ✕ on
  // the lane header, never auto-pruned on render. This just guards against
  // state.laneOrder ever being completely empty.
  function ensureAtLeastOneLane() {
    if (!state.laneOrder.length) state.laneOrder.push(newLaneId());
  }

  // ---- persistence ----------------------------------------------------

  function save() {
    const toSave = {
      baseUrl: state.baseUrl,
      tenantId: state.tenantId,
      sendTenantHeader: state.sendTenantHeader,
      tokens: state.tokens,
      tokenProfiles: state.tokenProfiles,
      suiteStaticVars,
      laneOrder: state.laneOrder,
      endpointSearch: state.endpointSearch,
      rows: state.rows.map(({ result, ...rest }) => rest),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  }

  function normalizeTokenProfiles(profiles) {
    const defaults = DEFAULT_TOKEN_PROFILES.map((profile) => ({ ...profile }));
    const seen = new Set(defaults.map((profile) => profile.key));
    const custom = Array.isArray(profiles) ? profiles : [];

    for (const profile of custom) {
      if (!profile || typeof profile !== 'object') continue;
      const key = String(profile.key || '').trim();
      const varName = normalizeVarName(profile.varName || key);
      if (!key || seen.has(key) || !varName) continue;
      seen.add(key);
      defaults.push({
        key,
        label: String(profile.label || key).trim() || key,
        varName,
        scope: String(profile.scope || 'Custom token').trim() || 'Custom token',
        locked: Boolean(profile.locked),
      });
    }

    return defaults;
  }

  function normalizeVarName(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    return normalized.endsWith('_TOKEN') ? normalized : normalized ? `${normalized}_TOKEN` : '';
  }

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function importedTokenProfileKey(varName) {
    const base = varName
      .toLowerCase()
      .replace(/_token$/, '')
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom';
    let key = base;
    let suffix = 2;
    const usedKeys = new Set(state.tokenProfiles.map((profile) => profile.key));
    while (usedKeys.has(key)) key = `${base}_${suffix++}`;
    return key;
  }

  function importedTokenLabel(varName) {
    return varName
      .replace(/_TOKEN$/, '')
      .split('_')
      .filter(Boolean)
      .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
      .join(' ') || 'Imported token';
  }

  function importTokenConfiguration(parsed) {
    if (!isRecord(parsed)) return 0;

    const rawProfiles = Array.isArray(parsed.tokenProfiles)
      ? parsed.tokenProfiles
      : Array.isArray(parsed.token_profiles) ? parsed.token_profiles : null;
    if (rawProfiles) {
      const profiles = rawProfiles.map((profile) => {
        if (!isRecord(profile)) return profile;
        return {
          ...profile,
          varName: profile.varName ?? profile.var_name,
        };
      });
      state.tokenProfiles = normalizeTokenProfiles(profiles);
    }

    if (!isRecord(parsed.tokens)) return 0;

    for (const rawName of Object.keys(parsed.tokens)) {
      const varName = normalizeVarName(rawName);
      const existing = state.tokenProfiles.find((profile) =>
        profile.key === rawName || profile.varName === rawName || profile.varName === varName);
      if (existing || !/^[A-Z][A-Z0-9_]*_TOKEN$/.test(varName)) continue;
      state.tokenProfiles.push({
        key: importedTokenProfileKey(varName),
        label: importedTokenLabel(varName),
        varName,
        scope: 'Imported token',
        locked: false,
      });
    }

    const previousTokens = state.tokens;
    state.tokens = Object.fromEntries(state.tokenProfiles.map((profile) => [
      profile.key,
      previousTokens[profile.key] || '',
    ]));

    let importedCount = 0;
    for (const [rawName, rawValue] of Object.entries(parsed.tokens)) {
      if (typeof rawValue !== 'string') continue;
      const varName = normalizeVarName(rawName);
      const profile = state.tokenProfiles.find((item) =>
        item.key === rawName || item.varName === rawName || item.varName === varName);
      if (!profile) continue;
      const token = rawValue.trim().replace(/^Bearer\s+/i, '');
      state.tokens[profile.key] = token;
      if (token) importedCount += 1;
    }
    return importedCount;
  }

  function tokenProfileForRole(role) {
    return state.tokenProfiles.find((profile) => profile.key === role);
  }

  function roleForAuthVar(authVar) {
    return state.tokenProfiles.find((profile) => profile.varName === authVar)?.key;
  }

  function syncTokenDiagnostics() {
    renderTokenList();
    renderTokenDiagnostics();
  }

  function renderTokenDiagnostics() {
    const box = el('tokenDiagnostics');
    if (!box) return;
    box.innerHTML = '';

    for (const profile of state.tokenProfiles) {
      const token = state.tokens[profile.key] || '';
      const item = document.createElement('div');
      item.className = 'token-diagnostic';
      const label = document.createElement('strong');
      label.textContent = profile.label;
      item.appendChild(label);

      const meta = decodeJwtPayload(token);
      const text = document.createElement('span');
      if (!token.trim()) {
        text.textContent = 'No pasted token. Captured suite tokens can still be used.';
      } else if (!meta) {
        item.classList.add('warn');
        text.textContent = 'Not a readable JWT.';
      } else {
        const issuer = meta.iss ? `issuer: ${meta.iss}` : 'issuer missing';
        const azp = meta.azp ? ` · azp: ${meta.azp}` : '';
        const exp = typeof meta.exp === 'number'
          ? ` · expires: ${new Date(meta.exp * 1000).toLocaleString()}`
          : '';
        text.textContent = `${issuer}${azp}${exp}`;
      }
      item.appendChild(text);
      box.appendChild(item);
    }
  }

  function renderTokenList() {
    const list = el('tokenList');
    if (!list) return;
    list.innerHTML = '';

    for (const profile of state.tokenProfiles) {
      const card = document.createElement('div');
      card.className = 'token-card';

      const meta = document.createElement('div');
      meta.className = 'token-card-meta';

      if (profile.locked) {
        const title = document.createElement('strong');
        title.textContent = profile.label;
        const scope = document.createElement('span');
        scope.textContent = profile.scope;
        const varName = document.createElement('code');
        varName.textContent = profile.varName;
        meta.appendChild(title);
        meta.appendChild(scope);
        meta.appendChild(varName);
      } else {
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = profile.label;
        labelInput.placeholder = 'Token label';
        labelInput.addEventListener('input', () => {
          profile.label = labelInput.value.trim() || 'Custom token';
          renderRows();
          saveDebounced();
        });

        const varInput = document.createElement('input');
        varInput.type = 'text';
        varInput.value = profile.varName;
        varInput.placeholder = 'TOKEN_VAR_NAME';
        varInput.addEventListener('change', () => {
          const nextVarName = normalizeVarName(varInput.value);
          if (!nextVarName) {
            varInput.value = profile.varName;
            return;
          }
          profile.varName = nextVarName;
          varInput.value = nextVarName;
          renderRows();
          seedVars(false);
          save();
        });

        meta.appendChild(labelInput);
        meta.appendChild(varInput);
      }

      const tokenInput = document.createElement('input');
      tokenInput.type = tokensVisible ? 'text' : 'password';
      tokenInput.placeholder = 'eyJhbGciOi...';
      tokenInput.autocomplete = 'off';
      tokenInput.value = state.tokens[profile.key] || '';
      tokenInput.addEventListener('input', () => {
        state.tokens[profile.key] = tokenInput.value;
        seedVars(false);
        renderTokenDiagnostics();
        saveDebounced();
      });

      card.appendChild(meta);
      card.appendChild(tokenInput);

      if (!profile.locked) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'lane-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove token slot';
        removeBtn.addEventListener('click', async () => {
          const confirmed = await showConfirm({
            title: 'Remove token slot',
            message: `Remove ${profile.label || profile.varName} from the token list? Rows using ${profile.varName} will keep the custom auth variable.`,
            okText: 'Remove',
          });
          if (!confirmed) return;
          state.tokenProfiles = state.tokenProfiles.filter((item) => item.key !== profile.key);
          delete state.tokens[profile.key];
          syncTokenDiagnostics();
          renderRows();
          save();
        });
        card.appendChild(removeBtn);
      }

      list.appendChild(card);
    }
  }

  function decodeJwtPayload(token) {
    const clean = token.trim().replace(/^Bearer\s+/i, '');
    const parts = clean.split('.');
    if (parts.length < 2) return null;
    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
      return JSON.parse(atob(padded));
    } catch (_) {
      return null;
    }
  }

  function load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      state.baseUrl = parsed.baseUrl ?? state.baseUrl;
      state.tenantId = parsed.tenantId ?? '';
      state.sendTenantHeader = parsed.sendTenantHeader ?? true;
      state.tokens = { ...state.tokens, ...(parsed.tokens || {}) };
      state.tokenProfiles = normalizeTokenProfiles(parsed.tokenProfiles);
      suiteStaticVars = parsed.suiteStaticVars || {};
      state.laneOrder = parsed.laneOrder || [];
      state.endpointSearch = parsed.endpointSearch || '';
      state.rows = (parsed.rows || []).map((r) => emptyRow(r));
      if (!state.laneOrder.length && state.rows.length) {
        const id = newLaneId();
        state.laneOrder = [id];
        state.rows.forEach((r) => { r.laneId = id; });
      }
    } catch (e) {
      console.warn('Failed to load saved state', e);
    }
  }

  const debounce = (fn, ms) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };
  const saveDebounced = debounce(save, 300);

  // ---- theme ------------------------------------------------------------

  function applyTheme(mode) {
    if (mode === 'auto') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', mode);
    }
    el('themeToggle').textContent = { light: 'Light', dark: 'Dark', auto: 'Auto' }[mode];
  }

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY) || 'auto';
    applyTheme(saved);
    el('themeToggle').addEventListener('click', () => {
      const order = ['auto', 'light', 'dark'];
      const current = localStorage.getItem(THEME_KEY) || 'auto';
      const nextMode = order[(order.indexOf(current) + 1) % order.length];
      localStorage.setItem(THEME_KEY, nextMode);
      applyTheme(nextMode);
    });
  }

  // ---- toast --------------------------------------------------------------

  let toastTimer;
  function toast(msg) {
    const t = el('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }

  async function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {
        // Fall through for browsers that expose Clipboard API but deny access.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    let copied = false;
    try {
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      copied = document.execCommand('copy');
    } finally {
      textarea.remove();
    }
    if (!copied) throw new Error('Clipboard access was denied');
  }

  function createCopyIconButton({ label, copiedMessage, getText, variant = '' }) {
    let resetTimer;
    const button = document.createElement('button');
    button.className = `icon-btn copy-icon-btn ${variant}`.trim();
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = ICONS.copy;
    button.addEventListener('click', async () => {
      try {
        await writeClipboard(getText());
        button.classList.add('is-copied');
        button.innerHTML = ICONS.check;
        button.title = copiedMessage;
        button.setAttribute('aria-label', copiedMessage);
        toast(copiedMessage);
        window.clearTimeout(resetTimer);
        resetTimer = window.setTimeout(() => {
          button.classList.remove('is-copied');
          button.innerHTML = ICONS.copy;
          button.title = label;
          button.setAttribute('aria-label', label);
        }, 1600);
      } catch (_) {
        toast('Copy failed');
      }
    });
    return button;
  }

  function showConfirm({ title = 'Confirm action', message, okText = 'Delete' }) {
    return new Promise((resolve) => {
      const modal = el('confirmModal');
      const titleEl = el('confirmTitle');
      const messageEl = el('confirmMessage');
      const cancelBtn = el('confirmCancel');
      const okBtn = el('confirmOk');

      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.textContent = okText;
      modal.hidden = false;

      const close = (value) => {
        modal.hidden = true;
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
        resolve(value);
      };

      const onCancel = () => close(false);
      const onOk = () => close(true);
      const onBackdrop = (event) => {
        if (event.target === modal) close(false);
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') close(false);
      };

      cancelBtn.addEventListener('click', onCancel);
      okBtn.addEventListener('click', onOk);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeydown);
      cancelBtn.focus();
    });
  }

  function bindGuide() {
    const trigger = el('guideBtn');
    const modal = el('guideModal');
    const closeBtn = el('guideClose');
    const doneBtn = el('guideDone');
    if (!trigger || !modal || !closeBtn || !doneBtn) return;

    const close = () => {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKeydown);
      trigger.focus();
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
    };

    trigger.addEventListener('click', () => {
      modal.hidden = false;
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', onKeydown);
      closeBtn.focus();
    });
    closeBtn.addEventListener('click', close);
    doneBtn.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });
  }

  // ---- variable substitution -------------------------------------------------

  function subst(str) {
    if (typeof str !== 'string') return str;
    let out = str;
    for (const key of Object.keys(VARS)) {
      out = out.split('${' + key + '}').join(VARS[key] ?? '');
    }
    return out;
  }

  function seedVars(fullReset) {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const base = fullReset ? {} : VARS;
    VARS = {
      ...base,
      RUN_ID: fullReset ? String(now) : (VARS.RUN_ID || String(now)),
      TODAY_ISO: iso(now),
      PLUS_1D_ISO: iso(now + 86400000),
      PLUS_2D_ISO: iso(now + 2 * 86400000),
      PLUS_7D_ISO: iso(now + 7 * 86400000),
      ...suiteStaticVars,
      TENANT_ID: state.tenantId || VARS.TENANT_ID || '',
    };
    for (const profile of state.tokenProfiles) {
      VARS[profile.varName] = fullReset
        ? (state.tokens[profile.key] || '')
        : (VARS[profile.varName] || state.tokens[profile.key] || '');
    }
    renderVarsPanel();
  }

  function renderVarsPanel() {
    const box = el('varsBox');
    if (!box) return;
    const entries = Object.entries(VARS).filter(([, v]) => v !== '' && v !== undefined);
    if (!entries.length) {
      box.textContent = '(none yet — run something)';
      return;
    }
    box.innerHTML = '';
    for (const [k, v] of entries) {
      const isToken = /TOKEN$/.test(k);
      const line = document.createElement('div');
      line.className = 'var-line';
      const shown = isToken && String(v).length > 12 ? `${String(v).slice(0, 8)}…<redacted>` : v;
      line.innerHTML = `<code>${escapeHtml(k)}</code> = <span>${escapeHtml(shown)}</span>`;
      box.appendChild(line);
    }
  }

  // ---- route / status helpers ------------------------------------------------

  function parseRoutesText(text) {
    return text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((line) => {
        const parts = line.split(/\s+/);
        const maybeVerb = parts[0].toUpperCase();
        if (VERBS.includes(maybeVerb) && parts.length > 1) {
          return { method: maybeVerb, path: parts.slice(1).join(' ') };
        }
        return { method: 'GET', path: line };
      });
  }

  function joinUrl(base, path) {
    if (/^https?:\/\//i.test(path)) return path;
    const b = base.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return b + p;
  }

  function statusMatches(status, expect) {
    const e = (expect || '').trim();
    if (!e) return status >= 200 && status < 300;
    if (e.includes(',')) {
      return e.split(',').map((x) => x.trim()).includes(String(status));
    }
    if (/^\d+$/.test(e)) return status === Number(e);
    if (/^\dxx$/i.test(e)) return Math.floor(status / 100) === Number(e[0]);
    return String(status) === e;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatImportedBody(body) {
    if (body === undefined || body === null || body === '') return '';
    if (typeof body !== 'string') return JSON.stringify(body, null, 2);

    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch (_) {
      return body;
    }
  }

  // ---- suite (engine.sh JSON) import -----------------------------------------

  function importParsedJson(parsed) {
    if (!isRecord(parsed)) throw new Error('The JSON root must be an object');
    const importedTokenCount = importTokenConfiguration(parsed);
    if (Array.isArray(parsed.steps)) {
      return { ...importEngineSuite(parsed), importedTokenCount, tokensOnly: false };
    }

    state.baseUrl = parsed.baseUrl ?? state.baseUrl;
    state.tenantId = parsed.tenantId ?? state.tenantId;
    state.sendTenantHeader = parsed.sendTenantHeader ?? state.sendTenantHeader;
    suiteStaticVars = parsed.suiteStaticVars || {};
    if (!Array.isArray(parsed.rows)) {
      return {
        rows: state.rows,
        laneOrder: state.laneOrder,
        importedTokenCount,
        tokensOnly: isRecord(parsed.tokens),
      };
    }

    const rows = parsed.rows.map((rawRow) => {
      const row = emptyRow(isRecord(rawRow) ? rawRow : {});
      row.body = formatImportedBody(row.body);
      return row;
    });
    let laneOrder = parsed.laneOrder;
    if (!laneOrder || !laneOrder.length) {
      const id = newLaneId();
      laneOrder = [id];
      rows.forEach((r) => { r.laneId = id; });
    } else {
      rows.forEach((r) => { if (!r.laneId) r.laneId = laneOrder[0]; });
    }
    return { rows, laneOrder, importedTokenCount, tokensOnly: false };
  }

  function importEngineSuite(parsed) {
    if (parsed.base_url) state.baseUrl = parsed.base_url;
    suiteStaticVars = { ...(parsed.vars || {}) };

    const rawSteps = [];
    for (const step of parsed.steps || []) {
      if (step.foreach && Array.isArray(step.foreach.values)) {
        for (const v of step.foreach.values) rawSteps.push(expandForeach(step, step.foreach.var, v));
      } else {
        rawSteps.push(step);
      }
    }

    const distinctStages = [...new Set(rawSteps.map((s) => s.stage ?? 0))].sort((a, b) => a - b);
    const laneIdForStage = new Map(distinctStages.map((s) => [s, newLaneId()]));
    const laneOrder = distinctStages.map((s) => laneIdForStage.get(s));
    const rows = rawSteps.map((step) => stepToRow(step, laneIdForStage.get(step.stage ?? 0)));
    return { rows, laneOrder };
  }

  function expandForeach(step, varName, value) {
    const clone = JSON.parse(JSON.stringify(step));
    delete clone.foreach;
    const token = '${' + varName + '}';
    const repl = (s) => (typeof s === 'string' ? s.split(token).join(String(value)) : s);
    clone.name = repl(clone.name);
    clone.path = repl(clone.path);
    if (clone.body !== undefined && clone.body !== null) {
      clone.body = JSON.parse(repl(JSON.stringify(clone.body)));
    }
    return clone;
  }

  function stepToRow(step, laneId) {
    const authVar = step.auth_var || '';
    const knownRole = roleForAuthVar(authVar);
    const role = knownRole || (authVar ? 'custom' : 'none');
    const expectRaw = step.expect_status;
    const expect = expectRaw === undefined || expectRaw === '2xx'
      ? ''
      : Array.isArray(expectRaw) ? expectRaw.join(',') : String(expectRaw);
    return emptyRow({
      laneId,
      method: (step.method || 'GET').toUpperCase(),
      path: step.path || '',
      role,
      authVar,
      headers: step.headers || {},
      body: formatImportedBody(step.body),
      expect,
      assert: step.assert || [],
      capture: step.capture || {},
      softFailIfContains: step.soft_fail_if_contains || [],
      continueOnFail: !!step.continue_on_fail,
      note: step.name || '',
    });
  }

  // ---- drag and drop -----------------------------------------------------------

  let draggingRowId = null;
  let draggingLaneId = null;

  function clearDragVisuals() {
    document.body.classList.remove('is-row-dragging', 'is-lane-dragging');
    document.querySelectorAll('.is-dragging, .row-drop-before, .drag-over').forEach((node) => {
      node.classList.remove('is-dragging', 'row-drop-before', 'drag-over');
    });
  }

  function moveRow(rowId, laneId, beforeRowId) {
    const fromIndex = state.rows.findIndex((r) => r.id === rowId);
    if (fromIndex < 0) return;
    const [row] = state.rows.splice(fromIndex, 1);
    row.laneId = laneId;

    const beforeIndex = beforeRowId
      ? state.rows.findIndex((r) => r.id === beforeRowId)
      : -1;
    if (beforeIndex >= 0) {
      state.rows.splice(beforeIndex, 0, row);
    } else {
      const lastInLane = [...state.rows].map((r, idx) => ({ r, idx }))
        .filter(({ r }) => r.laneId === laneId)
        .pop();
      state.rows.splice(lastInLane ? lastInLane.idx + 1 : state.rows.length, 0, row);
    }
  }

  function wireLaneDrop(laneEl, laneId) {
    laneEl.addEventListener('dragover', (e) => {
      if (draggingRowId || draggingLaneId) {
        e.preventDefault();
        laneEl.classList.add('drag-over');
      }
    });
    laneEl.addEventListener('dragleave', (e) => {
      if (e.target === laneEl) laneEl.classList.remove('drag-over');
    });
    laneEl.addEventListener('drop', (e) => {
      e.preventDefault();
      if (draggingLaneId) {
        if (draggingLaneId !== laneId) {
          const from = state.laneOrder.indexOf(draggingLaneId);
          const to = state.laneOrder.indexOf(laneId);
          state.laneOrder.splice(from, 1);
          state.laneOrder.splice(to, 0, draggingLaneId);
          renderRows();
          save();
        }
        draggingLaneId = null;
      } else if (draggingRowId) {
        moveRow(draggingRowId, laneId, null);
        draggingRowId = null;
        renderRows();
        save();
      }
      clearDragVisuals();
    });
  }

  function wireRowDrop(rowEl, row) {
    rowEl.addEventListener('dragover', (e) => {
      if (!draggingRowId || draggingRowId === row.id) return;
      e.preventDefault();
      e.stopPropagation();
      rowEl.classList.add('row-drop-before');
    });
    rowEl.addEventListener('dragleave', () => rowEl.classList.remove('row-drop-before'));
    rowEl.addEventListener('drop', (e) => {
      if (!draggingRowId || draggingRowId === row.id) return;
      e.preventDefault();
      e.stopPropagation();
      moveRow(draggingRowId, row.laneId, row.id);
      draggingRowId = null;
      clearDragVisuals();
      renderRows();
      save();
    });
  }

  // ---- rendering ------------------------------------------------------------

  function renderRows() {
    ensureAtLeastOneLane();
    const list = el('rowsList');
    list.innerHTML = '';
    const showLaneChrome = state.laneOrder.length > 1 || state.rows.some((r) => Object.keys(r.capture || {}).length || (r.assert || []).length);
    const isSearching = Boolean(state.endpointSearch.trim());
    let visibleCount = 0;

    state.laneOrder.forEach((laneId, idx) => {
      const laneRows = state.rows.filter((r) => r.laneId === laneId && rowMatchesSearch(r));
      if (isSearching && !laneRows.length) return;
      visibleCount += laneRows.length;
      const laneEl = document.createElement('div');
      laneEl.className = 'stage-lane';
      laneEl.dataset.laneId = laneId;

      const header = document.createElement('div');
      header.className = 'stage-lane-header';
      header.draggable = true;
      header.addEventListener('dragstart', () => {
        draggingLaneId = laneId;
        draggingRowId = null;
        header.classList.add('is-dragging');
        document.body.classList.add('is-lane-dragging');
      });
      header.addEventListener('dragend', () => {
        draggingLaneId = null;
        clearDragVisuals();
      });

      const handle = document.createElement('span');
      handle.className = 'lane-drag-handle';
      handle.textContent = '⠿';
      header.appendChild(handle);

      const title = document.createElement('span');
      title.className = 'lane-title';
      title.textContent = `Group ${idx + 1}`;
      header.appendChild(title);

      const hint = document.createElement('span');
      hint.className = 'lane-hint';
      hint.textContent = idx === 0
        ? 'runs first · rows run one at a time in order'
        : 'runs after the group above · rows run one at a time in order';
      header.appendChild(hint);

      const headerActions = document.createElement('div');
      headerActions.className = 'lane-actions';

      const addHereBtn = document.createElement('button');
      addHereBtn.className = 'btn ghost small';
      addHereBtn.textContent = '+ row';
      addHereBtn.title = 'Add an empty row to this group';
      addHereBtn.addEventListener('click', () => {
        state.rows.push(emptyRow({ laneId }));
        renderRows();
        save();
      });
      headerActions.appendChild(addHereBtn);

      const removeLaneBtn = document.createElement('button');
      removeLaneBtn.className = 'lane-remove';
      removeLaneBtn.textContent = '×';
      removeLaneBtn.title = laneRows.length ? 'Delete group and its rows' : 'Delete group';
      removeLaneBtn.addEventListener('click', async () => {
        if (state.laneOrder.length <= 1) {
          toast('Keep at least one group');
          return;
        }
        if (laneRows.length) {
          const confirmed = await showConfirm({
            title: `Delete Group ${idx + 1}`,
            message: `This will remove ${laneRows.length} row${laneRows.length > 1 ? 's' : ''} from this group.`,
            okText: 'Delete group',
          });
          if (!confirmed) return;
        }
        state.laneOrder = state.laneOrder.filter((id) => id !== laneId);
        state.rows = state.rows.filter((row) => row.laneId !== laneId);
        renderRows();
        save();
      });
      headerActions.appendChild(removeLaneBtn);
      header.appendChild(headerActions);

      laneEl.appendChild(header);

      const body = document.createElement('div');
      body.className = 'stage-lane-body';
      if (!laneRows.length) {
        const emptyHint = document.createElement('div');
        emptyHint.className = 'lane-empty-hint';
        emptyHint.textContent = 'Drag a row here';
        body.appendChild(emptyHint);
      } else {
        for (const row of laneRows) body.appendChild(buildRowEl(row));
      }
      laneEl.appendChild(body);

      wireLaneDrop(laneEl, laneId);
      list.appendChild(laneEl);
    });

    if (isSearching && visibleCount === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-empty';
      empty.innerHTML = '<strong>No endpoints found</strong><span>Try method, path, note, capture name, status, or body text.</span>';
      list.appendChild(empty);
    }

    if (!showLaneChrome) {
      list.classList.add('single-lane');
    } else {
      list.classList.remove('single-lane');
    }

    updateSearchCount(isSearching ? visibleCount : state.rows.length);
    updateSummary();
  }

  function buildAdvancedChips(row) {
    const bits = [];
    if (row.assert && row.assert.length) bits.push(`${row.assert.length} assert${row.assert.length > 1 ? 's' : ''}`);
    if (row.capture && Object.keys(row.capture).length) bits.push(`captures: ${Object.keys(row.capture).join(', ')}`);
    if (row.softFailIfContains && row.softFailIfContains.length) bits.push(`known-bug marker: ${row.softFailIfContains.join(', ')}`);
    if (row.continueOnFail) bits.push('continues on fail');
    return bits.map((bit) => {
      const chip = document.createElement('span');
      chip.className = 'request-chip';
      chip.textContent = bit;
      return chip;
    });
  }

  function rowSearchText(row) {
    return [
      row.method,
      row.path,
      row.role,
      tokenProfileForRole(row.role)?.label,
      tokenProfileForRole(row.role)?.scope,
      tokenProfileForRole(row.role)?.varName,
      row.authVar,
      row.expect,
      row.note,
      row.body,
      JSON.stringify(row.headers || {}),
      JSON.stringify(row.capture || {}),
      (row.assert || []).join(' '),
      (row.softFailIfContains || []).join(' '),
      row.result?.state,
      row.result?.status,
    ].filter((value) => value !== undefined && value !== null).join(' ').toLowerCase();
  }

  function rowMatchesSearch(row) {
    const query = state.endpointSearch.trim().toLowerCase();
    if (!query) return true;
    return query.split(/\s+/).every((part) => rowSearchText(row).includes(part));
  }

  function updateSearchCount(visibleCount) {
    const count = el('searchCount');
    if (!count) return;
    const total = state.rows.length;
    const query = state.endpointSearch.trim();
    count.textContent = query
      ? `${visibleCount} of ${total} endpoint${total === 1 ? '' : 's'}`
      : `${total} endpoint${total === 1 ? '' : 's'}`;
  }

  function buildRowEl(row) {
    const wrap = document.createElement('div');
    wrap.className = 'request-card';
    wrap.dataset.rowId = row.id;
    wireRowDrop(wrap, row);

    const dragCell = document.createElement('div');
    dragCell.className = 'drag-cell';
    const dragHandle = document.createElement('span');
    dragHandle.className = 'row-drag-handle';
    dragHandle.textContent = '⠿';
    dragHandle.title = 'Drag to move this row into a different group';
    dragHandle.draggable = true;
    dragHandle.addEventListener('dragstart', (e) => {
      draggingRowId = row.id;
      draggingLaneId = null;
      e.dataTransfer.effectAllowed = 'move';
      wrap.classList.add('is-dragging');
      document.body.classList.add('is-row-dragging');
      if (typeof e.dataTransfer.setDragImage === 'function') {
        e.dataTransfer.setDragImage(wrap, 28, 28);
      }
    });
    dragHandle.addEventListener('dragend', () => {
      draggingRowId = null;
      clearDragVisuals();
    });
    dragCell.appendChild(dragHandle);

    const main = document.createElement('div');
    main.className = 'request-main';

    const methodCell = document.createElement('div');
    methodCell.className = 'request-method';
    methodCell.dataset.label = 'Method';
    const methodSel = document.createElement('select');
    methodSel.className = 'method-select';
    for (const v of VERBS) {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (v === row.method) opt.selected = true;
      methodSel.appendChild(opt);
    }
    methodSel.addEventListener('change', () => { row.method = methodSel.value; saveDebounced(); });
    methodCell.appendChild(methodSel);

    const pathCell = document.createElement('div');
    pathCell.className = 'request-path';
    pathCell.dataset.label = 'Path';
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'path-input';
    pathInput.placeholder = '/admin/courses/queue';
    pathInput.value = row.path;
    pathInput.addEventListener('input', () => { row.path = pathInput.value; saveDebounced(); });
    const pathInputWrap = document.createElement('div');
    pathInputWrap.className = 'path-input-wrap';
    pathInputWrap.appendChild(pathInput);
    pathInputWrap.appendChild(createCopyIconButton({
      label: 'Copy endpoint as cURL',
      copiedMessage: 'cURL copied',
      getText: () => buildCurlCommand(row),
      variant: 'endpoint-copy-btn',
    }));
    pathCell.appendChild(pathInputWrap);

    const roleCell = document.createElement('div');
    roleCell.className = 'request-meta';
    roleCell.dataset.label = 'Role';
    const roleSel = document.createElement('select');
    const roleOptions = [
      ['none', 'None'],
      ...state.tokenProfiles.map((profile) => [profile.key, profile.label]),
      ['custom', 'Custom var'],
    ];
    for (const [val, label] of roleOptions) {
      const opt = document.createElement('option');
      opt.value = val; opt.textContent = label;
      if (val === row.role) opt.selected = true;
      roleSel.appendChild(opt);
    }
    const customVarInput = document.createElement('input');
    customVarInput.type = 'text';
    customVarInput.placeholder = 'VAR_NAME';
    customVarInput.value = row.authVar || '';
    customVarInput.className = 'custom-var-input';
    customVarInput.hidden = row.role !== 'custom';
    customVarInput.addEventListener('input', () => { row.authVar = customVarInput.value.trim(); saveDebounced(); });
    roleSel.addEventListener('change', () => {
      row.role = roleSel.value;
      if (row.role === 'custom') {
        customVarInput.hidden = false;
      } else {
        customVarInput.hidden = true;
        row.authVar = tokenProfileForRole(row.role)?.varName || '';
      }
      saveDebounced();
    });
    const roleWrap = document.createElement('label');
    roleWrap.className = 'compact-field';
    roleWrap.innerHTML = '<span>Role</span>';
    roleWrap.appendChild(roleSel);
    roleWrap.appendChild(customVarInput);
    roleCell.appendChild(roleWrap);

    const bodyTa = document.createElement('textarea');
    bodyTa.rows = 8;
    bodyTa.className = 'body-editor';
    bodyTa.placeholder = '{\n  "key": "value"\n}';
    bodyTa.value = row.body;
    bodyTa.addEventListener('input', () => { row.body = bodyTa.value; saveDebounced(); });

    const expectCell = document.createElement('div');
    expectCell.className = 'request-meta';
    expectCell.dataset.label = 'Expect';
    const expectInput = document.createElement('input');
    expectInput.type = 'text';
    expectInput.placeholder = '2xx';
    expectInput.value = row.expect;
    expectInput.addEventListener('input', () => { row.expect = expectInput.value; saveDebounced(); });
    const expectWrap = document.createElement('label');
    expectWrap.className = 'compact-field';
    expectWrap.innerHTML = '<span>Expect</span>';
    expectWrap.appendChild(expectInput);
    expectCell.appendChild(expectWrap);

    const resultCell = document.createElement('div');
    resultCell.className = 'result-cell';
    resultCell.dataset.label = 'Result';
    resultCell.appendChild(buildResultBadge(row));

    const actionsCell = document.createElement('div');
    actionsCell.className = 'actions-cell';
    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'btn ghost small row-action';
    const hasInspectableResult =
      row.result && row.result.state !== 'pending' && row.result.state !== 'skipped';
    detailsBtn.textContent = row.expanded ? 'Hide' : hasInspectableResult ? 'Details' : 'Body';
    detailsBtn.title = 'Show or hide request body and response';
    detailsBtn.addEventListener('click', () => {
      row.expanded = !row.expanded;
      renderRows();
      save();
    });
    const runOneBtn = document.createElement('button');
    runOneBtn.className = 'btn primary small row-action run-endpoint-btn';
    runOneBtn.textContent = 'Run';
    runOneBtn.title = 'Run this endpoint';
    runOneBtn.disabled = runInProgress;
    runOneBtn.addEventListener('click', () => runStaged([row], false));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove row';
    removeBtn.addEventListener('click', () => {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      renderRows();
      save();
    });
    actionsCell.appendChild(detailsBtn);
    actionsCell.appendChild(runOneBtn);
    actionsCell.appendChild(removeBtn);

    main.appendChild(methodCell);
    main.appendChild(pathCell);
    main.appendChild(roleCell);
    main.appendChild(expectCell);
    main.appendChild(resultCell);
    main.appendChild(actionsCell);

    wrap.appendChild(dragCell);
    wrap.appendChild(main);

    const subline = document.createElement('div');
    subline.className = 'request-subline';
    if (row.note) {
      const note = document.createElement('span');
      note.className = 'request-note';
      note.textContent = row.note;
      subline.appendChild(note);
    }
    for (const chip of buildAdvancedChips(row)) subline.appendChild(chip);
    if (subline.childNodes.length) wrap.appendChild(subline);

    if (row.expanded) {
      const extra = document.createElement('div');
      extra.className = 'request-extra';

      const bodyPanel = document.createElement('section');
      bodyPanel.className = 'request-panel request-body-panel';
      const bodyHead = document.createElement('div');
      bodyHead.className = 'panel-head';
      bodyHead.innerHTML = '<strong>Request body</strong><span>JSON with ${VARS} supported</span>';
      const bodyActions = document.createElement('div');
      bodyActions.className = 'panel-actions';

      const formatBtn = document.createElement('button');
      formatBtn.className = 'btn ghost small';
      formatBtn.type = 'button';
      formatBtn.textContent = 'Format';
      formatBtn.addEventListener('click', () => {
        const raw = bodyTa.value.trim();
        if (!raw) return;
        try {
          row.body = JSON.stringify(JSON.parse(raw), null, 2);
          renderRows();
          save();
        } catch (_) {
          toast('Body is not valid JSON yet');
        }
      });

      const clearBodyBtn = document.createElement('button');
      clearBodyBtn.className = 'btn ghost small';
      clearBodyBtn.type = 'button';
      clearBodyBtn.textContent = 'Clear';
      clearBodyBtn.addEventListener('click', () => {
        row.body = '';
        renderRows();
        save();
      });

      bodyActions.appendChild(formatBtn);
      bodyActions.appendChild(clearBodyBtn);
      bodyHead.appendChild(bodyActions);
      bodyPanel.appendChild(bodyHead);
      bodyPanel.appendChild(bodyTa);
      extra.appendChild(bodyPanel);

      if (row.result && row.result.state !== 'pending' && row.result.state !== 'skipped') {
        extra.appendChild(buildResponsePanel(row));
      }

      wrap.appendChild(extra);
    }

    return wrap;
  }

  function buildResponsePanel(row) {
    const r = row.result;
    const panel = document.createElement('section');
    panel.className = 'request-panel response-panel';

    const head = document.createElement('div');
    head.className = 'panel-head';
    const title = document.createElement('strong');
    title.textContent = 'Response';
    const meta = document.createElement('span');
    meta.textContent = `${r.status} · ${r.ms}ms`;
    head.appendChild(title);
    head.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    actions.appendChild(createCopyIconButton({
      label: 'Copy response',
      copiedMessage: 'Response copied',
      getText: () => formatBody(r.respBody),
      variant: 'response-copy-btn',
    }));
    head.appendChild(actions);
    panel.appendChild(head);

    const requestLine = document.createElement('div');
    requestLine.className = 'response-url';
    requestLine.textContent = `${row.method} ${r.reqUrl}`;
    panel.appendChild(requestLine);

    if (r.reqBody) {
      const sent = document.createElement('details');
      sent.className = 'request-sent';
      sent.innerHTML = `<summary>Sent body</summary><pre>${escapeHtml(formatBody(r.reqBody))}</pre>`;
      panel.appendChild(sent);
    }

    const pre = document.createElement('pre');
    pre.className = 'response-body';
    pre.textContent = formatBody(r.respBody);
    panel.appendChild(pre);
    return panel;
  }

  function formatBody(raw) {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch (_) { return String(raw ?? ''); }
  }

  function buildResultBadge(row) {
    const container = document.createElement('div');
    container.className = 'result-stack';
    const r = row.result;
    const badge = document.createElement('span');
    if (!r) {
      badge.className = 'badge idle';
      badge.textContent = '—';
    } else if (r.state === 'pending') {
      badge.className = 'badge pending';
      badge.textContent = '…';
    } else if (r.state === 'skipped') {
      badge.className = 'badge idle';
      badge.textContent = 'skipped';
    } else if (r.state === 'pass') {
      badge.className = 'badge pass';
      badge.textContent = `✓ ${r.status} · ${r.ms}ms`;
    } else if (r.state === 'bug') {
      badge.className = 'badge bug';
      badge.textContent = `⚠ ${r.status} known`;
    } else if (r.state === 'error') {
      badge.className = 'badge error';
      badge.textContent = 'ERR';
    } else {
      badge.className = 'badge fail';
      badge.textContent = `✕ ${r.status}`;
    }
    container.appendChild(badge);

    return container;
  }

  function updateRowResult(row) {
    if (row.expanded) {
      renderRows();
      return;
    }

    const rowEl = document.querySelector(`[data-row-id="${row.id}"]`);
    if (!rowEl) return;
    const resultCell = rowEl.querySelector('.result-cell');
    resultCell.innerHTML = '';
    resultCell.appendChild(buildResultBadge(row));
  }

  function updateSummary() {
    const total = state.rows.length;
    const withResult = state.rows.filter((r) => r.result && r.result.state !== 'pending' && r.result.state !== 'skipped');
    const pass = withResult.filter((r) => r.result.state === 'pass').length;
    const bug = withResult.filter((r) => r.result.state === 'bug').length;
    const fail = withResult.filter((r) => r.result.state === 'fail' || r.result.state === 'error').length;
    el('sumTotal').textContent = total;
    el('sumPass').textContent = pass;
    el('sumBug').textContent = bug;
    el('sumFail').textContent = fail;
  }

  // ---- running (groups and rows execute sequentially, with capture between rows) --

  function buildRequestSnapshot(row) {
    const url = joinUrl(state.baseUrl, subst(row.path.trim()));
    const headers = {};
    if (row.authVar && VARS[row.authVar]) headers.Authorization = `Bearer ${VARS[row.authVar]}`;
    for (const [header, value] of Object.entries(row.headers || {})) {
      headers[header] = subst(String(value));
    }
    if (!('x-tenant-id' in headers) && row.authVar && state.sendTenantHeader && VARS.TENANT_ID) {
      headers['x-tenant-id'] = VARS.TENANT_ID;
    }
    const body = subst(row.body.trim());
    if (body) headers['Content-Type'] = 'application/json';
    return { url, headers, body };
  }

  function shellQuote(value) {
    return `'${String(value).split("'").join("'\"'\"'")}'`;
  }

  function buildCurlCommand(row) {
    const request = buildRequestSnapshot(row);
    const lines = [
      `curl --request ${shellQuote(row.method)}`,
      `  --url ${shellQuote(request.url)}`,
    ];
    for (const [header, value] of Object.entries(request.headers)) {
      lines.push(`  --header ${shellQuote(`${header}: ${value}`)}`);
    }
    if (request.body) lines.push(`  --data-raw ${shellQuote(request.body)}`);
    return lines
      .map((line, index) => (index < lines.length - 1 ? `${line} \\` : line))
      .join('\n');
  }

  async function fireRequest(row) {
    const request = buildRequestSnapshot(row);

    try {
      const resp = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          method: row.method,
          url: request.url,
          headers: request.headers,
          body: request.body || null,
        }),
      });
      const out = await resp.json();
      return {
        status: out.status,
        ms: out.ms,
        reqUrl: request.url,
        reqHeaders: request.headers,
        reqBody: request.body,
        body: out.body,
      };
    } catch (e) {
      return {
        status: 0,
        ms: 0,
        reqUrl: request.url,
        reqHeaders: request.headers,
        reqBody: request.body,
        body: JSON.stringify({ error: String(e) }),
      };
    }
  }

  async function callJq(mode, filter, input) {
    try {
      const resp = await fetch('/api/jq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, filter, input }),
      });
      return await resp.json();
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  async function evaluateAndCapture(row, fetched) {
    const status = fetched.status;
    const expectOk = statusMatches(status, row.expect);

    let assertOk = true;
    for (const exprRaw of row.assert || []) {
      const expr = subst(exprRaw);
      const r = await callJq('assert', expr, fetched.body);
      if (!r.ok || !r.pass) assertOk = false;
    }

    const passed = status > 0 && expectOk && assertOk;

    if (passed) {
      for (const [k, filterRaw] of Object.entries(row.capture || {})) {
        const r = await callJq('capture', filterRaw, fetched.body);
        if (r.ok && r.value) VARS[k] = r.value;
      }
      row.result = { state: 'pass', status, ms: fetched.ms, reqUrl: fetched.reqUrl, reqHeaders: fetched.reqHeaders, reqBody: fetched.reqBody, respBody: fetched.body };
      renderVarsPanel();
      return 'pass';
    }

    const softList = row.softFailIfContains || [];
    const softHit = softList.length > 0 && softList.every((needle) => fetched.body.includes(needle));
    if (softHit) {
      row.result = { state: 'bug', status, ms: fetched.ms, reqUrl: fetched.reqUrl, reqHeaders: fetched.reqHeaders, reqBody: fetched.reqBody, respBody: fetched.body };
      return 'bug';
    }

    row.result = { state: status === 0 ? 'error' : 'fail', status, ms: fetched.ms, reqUrl: fetched.reqUrl, reqHeaders: fetched.reqHeaders, reqBody: fetched.reqBody, respBody: fetched.body };
    return row.continueOnFail ? 'fail-continue' : 'hardfail';
  }

  function groupByLane(rows) {
    const byLane = new Map();
    for (const r of rows) {
      if (!byLane.has(r.laneId)) byLane.set(r.laneId, []);
      byLane.get(r.laneId).push(r);
    }
    return state.laneOrder.filter((id) => byLane.has(id)).map((id) => byLane.get(id));
  }

  function syncRunControls() {
    const runAllButton = el('runAllBtn');
    if (runAllButton) {
      runAllButton.disabled = runInProgress;
      runAllButton.textContent = runInProgress ? 'Running…' : 'Run all';
    }
    document.querySelectorAll('.run-endpoint-btn').forEach((button) => {
      button.disabled = runInProgress;
    });
    el('rowsList')?.setAttribute('aria-busy', String(runInProgress));
  }

  async function runStaged(rows, resetVars) {
    if (runInProgress) {
      toast('Wait for the current run to finish');
      return;
    }

    runInProgress = true;
    syncRunControls();
    try {
      seedVars(resetVars);
      const lanes = groupByLane(rows);
      let stopped = false;

      for (const laneRows of lanes) {
        if (stopped) {
          for (const row of laneRows) { row.result = { state: 'skipped' }; updateRowResult(row); }
          continue;
        }

        for (const row of laneRows) {
          if (stopped) {
            row.result = { state: 'skipped' };
            updateRowResult(row);
            continue;
          }

          row.result = { state: 'pending' };
          updateRowResult(row);
          updateSummary();

          const fetched = await fireRequest(row);
          const outcome = await evaluateAndCapture(row, fetched);
          updateRowResult(row);
          updateSummary();
          if (outcome === 'hardfail') stopped = true;
        }
      }
    } finally {
      runInProgress = false;
      syncRunControls();
    }
  }

  // ---- report ----------------------------------------------------------------

  function buildReportMarkdown() {
    const lines = [];
    const name = el('suiteName').value || 'api-test-studio';
    lines.push(`# API Test Studio run — ${name}`);
    lines.push('');
    lines.push(`- Base URL: \`${state.baseUrl}\``);
    lines.push(`- Generated: ${new Date().toISOString()}`);
    lines.push('');
    const withResult = state.rows.filter((r) => r.result && r.result.state !== 'pending' && r.result.state !== 'skipped');
    const pass = withResult.filter((r) => r.result.state === 'pass').length;
    const bug = withResult.filter((r) => r.result.state === 'bug').length;
    const fail = withResult.length - pass - bug;
    lines.push('## Summary');
    lines.push('');
    lines.push('| Result | Count |');
    lines.push('|---|---|');
    lines.push(`| PASS | ${pass} |`);
    lines.push(`| BUG (flagged, non-blocking) | ${bug} |`);
    lines.push(`| FAIL/ERROR | ${fail} |`);
    lines.push(`| Not run / skipped | ${state.rows.length - withResult.length} |`);
    lines.push('');
    lines.push('## Requests');
    lines.push('');
    state.laneOrder.forEach((laneId, idx) => {
      const laneRows = state.rows.filter((r) => r.laneId === laneId);
      if (!laneRows.length) return;
      lines.push(`### Group ${idx + 1}`);
      lines.push('');
      for (const row of laneRows) {
        const r = row.result;
        const tag = !r ? 'NOT RUN' : r.state.toUpperCase();
        lines.push(`#### [${tag}] ${row.method} ${row.path}`);
        lines.push('');
        if (row.note) lines.push(`_${row.note}_\n`);
        if (r && r.reqUrl) {
          lines.push(`\`${row.method} ${r.reqUrl}\` — status: ${r.status}, ${r.ms}ms`);
          lines.push('');
          if (r.reqBody) {
            lines.push('**Request body**');
            lines.push('```json');
            lines.push(r.reqBody);
            lines.push('```');
            lines.push('');
          }
          lines.push('**Response**');
          lines.push('```json');
          let pretty = r.respBody;
          try { pretty = JSON.stringify(JSON.parse(r.respBody), null, 2); } catch (_) { /* raw */ }
          lines.push(pretty);
          lines.push('```');
        }
        lines.push('');
      }
    });
    return lines.join('\n');
  }

  async function saveReport() {
    const markdown = buildReportMarkdown();
    const rawName = el('suiteName').value || 'api-test-studio';
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || 'api-test-studio';
    try {
      const runId = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${name}-${runId}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast('Report downloaded');
    } catch (e) {
      toast(`Failed to download report: ${e}`);
    }
  }

  // ---- wiring -----------------------------------------------------------------

  function bindConnectionInputs() {
    syncConnectionInputs();

    el('baseUrl').addEventListener('input', (e) => { state.baseUrl = e.target.value; saveDebounced(); });
    el('tenantId').addEventListener('input', (e) => { state.tenantId = e.target.value; saveDebounced(); });
    el('sendTenantHeader').addEventListener('change', (e) => { state.sendTenantHeader = e.target.checked; saveDebounced(); });

    el('addTokenBtn').addEventListener('click', () => {
      const index = state.tokenProfiles.filter((profile) => !profile.locked).length + 1;
      const key = `custom_${Date.now()}`;
      state.tokenProfiles.push({
        key,
        label: `Custom token ${index}`,
        varName: `CUSTOM_${index}_TOKEN`,
        scope: 'Custom token',
        locked: false,
      });
      state.tokens[key] = '';
      syncTokenDiagnostics();
      renderRows();
      save();
    });

    el('importTokensBtn').addEventListener('click', () => el('importFile').click());

    el('showTokens').addEventListener('click', () => {
      tokensVisible = !tokensVisible;
      el('showTokens').textContent = tokensVisible ? 'Hide tokens' : 'Show tokens';
      renderTokenList();
    });

    el('clearTokens').addEventListener('click', () => {
      state.tokens = Object.fromEntries(state.tokenProfiles.map((profile) => [profile.key, '']));
      syncConnectionInputs();
      seedVars(true);
      save();
      toast('Pasted tokens cleared. Suite-captured tokens will be used during runs.');
    });
  }

  function syncConnectionInputs() {
    el('baseUrl').value = state.baseUrl;
    el('tenantId').value = state.tenantId;
    el('sendTenantHeader').checked = state.sendTenantHeader;
    syncTokenDiagnostics();
  }

  async function importFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const isSuite = Array.isArray(parsed.steps);
      const { rows, laneOrder, importedTokenCount, tokensOnly } = importParsedJson(parsed);
      state.rows = rows;
      state.laneOrder = laneOrder;
      syncConnectionInputs();
      seedVars(true);
      renderRows();
      save();
      const tokenSummary = importedTokenCount
        ? ` · ${importedTokenCount} token${importedTokenCount === 1 ? '' : 's'}`
        : '';
      if (tokensOnly) {
        toast(importedTokenCount
          ? `Imported ${importedTokenCount} token${importedTokenCount === 1 ? '' : 's'}`
          : 'Token JSON imported');
      } else {
        toast(isSuite
          ? `Imported suite (${rows.length} steps${tokenSummary})`
          : `Imported ${rows.length} rows${tokenSummary}`);
      }
    } catch (err) {
      toast(`Import failed: ${err}`);
    }
  }

  function downloadJson(name, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function bindEndpointControls() {
    const searchInput = el('endpointSearch');
    const clearSearchBtn = el('clearSearchBtn');
    if (searchInput) {
      searchInput.value = state.endpointSearch;
      searchInput.addEventListener('input', (event) => {
        state.endpointSearch = event.target.value;
        renderRows();
        saveDebounced();
      });
    }
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        state.endpointSearch = '';
        if (searchInput) searchInput.value = '';
        renderRows();
        save();
        searchInput?.focus();
      });
    }

    el('parseBtn').addEventListener('click', () => {
      const parsed = parseRoutesText(el('pasteBox').value);
      if (!parsed.length) return;
      const laneId = lastLaneId();
      for (const p of parsed) state.rows.push(emptyRow({ ...p, laneId }));
      el('pasteBox').value = '';
      renderRows();
      save();
    });

    const addEmpty = () => { state.rows.push(emptyRow({ laneId: lastLaneId() })); renderRows(); save(); };
    el('addRowBtn').addEventListener('click', addEmpty);
    el('addRowBtn2').addEventListener('click', addEmpty);

    el('addStageBtn').addEventListener('click', () => {
      state.laneOrder.push(newLaneId());
      renderRows();
      save();
    });

    el('exampleBtn').addEventListener('click', () => {
      const laneId = lastLaneId();
      const examples = [
        { method: 'GET', path: '/auth/me', role: 'admin', authVar: 'ADMIN_TOKEN' },
        { method: 'GET', path: '/admin/courses/queue?tab=PENDING', role: 'admin', authVar: 'ADMIN_TOKEN' },
        { method: 'GET', path: '/admin/courses/queue', role: 'student', authVar: 'STUDENT_TOKEN', expect: '403' },
      ];
      for (const ex of examples) state.rows.push(emptyRow({ ...ex, laneId }));
      renderRows();
      save();
    });

    el('clearAllBtn').addEventListener('click', async () => {
      const confirmed = await showConfirm({
        title: 'Clear all rows',
        message: 'This will remove every request row and reset the workspace to one empty group.',
        okText: 'Clear rows',
      });
      if (!confirmed) return;
      state.rows = [];
      state.laneOrder = [newLaneId()];
      renderRows();
      save();
    });

    el('exportBtn').addEventListener('click', () => {
      const data = {
        baseUrl: state.baseUrl,
        tenantId: state.tenantId,
        sendTenantHeader: state.sendTenantHeader,
        tokens: Object.fromEntries(state.tokenProfiles.map((profile) => [
          profile.varName,
          state.tokens[profile.key] || '',
        ])),
        tokenProfiles: state.tokenProfiles
          .filter((profile) => !profile.locked)
          .map((profile) => ({ ...profile })),
        laneOrder: state.laneOrder,
        rows: state.rows.map(({ result, ...rest }) => rest),
      };
      downloadJson(`${el('suiteName').value || 'api-test-studio'}.json`, data);
      toast('JSON exported with token values — store it securely');
    });

    el('templateBtn').addEventListener('click', () => {
      downloadJson('api-test-suite-template.json', DEFAULT_TEMPLATE);
    });

    el('importBtn').addEventListener('click', () => el('importFile').click());
    el('importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      await importFile(file);
      e.target.value = '';
    });

    const dropZone = el('dropZone');
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragging');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
    dropZone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      if (!file) return;
      await importFile(file);
    });
  }

  function bindRunBar() {
    el('runAllBtn').addEventListener('click', () => runStaged(state.rows, true));
    el('saveReportBtn').addEventListener('click', saveReport);
  }

  function bindVarsPanel() {
    const toggle = el('varsToggle');
    const box = el('varsBox');
    if (!toggle || !box) return;
    toggle.addEventListener('click', () => {
      box.hidden = !box.hidden;
      toggle.textContent = box.hidden ? 'Show variables' : 'Hide variables';
    });
  }

  function bindBackToTop() {
    const button = el('backToTopBtn');
    if (!button) return;
    const sync = () => {
      button.hidden = window.scrollY < 420;
    };
    button.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    window.addEventListener('scroll', sync, { passive: true });
    sync();
  }

  function init() {
    initTheme();
    load();
    bindConnectionInputs();
    bindEndpointControls();
    bindRunBar();
    bindVarsPanel();
    bindBackToTop();
    bindGuide();
    if (!state.rows.length) {
      const laneId = lastLaneId();
      state.rows.push(emptyRow({ method: 'GET', path: '/auth/me', role: 'admin', authVar: 'ADMIN_TOKEN', laneId }));
    }
    seedVars(true);
    renderRows();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
