'use strict';

const YAML = require('yaml');
const { fetchWithNetworkRetry } = require('./fetch-retry');
const { validateProxyUrl } = require('./proxy-security');

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
const JSON_MEDIA_TYPE_PATTERN = /(^application\/json$|\+json$)/i;
const MAX_DOCUMENT_BYTES = 8_000_000;
const MAX_DISCOVERY_REQUESTS = 10;
const MAX_REDIRECTS = 5;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOpenApiDocument(value) {
  return isRecord(value) && isRecord(value.paths) &&
    (typeof value.openapi === 'string' || typeof value.swagger === 'string');
}

function parseDocumentText(text) {
  try {
    const parsed = JSON.parse(text);
    return isOpenApiDocument(parsed) ? parsed : null;
  } catch {
    // OpenAPI documents are also commonly published as YAML.
  }

  try {
    const parsed = YAML.parse(text);
    return isOpenApiDocument(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractBalancedObject(text, startIndex) {
  const objectStart = text.indexOf('{', startIndex);
  if (objectStart < 0) return null;

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = objectStart; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(objectStart, index + 1);
    }
  }
  return null;
}

function extractEmbeddedDocument(text) {
  const markers = [
    /["']swaggerDoc["']\s*:\s*/g,
    /\bswaggerDoc\s*:\s*/g,
    /(?:^|[,\s])spec\s*:\s*/gm,
    /["']spec["']\s*:\s*/g,
  ];

  for (const marker of markers) {
    let match;
    while ((match = marker.exec(text)) !== null) {
      const candidate = extractBalancedObject(text, match.index + match[0].length);
      if (!candidate) continue;
      try {
        const parsed = JSON.parse(candidate);
        if (isOpenApiDocument(parsed)) return parsed;
      } catch {
        // Some Swagger initializers use JavaScript objects rather than JSON.
      }
    }
  }
  return null;
}

function resolveDiscoveredUrl(rawUrl, resourceUrl) {
  if (!rawUrl || /^(data:|javascript:|#)/i.test(rawUrl)) return null;
  try {
    return new URL(rawUrl.replace(/&amp;/g, '&'), resourceUrl).toString();
  } catch {
    return null;
  }
}

function discoverResourceUrls(text, resourceUrl) {
  const candidates = [];
  const add = (rawUrl, priority = 10) => {
    const resolved = resolveDiscoveredUrl(rawUrl, resourceUrl);
    if (resolved) candidates.push({ url: resolved, priority });
  };

  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = scriptPattern.exec(text)) !== null) {
    const source = match[1];
    if (/swagger-ui-init|swagger.*(?:config|options)|openapi.*(?:config|init)/i.test(source)) add(source, 0);
    else if (!/(?:swagger-ui-bundle|standalone-preset)(?:\.min)?\.js/i.test(source)) add(source, 20);
  }

  const configUrlPatterns = [
    /["']swaggerUrl["']\s*:\s*["']([^"']+)["']/gi,
    /\bswaggerUrl\s*:\s*["']([^"']+)["']/gi,
    /["']configUrl["']\s*:\s*["']([^"']+)["']/gi,
    /\bconfigUrl\s*:\s*["']([^"']+)["']/gi,
    /["']url["']\s*:\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi,
    /\burl\s*:\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi,
    /(?:href|src)=["']([^"']*(?:openapi|swagger)[^"']*\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi,
  ];
  configUrlPatterns.forEach((pattern) => {
    while ((match = pattern.exec(text)) !== null) add(match[1], 5);
  });

  if (/SwaggerUIBundle\s*\(/.test(text)) {
    const swaggerBundleUrlPattern = /\burl\s*:\s*["']([^"']+)["']/gi;
    while ((match = swaggerBundleUrlPattern.exec(text)) !== null) add(match[1], 6);
  }

  return candidates
    .sort((left, right) => left.priority - right.priority)
    .map(({ url }) => url)
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

async function fetchText(rawUrl, options = {}) {
  const fetchImplementation = options.fetchImplementation || fetch;
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const target = await (options.validateUrl || validateProxyUrl)(currentUrl);
    const { response } = await fetchWithNetworkRetry(target, {
      method: 'GET',
      headers: {
        Accept: 'application/json, application/yaml, text/yaml, text/html, text/javascript, */*;q=0.5',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent': 'Devman-API-OpenAPI-Importer/1.0',
      },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    }, { fetchImplementation });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`Swagger URL redirected without a location (${response.status})`);
      currentUrl = new URL(location, target).toString();
      continue;
    }
    if (!response.ok) throw new Error(`Swagger URL returned HTTP ${response.status}`);

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
      throw new Error('Swagger document is too large to import (8 MB maximum)');
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new Error('Swagger document is too large to import (8 MB maximum)');
    }
    return { text, url: target.toString() };
  }

  throw new Error('Swagger URL redirected too many times');
}

async function loadOpenApiDocument(rawUrl, options = {}) {
  const queue = [rawUrl];
  const visited = new Set();
  let lastError = null;

  while (queue.length && visited.size < MAX_DISCOVERY_REQUESTS) {
    const candidateUrl = queue.shift();
    if (visited.has(candidateUrl)) continue;
    visited.add(candidateUrl);

    try {
      const resource = await fetchText(candidateUrl, options);
      const document = parseDocumentText(resource.text) || extractEmbeddedDocument(resource.text);
      if (document) return { document, documentUrl: resource.url };

      discoverResourceUrls(resource.text, resource.url).forEach((url) => {
        if (!visited.has(url)) queue.push(url);
      });
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError && visited.size === 1) throw lastError;
  throw new Error('No OpenAPI document was found at this URL. Use a Swagger UI page or a direct JSON/YAML spec URL.');
}

function resolveJsonPointer(document, reference) {
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return null;
  return reference.slice(2).split('/').reduce((value, part) => {
    if (!isRecord(value) && !Array.isArray(value)) return null;
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    return value[key];
  }, document);
}

function resolveSchema(document, schema) {
  if (!isRecord(schema) || typeof schema.$ref !== 'string') return schema;
  const resolved = resolveJsonPointer(document, schema.$ref);
  return isRecord(resolved) ? resolved : schema;
}

function mergeExamples(values) {
  const records = values.filter(isRecord);
  if (records.length === values.length) return Object.assign({}, ...records);
  return values.find((value) => value !== undefined);
}

function exampleForSchema(document, rawSchema, depth = 0, referenceTrail = new Set()) {
  if (!isRecord(rawSchema) || depth > 6) return undefined;
  if (rawSchema.example !== undefined) return rawSchema.example;
  if (rawSchema.default !== undefined) return rawSchema.default;
  if (rawSchema.const !== undefined) return rawSchema.const;
  if (Array.isArray(rawSchema.enum) && rawSchema.enum.length) return rawSchema.enum[0];

  if (typeof rawSchema.$ref === 'string') {
    if (referenceTrail.has(rawSchema.$ref)) return undefined;
    const resolved = resolveJsonPointer(document, rawSchema.$ref);
    if (!isRecord(resolved)) return undefined;
    const nextTrail = new Set(referenceTrail);
    nextTrail.add(rawSchema.$ref);
    return exampleForSchema(document, resolved, depth + 1, nextTrail);
  }

  const alternatives = rawSchema.oneOf || rawSchema.anyOf;
  if (Array.isArray(alternatives) && alternatives.length) {
    return exampleForSchema(document, alternatives[0], depth + 1, referenceTrail);
  }
  if (Array.isArray(rawSchema.allOf) && rawSchema.allOf.length) {
    return mergeExamples(rawSchema.allOf
      .map((schema) => exampleForSchema(document, schema, depth + 1, referenceTrail))
      .filter((value) => value !== undefined));
  }

  const schema = resolveSchema(document, rawSchema);
  const type = schema.type || (isRecord(schema.properties) ? 'object' : undefined);
  if (type === 'object') {
    const properties = isRecord(schema.properties) ? Object.entries(schema.properties).slice(0, 50) : [];
    return Object.fromEntries(properties.map(([name, propertySchema]) => {
      const value = exampleForSchema(document, propertySchema, depth + 1, referenceTrail);
      return [name, value === undefined ? null : value];
    }));
  }
  if (type === 'array') {
    const item = exampleForSchema(document, schema.items, depth + 1, referenceTrail);
    return item === undefined ? [] : [item];
  }
  if (type === 'boolean') return false;
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0;
  if (type === 'string') {
    const samples = {
      email: 'user@example.com',
      uuid: '00000000-0000-4000-8000-000000000000',
      date: '2026-01-01',
      'date-time': '2026-01-01T00:00:00.000Z',
      uri: 'https://example.com',
      url: 'https://example.com',
      binary: '<binary>',
    };
    return samples[schema.format] || 'string';
  }
  return undefined;
}

function resolveParameter(document, parameter) {
  if (!isRecord(parameter)) return null;
  if (typeof parameter.$ref !== 'string') return parameter;
  const resolved = resolveJsonPointer(document, parameter.$ref);
  return isRecord(resolved) ? resolved : null;
}

function parameterExample(document, parameter) {
  if (parameter.example !== undefined) return parameter.example;
  return exampleForSchema(document, parameter.schema);
}

function buildPathAndHeaders(document, path, parameters) {
  const query = [];
  const headers = {};
  parameters.map((parameter) => resolveParameter(document, parameter)).filter(Boolean).forEach((parameter) => {
    if (!parameter.required) return;
    const value = parameterExample(document, parameter);
    if (parameter.in === 'query') {
      query.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(value ?? '')}`);
    } else if (parameter.in === 'header') {
      headers[parameter.name] = String(value ?? '');
    }
  });

  if (!query.length) return { path, headers };
  return { path: `${path}${path.includes('?') ? '&' : '?'}${query.join('&')}`, headers };
}

function requestBodyExample(document, operation, parameters) {
  const openApiBody = isRecord(operation.requestBody)
    ? (typeof operation.requestBody.$ref === 'string'
      ? resolveJsonPointer(document, operation.requestBody.$ref)
      : operation.requestBody)
    : null;
  if (isRecord(openApiBody) && isRecord(openApiBody.content)) {
    const mediaEntry = Object.entries(openApiBody.content)
      .find(([mediaType]) => JSON_MEDIA_TYPE_PATTERN.test(mediaType));
    if (mediaEntry && isRecord(mediaEntry[1])) {
      const media = mediaEntry[1];
      if (media.example !== undefined) return media.example;
      if (isRecord(media.examples)) {
        const firstExample = Object.values(media.examples).find(isRecord);
        if (firstExample?.value !== undefined) return firstExample.value;
      }
      return exampleForSchema(document, media.schema);
    }
  }

  const swaggerBody = parameters
    .map((parameter) => resolveParameter(document, parameter))
    .find((parameter) => parameter?.in === 'body');
  return swaggerBody ? exampleForSchema(document, swaggerBody.schema) : undefined;
}

function formValue(document, schema) {
  const value = exampleForSchema(document, schema);
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function multipartPartsForSchema(document, rawSchema) {
  const schema = resolveSchema(document, rawSchema);
  if (!isRecord(schema) || !isRecord(schema.properties)) return [];
  return Object.entries(schema.properties).map(([name, rawProperty]) => {
    const property = resolveSchema(document, rawProperty);
    const isFile = isRecord(property) && property.type === 'string' && property.format === 'binary';
    return {
      name,
      kind: isFile ? 'file' : 'text',
      value: isFile ? '' : formValue(document, rawProperty),
      file: null,
    };
  });
}

function uploadBodyConfiguration(document, operation, parameters) {
  const openApiBody = isRecord(operation.requestBody)
    ? (typeof operation.requestBody.$ref === 'string'
      ? resolveJsonPointer(document, operation.requestBody.$ref)
      : operation.requestBody)
    : null;
  if (isRecord(openApiBody) && isRecord(openApiBody.content)) {
    const multipart = Object.entries(openApiBody.content)
      .find(([mediaType]) => /^multipart\/form-data(?:;|$)/i.test(mediaType));
    if (multipart && isRecord(multipart[1])) {
      return { bodyMode: 'multipart', formData: multipartPartsForSchema(document, multipart[1].schema) };
    }

    const binary = Object.entries(openApiBody.content).find(([mediaType, media]) => {
      if (!isRecord(media)) return false;
      const schema = resolveSchema(document, media.schema);
      return (isRecord(schema) && schema.type === 'string' && schema.format === 'binary') ||
        /^(application\/octet-stream|image\/|audio\/|video\/|font\/|model\/)/i.test(mediaType);
    });
    if (binary) return { bodyMode: 'binary', binaryFile: null };
  }

  const resolvedParameters = parameters.map((parameter) => resolveParameter(document, parameter)).filter(Boolean);
  const formParameters = resolvedParameters.filter((parameter) => parameter.in === 'formData');
  if (!formParameters.length) return null;
  return {
    bodyMode: 'multipart',
    formData: formParameters.map((parameter) => ({
      name: String(parameter.name || ''),
      kind: parameter.type === 'file' ? 'file' : 'text',
      value: parameter.type === 'file' ? '' : formValue(document, parameter.schema || parameter),
      file: null,
    })),
  };
}

function expectedStatus(operation) {
  if (!isRecord(operation.responses)) return '';
  const responseKeys = Object.keys(operation.responses);
  const hasSuccessfulResponse = responseKeys.some((status) =>
    /^2\d\d$/.test(status) || /^2xx$/i.test(status));
  return hasSuccessfulResponse ? '2xx' : '';
}

function resolveServerUrl(server, documentUrl) {
  if (!isRecord(server) || typeof server.url !== 'string') return '';
  const expanded = server.url.replace(/\{([^}]+)\}/g, (match, variableName) => {
    const variable = isRecord(server.variables) ? server.variables[variableName] : null;
    return isRecord(variable) && variable.default !== undefined ? String(variable.default) : match;
  });
  try {
    return new URL(expanded, documentUrl).toString().replace(/\/$/, '');
  } catch {
    return expanded.replace(/\/$/, '');
  }
}

function documentBaseUrl(document, documentUrl) {
  if (Array.isArray(document.servers) && document.servers.length) {
    const serverUrl = resolveServerUrl(document.servers[0], documentUrl);
    if (serverUrl) return serverUrl;
  }
  if (typeof document.host === 'string') {
    const scheme = Array.isArray(document.schemes) && document.schemes.length
      ? document.schemes[0]
      : new URL(documentUrl).protocol.replace(':', '');
    const basePath = typeof document.basePath === 'string' ? document.basePath : '';
    return `${scheme}://${document.host}${basePath}`.replace(/\/$/, '');
  }
  return new URL(documentUrl).origin;
}

function normalizeOpenApiDocument(document, documentUrl, sourceUrl) {
  const operations = [];
  Object.entries(document.paths).forEach(([rawPath, pathItem]) => {
    if (!isRecord(pathItem)) return;
    const sharedParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    Object.entries(pathItem).forEach(([method, rawOperation]) => {
      if (!HTTP_METHODS.has(method.toLowerCase()) || !isRecord(rawOperation)) return;
      const parameters = [...sharedParameters, ...(Array.isArray(rawOperation.parameters) ? rawOperation.parameters : [])];
      const request = buildPathAndHeaders(document, rawPath, parameters);
      const bodyExample = requestBodyExample(document, rawOperation, parameters);
      const uploadBody = uploadBodyConfiguration(document, rawOperation, parameters);
      const security = rawOperation.security !== undefined ? rawOperation.security : document.security;
      const tags = Array.isArray(rawOperation.tags) ? rawOperation.tags.map(String) : [];
      operations.push({
        method: method.toUpperCase(),
        path: request.path,
        summary: String(rawOperation.summary || rawOperation.operationId || '').trim(),
        tags,
        group: tags.find((tag) => tag.trim())?.trim() || 'Other',
        secured: Array.isArray(security) && security.length > 0,
        headers: request.headers,
        body: bodyExample === undefined ? '' : JSON.stringify(bodyExample, null, 2),
        expect: expectedStatus(rawOperation),
        ...(uploadBody || {}),
      });
    });
  });

  if (!operations.length) throw new Error('The OpenAPI document does not contain any supported endpoints');
  return {
    title: String(document.info?.title || 'Imported API'),
    version: String(document.info?.version || document.openapi || document.swagger || ''),
    sourceUrl,
    documentUrl,
    baseUrl: documentBaseUrl(document, documentUrl),
    operations,
  };
}

async function importOpenApiFromUrl(rawUrl, options = {}) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) throw new Error('Enter a Swagger or OpenAPI URL');
  const sourceUrl = rawUrl.trim();
  const { document, documentUrl } = await loadOpenApiDocument(sourceUrl, options);
  return normalizeOpenApiDocument(document, documentUrl, sourceUrl);
}

module.exports = {
  discoverResourceUrls,
  extractEmbeddedDocument,
  importOpenApiFromUrl,
  isOpenApiDocument,
  normalizeOpenApiDocument,
  parseDocumentText,
};
