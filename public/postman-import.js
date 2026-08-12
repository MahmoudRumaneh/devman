(function exposePostmanImport(root, factory) {
  'use strict';

  const postmanImport = factory();
  if (typeof module === 'object' && module.exports) module.exports = postmanImport;
  if (root) root.DevmanPostmanImport = postmanImport;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  const POSTMAN_VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function isPostmanCollection(value) {
    if (!isRecord(value) || !isRecord(value.info) || !Array.isArray(value.item)) return false;
    const schema = typeof value.info.schema === 'string' ? value.info.schema : '';
    return /schema\.getpostman\.com\/json\/collection\/v2/i.test(schema) ||
      typeof value.info._postman_id === 'string';
  }

  function normalizeRequest(value) {
    if (isRecord(value)) return value;
    return typeof value === 'string' && value.trim()
      ? { method: 'GET', url: value.trim() }
      : null;
  }

  function variableName(value) {
    const normalized = String(value || '')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
    if (!normalized) return 'VALUE';
    return /^[A-Z_]/.test(normalized) ? normalized : `VALUE_${normalized}`;
  }

  function importedVariables(collection) {
    const values = {};
    const names = new Map();
    const variables = Array.isArray(collection.variable) ? collection.variable : [];
    variables.forEach((entry) => {
      if (!isRecord(entry) || entry.disabled === true || typeof entry.key !== 'string' || !entry.key.trim()) return;
      const name = variableName(entry.key);
      names.set(entry.key.trim(), name);
      if (entry.value !== undefined && entry.value !== null) values[name] = String(entry.value);
    });
    return { names, values };
  }

  function replaceVariables(value, variableNames) {
    return String(value ?? '').replace(POSTMAN_VARIABLE_PATTERN, (match, rawName) =>
      `\${${variableNames.get(rawName.trim()) || variableName(rawName)}}`);
  }

  function rawRequestUrl(url) {
    if (typeof url === 'string') return url;
    if (!isRecord(url)) return '';
    if (typeof url.raw === 'string') {
      let raw = url.raw;
      if (Array.isArray(url.variable)) {
        url.variable.forEach((entry) => {
          if (!isRecord(entry) || typeof entry.key !== 'string') return;
          raw = raw.split(`:${entry.key}`).join(`{{${entry.key}}}`);
        });
      }
      if (!Array.isArray(url.query)) return raw;
      const base = raw.split('?')[0];
      const query = url.query
        .filter((entry) => isRecord(entry) && entry.disabled !== true && typeof entry.key === 'string')
        .map((entry) => `${entry.key}=${String(entry.value ?? '')}`)
        .join('&');
      return `${base}${query ? `?${query}` : ''}`;
    }

    const protocol = typeof url.protocol === 'string' ? `${url.protocol}://` : '';
    const host = Array.isArray(url.host) ? url.host.join('.') : String(url.host || '');
    const path = Array.isArray(url.path) ? `/${url.path.join('/')}` : String(url.path || '');
    const query = Array.isArray(url.query)
      ? url.query
        .filter((entry) => isRecord(entry) && entry.disabled !== true && typeof entry.key === 'string')
        .map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(String(entry.value ?? ''))}`)
        .join('&')
      : '';
    return `${protocol}${host}${path}${query ? `?${query}` : ''}`;
  }

  function baseUrlVariable(collection, variables) {
    const entries = Array.isArray(collection.variable) ? collection.variable : [];
    return entries.find((entry) => {
      if (!isRecord(entry) || entry.disabled === true || typeof entry.key !== 'string') return false;
      if (!/^(?:base[_-]?url|api[_-]?url|host)$/i.test(entry.key.trim())) return false;
      const value = variables.values[variables.names.get(entry.key.trim())];
      return typeof value === 'string' && /^https?:\/\//i.test(value);
    }) || null;
  }

  function normalizeRequestPath(rawUrl, variables, baseVariable) {
    let path = rawUrl.trim();
    if (baseVariable) {
      const keyPattern = `{{${baseVariable.key}}}`;
      const baseValue = String(baseVariable.value || '').replace(/\/+$/, '');
      if (path.startsWith(keyPattern)) path = path.slice(keyPattern.length) || '/';
      else if (baseValue && path.startsWith(baseValue)) path = path.slice(baseValue.length) || '/';
    }
    return replaceVariables(path, variables.names);
  }

  function addRequestUrlVariables(url, variables) {
    if (!isRecord(url) || !Array.isArray(url.variable)) return;
    url.variable.forEach((entry) => {
      if (!isRecord(entry) || typeof entry.key !== 'string' || !entry.key.trim()) return;
      const name = variableName(entry.key);
      variables.names.set(entry.key.trim(), name);
      if (entry.value !== undefined && entry.value !== null && variables.values[name] === undefined) {
        variables.values[name] = String(entry.value);
      }
    });
  }

  function inheritedOrExplicitAuth(rawAuth, inheritedAuth) {
    return !isRecord(rawAuth) || rawAuth.type === 'inherit' ? inheritedAuth : rawAuth;
  }

  function headerEntries(rawHeaders, variableNames) {
    return (Array.isArray(rawHeaders) ? rawHeaders : [])
      .filter((entry) => isRecord(entry) && entry.disabled !== true && typeof entry.key === 'string' && entry.key.trim())
      .filter((entry) => entry.key.toLowerCase() !== 'content-length')
      .map((entry) => [entry.key.trim(), replaceVariables(entry.value, variableNames)]);
  }

  function setHeader(headers, name, value) {
    const existingName = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (existingName) delete headers[existingName];
    headers[name] = value;
  }

  function authValues(auth, type) {
    if (!isRecord(auth) || !Array.isArray(auth[type])) return {};
    return Object.fromEntries(auth[type]
      .filter((entry) => isRecord(entry) && typeof entry.key === 'string')
      .map((entry) => [entry.key, String(entry.value ?? '')]));
  }

  function bearerVariableName(rawToken, variableNames) {
    const match = String(rawToken || '').match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
    let name = match ? variableNames.get(match[1].trim()) || variableName(match[1]) : 'POSTMAN_BEARER_TOKEN';
    if (name === 'TOKEN') name = 'API_TOKEN';
    else if (!name.endsWith('_TOKEN')) name = `${name}_TOKEN`;
    return name;
  }

  function applyAuth(rawAuth, headers, path, variables, tokens) {
    if (!isRecord(rawAuth) || rawAuth.type === 'noauth') return { path, authVar: '' };
    if (rawAuth.type === 'bearer') {
      const rawToken = authValues(rawAuth, 'bearer').token || '';
      if (!rawToken) return { path, authVar: '' };
      const authVar = bearerVariableName(rawToken, variables.names);
      const variableMatch = rawToken.match(/^\{\{\s*([^{}]+?)\s*\}\}$/);
      const sourceName = variableMatch
        ? variables.names.get(variableMatch[1].trim()) || variableName(variableMatch[1])
        : '';
      tokens[authVar] = sourceName && variables.values[sourceName] !== undefined
        ? variables.values[sourceName]
        : variableMatch ? '' : rawToken;
      return { path, authVar };
    }
    if (rawAuth.type === 'apikey') {
      const values = authValues(rawAuth, 'apikey');
      const key = replaceVariables(values.key || '', variables.names);
      const value = replaceVariables(values.value || '', variables.names);
      if (values.in === 'query' && key) {
        return { path: `${path}${path.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${value}`, authVar: '' };
      }
      if (key) setHeader(headers, key, value);
    }
    return { path, authVar: '' };
  }

  function inferRawContentType(body) {
    const language = isRecord(body.options) && isRecord(body.options.raw)
      ? String(body.options.raw.language || '').toLowerCase()
      : '';
    return {
      json: 'application/json',
      xml: 'application/xml',
      html: 'text/html',
      javascript: 'application/javascript',
      text: 'text/plain',
    }[language] || '';
  }

  function encodedFormBody(entries, variableNames) {
    return (Array.isArray(entries) ? entries : [])
      .filter((entry) => isRecord(entry) && entry.disabled !== true && typeof entry.key === 'string')
      .map((entry) => {
        const name = encodeURIComponent(entry.key);
        const value = encodeURIComponent(replaceVariables(entry.value, variableNames))
          .replace(/%24%7B([A-Z_][A-Z0-9_]*)%7D/g, '${$1}');
        return `${name}=${value}`;
      })
      .join('&');
  }

  function fileMetadata(source) {
    const rawPath = Array.isArray(source) ? source[0] : source;
    const name = String(rawPath || '').split(/[\\/]/).filter(Boolean).pop() || 'upload.bin';
    return { name, type: '', size: 0 };
  }

  function bodyConfiguration(rawBody, headers, variableNames) {
    if (!isRecord(rawBody) || rawBody.disabled === true) return {};
    if (rawBody.mode === 'raw') {
      const contentType = inferRawContentType(rawBody);
      if (contentType && !Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
        setHeader(headers, 'Content-Type', contentType);
      }
      return { body: replaceVariables(rawBody.raw, variableNames) };
    }
    if (rawBody.mode === 'urlencoded') {
      setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
      return { body: encodedFormBody(rawBody.urlencoded, variableNames) };
    }
    if (rawBody.mode === 'formdata') {
      const formData = (Array.isArray(rawBody.formdata) ? rawBody.formdata : [])
        .filter((entry) => isRecord(entry) && entry.disabled !== true && typeof entry.key === 'string')
        .map((entry) => entry.type === 'file'
          ? { name: entry.key, kind: 'file', value: '', file: fileMetadata(entry.src) }
          : { name: entry.key, kind: 'text', value: replaceVariables(entry.value, variableNames), file: null });
      return { bodyMode: 'multipart', formData };
    }
    if (rawBody.mode === 'file') {
      return { bodyMode: 'binary', binaryFile: fileMetadata(rawBody.file?.src) };
    }
    if (rawBody.mode === 'graphql' && isRecord(rawBody.graphql)) {
      setHeader(headers, 'Content-Type', 'application/json');
      let variables = replaceVariables(rawBody.graphql.variables || '{}', variableNames);
      try { variables = JSON.parse(variables); } catch { /* Preserve malformed Postman input for editing. */ }
      return { body: JSON.stringify({ query: replaceVariables(rawBody.graphql.query, variableNames), variables }, null, 2) };
    }
    return {};
  }

  function countPostmanRequests(collection) {
    if (!isPostmanCollection(collection)) return 0;
    const countItems = (items) => (Array.isArray(items) ? items : []).reduce((count, item) => {
      if (!isRecord(item)) return count;
      return count + (normalizeRequest(item.request) ? 1 : 0) + countItems(item.item);
    }, 0);
    return countItems(collection.item);
  }

  function postmanCollectionToSuite(collection) {
    if (!isPostmanCollection(collection)) throw new Error('The JSON is not a supported Postman Collection v2.0 or v2.1 file');
    const variables = importedVariables(collection);
    const baseVariable = baseUrlVariable(collection, variables);
    const baseUrl = baseVariable ? String(baseVariable.value).replace(/\/+$/, '') : '';
    if (baseVariable) delete variables.values[variables.names.get(baseVariable.key)];
    const tokens = {};
    const steps = [];
    const groupStages = new Map();

    const stageFor = (groupName) => {
      if (!groupStages.has(groupName)) groupStages.set(groupName, (groupStages.size + 1) * 10);
      return groupStages.get(groupName);
    };
    const visit = (items, folderPath = [], inheritedAuth = collection.auth) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (!isRecord(item)) return;
        const nextPath = typeof item.name === 'string' && item.name.trim()
          ? [...folderPath, item.name.trim()]
          : folderPath;
        if (Array.isArray(item.item)) {
          visit(item.item, nextPath, inheritedOrExplicitAuth(item.auth, inheritedAuth));
          return;
        }
        const request = normalizeRequest(item.request);
        if (!request) return;
        const method = String(request.method || 'GET').toUpperCase();
        if (!HTTP_METHODS.has(method)) return;
        const groupName = folderPath.join(' / ') || String(collection.info.name || 'Postman Collection');
        const headers = Object.fromEntries(headerEntries(request.header, variables.names));
        addRequestUrlVariables(request.url, variables);
        let path = normalizeRequestPath(rawRequestUrl(request.url), variables, baseVariable);
        const auth = applyAuth(
          inheritedOrExplicitAuth(request.auth, inheritedAuth),
          headers,
          path,
          variables,
          tokens,
        );
        path = auth.path;
        const body = bodyConfiguration(request.body, headers, variables.names);
        steps.push({
          name: String(item.name || `${method} ${path}`),
          goal: groupName,
          stage: stageFor(groupName),
          method,
          path,
          headers,
          auth_var: auth.authVar,
          expect_status: '2xx',
          ...body,
        });
      });
    };
    visit(collection.item);

    if (!steps.length) throw new Error('The Postman collection does not contain any supported HTTP requests');
    return { base_url: baseUrl, vars: variables.values, tokens, steps };
  }

  return { countPostmanRequests, isPostmanCollection, postmanCollectionToSuite };
}));
