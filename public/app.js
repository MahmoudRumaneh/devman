(() => {
  'use strict';

  const STORAGE_KEY = 'devmanApi.v3';
  const THEME_KEY = 'devmanApi.theme';
  const LEGACY_STORAGE_KEY = 'apiTestStudio.v3';
  const LEGACY_THEME_KEY = 'apiTestStudio.theme';
  const DEFAULT_PROJECT_NAME = 'devman-api';
  const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  const SAFE_RETRY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  const RETRYABLE_PROXY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
  const PROXY_MAX_ATTEMPTS = 3;
  const PROXY_RETRY_DELAY_MS = 250;
  const FAILURE_ALERT_DURATION_MS = 9000;
  const FAILURE_HIGHLIGHT_DURATION_MS = 2600;
  const RUN_MODE = Object.freeze({ ALL: 'all', GROUPS: 'groups', SINGLE: 'single' });
  const SWAGGER_IMPORT_MODE = Object.freeze({ REPLACE: 'replace', APPEND: 'append' });
  const JSON_IMPORT_ACTION = Object.freeze({ REPLACE: 'replace', APPEND: 'append' });
  const ROW_PANEL = Object.freeze({ NONE: '', BODY: 'body', HEADERS: 'headers', RESPONSE: 'response' });
  const ROW_PANEL_VALUES = new Set(Object.values(ROW_PANEL));
  const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
  const DEFAULT_CUSTOM_HEADER_NAME = 'X-Custom-Header';
  const GROUP_NAME_MAX_LENGTH = 80;
  const ICONS = {
    copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"></path></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l10.7-10.7a2.1 2.1 0 0 0-3-3Z"></path><path d="m14.5 7.5 3 3"></path></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"></path></svg>',
    key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"></circle><path d="m11 12 9-9M16 7l3 3M14 9l2 2"></path></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7Z"></path></svg>',
    response: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.5"></circle></svg>',
  };
  const DEFAULT_TOKEN_PROFILES = [
    { key: 'admin', label: 'Tenant admin', varName: 'ADMIN_TOKEN', scope: 'TenantRole.TENANT_ADMIN', locked: true },
    { key: 'platform_admin', label: 'Platform admin', varName: 'PLATFORM_ADMIN_TOKEN', scope: 'UserRole.PLATFORM_ADMIN', locked: true },
    { key: 'creator', label: 'Creator', varName: 'CREATOR_TOKEN', scope: 'UserRole.CREATOR', locked: true },
    { key: 'student', label: 'Student', varName: 'STUDENT_TOKEN', scope: 'UserRole.STUDENT', locked: true },
  ];
  const DEFAULT_TEMPLATE = {
    base_url: 'https://api.example.com/v1',
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
    baseUrl: 'https://api.example.com/v1',
    tenantId: '',
    sendTenantHeader: true,
    tokens: Object.fromEntries(DEFAULT_TOKEN_PROFILES.map((profile) => [profile.key, ''])),
    tokenProfiles: DEFAULT_TOKEN_PROFILES.map((profile) => ({ ...profile })),
    rows: [],
    laneOrder: [], // array of lane ids, in the order they execute — this replaces numeric "stage"
    laneMeta: {}, // lane id -> stable display name and collapsed state
    endpointSearch: '',
  };

  // Static vars seeded from an imported suite's top-level "vars" object.
  let suiteStaticVars = {};

  // Live variable store for ${VAR} substitution and captures.
  let VARS = {};
  let tokensVisible = false;
  let runInProgress = false;
  let activeRunLaneId = null;
  const selectedLaneIds = new Set();
  const searchCollapsedLaneIds = new Set();
  let previousEndpointSearch = '';

  let nextId = 1;
  const newRowId = () => `r${nextId++}`;
  let nextLaneNum = 1;
  const newLaneId = (over = {}) => {
    let id;
    do { id = `lane-${nextLaneNum++}`; } while (state.laneOrder.includes(id) || state.laneMeta[id]);
    state.laneMeta[id] = {
      name: String(over.name || '').trim(),
      collapsed: over.collapsed ?? true,
    };
    return id;
  };

  function emptyRow(over = {}) {
    const row = {
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
      activePanel: ROW_PANEL.NONE,
      ...over,
    };
    row.expect = normalizeStatusExpectation(row.expect);
    if (!ROW_PANEL_VALUES.has(row.activePanel)) row.activePanel = ROW_PANEL.NONE;
    if (row.expanded && row.activePanel === ROW_PANEL.NONE) row.activePanel = ROW_PANEL.BODY;
    if (row.activePanel === ROW_PANEL.RESPONSE && !row.result) row.activePanel = ROW_PANEL.NONE;
    delete row.expanded;
    return row;
  }

  function lastLaneId() {
    if (!state.laneOrder.length) state.laneOrder.push(newLaneId());
    return state.laneOrder[state.laneOrder.length - 1];
  }

  function normalizeLaneMeta(rawMeta, laneOrder) {
    const source = isRecord(rawMeta) ? rawMeta : {};
    return Object.fromEntries(laneOrder.map((laneId) => {
      const meta = isRecord(source[laneId]) ? source[laneId] : {};
      return [laneId, {
        name: typeof meta.name === 'string' ? meta.name.trim() : '',
        collapsed: typeof meta.collapsed === 'boolean' ? meta.collapsed : true,
      }];
    }));
  }

  function laneMetaFor(laneId) {
    if (!isRecord(state.laneMeta[laneId])) {
      state.laneMeta[laneId] = { name: '', collapsed: true };
    }
    return state.laneMeta[laneId];
  }

  function laneDisplayName(laneId, index = state.laneOrder.indexOf(laneId)) {
    return laneMetaFor(laneId).name || `Group ${Math.max(index, 0) + 1}`;
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
      laneMeta: state.laneMeta,
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
        text.textContent = 'Opaque token ready. It will be sent exactly as provided.';
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

  function syncTokenCardActions() {
    document.querySelectorAll('.token-apply-all-btn').forEach((button) => {
      const hasToken = Boolean(state.tokens[button.dataset.profileKey]?.trim());
      button.hidden = !hasToken;
      button.disabled = runInProgress || !state.rows.length;
      const actions = button.closest('.token-card-actions');
      if (actions) actions.hidden = [...actions.children].every((child) => child.hidden);
    });
  }

  async function applyTokenProfileToAllEndpoints(profile) {
    if (runInProgress) {
      toast('Wait for the current run to finish');
      return;
    }
    if (!state.tokens[profile.key]?.trim()) {
      toast(`Paste a value for ${profile.varName} first`);
      return;
    }
    if (!state.rows.length) {
      toast('Add at least one endpoint first');
      return;
    }

    const changedCount = state.rows.filter((row) =>
      row.role !== profile.key || row.authVar !== profile.varName).length;
    if (!changedCount) {
      toast(`Every endpoint already uses ${profile.label}`);
      return;
    }
    const confirmed = await showConfirm({
      title: `Use ${profile.label} for all endpoints?`,
      message: `This will assign ${profile.varName} to all ${state.rows.length} endpoint${state.rows.length === 1 ? '' : 's'} and replace their current authentication profile.`,
      okText: 'Apply to all',
      danger: false,
    });
    if (!confirmed) return;

    state.rows.forEach((row) => {
      row.role = profile.key;
      row.authVar = profile.varName;
    });
    seedVars(false);
    renderRows();
    save();
    toast(`${profile.label} applied to all ${state.rows.length} endpoint${state.rows.length === 1 ? '' : 's'}`);
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
        const varName = document.createElement('code');
        varName.textContent = profile.varName;
        meta.appendChild(title);
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
        syncTokenCardActions();
        saveDebounced();
      });

      card.appendChild(meta);
      card.appendChild(tokenInput);

      const actions = document.createElement('div');
      actions.className = 'token-card-actions';
      const applyAllButton = document.createElement('button');
      applyAllButton.className = 'btn ghost small token-apply-all-btn';
      applyAllButton.type = 'button';
      applyAllButton.dataset.profileKey = profile.key;
      applyAllButton.innerHTML = `${ICONS.key}<span>Use for all endpoints</span>`;
      applyAllButton.title = `Use ${profile.label} for every endpoint`;
      applyAllButton.setAttribute('aria-label', `Use ${profile.label} token for every endpoint`);
      applyAllButton.addEventListener('click', () => applyTokenProfileToAllEndpoints(profile));
      actions.appendChild(applyAllButton);

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
        actions.appendChild(removeBtn);
      }

      card.appendChild(actions);

      list.appendChild(card);
    }
    syncTokenCardActions();
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
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      state.baseUrl = parsed.baseUrl ?? state.baseUrl;
      state.tenantId = parsed.tenantId ?? '';
      state.sendTenantHeader = parsed.sendTenantHeader ?? true;
      state.tokens = { ...state.tokens, ...(parsed.tokens || {}) };
      state.tokenProfiles = normalizeTokenProfiles(parsed.tokenProfiles);
      suiteStaticVars = parsed.suiteStaticVars || {};
      state.laneOrder = Array.isArray(parsed.laneOrder) ? parsed.laneOrder : [];
      state.laneMeta = normalizeLaneMeta(parsed.laneMeta, state.laneOrder);
      state.endpointSearch = parsed.endpointSearch || '';
      state.rows = (parsed.rows || []).map((r) => emptyRow(r));
      if (!state.laneOrder.length && state.rows.length) {
        const id = newLaneId();
        state.laneOrder = [id];
        state.rows.forEach((r) => { r.laneId = id; });
      }
      state.laneMeta = normalizeLaneMeta(state.laneMeta, state.laneOrder);
      if (!localStorage.getItem(STORAGE_KEY)) save();
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

  // ---- shared select control -----------------------------------------------

  let nextSharedSelectId = 1;
  let openSharedSelectState = null;

  function selectedNativeOption(select) {
    return select.options[select.selectedIndex] || select.options[0] || null;
  }

  function refreshSharedSelect(select) {
    const wrapper = select.closest('.shared-select');
    if (!wrapper) return;
    const trigger = wrapper.querySelector('.shared-select-trigger');
    const valueLabel = wrapper.querySelector('.shared-select-value');
    const selectedOption = selectedNativeOption(select);
    if (!trigger || !valueLabel) return;

    valueLabel.textContent = selectedOption?.textContent || 'Choose an option';
    trigger.disabled = select.disabled;
    trigger.dataset.value = selectedOption?.value || '';
    trigger.title = selectedOption?.textContent || 'Choose an option';
    if (openSharedSelectState?.select === select) closeSharedSelect();
  }

  function positionSharedSelectMenu(state) {
    const { trigger, menu } = state;
    if (!trigger.isConnected || !menu.isConnected) return;
    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const width = Math.min(
      Math.max(rect.width, 220),
      Math.max(160, window.innerWidth - (viewportPadding * 2)),
    );
    const isRtl = getComputedStyle(trigger).direction === 'rtl';
    const preferredLeft = isRtl ? rect.right - width : rect.left;
    const left = Math.min(
      Math.max(preferredLeft, viewportPadding),
      window.innerWidth - width - viewportPadding,
    );
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPadding;
    const spaceAbove = rect.top - gap - viewportPadding;
    const estimatedHeight = Math.min(menu.scrollHeight, 320);
    const openAbove = spaceBelow < Math.min(estimatedHeight, 180) && spaceAbove > spaceBelow;

    menu.style.width = `${width}px`;
    menu.style.left = `${left}px`;
    menu.style.right = 'auto';
    menu.style.top = openAbove ? 'auto' : `${rect.bottom + gap}px`;
    menu.style.bottom = openAbove ? `${window.innerHeight - rect.top + gap}px` : 'auto';
    menu.style.maxHeight = `${Math.max(96, Math.min(320, openAbove ? spaceAbove : spaceBelow))}px`;
    menu.style.visibility = 'visible';
  }

  function setSharedSelectActiveIndex(state, nextIndex) {
    const enabledIndices = state.options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled)
      .map(({ index }) => index);
    if (!enabledIndices.length) return;

    const requestedIndex = enabledIndices.includes(nextIndex) ? nextIndex : enabledIndices[0];
    state.activeIndex = requestedIndex;
    state.optionElements.forEach((optionElement, index) => {
      const isActive = index === requestedIndex;
      optionElement.classList.toggle('is-active', isActive);
      if (isActive) {
        state.trigger.setAttribute('aria-activedescendant', optionElement.id);
        optionElement.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function moveSharedSelectActiveIndex(state, direction) {
    const enabledIndices = state.options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !option.disabled)
      .map(({ index }) => index);
    if (!enabledIndices.length) return;
    const currentPosition = enabledIndices.indexOf(state.activeIndex);
    const nextPosition = currentPosition < 0
      ? 0
      : (currentPosition + direction + enabledIndices.length) % enabledIndices.length;
    setSharedSelectActiveIndex(state, enabledIndices[nextPosition]);
  }

  function chooseSharedSelectOption(state, optionIndex) {
    const option = state.options[optionIndex];
    if (!option || option.disabled) return;
    state.select.selectedIndex = optionIndex;
    state.select.dispatchEvent(new Event('change', { bubbles: true }));
    refreshSharedSelect(state.select);
    closeSharedSelect({ restoreFocus: true });
  }

  function closeSharedSelect({ restoreFocus = false } = {}) {
    const state = openSharedSelectState;
    if (!state) return;
    openSharedSelectState = null;
    state.menu.remove();
    state.trigger.setAttribute('aria-expanded', 'false');
    state.trigger.removeAttribute('aria-activedescendant');
    state.wrapper.classList.remove('is-open');
    document.removeEventListener('pointerdown', state.onOutsidePointer, true);
    document.removeEventListener('scroll', state.onViewportChange, true);
    window.removeEventListener('resize', state.onViewportChange);
    if (restoreFocus && state.trigger.isConnected) state.trigger.focus({ preventScroll: true });
  }

  function openSharedSelect(select, wrapper, trigger) {
    if (select.disabled) return;
    if (openSharedSelectState?.select === select) {
      closeSharedSelect({ restoreFocus: true });
      return;
    }
    closeSharedSelect();

    const options = [...select.options];
    const menu = document.createElement('div');
    menu.className = 'shared-select-menu';
    menu.id = trigger.getAttribute('aria-controls');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Options');
    menu.style.visibility = 'hidden';

    const optionElements = options.map((option, index) => {
      const optionElement = document.createElement('div');
      optionElement.className = 'shared-select-option';
      optionElement.id = `${menu.id}-option-${index}`;
      optionElement.setAttribute('role', 'option');
      optionElement.setAttribute('aria-selected', String(index === select.selectedIndex));
      optionElement.setAttribute('aria-disabled', String(option.disabled));
      optionElement.classList.toggle('is-selected', index === select.selectedIndex);
      optionElement.classList.toggle('is-disabled', option.disabled);

      const copy = document.createElement('span');
      copy.className = 'shared-select-option-copy';
      const label = document.createElement('strong');
      label.textContent = option.textContent;
      copy.appendChild(label);
      if (option.dataset.description) {
        const description = document.createElement('small');
        description.textContent = option.dataset.description;
        copy.appendChild(description);
      }
      const check = document.createElement('span');
      check.className = 'shared-select-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      optionElement.appendChild(copy);
      optionElement.appendChild(check);
      optionElement.addEventListener('pointerenter', () => {
        if (!option.disabled && openSharedSelectState) {
          setSharedSelectActiveIndex(openSharedSelectState, index);
        }
      });
      optionElement.addEventListener('pointerdown', (event) => event.preventDefault());
      optionElement.addEventListener('click', () => {
        if (openSharedSelectState) chooseSharedSelectOption(openSharedSelectState, index);
      });
      menu.appendChild(optionElement);
      return optionElement;
    });

    const state = {
      select,
      wrapper,
      trigger,
      menu,
      options,
      optionElements,
      activeIndex: select.selectedIndex >= 0 ? select.selectedIndex : 0,
      onOutsidePointer: null,
      onViewportChange: null,
    };
    state.onOutsidePointer = (event) => {
      if (!wrapper.contains(event.target) && !menu.contains(event.target)) closeSharedSelect();
    };
    state.onViewportChange = (event) => {
      if (event.type === 'scroll' && menu.contains(event.target)) return;
      closeSharedSelect();
    };

    openSharedSelectState = state;
    document.body.appendChild(menu);
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    positionSharedSelectMenu(state);
    setSharedSelectActiveIndex(state, state.activeIndex);
    document.addEventListener('pointerdown', state.onOutsidePointer, true);
    document.addEventListener('scroll', state.onViewportChange, true);
    window.addEventListener('resize', state.onViewportChange);
  }

  function handleSharedSelectKeydown(event, select, wrapper, trigger) {
    const state = openSharedSelectState?.select === select ? openSharedSelectState : null;
    if (!state) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openSharedSelect(select, wrapper, trigger);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeSharedSelect({ restoreFocus: true });
    } else if (event.key === 'Tab') {
      closeSharedSelect();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveSharedSelectActiveIndex(state, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : state.options.length - 1;
      setSharedSelectActiveIndex(state, index);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseSharedSelectOption(state, state.activeIndex);
    }
  }

  function enhanceSelect(select, { variant = 'default', label = 'Choose an option' } = {}) {
    const existingWrapper = select.closest('.shared-select');
    if (existingWrapper) {
      existingWrapper.dataset.variant = variant;
      const existingTrigger = existingWrapper.querySelector('.shared-select-trigger');
      if (existingTrigger) existingTrigger.setAttribute('aria-label', label);
      refreshSharedSelect(select);
      return existingWrapper;
    }

    const controlId = select.id || `shared-select-${nextSharedSelectId++}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'shared-select';
    wrapper.dataset.variant = variant;
    const trigger = document.createElement('button');
    trigger.className = 'shared-select-trigger';
    trigger.type = 'button';
    trigger.id = `${controlId}-trigger`;
    trigger.setAttribute('aria-label', label);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', `${controlId}-menu`);

    const valueLabel = document.createElement('span');
    valueLabel.className = 'shared-select-value';
    const chevron = document.createElement('span');
    chevron.className = 'shared-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = '<svg viewBox="0 0 20 20"><path d="m5.5 7.5 4.5 4.5 4.5-4.5"></path></svg>';
    trigger.appendChild(valueLabel);
    trigger.appendChild(chevron);

    if (select.parentNode) select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);
    wrapper.appendChild(trigger);
    select.classList.add('shared-select-native');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    select.addEventListener('change', () => refreshSharedSelect(select));
    trigger.addEventListener('click', () => openSharedSelect(select, wrapper, trigger));
    trigger.addEventListener('keydown', (event) => handleSharedSelectKeydown(event, select, wrapper, trigger));
    refreshSharedSelect(select);
    return wrapper;
  }

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
    const saved = localStorage.getItem(THEME_KEY) || localStorage.getItem(LEGACY_THEME_KEY) || 'auto';
    if (!localStorage.getItem(THEME_KEY)) localStorage.setItem(THEME_KEY, saved);
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

  let failureAlertTimer;
  let failureAlertHideTimer;
  let failureHighlightTimer;
  let highlightedFailureRowId = null;

  function hideRunFailureAlert() {
    const backdrop = el('runFailureBackdrop');
    if (!backdrop || backdrop.hidden) return;
    clearTimeout(failureAlertTimer);
    clearTimeout(failureAlertHideTimer);
    backdrop.classList.remove('is-visible');
    failureAlertHideTimer = window.setTimeout(() => { backdrop.hidden = true; }, 180);
  }

  function failedRequestReason(row) {
    const result = row.result;
    if (!result || result.status === 0) {
      try {
        const parsed = JSON.parse(result?.respBody || '');
        if (isRecord(parsed) && typeof parsed.error === 'string' && parsed.error.trim()) {
          return parsed.error.trim();
        }
      } catch (_) {
        // Use the stable network-error message below for non-JSON responses.
      }
      return 'No HTTP response was received. Check the connection and endpoint availability.';
    }

    if (!statusMatches(result.status, row.expect)) {
      return `Received HTTP ${result.status}; expected ${row.expect.trim() || 'a successful response'}.`;
    }
    if ((row.assert || []).length) {
      return `HTTP ${result.status} was received, but a response assertion did not pass.`;
    }
    return `The endpoint returned HTTP ${result.status} and did not meet its configured expectation.`;
  }

  function findRenderedRow(rowId) {
    return [...document.querySelectorAll('.request-card')]
      .find((rowElement) => rowElement.dataset.rowId === rowId);
  }

  function clearFailureHighlight() {
    clearTimeout(failureHighlightTimer);
    highlightedFailureRowId = null;
    document.querySelectorAll('.request-card.run-failure-focus').forEach((rowElement) => {
      rowElement.classList.remove('run-failure-focus');
      rowElement.removeAttribute('tabindex');
    });
  }

  function focusFailedEndpoint(row) {
    if (state.endpointSearch && !rowMatchesSearch(row)) {
      state.endpointSearch = '';
      syncEndpointSearchControls();
      saveDebounced();
    }

    row.activePanel = ROW_PANEL.RESPONSE;
    clearFailureHighlight();
    highlightedFailureRowId = row.id;
    renderRows();

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const rowElement = findRenderedRow(row.id);
        if (!rowElement) return;

        rowElement.classList.remove('run-failure-focus');
        void rowElement.offsetWidth;
        rowElement.classList.add('run-failure-focus');
        rowElement.setAttribute('tabindex', '-1');

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        rowElement.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
          inline: 'nearest',
        });
        rowElement.focus({ preventScroll: true });

        failureHighlightTimer = window.setTimeout(() => {
          if (highlightedFailureRowId === row.id) highlightedFailureRowId = null;
          const currentRowElement = findRenderedRow(row.id);
          currentRowElement?.classList.remove('run-failure-focus');
          currentRowElement?.removeAttribute('tabindex');
        }, FAILURE_HIGHLIGHT_DURATION_MS);
      });
    });
  }

  function showRunFailureAlert(row, outcome) {
    const alert = el('runFailureAlert');
    const backdrop = el('runFailureBackdrop');
    if (!alert || !backdrop) return;

    clearTimeout(failureAlertTimer);
    clearTimeout(failureAlertHideTimer);
    el('runFailureEyebrow').textContent = outcome === 'hardfail' ? 'Run paused' : 'Run continuing';
    el('runFailureTitle').textContent = row.result?.state === 'error'
      ? 'Could not reach endpoint'
      : 'Endpoint check failed';
    el('runFailureEndpoint').textContent = `${row.method} ${row.path || '/'}`;
    el('runFailureReason').textContent = failedRequestReason(row);
    el('runFailureViewBtn').onclick = () => {
      hideRunFailureAlert();
      focusFailedEndpoint(row);
    };
    el('runFailureClose').onclick = hideRunFailureAlert;
    backdrop.onclick = (event) => {
      if (event.target === backdrop) hideRunFailureAlert();
    };

    backdrop.hidden = false;
    backdrop.classList.remove('is-visible');
    window.requestAnimationFrame(() => backdrop.classList.add('is-visible'));
    failureAlertTimer = window.setTimeout(hideRunFailureAlert, FAILURE_ALERT_DURATION_MS);
  }

  function revealRunFailure(row, outcome) {
    focusFailedEndpoint(row);
    showRunFailureAlert(row, outcome);
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

  function openEndpointPathEditor(row, returnFocus) {
    const modal = el('endpointPathModal');
    const input = el('endpointPathInput');
    const method = el('endpointPathMethod');
    const count = el('endpointPathCount');
    const preview = el('endpointPathPreview');
    const cancelButton = el('endpointPathCancel');
    const copyButton = el('endpointPathCopy');
    const saveButton = el('endpointPathSave');
    let copyResetTimer;

    closeSharedSelect();
    input.value = String(row.path || '');
    method.textContent = row.method;
    method.dataset.method = row.method;
    copyButton.innerHTML = `${ICONS.copy}<span>Copy path</span>`;
    copyButton.classList.remove('is-copied');

    const syncPreview = () => {
      const value = input.value;
      count.textContent = `${value.length} character${value.length === 1 ? '' : 's'}`;
      preview.textContent = joinUrl(state.baseUrl, value.trim());
    };
    const focusPathAction = () => {
      const rowElement = [...document.querySelectorAll('.request-card')]
        .find((element) => element.dataset.rowId === row.id);
      rowElement?.querySelector('.endpoint-expand-btn')?.focus({ preventScroll: true });
    };
    const close = ({ saveChanges = false } = {}) => {
      window.clearTimeout(copyResetTimer);
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKeydown);
      input.oninput = null;
      cancelButton.onclick = null;
      copyButton.onclick = null;
      saveButton.onclick = null;
      modal.onclick = null;
      if (saveChanges) {
        row.path = input.value.trim();
        save();
        renderRows();
        window.requestAnimationFrame(focusPathAction);
      } else if (returnFocus?.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        close({ saveChanges: true });
      }
    };

    input.oninput = syncPreview;
    cancelButton.onclick = () => close();
    saveButton.onclick = () => close({ saveChanges: true });
    copyButton.onclick = async () => {
      try {
        await writeClipboard(input.value);
        copyButton.classList.add('is-copied');
        copyButton.innerHTML = `${ICONS.check}<span>Copied</span>`;
        toast('Endpoint path copied');
        window.clearTimeout(copyResetTimer);
        copyResetTimer = window.setTimeout(() => {
          copyButton.classList.remove('is-copied');
          copyButton.innerHTML = `${ICONS.copy}<span>Copy path</span>`;
        }, 1600);
      } catch (_) {
        toast('Copy failed');
      }
    };
    modal.onclick = (event) => {
      if (event.target === modal) close();
    };
    document.addEventListener('keydown', onKeydown);
    syncPreview();
    modal.hidden = false;
    document.body.classList.add('modal-open');
    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function showConfirm({ title = 'Confirm action', message, okText = 'Delete', danger = true }) {
    return new Promise((resolve) => {
      const modal = el('confirmModal');
      const titleEl = el('confirmTitle');
      const messageEl = el('confirmMessage');
      const cancelBtn = el('confirmCancel');
      const okBtn = el('confirmOk');

      titleEl.textContent = title;
      messageEl.textContent = message;
      okBtn.textContent = okText;
      okBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
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

  function showJsonImportChoice({ existingCount, importedCount }) {
    return new Promise((resolve) => {
      const modal = el('jsonImportChoiceModal');
      const message = el('jsonImportChoiceMessage');
      const cancelButton = el('jsonImportChoiceCancel');
      const replaceButton = el('jsonImportChoiceReplace');
      const appendButton = el('jsonImportChoiceAppend');

      message.textContent = `Your workspace already has ${existingCount} endpoint${existingCount === 1 ? '' : 's'}. This file contains ${importedCount} endpoint${importedCount === 1 ? '' : 's'}. Choose how to import them.`;
      modal.hidden = false;
      document.body.classList.add('modal-open');

      const close = (action = null) => {
        modal.hidden = true;
        document.body.classList.remove('modal-open');
        cancelButton.removeEventListener('click', onCancel);
        replaceButton.removeEventListener('click', onReplace);
        appendButton.removeEventListener('click', onAppend);
        modal.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKeydown);
        resolve(action);
      };
      const onCancel = () => close();
      const onReplace = () => close(JSON_IMPORT_ACTION.REPLACE);
      const onAppend = () => close(JSON_IMPORT_ACTION.APPEND);
      const onBackdrop = (event) => {
        if (event.target === modal) close();
      };
      const onKeydown = (event) => {
        if (event.key === 'Escape') close();
      };

      cancelButton.addEventListener('click', onCancel);
      replaceButton.addEventListener('click', onReplace);
      appendButton.addEventListener('click', onAppend);
      modal.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKeydown);
      appendButton.focus();
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

  function analyzeRoutesText(text) {
    const routes = [];
    const issues = [];
    String(text || '').split('\n').forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;

      const parts = line.split(/\s+/);
      const firstPart = parts[0];
      const maybeVerb = firstPart.toUpperCase();
      let method = 'GET';
      let path = line;

      if (VERBS.includes(maybeVerb)) {
        method = maybeVerb;
        path = parts.slice(1).join(' ');
        if (!path) {
          issues.push({ line: index + 1, message: `${method} is missing an endpoint path` });
          return;
        }
      } else if (/^[A-Za-z]+$/.test(firstPart) && parts.length > 1) {
        issues.push({ line: index + 1, message: `Unsupported method “${firstPart}”` });
        return;
      }

      if (/\s/.test(path)) {
        issues.push({ line: index + 1, message: 'Endpoint paths cannot contain spaces' });
        return;
      }
      routes.push({ method, path });
    });
    return { routes, issues };
  }

  function joinUrl(base, path) {
    if (/^https?:\/\//i.test(path)) return path;
    const b = base.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return b + p;
  }

  function statusExpectationValues(expect) {
    const expectedValues = Array.isArray(expect) ? expect : String(expect ?? '').split(',');
    return expectedValues.map((value) => String(value).trim()).filter(Boolean);
  }

  function normalizeStatusExpectation(expect) {
    const values = statusExpectationValues(expect);
    if (!values.length) return '';
    const allAreGeneralSuccessCodes = values.every((value) =>
      /^2xx$/i.test(value) || /^2\d{2}$/.test(value));
    return allAreGeneralSuccessCodes ? '2xx' : values.join(',');
  }

  function statusMatches(status, expect) {
    const normalizedValues = statusExpectationValues(normalizeStatusExpectation(expect));
    if (!normalizedValues.length) return status >= 200 && status < 300;

    return normalizedValues.some((expectedValue) => {
      const strictStatus = expectedValue.match(/^=(\d{3})$/);
      if (strictStatus) return status === Number(strictStatus[1]);
      if (/^\d{3}$/.test(expectedValue)) return status === Number(expectedValue);
      if (/^[1-5]xx$/i.test(expectedValue)) {
        return Math.floor(status / 100) === Number(expectedValue[0]);
      }
      const range = expectedValue.match(/^(\d{3})\s*(?:-|\.\.)\s*(\d{3})$/);
      if (range) return status >= Number(range[1]) && status <= Number(range[2]);
      return String(status) === expectedValue;
    });
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
        laneMeta: state.laneMeta,
        importedTokenCount,
        tokensOnly: isRecord(parsed.tokens),
      };
    }

    const rows = parsed.rows.map((rawRow) => {
      const row = emptyRow(isRecord(rawRow) ? rawRow : {});
      row.body = formatImportedBody(row.body);
      return row;
    });
    let laneOrder = Array.isArray(parsed.laneOrder) ? parsed.laneOrder : null;
    if (!laneOrder || !laneOrder.length) {
      const id = newLaneId();
      laneOrder = [id];
      rows.forEach((r) => { r.laneId = id; });
    } else {
      rows.forEach((r) => { if (!r.laneId) r.laneId = laneOrder[0]; });
    }
    const laneMeta = normalizeLaneMeta(parsed.laneMeta ?? parsed.lane_meta, laneOrder);
    return { rows, laneOrder, laneMeta, importedTokenCount, tokensOnly: false };
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
    const laneIdForStage = new Map(distinctStages.map((stage) => [stage, newLaneId({
      name: `Stage ${stage}`,
      collapsed: true,
    })]));
    const laneOrder = distinctStages.map((s) => laneIdForStage.get(s));
    const rows = rawSteps.map((step) => stepToRow(step, laneIdForStage.get(step.stage ?? 0)));
    return { rows, laneOrder, laneMeta: normalizeLaneMeta(state.laneMeta, laneOrder) };
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
        laneMetaFor(laneId).collapsed = false;
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

  function rowsForLaneIds(laneIds) {
    const allowedLaneIds = laneIds instanceof Set ? laneIds : new Set(laneIds);
    return state.rows.filter((row) => allowedLaneIds.has(row.laneId));
  }

  function nextDuplicateLaneName(laneId) {
    const sourceName = laneDisplayName(laneId);
    const usedNames = new Set(state.laneOrder.map((id, index) =>
      laneDisplayName(id, index).toLocaleLowerCase()));
    let candidate = `${sourceName} copy`;
    let suffix = 2;
    while (usedNames.has(candidate.toLocaleLowerCase())) candidate = `${sourceName} copy ${suffix++}`;
    return candidate;
  }

  function cloneRowForLane(row, laneId) {
    const persistedRow = { ...row };
    delete persistedRow.id;
    delete persistedRow.result;
    const clone = typeof structuredClone === 'function'
      ? structuredClone(persistedRow)
      : JSON.parse(JSON.stringify(persistedRow));
    return emptyRow({
      ...clone,
      laneId,
      result: null,
      activePanel: ROW_PANEL.NONE,
    });
  }

  function duplicateLane(laneId) {
    const sourceIndex = state.laneOrder.indexOf(laneId);
    if (sourceIndex < 0) return;
    const sourceRows = state.rows.filter((row) => row.laneId === laneId);
    const duplicateName = nextDuplicateLaneName(laneId);
    const duplicateLaneId = newLaneId({ name: duplicateName, collapsed: true });
    const duplicateRows = sourceRows.map((row) => cloneRowForLane(row, duplicateLaneId));
    state.laneOrder.splice(sourceIndex + 1, 0, duplicateLaneId);

    const sourceRowIndices = state.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.laneId === laneId)
      .map(({ index }) => index);
    const insertionIndex = sourceRowIndices.length
      ? sourceRowIndices[sourceRowIndices.length - 1] + 1
      : state.rows.length;
    state.rows.splice(insertionIndex, 0, ...duplicateRows);
    renderRows();
    save();
    toast(`Duplicated ${laneDisplayName(laneId, sourceIndex)} as ${duplicateName}`);
  }

  function createGroupActionButton({ className, icon, label, title, onClick, disabled = false }) {
    const button = document.createElement('button');
    button.className = className;
    button.type = 'button';
    button.draggable = false;
    button.disabled = disabled;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    if (label) {
      const labelElement = document.createElement('span');
      labelElement.textContent = label;
      button.appendChild(labelElement);
    }
    button.addEventListener('click', onClick);
    return button;
  }

  function laneNameIsUsed(name, currentLaneId) {
    const normalizedName = name.toLocaleLowerCase();
    return state.laneOrder.some((laneId, index) =>
      laneId !== currentLaneId && laneDisplayName(laneId, index).toLocaleLowerCase() === normalizedName);
  }

  function beginLaneNameEdit({ laneId, laneIndex, container }) {
    if (runInProgress) return;
    const currentName = laneDisplayName(laneId, laneIndex);
    container.classList.add('is-editing');
    container.innerHTML = '';

    const input = document.createElement('input');
    input.className = 'lane-name-input';
    input.type = 'text';
    input.value = currentName;
    input.maxLength = GROUP_NAME_MAX_LENGTH;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', `Edit ${currentName} name`);

    const actions = document.createElement('span');
    actions.className = 'lane-name-editor-actions';
    const saveButton = createGroupActionButton({
      className: 'lane-name-editor-btn is-save',
      icon: ICONS.check,
      label: '',
      title: 'Save group name',
      onClick: () => saveName(),
    });
    const cancelButton = document.createElement('button');
    cancelButton.className = 'lane-name-editor-btn is-cancel';
    cancelButton.type = 'button';
    cancelButton.title = 'Cancel editing';
    cancelButton.setAttribute('aria-label', 'Cancel editing group name');
    cancelButton.textContent = '×';

    const showInputError = (message) => {
      input.classList.add('has-error');
      input.setAttribute('aria-invalid', 'true');
      input.title = message;
      toast(message);
      input.focus();
      input.select();
    };
    const saveName = () => {
      const nextName = input.value.trim();
      if (!nextName) {
        showInputError('Group name cannot be empty');
        return;
      }
      if (laneNameIsUsed(nextName, laneId)) {
        showInputError(`A group named “${nextName}” already exists`);
        return;
      }
      laneMetaFor(laneId).name = nextName;
      renderRows();
      save();
      toast(`Group renamed to ${nextName}`);
    };
    const cancel = () => renderRows();

    input.addEventListener('input', () => {
      input.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
      input.removeAttribute('title');
    });
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveName();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    });
    cancelButton.addEventListener('click', cancel);
    actions.appendChild(saveButton);
    actions.appendChild(cancelButton);
    container.appendChild(input);
    container.appendChild(actions);
    input.focus();
    input.select();
  }

  function buildGroupSelectionBar() {
    const selectedRows = rowsForLaneIds(selectedLaneIds);
    const bar = document.createElement('div');
    bar.className = 'group-selection-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Selected group actions');

    const summary = document.createElement('div');
    summary.className = 'group-selection-summary';
    const indicator = document.createElement('span');
    indicator.className = 'group-selection-indicator';
    indicator.innerHTML = ICONS.check;
    const copy = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = `${selectedLaneIds.size} group${selectedLaneIds.size === 1 ? '' : 's'} selected`;
    const detail = document.createElement('small');
    detail.textContent = `${selectedRows.length} endpoint${selectedRows.length === 1 ? '' : 's'} will run in workspace order`;
    copy.appendChild(title);
    copy.appendChild(detail);
    summary.appendChild(indicator);
    summary.appendChild(copy);

    const actions = document.createElement('div');
    actions.className = 'group-selection-actions';
    const runSelectedButton = createGroupActionButton({
      className: 'btn primary small bulk-group-btn run-selected-groups-btn',
      icon: ICONS.play,
      label: runInProgress ? 'Running…' : 'Run selected',
      title: 'Run only the selected groups',
      disabled: runInProgress || !selectedRows.length,
      onClick: () => runStaged(rowsForLaneIds(selectedLaneIds), {
        resetVars: true,
        mode: RUN_MODE.GROUPS,
      }),
    });
    const selectAllButton = createGroupActionButton({
      className: 'btn ghost small bulk-group-btn group-selection-mutation-btn',
      icon: ICONS.check,
      label: 'Select all',
      title: 'Select every group',
      disabled: runInProgress || selectedLaneIds.size === state.laneOrder.length,
      onClick: () => {
        state.laneOrder.forEach((laneId) => selectedLaneIds.add(laneId));
        renderRows();
      },
    });
    const clearButton = document.createElement('button');
    clearButton.className = 'btn ghost small group-selection-mutation-btn';
    clearButton.type = 'button';
    clearButton.disabled = runInProgress;
    clearButton.textContent = 'Clear';
    clearButton.addEventListener('click', () => {
      selectedLaneIds.clear();
      renderRows();
    });
    actions.appendChild(runSelectedButton);
    actions.appendChild(selectAllButton);
    actions.appendChild(clearButton);
    bar.appendChild(summary);
    bar.appendChild(actions);
    return bar;
  }

  // ---- rendering ------------------------------------------------------------

  function renderRows() {
    closeSharedSelect();
    ensureAtLeastOneLane();
    [...selectedLaneIds].forEach((laneId) => {
      if (!state.laneOrder.includes(laneId)) selectedLaneIds.delete(laneId);
    });
    const list = el('rowsList');
    list.innerHTML = '';
    const normalizedSearch = state.endpointSearch.trim();
    const isSearching = Boolean(normalizedSearch);
    if (!isSearching || !previousEndpointSearch) searchCollapsedLaneIds.clear();
    previousEndpointSearch = normalizedSearch;
    let visibleCount = 0;
    if (selectedLaneIds.size) list.appendChild(buildGroupSelectionBar());

    state.laneOrder.forEach((laneId, idx) => {
      const allLaneRows = state.rows.filter((r) => r.laneId === laneId);
      const laneRows = allLaneRows.filter((r) => rowMatchesSearch(r));
      if (isSearching && !laneRows.length) return;
      visibleCount += laneRows.length;
      const meta = laneMetaFor(laneId);
      const isCollapsed = isSearching
        ? searchCollapsedLaneIds.has(laneId)
        : meta.collapsed;
      const laneEl = document.createElement('div');
      laneEl.className = 'stage-lane';
      laneEl.classList.toggle('is-collapsed', isCollapsed);
      laneEl.classList.toggle('is-selected', selectedLaneIds.has(laneId));
      laneEl.classList.toggle('is-run-active', runInProgress && activeRunLaneId === laneId);
      laneEl.dataset.laneId = laneId;

      const header = document.createElement('div');
      header.className = 'stage-lane-header';
      header.draggable = true;
      header.addEventListener('dragstart', (event) => {
        if (event.target.closest('button, input')) {
          event.preventDefault();
          return;
        }
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

      const selectButton = document.createElement('button');
      const isSelected = selectedLaneIds.has(laneId);
      selectButton.className = 'lane-select-toggle';
      selectButton.type = 'button';
      selectButton.draggable = false;
      selectButton.disabled = runInProgress;
      selectButton.innerHTML = ICONS.check;
      selectButton.title = isSelected ? 'Remove group from selection' : 'Select group';
      selectButton.setAttribute('role', 'checkbox');
      selectButton.setAttribute('aria-checked', String(isSelected));
      selectButton.setAttribute('aria-label', `${isSelected ? 'Deselect' : 'Select'} ${laneDisplayName(laneId, idx)}`);
      selectButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (selectedLaneIds.has(laneId)) selectedLaneIds.delete(laneId);
        else selectedLaneIds.add(laneId);
        renderRows();
      });
      header.appendChild(selectButton);

      const collapseButton = document.createElement('button');
      collapseButton.className = 'lane-collapse-toggle';
      collapseButton.type = 'button';
      collapseButton.draggable = false;
      collapseButton.disabled = runInProgress && activeRunLaneId === laneId;
      collapseButton.innerHTML = '<span aria-hidden="true">⌄</span>';
      collapseButton.title = isCollapsed ? 'Expand group' : 'Collapse group';
      collapseButton.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} ${laneDisplayName(laneId, idx)}`);
      collapseButton.setAttribute('aria-expanded', String(!isCollapsed));
      collapseButton.setAttribute('aria-controls', `lane-body-${laneId}`);
      collapseButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (isSearching) {
          if (searchCollapsedLaneIds.has(laneId)) searchCollapsedLaneIds.delete(laneId);
          else searchCollapsedLaneIds.add(laneId);
        } else {
          meta.collapsed = !meta.collapsed;
        }
        renderRows();
        if (!isSearching) save();
      });
      header.appendChild(collapseButton);

      const title = document.createElement('div');
      title.className = 'lane-title lane-title-editor';
      const titleButton = document.createElement('button');
      titleButton.className = 'lane-title-value lane-mutation-btn';
      titleButton.type = 'button';
      titleButton.disabled = runInProgress;
      titleButton.textContent = laneDisplayName(laneId, idx);
      titleButton.title = `Rename ${laneDisplayName(laneId, idx)}`;
      titleButton.setAttribute('aria-label', `Rename ${laneDisplayName(laneId, idx)}`);
      const editNameButton = document.createElement('button');
      editNameButton.className = 'lane-name-edit-btn lane-mutation-btn';
      editNameButton.type = 'button';
      editNameButton.disabled = runInProgress;
      editNameButton.innerHTML = ICONS.edit;
      editNameButton.title = `Rename ${laneDisplayName(laneId, idx)}`;
      editNameButton.setAttribute('aria-label', `Rename ${laneDisplayName(laneId, idx)}`);
      const editGroupName = (event) => {
        event.stopPropagation();
        beginLaneNameEdit({ laneId, laneIndex: idx, container: title });
      };
      titleButton.addEventListener('click', editGroupName);
      editNameButton.addEventListener('click', editGroupName);
      title.appendChild(titleButton);
      title.appendChild(editNameButton);
      header.appendChild(title);

      const count = document.createElement('span');
      count.className = 'lane-count';
      count.textContent = String(allLaneRows.length);
      count.title = `${allLaneRows.length} endpoint${allLaneRows.length === 1 ? '' : 's'}`;
      header.appendChild(count);

      const hint = document.createElement('span');
      hint.className = 'lane-hint';
      hint.textContent = idx === 0
        ? 'runs first · endpoints run in order'
        : `execution position ${idx + 1} · endpoints run in order`;
      header.appendChild(hint);

      const headerActions = document.createElement('div');
      headerActions.className = 'lane-actions';

      const runGroupButton = createGroupActionButton({
        className: 'btn primary small lane-action-btn run-group-btn',
        icon: ICONS.play,
        label: runInProgress && activeRunLaneId === laneId ? 'Running…' : 'Run',
        title: `Run only ${laneDisplayName(laneId, idx)}`,
        disabled: runInProgress || !allLaneRows.length,
        onClick: () => runStaged(state.rows.filter((row) => row.laneId === laneId), {
          resetVars: true,
          mode: RUN_MODE.GROUPS,
        }),
      });
      headerActions.appendChild(runGroupButton);

      const duplicateButton = createGroupActionButton({
        className: 'btn ghost small lane-action-btn lane-icon-action lane-mutation-btn duplicate-group-btn',
        icon: ICONS.copy,
        label: '',
        title: `Duplicate ${laneDisplayName(laneId, idx)}`,
        disabled: runInProgress,
        onClick: () => duplicateLane(laneId),
      });
      headerActions.appendChild(duplicateButton);

      const addHereBtn = document.createElement('button');
      addHereBtn.className = 'btn ghost small lane-add-row-btn lane-mutation-btn';
      addHereBtn.type = 'button';
      addHereBtn.disabled = runInProgress;
      addHereBtn.textContent = '+ row';
      addHereBtn.title = 'Add an empty row to this group';
      addHereBtn.addEventListener('click', () => {
        state.rows.push(emptyRow({ laneId }));
        meta.collapsed = false;
        renderRows();
        save();
      });
      headerActions.appendChild(addHereBtn);

      const removeLaneBtn = document.createElement('button');
      removeLaneBtn.className = 'lane-remove';
      removeLaneBtn.type = 'button';
      removeLaneBtn.disabled = runInProgress;
      removeLaneBtn.textContent = '×';
      removeLaneBtn.title = allLaneRows.length ? 'Delete group and its rows' : 'Delete group';
      removeLaneBtn.addEventListener('click', async () => {
        if (state.laneOrder.length <= 1) {
          toast('Keep at least one group');
          return;
        }
        if (allLaneRows.length) {
          const groupName = laneDisplayName(laneId, idx);
          const confirmed = await showConfirm({
            title: `Delete ${groupName}`,
            message: `This will remove ${allLaneRows.length} row${allLaneRows.length > 1 ? 's' : ''} from this group.`,
            okText: 'Delete group',
          });
          if (!confirmed) return;
        }
        state.laneOrder = state.laneOrder.filter((id) => id !== laneId);
        state.rows = state.rows.filter((row) => row.laneId !== laneId);
        delete state.laneMeta[laneId];
        selectedLaneIds.delete(laneId);
        renderRows();
        save();
      });
      headerActions.appendChild(removeLaneBtn);
      header.appendChild(headerActions);

      laneEl.appendChild(header);

      const body = document.createElement('div');
      body.className = 'stage-lane-body';
      body.id = `lane-body-${laneId}`;
      body.hidden = isCollapsed;
      if (isCollapsed) {
        // Avoid constructing hundreds of hidden controls for large Swagger imports.
      } else if (!laneRows.length) {
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

    list.classList.remove('single-lane');

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

  function syncEndpointSearchControls() {
    const input = el('endpointSearch');
    const clearButton = el('clearSearchBtn');
    if (input && input.value !== state.endpointSearch) input.value = state.endpointSearch;
    if (clearButton) clearButton.disabled = !state.endpointSearch.trim();
  }

  function customHeaderEntries(row) {
    if (!isRecord(row.headers)) return [];
    return Object.entries(row.headers).map(([name, value]) => [name, String(value ?? '')]);
  }

  function replaceCustomHeaders(row, entries) {
    row.headers = Object.fromEntries(entries);
  }

  function hasHeaderName(entries, name, exceptName = '') {
    const normalizedName = name.toLowerCase();
    return entries.some(([existingName]) =>
      existingName.toLowerCase() === normalizedName &&
      existingName !== exceptName);
  }

  function nextCustomHeaderName(row) {
    const entries = customHeaderEntries(row);
    let name = DEFAULT_CUSTOM_HEADER_NAME;
    let suffix = 2;
    while (hasHeaderName(entries, name)) name = `${DEFAULT_CUSTOM_HEADER_NAME}-${suffix++}`;
    return name;
  }

  function renameCustomHeader(row, currentName, nextName) {
    replaceCustomHeaders(row, customHeaderEntries(row).map(([name, value]) =>
      name === currentName ? [nextName, value] : [name, value]));
  }

  function setCustomHeaderValue(row, headerName, value) {
    replaceCustomHeaders(row, customHeaderEntries(row).map(([name, currentValue]) =>
      name === headerName ? [name, value] : [name, currentValue]));
  }

  function removeCustomHeader(row, headerName) {
    replaceCustomHeaders(row, customHeaderEntries(row).filter(([name]) => name !== headerName));
  }

  function managedHeaderDescriptions(row) {
    const entries = customHeaderEntries(row);
    const managed = [];
    if (row.authVar && !hasHeaderName(entries, 'Authorization')) {
      managed.push(`Authorization from ${row.authVar}`);
    }
    if (row.authVar && state.sendTenantHeader && !hasHeaderName(entries, 'x-tenant-id')) {
      managed.push('x-tenant-id when TENANT_ID is available');
    }
    if (String(row.body || '').trim() && !hasHeaderName(entries, 'Content-Type')) {
      managed.push('Content-Type: application/json');
    }
    return managed;
  }

  function findHeadersPanel(rowId) {
    return [...document.querySelectorAll('.request-headers-panel')]
      .find((panel) => panel.dataset.rowId === rowId);
  }

  function focusHeadersEditor(row, selectHeaderName = '') {
    row.activePanel = ROW_PANEL.HEADERS;
    renderRows();
    save();
    window.requestAnimationFrame(() => {
      const panel = findHeadersPanel(row.id);
      if (!panel) return;
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
      const inputs = [...panel.querySelectorAll('.header-name-input')];
      const input = inputs.find((candidate) => candidate.value === selectHeaderName) || inputs[0];
      if (input) {
        input.focus({ preventScroll: true });
        if (selectHeaderName) input.select();
      } else {
        panel.querySelector('.add-header-btn')?.focus({ preventScroll: true });
      }
    });
  }

  function addCustomHeader(row) {
    const name = nextCustomHeaderName(row);
    replaceCustomHeaders(row, [...customHeaderEntries(row), [name, '']]);
    save();
    focusHeadersEditor(row, name);
  }

  function buildHeadersPanel(row) {
    const entries = customHeaderEntries(row);
    const panel = document.createElement('section');
    panel.className = 'request-panel request-headers-panel';
    panel.dataset.rowId = row.id;

    const head = document.createElement('div');
    head.className = 'panel-head headers-panel-head';
    const heading = document.createElement('div');
    heading.className = 'headers-panel-title';
    const title = document.createElement('strong');
    title.textContent = 'Request headers';
    const count = document.createElement('span');
    count.textContent = `${entries.length} custom`;
    heading.appendChild(title);
    heading.appendChild(count);

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    const addButton = document.createElement('button');
    addButton.className = 'btn primary small add-header-btn';
    addButton.type = 'button';
    addButton.textContent = '+ Add header';
    addButton.addEventListener('click', () => addCustomHeader(row));
    actions.appendChild(addButton);

    if (entries.length) {
      const clearButton = document.createElement('button');
      clearButton.className = 'btn ghost small';
      clearButton.type = 'button';
      clearButton.textContent = 'Clear all';
      clearButton.addEventListener('click', async () => {
        const confirmed = await showConfirm({
          title: 'Clear request headers',
          message: `Remove all ${entries.length} custom header${entries.length === 1 ? '' : 's'} from ${row.method} ${row.path || '/'}?`,
          okText: 'Clear headers',
        });
        if (!confirmed) return;
        row.headers = {};
        renderRows();
        save();
      });
      actions.appendChild(clearButton);
    }

    head.appendChild(heading);
    head.appendChild(actions);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'headers-editor';
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'headers-empty';
      const emptyTitle = document.createElement('strong');
      emptyTitle.textContent = 'No custom headers yet';
      const emptyText = document.createElement('span');
      emptyText.textContent = 'Add only the headers this endpoint needs. Variables such as ${TENANT_ID} are supported.';
      empty.appendChild(emptyTitle);
      empty.appendChild(emptyText);
      body.appendChild(empty);
    } else {
      const labels = document.createElement('div');
      labels.className = 'header-editor-labels';
      labels.innerHTML = '<span>Header name</span><span>Value</span><span></span>';
      body.appendChild(labels);

      entries.forEach(([initialName, initialValue]) => {
        let currentName = initialName;
        const editorRow = document.createElement('div');
        editorRow.className = 'header-editor-row';

        const nameInput = document.createElement('input');
        nameInput.className = 'header-name-input';
        nameInput.type = 'text';
        nameInput.value = currentName;
        nameInput.placeholder = 'X-Custom-Header';
        nameInput.autocomplete = 'off';
        nameInput.spellcheck = false;
        nameInput.setAttribute('aria-label', 'Header name');
        nameInput.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') nameInput.blur();
        });
        nameInput.addEventListener('change', () => {
          const nextName = nameInput.value.trim();
          const latestEntries = customHeaderEntries(row);
          if (!HEADER_NAME_PATTERN.test(nextName)) {
            nameInput.value = currentName;
            toast('Enter a valid HTTP header name');
            return;
          }
          if (hasHeaderName(latestEntries, nextName, currentName)) {
            nameInput.value = currentName;
            toast(`Header “${nextName}” already exists`);
            return;
          }
          if (nextName === currentName) return;
          renameCustomHeader(row, currentName, nextName);
          currentName = nextName;
          nameInput.value = nextName;
          save();
        });

        const valueInput = document.createElement('input');
        valueInput.className = 'header-value-input';
        valueInput.type = 'text';
        valueInput.value = initialValue;
        valueInput.placeholder = 'Value or ${VARIABLE}';
        valueInput.autocomplete = 'off';
        valueInput.spellcheck = false;
        valueInput.setAttribute('aria-label', `Value for ${initialName}`);
        valueInput.addEventListener('input', () => {
          setCustomHeaderValue(row, currentName, valueInput.value);
          saveDebounced();
        });

        const removeButton = document.createElement('button');
        removeButton.className = 'header-remove-btn';
        removeButton.type = 'button';
        removeButton.textContent = '×';
        removeButton.title = `Remove ${initialName}`;
        removeButton.setAttribute('aria-label', `Remove ${initialName} header`);
        removeButton.addEventListener('click', () => {
          removeCustomHeader(row, currentName);
          renderRows();
          save();
        });

        editorRow.appendChild(nameInput);
        editorRow.appendChild(valueInput);
        editorRow.appendChild(removeButton);
        body.appendChild(editorRow);
      });
    }
    panel.appendChild(body);

    const managed = managedHeaderDescriptions(row);
    if (managed.length) {
      const managedRow = document.createElement('div');
      managedRow.className = 'managed-headers';
      const managedLabel = document.createElement('strong');
      managedLabel.textContent = 'Added automatically';
      const managedList = document.createElement('div');
      managedList.className = 'managed-header-list';
      managed.forEach((description) => {
        const chip = document.createElement('span');
        chip.textContent = description;
        managedList.appendChild(chip);
      });
      managedRow.appendChild(managedLabel);
      managedRow.appendChild(managedList);
      panel.appendChild(managedRow);
    }

    return panel;
  }

  function buildRowEl(row) {
    const wrap = document.createElement('div');
    wrap.className = 'request-card';
    wrap.dataset.rowId = row.id;
    if (row.id === highlightedFailureRowId) wrap.classList.add('run-failure-focus');
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
    methodCell.appendChild(enhanceSelect(methodSel, {
      variant: 'method',
      label: `HTTP method for ${row.path || 'endpoint'}`,
    }));

    const pathCell = document.createElement('div');
    pathCell.className = 'request-path';
    pathCell.dataset.label = 'Path';
    const pathInput = document.createElement('input');
    pathInput.type = 'text';
    pathInput.className = 'path-input';
    pathInput.placeholder = '/admin/courses/queue';
    pathInput.value = row.path;
    pathInput.title = row.path || 'Endpoint path';
    pathInput.addEventListener('input', () => {
      row.path = pathInput.value;
      pathInput.title = row.path || 'Endpoint path';
      saveDebounced();
    });
    const pathInputWrap = document.createElement('div');
    pathInputWrap.className = 'path-input-wrap';
    const pathActions = document.createElement('div');
    pathActions.className = 'path-input-actions';
    const expandPathButton = document.createElement('button');
    expandPathButton.className = 'icon-btn endpoint-expand-btn';
    expandPathButton.type = 'button';
    expandPathButton.innerHTML = ICONS.expand;
    expandPathButton.title = 'Open full endpoint path editor';
    expandPathButton.setAttribute('aria-label', `Open full path editor for ${row.path || 'endpoint'}`);
    expandPathButton.addEventListener('click', () => openEndpointPathEditor(row, expandPathButton));
    pathInputWrap.appendChild(pathInput);
    pathActions.appendChild(expandPathButton);
    pathActions.appendChild(createCopyIconButton({
      label: 'Copy endpoint as cURL',
      copiedMessage: 'cURL copied',
      getText: () => buildCurlCommand(row),
      variant: 'endpoint-copy-btn',
    }));
    pathInputWrap.appendChild(pathActions);
    pathCell.appendChild(pathInputWrap);

    const roleCell = document.createElement('div');
    roleCell.className = 'request-meta';
    roleCell.dataset.label = 'Role';
    const roleSel = document.createElement('select');
    const roleOptions = [
      { value: 'none', label: 'None', description: 'No Authorization header' },
      ...state.tokenProfiles.map((profile) => ({
        value: profile.key,
        label: profile.label,
        description: `${profile.varName} · ${profile.scope}`,
      })),
      { value: 'custom', label: 'Custom variable', description: 'Use a custom token variable name' },
    ];
    for (const { value, label, description } of roleOptions) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      opt.dataset.description = description;
      if (value === row.role) opt.selected = true;
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
    const roleWrap = document.createElement('div');
    roleWrap.className = 'compact-field';
    roleWrap.innerHTML = '<span>Role</span>';
    roleWrap.appendChild(enhanceSelect(roleSel, {
      variant: 'role',
      label: `Authentication role for ${row.path || 'endpoint'}`,
    }));
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
    expectInput.placeholder = '2xx · strict: =201';
    expectInput.title = 'Any 2xx response is successful. Prefix a code with = for an exact check, for example =201.';
    expectInput.value = row.expect;
    expectInput.addEventListener('input', () => { row.expect = expectInput.value; saveDebounced(); });
    expectInput.addEventListener('change', () => {
      row.expect = normalizeStatusExpectation(expectInput.value);
      expectInput.value = row.expect;
      save();
    });
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
    const bodyBtn = document.createElement('button');
    bodyBtn.className = 'btn ghost small row-action endpoint-body-btn';
    const hasInspectableResult =
      row.result && row.result.state !== 'pending' && row.result.state !== 'skipped';
    const bodyIsOpen = row.activePanel === ROW_PANEL.BODY;
    bodyBtn.textContent = bodyIsOpen ? 'Hide' : 'Body';
    bodyBtn.title = bodyIsOpen ? 'Hide request body' : 'Show request body';
    bodyBtn.setAttribute('aria-expanded', String(bodyIsOpen));
    bodyBtn.addEventListener('click', () => {
      row.activePanel = bodyIsOpen ? ROW_PANEL.NONE : ROW_PANEL.BODY;
      renderRows();
      save();
    });
    const headersBtn = document.createElement('button');
    headersBtn.className = 'btn ghost small row-action endpoint-headers-btn';
    const headerCount = customHeaderEntries(row).length;
    const headersAreOpen = row.activePanel === ROW_PANEL.HEADERS;
    headersBtn.textContent = headersAreOpen ? 'Hide' : `Headers${headerCount ? ` · ${headerCount}` : ''}`;
    headersBtn.title = headersAreOpen ? 'Hide request headers' : 'View or edit request headers';
    headersBtn.setAttribute('aria-expanded', String(headersAreOpen));
    headersBtn.addEventListener('click', () => {
      if (headersAreOpen) {
        row.activePanel = ROW_PANEL.NONE;
        renderRows();
        save();
        return;
      }
      focusHeadersEditor(row);
    });
    const runOneBtn = document.createElement('button');
    runOneBtn.className = 'btn primary small row-action run-endpoint-btn';
    runOneBtn.textContent = 'Run';
    runOneBtn.title = 'Run this endpoint';
    runOneBtn.disabled = runInProgress;
    runOneBtn.addEventListener('click', () => runStaged([row], {
      resetVars: false,
      mode: RUN_MODE.SINGLE,
    }));
    const removeBtn = document.createElement('button');
    removeBtn.className = 'row-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove row';
    removeBtn.addEventListener('click', () => {
      state.rows = state.rows.filter((r) => r.id !== row.id);
      renderRows();
      save();
    });
    actionsCell.appendChild(bodyBtn);
    actionsCell.appendChild(headersBtn);
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

    if (row.activePanel !== ROW_PANEL.NONE) {
      const extra = document.createElement('div');
      extra.className = 'request-extra';

      if (row.activePanel === ROW_PANEL.HEADERS) extra.appendChild(buildHeadersPanel(row));

      if (row.activePanel === ROW_PANEL.BODY) {
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
      }

      if (row.activePanel === ROW_PANEL.RESPONSE && hasInspectableResult) {
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
    const attemptsLabel = r.attempts > 1 ? ` · ${r.attempts} attempts` : '';
    meta.textContent = `${r.status} · ${r.ms}ms${attemptsLabel}`;
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
      const retried = r.attempts > 1 ? ' ↻' : '';
      badge.textContent = `✓ ${r.status} · ${r.ms}ms${retried}`;
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

    const hasInspectableResponse = r && r.state !== 'pending' && r.state !== 'skipped';
    if (hasInspectableResponse) {
      const responseToggle = document.createElement('button');
      responseToggle.className = 'result-toggle response-panel-toggle';
      responseToggle.type = 'button';
      const responseIsOpen = row.activePanel === ROW_PANEL.RESPONSE;
      responseToggle.innerHTML = ICONS.response;
      const responseLabel = document.createElement('span');
      responseLabel.textContent = responseIsOpen ? 'Hide' : 'Response';
      responseToggle.appendChild(responseLabel);
      responseToggle.title = responseIsOpen ? 'Hide response details' : 'Show response details';
      responseToggle.setAttribute('aria-expanded', String(responseIsOpen));
      responseToggle.addEventListener('click', () => {
        row.activePanel = responseIsOpen ? ROW_PANEL.NONE : ROW_PANEL.RESPONSE;
        renderRows();
        save();
      });
      container.appendChild(responseToggle);
    }

    return container;
  }

  function updateRowResult(row) {
    if (row.activePanel !== ROW_PANEL.NONE) {
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
    syncTokenCardActions();
  }

  // ---- running (groups and rows execute sequentially, with capture between rows) --

  function assignRequestHeader(headers, name, value) {
    const existingName = Object.keys(headers)
      .find((headerName) => headerName.toLowerCase() === name.toLowerCase());
    if (existingName && existingName !== name) delete headers[existingName];
    headers[name] = value;
  }

  function requestHasHeader(headers, name) {
    return Object.keys(headers).some((headerName) => headerName.toLowerCase() === name.toLowerCase());
  }

  function buildRequestSnapshot(row) {
    const url = joinUrl(state.baseUrl, subst(row.path.trim()));
    const headers = {};
    if (row.authVar && VARS[row.authVar]) {
      assignRequestHeader(headers, 'Authorization', `Bearer ${VARS[row.authVar]}`);
    }
    for (const [header, value] of customHeaderEntries(row)) {
      assignRequestHeader(headers, header, subst(value));
    }
    if (!requestHasHeader(headers, 'x-tenant-id') && row.authVar && state.sendTenantHeader && VARS.TENANT_ID) {
      assignRequestHeader(headers, 'x-tenant-id', VARS.TENANT_ID);
    }
    const body = subst(row.body.trim());
    if (body && !requestHasHeader(headers, 'Content-Type')) {
      assignRequestHeader(headers, 'Content-Type', 'application/json');
    }
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

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  async function parseProxyResponse(response) {
    const rawBody = await response.text();
    if (!response.ok) {
      const error = new Error(`Devman API proxy returned HTTP ${response.status}${rawBody ? `: ${rawBody}` : ''}`);
      error.retryable = RETRYABLE_PROXY_STATUSES.has(response.status);
      throw error;
    }

    let output;
    try {
      output = JSON.parse(rawBody);
    } catch {
      const error = new Error('Devman API proxy returned an invalid response');
      error.retryable = true;
      throw error;
    }

    if (!isRecord(output) || typeof output.status !== 'number' || typeof output.body !== 'string') {
      const error = new Error('Devman API proxy response is missing required fields');
      error.retryable = true;
      throw error;
    }
    return output;
  }

  async function callProxy(payload) {
    const canRetry = SAFE_RETRY_METHODS.has(payload.method);
    const maxAttempts = canRetry ? PROXY_MAX_ATTEMPTS : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await fetch('/api/proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const output = await parseProxyResponse(response);
        const upstreamAttempts = Number.isInteger(output.attempts) && output.attempts > 0
          ? output.attempts
          : 1;
        return { output, attempts: upstreamAttempts + attempt - 1 };
      } catch (error) {
        const isLastAttempt = attempt === maxAttempts;
        if (isLastAttempt || error?.retryable === false) {
          const methodNote = canRetry
            ? ''
            : ` ${payload.method} was not retried because repeating it could duplicate data.`;
          const separator = errorMessage(error).endsWith('.') ? '' : '.';
          const requestError = new Error(`${errorMessage(error)}${separator}${methodNote}`.trim());
          requestError.attempts = attempt;
          throw requestError;
        }
        await wait(PROXY_RETRY_DELAY_MS * (2 ** (attempt - 1)));
      }
    }

    throw new Error('Devman API proxy request failed');
  }

  async function fireRequest(row) {
    const request = buildRequestSnapshot(row);

    try {
      const { output, attempts } = await callProxy({
        method: row.method,
        url: request.url,
        headers: request.headers,
        body: request.body || null,
      });
      return {
        status: output.status,
        ms: output.ms,
        attempts,
        reqUrl: request.url,
        reqHeaders: request.headers,
        reqBody: request.body,
        body: output.body,
      };
    } catch (e) {
      return {
        status: 0,
        ms: 0,
        attempts: Number.isInteger(e?.attempts) ? e.attempts : 1,
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
      row.result = completedResult('pass', fetched);
      renderVarsPanel();
      return 'pass';
    }

    const softList = row.softFailIfContains || [];
    const softHit = softList.length > 0 && softList.every((needle) => fetched.body.includes(needle));
    if (softHit) {
      row.result = completedResult('bug', fetched);
      return 'bug';
    }

    row.result = completedResult(status === 0 ? 'error' : 'fail', fetched);
    return row.continueOnFail ? 'fail-continue' : 'hardfail';
  }

  function completedResult(resultState, fetched) {
    return {
      state: resultState,
      status: fetched.status,
      ms: fetched.ms,
      attempts: fetched.attempts,
      reqUrl: fetched.reqUrl,
      reqHeaders: fetched.reqHeaders,
      reqBody: fetched.reqBody,
      respBody: fetched.body,
    };
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
    const setLabel = (button, label) => {
      const labelElement = button?.querySelector('span');
      if (labelElement) labelElement.textContent = label;
    };
    const runAllButton = el('runAllBtn');
    if (runAllButton) {
      runAllButton.disabled = runInProgress || !state.rows.length;
      runAllButton.textContent = runInProgress ? 'Running…' : 'Run all';
    }
    document.querySelectorAll('.run-group-btn').forEach((button) => {
      const laneId = button.closest('.stage-lane')?.dataset.laneId;
      const hasRows = state.rows.some((row) => row.laneId === laneId);
      const isActive = runInProgress && activeRunLaneId === laneId;
      button.disabled = runInProgress || !hasRows;
      setLabel(button, isActive ? 'Running…' : 'Run');
    });
    document.querySelectorAll('.run-selected-groups-btn').forEach((button) => {
      const hasSelectedRows = rowsForLaneIds(selectedLaneIds).length > 0;
      button.disabled = runInProgress || !hasSelectedRows;
      setLabel(button, runInProgress ? 'Running…' : 'Run selected');
    });
    document.querySelectorAll([
      '.run-endpoint-btn',
      '.lane-mutation-btn',
      '.group-selection-mutation-btn',
      '.lane-select-toggle',
      '.lane-remove',
    ].join(',')).forEach((button) => {
      button.disabled = runInProgress;
    });
    syncTokenCardActions();
    el('rowsList')?.setAttribute('aria-busy', String(runInProgress));
  }

  function activateRunLane(laneId) {
    activeRunLaneId = laneId;
    laneMetaFor(laneId).collapsed = false;
    renderRows();
    syncRunControls();
    const activeLane = [...document.querySelectorAll('.stage-lane')]
      .find((lane) => lane.dataset.laneId === laneId);
    if (activeLane) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      activeLane.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  async function runStaged(rows, { resetVars, mode }) {
    if (runInProgress) {
      toast('Wait for the current run to finish');
      return;
    }
    if (!rows.length) {
      toast('This selection does not contain any endpoints');
      return;
    }

    runInProgress = true;
    const isGroupRun = mode === RUN_MODE.ALL || mode === RUN_MODE.GROUPS;
    if (isGroupRun) {
      hideRunFailureAlert();
      clearFailureHighlight();
      if (state.endpointSearch) {
        state.endpointSearch = '';
        syncEndpointSearchControls();
      }
    }
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

        if (isGroupRun && laneRows[0]?.laneId) {
          activateRunLane(laneRows[0].laneId);
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
          if (isGroupRun && (outcome === 'hardfail' || outcome === 'fail-continue')) {
            revealRunFailure(row, outcome);
          }
          if (outcome === 'hardfail') stopped = true;
        }
      }
    } finally {
      activeRunLaneId = null;
      document.querySelectorAll('.stage-lane.is-run-active').forEach((lane) => {
        lane.classList.remove('is-run-active');
      });
      runInProgress = false;
      syncRunControls();
      if (isGroupRun) save();
    }
  }

  // ---- report ----------------------------------------------------------------

  function buildReportMarkdown() {
    const lines = [];
    const name = el('suiteName').value || DEFAULT_PROJECT_NAME;
    lines.push(`# Devman API run — ${name}`);
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
      lines.push(`### ${laneDisplayName(laneId, idx)}`);
      lines.push('');
      for (const row of laneRows) {
        const r = row.result;
        const tag = !r ? 'NOT RUN' : r.state.toUpperCase();
        lines.push(`#### [${tag}] ${row.method} ${row.path}`);
        lines.push('');
        if (row.note) lines.push(`_${row.note}_\n`);
        if (r && r.reqUrl) {
          const attempts = r.attempts > 1 ? `, ${r.attempts} attempts` : '';
          lines.push(`\`${row.method} ${r.reqUrl}\` — status: ${r.status}, ${r.ms}ms${attempts}`);
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
    const rawName = el('suiteName').value || DEFAULT_PROJECT_NAME;
    const name = rawName.replace(/[^a-zA-Z0-9_-]/g, '') || DEFAULT_PROJECT_NAME;
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

  function jsonImportEndpointCount(parsed) {
    if (!isRecord(parsed)) return 0;
    if (Array.isArray(parsed.rows)) return parsed.rows.length;
    if (!Array.isArray(parsed.steps)) return 0;
    return parsed.steps.reduce((count, step) => {
      if (!isRecord(step)) return count;
      const values = isRecord(step.foreach) && Array.isArray(step.foreach.values)
        ? step.foreach.values.length
        : 1;
      return count + values;
    }, 0);
  }

  function captureWorkspaceForAppend() {
    return {
      baseUrl: state.baseUrl,
      tenantId: state.tenantId,
      sendTenantHeader: state.sendTenantHeader,
      tokens: { ...state.tokens },
      tokenProfiles: state.tokenProfiles.map((profile) => ({ ...profile })),
      suiteStaticVars: { ...suiteStaticVars },
      laneMeta: normalizeLaneMeta(state.laneMeta, state.laneOrder),
    };
  }

  function restoreConfigurationAfterAppend(current, importedRows) {
    const importedProfiles = state.tokenProfiles.map((profile) => ({ ...profile }));
    const importedTokens = { ...state.tokens };
    const importedStaticVars = { ...suiteStaticVars };
    const mergedProfiles = current.tokenProfiles.map((profile) => ({ ...profile }));
    const importedRoleMap = new Map();

    importedProfiles.forEach((profile) => {
      let target = mergedProfiles.find((candidate) => candidate.varName === profile.varName);
      if (!target) {
        const usedKeys = new Set(mergedProfiles.map((candidate) => candidate.key));
        let key = profile.key;
        let suffix = 2;
        while (usedKeys.has(key)) key = `${profile.key}_${suffix++}`;
        target = { ...profile, key };
        mergedProfiles.push(target);
      }
      importedRoleMap.set(profile.key, target.key);
    });

    const mergedTokens = Object.fromEntries(mergedProfiles.map((profile) => {
      const currentProfile = current.tokenProfiles.find((candidate) =>
        candidate.varName === profile.varName);
      const importedProfile = importedProfiles.find((candidate) =>
        importedRoleMap.get(candidate.key) === profile.key);
      const currentToken = currentProfile ? current.tokens[currentProfile.key] : '';
      const importedToken = importedProfile ? importedTokens[importedProfile.key] : '';
      return [profile.key, currentToken || importedToken || ''];
    }));

    importedRows.forEach((row) => {
      if (importedRoleMap.has(row.role)) row.role = importedRoleMap.get(row.role);
    });
    state.baseUrl = current.baseUrl;
    state.tenantId = current.tenantId;
    state.sendTenantHeader = current.sendTenantHeader;
    state.tokenProfiles = mergedProfiles;
    state.tokens = mergedTokens;
    state.laneMeta = current.laneMeta;
    suiteStaticVars = { ...importedStaticVars, ...current.suiteStaticVars };
  }

  function appendImportedWorkspace({ rows, laneOrder, laneMeta }) {
    const sourceLaneIds = [];
    const rememberLane = (laneId) => {
      if (typeof laneId === 'string' && laneId && !sourceLaneIds.includes(laneId)) sourceLaneIds.push(laneId);
    };
    laneOrder.forEach(rememberLane);
    rows.forEach((row) => rememberLane(row.laneId));

    const laneIdMap = new Map(sourceLaneIds.map((sourceLaneId) => {
      const meta = isRecord(laneMeta[sourceLaneId]) ? laneMeta[sourceLaneId] : {};
      const newId = newLaneId({
        name: typeof meta.name === 'string' ? meta.name : '',
        collapsed: typeof meta.collapsed === 'boolean' ? meta.collapsed : true,
      });
      return [sourceLaneId, newId];
    }));
    const fallbackLaneId = laneIdMap.values().next().value || newLaneId({ collapsed: true });
    if (!sourceLaneIds.length) sourceLaneIds.push('__imported__');
    const appendedLaneIds = sourceLaneIds.map((sourceLaneId) =>
      laneIdMap.get(sourceLaneId) || fallbackLaneId);
    const appendedRows = rows.map((row) =>
      cloneRowForLane(row, laneIdMap.get(row.laneId) || fallbackLaneId));

    state.laneOrder.push(...appendedLaneIds);
    state.rows.push(...appendedRows);
    return appendedRows.length;
  }

  async function importFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const importedEndpointCount = jsonImportEndpointCount(parsed);
      const existingEndpointCount = state.rows.filter((row) => String(row.path || '').trim()).length;
      let importAction = JSON_IMPORT_ACTION.REPLACE;
      if (existingEndpointCount && importedEndpointCount) {
        importAction = await showJsonImportChoice({
          existingCount: existingEndpointCount,
          importedCount: importedEndpointCount,
        });
        if (!importAction) {
          toast('JSON import cancelled');
          return;
        }
      }

      const appendSnapshot = importAction === JSON_IMPORT_ACTION.APPEND
        ? captureWorkspaceForAppend()
        : null;
      const isSuite = Array.isArray(parsed.steps);
      const { rows, laneOrder, laneMeta, importedTokenCount, tokensOnly } = importParsedJson(parsed);
      let importedRowCount = rows.length;
      if (appendSnapshot && !tokensOnly) {
        restoreConfigurationAfterAppend(appendSnapshot, rows);
        importedRowCount = appendImportedWorkspace({ rows, laneOrder, laneMeta });
      } else {
        state.rows = rows;
        state.laneOrder = laneOrder;
        state.laneMeta = normalizeLaneMeta(laneMeta, laneOrder);
      }
      if (!tokensOnly) selectedLaneIds.clear();
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
          ? `${importAction === JSON_IMPORT_ACTION.APPEND ? 'Added' : 'Imported'} suite (${importedRowCount} steps${tokenSummary})`
          : `${importAction === JSON_IMPORT_ACTION.APPEND ? 'Added' : 'Imported'} ${importedRowCount} rows${tokenSummary}`);
      }
    } catch (err) {
      toast(`Import failed: ${err}`);
    }
  }

  function populateSwaggerAuthProfiles() {
    const select = el('swaggerAuthProfile');
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = '';

    const noTokenOption = document.createElement('option');
    noTokenOption.value = 'none';
    noTokenOption.textContent = 'No token (leave unassigned)';
    noTokenOption.dataset.description = 'Secured endpoints will not receive an Authorization header';
    select.appendChild(noTokenOption);

    state.tokenProfiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.key;
      option.textContent = profile.label;
      option.dataset.description = `${profile.varName} · ${profile.scope}`;
      select.appendChild(option);
    });

    const preferredValue = previousValue || 'none';
    select.value = [...select.options].some((option) => option.value === preferredValue)
      ? preferredValue
      : 'none';
    refreshSharedSelect(select);
  }

  function isSwaggerImportPayload(value) {
    return isRecord(value) && Array.isArray(value.operations) &&
      value.operations.every((operation) => isRecord(operation) &&
        typeof operation.method === 'string' && typeof operation.path === 'string');
  }

  function swaggerOperationToRow(operation, laneId, authProfile) {
    const isSecured = operation.secured === true;
    const tags = Array.isArray(operation.tags) ? operation.tags.map(String).filter(Boolean) : [];
    const summary = typeof operation.summary === 'string' ? operation.summary.trim() : '';
    const noteParts = [summary, tags.length ? `Tags: ${tags.join(', ')}` : ''].filter(Boolean);
    return emptyRow({
      laneId,
      method: operation.method.toUpperCase(),
      path: operation.path,
      role: isSecured && authProfile ? authProfile.key : 'none',
      authVar: isSecured && authProfile ? authProfile.varName : '',
      headers: isRecord(operation.headers) ? operation.headers : {},
      body: typeof operation.body === 'string' ? operation.body : '',
      expect: typeof operation.expect === 'string' ? operation.expect : '',
      note: noteParts.join(' · '),
    });
  }

  function swaggerGroupName(operation) {
    if (typeof operation.group === 'string' && operation.group.trim()) return operation.group.trim();
    const primaryTag = Array.isArray(operation.tags)
      ? operation.tags.map(String).find((tag) => tag.trim())
      : '';
    return primaryTag?.trim() || 'Other';
  }

  function bindSwaggerImport() {
    const trigger = el('swaggerImportBtn');
    const modal = el('swaggerImportModal');
    const form = el('swaggerImportForm');
    const urlInput = el('swaggerUrl');
    const closeButton = el('swaggerImportClose');
    const cancelButton = el('swaggerImportCancel');
    const submitButton = el('swaggerImportSubmit');
    const feedback = el('swaggerImportFeedback');
    if (!trigger || !modal || !form || !urlInput || !closeButton || !cancelButton || !submitButton || !feedback) return;

    let controller = null;
    const defaultFeedback = 'Supports OpenAPI 3.x, Swagger 2.0, JSON, YAML, and embedded Swagger UI documents.';

    const setFeedback = (message, stateName = '') => {
      feedback.textContent = message;
      feedback.classList.toggle('is-loading', stateName === 'loading');
      feedback.classList.toggle('has-error', stateName === 'error');
    };

    const setLoading = (loading) => {
      submitButton.disabled = loading;
      urlInput.disabled = loading;
      el('swaggerImportMode').disabled = loading;
      el('swaggerAuthProfile').disabled = loading;
      el('swaggerSetBaseUrl').disabled = loading;
      refreshSharedSelect(el('swaggerImportMode'));
      refreshSharedSelect(el('swaggerAuthProfile'));
      submitButton.classList.toggle('swagger-import-submit-loading', loading);
      submitButton.textContent = loading ? 'Discovering API…' : 'Import endpoints';
    };

    const close = () => {
      controller?.abort();
      controller = null;
      setLoading(false);
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKeydown);
      trigger.focus({ preventScroll: true });
    };

    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
    };

    trigger.addEventListener('click', () => {
      populateSwaggerAuthProfiles();
      setFeedback(defaultFeedback);
      modal.hidden = false;
      document.body.classList.add('modal-open');
      document.addEventListener('keydown', onKeydown);
      window.requestAnimationFrame(() => urlInput.focus());
    });
    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) close();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const rawUrl = urlInput.value.trim();
      try {
        const parsedUrl = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Use an HTTP or HTTPS URL');
      } catch (error) {
        setFeedback(error instanceof Error && error.message !== 'Invalid URL'
          ? error.message
          : 'Enter a complete Swagger URL, including https://', 'error');
        urlInput.focus();
        return;
      }

      controller = new AbortController();
      setLoading(true);
      setFeedback('Finding the OpenAPI document and preparing endpoint rows…', 'loading');
      try {
        const response = await fetch('/api/swagger-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUrl }),
          signal: controller.signal,
        });
        const rawResponse = await response.text();
        let imported;
        try {
          imported = JSON.parse(rawResponse);
        } catch {
          throw new Error(`Import service returned an invalid response (HTTP ${response.status})`);
        }
        if (!response.ok || !isSwaggerImportPayload(imported)) {
          const message = isRecord(imported) && typeof imported.error === 'string'
            ? imported.error
            : 'The URL did not return a supported OpenAPI document';
          throw new Error(message);
        }

        const mode = el('swaggerImportMode').value;
        const selectedProfileKey = el('swaggerAuthProfile').value;
        const authProfile = selectedProfileKey === 'none'
          ? null
          : state.tokenProfiles.find((profile) => profile.key === selectedProfileKey) || null;
        const existingKeys = new Set(mode === SWAGGER_IMPORT_MODE.APPEND
          ? state.rows.map((row) => `${row.method.toUpperCase()} ${row.path}`)
          : []);
        if (mode === SWAGGER_IMPORT_MODE.REPLACE) state.laneMeta = {};
        const importedLaneOrder = [];
        const laneByGroupName = new Map();
        if (mode === SWAGGER_IMPORT_MODE.APPEND) {
          state.laneOrder.forEach((laneId, index) => {
            laneByGroupName.set(laneDisplayName(laneId, index).toLocaleLowerCase(), laneId);
          });
        }
        const importedRows = [];
        const touchedLaneIds = new Set();
        let skippedCount = 0;
        imported.operations.forEach((operation) => {
          const key = `${operation.method.toUpperCase()} ${operation.path}`;
          if (existingKeys.has(key)) {
            skippedCount += 1;
            return;
          }
          existingKeys.add(key);
          const groupName = swaggerGroupName(operation);
          const groupKey = groupName.toLocaleLowerCase();
          let laneId = laneByGroupName.get(groupKey);
          if (!laneId) {
            laneId = newLaneId({ name: groupName, collapsed: true });
            laneByGroupName.set(groupKey, laneId);
            importedLaneOrder.push(laneId);
          }
          laneMetaFor(laneId).collapsed = true;
          touchedLaneIds.add(laneId);
          importedRows.push(swaggerOperationToRow(operation, laneId, authProfile));
        });

        if (mode === SWAGGER_IMPORT_MODE.REPLACE) {
          selectedLaneIds.clear();
          state.rows = importedRows;
          state.laneOrder = importedLaneOrder;
          state.laneMeta = normalizeLaneMeta(state.laneMeta, state.laneOrder);
          state.endpointSearch = '';
          syncEndpointSearchControls();
        } else {
          state.rows.push(...importedRows);
          state.laneOrder.push(...importedLaneOrder);
        }
        if (el('swaggerSetBaseUrl').checked && typeof imported.baseUrl === 'string' && imported.baseUrl) {
          state.baseUrl = imported.baseUrl;
          syncConnectionInputs();
        }

        seedVars(true);
        save();
        close();
        renderRows();
        const skippedSummary = skippedCount ? ` · ${skippedCount} duplicate${skippedCount === 1 ? '' : 's'} skipped` : '';
        const groupSummary = touchedLaneIds.size
          ? ` in ${touchedLaneIds.size} group${touchedLaneIds.size === 1 ? '' : 's'}`
          : '';
        toast(`Imported ${importedRows.length} endpoint${importedRows.length === 1 ? '' : 's'}${groupSummary} from ${imported.title || 'Swagger'}${skippedSummary}`);
      } catch (error) {
        if (error?.name === 'AbortError') return;
        controller = null;
        setLoading(false);
        setFeedback(error instanceof Error ? error.message : String(error), 'error');
      }
    });
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
    const pasteBox = el('pasteBox');
    const parseButton = el('parseBtn');

    const syncRouteComposer = () => {
      const analysis = analyzeRoutesText(pasteBox.value);
      const count = el('routeComposerCount');
      const feedback = el('routeComposerFeedback');
      const hasInput = pasteBox.value.trim().length > 0;
      const hasIssues = analysis.issues.length > 0;
      const endpointLabel = `endpoint${analysis.routes.length === 1 ? '' : 's'}`;

      count.classList.toggle('is-ready', analysis.routes.length > 0 && !hasIssues);
      count.classList.toggle('has-error', hasIssues);
      count.textContent = !hasInput
        ? 'Waiting for input'
        : hasIssues
          ? `${analysis.issues.length} issue${analysis.issues.length === 1 ? '' : 's'}`
          : `${analysis.routes.length} ${endpointLabel} ready`;

      if (!hasInput) {
        feedback.textContent = 'Paste endpoints to validate them.';
      } else if (hasIssues) {
        const issue = analysis.issues[0];
        const extraIssues = analysis.issues.length > 1 ? ` · +${analysis.issues.length - 1} more` : '';
        feedback.textContent = `Line ${issue.line}: ${issue.message}${extraIssues}`;
      } else {
        const methodCounts = new Map();
        analysis.routes.forEach(({ method }) => methodCounts.set(method, (methodCounts.get(method) || 0) + 1));
        const summary = [...methodCounts.entries()].map(([method, methodCount]) => `${methodCount} ${method}`).join(' · ');
        feedback.textContent = `${analysis.routes.length} ${endpointLabel} ready${summary ? ` · ${summary}` : ''}`;
      }

      feedback.classList.toggle('has-error', hasIssues);
      pasteBox.setAttribute('aria-invalid', String(hasIssues));
      parseButton.disabled = !analysis.routes.length || hasIssues;
      parseButton.textContent = analysis.routes.length && !hasIssues
        ? `Add ${analysis.routes.length} ${endpointLabel}`
        : 'Add endpoints';

      pasteBox.style.height = 'auto';
      pasteBox.style.height = `${Math.min(Math.max(pasteBox.scrollHeight, 112), 240)}px`;
      return analysis;
    };

    pasteBox.addEventListener('input', syncRouteComposer);
    pasteBox.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      if (!parseButton.disabled) parseButton.click();
    });
    syncRouteComposer();
    if (searchInput) {
      syncEndpointSearchControls();
      searchInput.addEventListener('input', (event) => {
        state.endpointSearch = event.target.value;
        syncEndpointSearchControls();
        renderRows();
        saveDebounced();
      });
    }
    if (clearSearchBtn) {
      clearSearchBtn.addEventListener('click', () => {
        state.endpointSearch = '';
        syncEndpointSearchControls();
        renderRows();
        save();
        searchInput?.focus();
      });
    }

    parseButton.addEventListener('click', () => {
      const analysis = syncRouteComposer();
      const parsed = analysis.routes;
      if (analysis.issues.length) return;
      if (!parsed.length) return;
      const laneId = lastLaneId();
      for (const p of parsed) state.rows.push(emptyRow({ ...p, laneId }));
      laneMetaFor(laneId).collapsed = false;
      pasteBox.value = '';
      syncRouteComposer();
      renderRows();
      save();
      toast(`Added ${parsed.length} endpoint${parsed.length === 1 ? '' : 's'}`);
    });

    const addEmpty = () => {
      const laneId = lastLaneId();
      state.rows.push(emptyRow({ laneId }));
      laneMetaFor(laneId).collapsed = false;
      renderRows();
      save();
    };
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
      laneMetaFor(laneId).collapsed = false;
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
      selectedLaneIds.clear();
      state.laneMeta = {};
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
        laneMeta: state.laneMeta,
        rows: state.rows.map(({ result, ...rest }) => rest),
      };
      downloadJson(`${el('suiteName').value || DEFAULT_PROJECT_NAME}.json`, data);
      toast('JSON exported with token values — store it securely');
    });

    el('templateBtn').addEventListener('click', () => {
      downloadJson('devman-api-suite-template.json', DEFAULT_TEMPLATE);
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
    el('runAllBtn').addEventListener('click', () => runStaged(state.rows, {
      resetVars: true,
      mode: RUN_MODE.ALL,
    }));
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
    enhanceSelect(el('swaggerImportMode'), {
      variant: 'workspace-action',
      label: 'Swagger workspace action',
    });
    enhanceSelect(el('swaggerAuthProfile'), {
      variant: 'auth-profile',
      label: 'Token for secured Swagger endpoints',
    });
    bindConnectionInputs();
    bindEndpointControls();
    bindSwaggerImport();
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
