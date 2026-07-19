'use strict';

const { once } = require('node:events');

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);
const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const BODY_KIND = Object.freeze({ TEXT: 'text', BINARY: 'binary', MULTIPART: 'multipart' });
const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const UNSAFE_HEADER_VALUE_PATTERN = /[\u0000-\u0008\u000a-\u001f\u007f]/;
const RESPONSE_HEADER_NAMES = [
  'cache-control',
  'content-disposition',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
];

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function encodeHeaderValue(name, value) {
  if (UNSAFE_HEADER_VALUE_PATTERN.test(value)) {
    throw new Error(`Header "${name}" contains an unsafe control character`);
  }

  // Fetch accepts header values as ByteStrings. Preserve ASCII exactly and
  // represent every other Unicode value as its UTF-8 byte sequence so smart
  // punctuation and international text do not fail before the request starts.
  return /[^\u0000-\u007f]/.test(value)
    ? Buffer.from(value, 'utf8').toString('latin1')
    : value;
}

function normalizeHeaders(value) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([, headerValue]) => typeof headerValue === 'string')
    .map(([name, headerValue]) => {
      if (!HEADER_NAME_PATTERN.test(name)) {
        throw new Error(`Invalid HTTP header name "${name}"`);
      }
      return [name, encodeHeaderValue(name, headerValue)];
    }));
}

function removeHeader(headers, headerName) {
  const existingName = Object.keys(headers)
    .find((name) => name.toLowerCase() === headerName.toLowerCase());
  if (existingName) delete headers[existingName];
}

function decodeBase64(value) {
  if (typeof value !== 'string') throw new Error('The uploaded file data is missing');
  return Buffer.from(value, 'base64');
}

function buildMultipartBody(rawParts) {
  const form = new FormData();
  const parts = Array.isArray(rawParts) ? rawParts : [];
  for (const rawPart of parts) {
    if (!isRecord(rawPart) || typeof rawPart.name !== 'string' || !rawPart.name.trim()) continue;
    if (rawPart.kind === 'file') {
      const bytes = decodeBase64(rawPart.data);
      const type = typeof rawPart.type === 'string' && rawPart.type ? rawPart.type : 'application/octet-stream';
      const fileName = typeof rawPart.fileName === 'string' && rawPart.fileName
        ? rawPart.fileName
        : 'upload.bin';
      form.append(rawPart.name, new Blob([bytes], { type }), fileName);
    } else {
      form.append(rawPart.name, typeof rawPart.value === 'string' ? rawPart.value : '');
    }
  }
  return form;
}

function buildUpstreamRequest(payload) {
  if (!isRecord(payload)) throw new Error('The proxy request must be an object');
  const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET';
  if (!SUPPORTED_METHODS.has(method)) throw new Error('Unsupported HTTP method');

  const headers = normalizeHeaders(payload.headers);
  removeHeader(headers, 'content-length');
  const bodyKind = Object.values(BODY_KIND).includes(payload.bodyKind) ? payload.bodyKind : BODY_KIND.TEXT;
  let body;

  if (!METHODS_WITHOUT_BODY.has(method)) {
    if (bodyKind === BODY_KIND.MULTIPART) {
      removeHeader(headers, 'content-type');
      body = buildMultipartBody(payload.parts);
    } else if (bodyKind === BODY_KIND.BINARY) {
      body = decodeBase64(payload.body);
    } else if (typeof payload.body === 'string') {
      body = payload.body;
    }
  }

  return { method, headers, body };
}

function applyUpstreamResponseHeaders(upstream, response, attempts, elapsedMs) {
  response.statusCode = upstream.status;
  response.setHeader('X-Devman-Proxy', 'upstream');
  response.setHeader('X-Devman-Upstream-Status', String(upstream.status));
  response.setHeader('X-Devman-Attempts', String(attempts));
  response.setHeader('X-Devman-Elapsed-Ms', String(elapsedMs));
  const declaredLength = upstream.headers.get('content-length');
  if (declaredLength) response.setHeader('X-Devman-Content-Length', declaredLength);
  RESPONSE_HEADER_NAMES.forEach((name) => {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  });
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

async function streamUpstreamResponse(upstream, response) {
  if (!upstream.body) {
    response.end();
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!response.write(Buffer.from(value))) await once(response, 'drain');
    }
    response.end();
  } catch (error) {
    response.destroy(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
}

module.exports = {
  BODY_KIND,
  buildUpstreamRequest,
  normalizeHeaders,
  applyUpstreamResponseHeaders,
  streamUpstreamResponse,
};
