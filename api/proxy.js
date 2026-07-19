'use strict';

const { getErrorMessage, getJsonBody, sendJson } = require('../lib/api');
const { fetchWithNetworkRetry } = require('../lib/fetch-retry');
const { validateProxyUrl } = require('../lib/proxy-security');
const { normalizeHeaders } = require('../lib/proxy-stream');

const METHODS_WITHOUT_BODY = new Set(['GET', 'HEAD']);
const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

module.exports = async function proxy(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  try {
    const payload = await getJsonBody(request);
    const method = typeof payload.method === 'string' ? payload.method.toUpperCase() : 'GET';
    const headers = normalizeHeaders(payload.headers);
    const body = typeof payload.body === 'string' ? payload.body : undefined;

    if (!SUPPORTED_METHODS.has(method)) return sendJson(response, 400, { error: 'Unsupported HTTP method' });

    const target = await validateProxyUrl(typeof payload.url === 'string' ? payload.url : '');
    const started = Date.now();
    const { response: upstream, attempts } = await fetchWithNetworkRetry(target, {
      method,
      headers,
      body: body !== undefined && !METHODS_WITHOUT_BODY.has(method) ? body : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
    const responseBody = await upstream.text();
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => { responseHeaders[key] = value; });

    return sendJson(response, 200, {
      status: upstream.status,
      headers: responseHeaders,
      body: responseBody,
      ms: Date.now() - started,
      attempts,
    });
  } catch (error) {
    return sendJson(response, 200, {
      status: 0,
      headers: {},
      body: JSON.stringify({ error: getErrorMessage(error) }),
      ms: 0,
      attempts: Number.isInteger(error?.attempts) ? error.attempts : 1,
    });
  }
};
