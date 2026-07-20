'use strict';

const { getErrorMessage, getJsonBody, sendJson } = require('../lib/api');
const { fetchWithNetworkRetry } = require('../lib/fetch-retry');
const { validateProxyUrl } = require('../lib/proxy-security');
const {
  applyProxyErrorHeaders,
  applyUpstreamResponseHeaders,
  buildUpstreamRequest,
  streamUpstreamResponse,
} = require('../lib/proxy-stream');

module.exports = async function proxyStream(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  try {
    const payload = await getJsonBody(request);
    const target = await validateProxyUrl(typeof payload.url === 'string' ? payload.url : '');
    const upstreamRequest = buildUpstreamRequest(payload);
    const started = Date.now();
    const controller = new AbortController();
    response.once('close', () => {
      if (!response.writableEnded) controller.abort();
    });
    const { response: upstream, attempts } = await fetchWithNetworkRetry(target, {
      ...upstreamRequest,
      redirect: 'manual',
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
    });
    applyUpstreamResponseHeaders(upstream, response, attempts, Date.now() - started);
    return streamUpstreamResponse(upstream, response);
  } catch (error) {
    applyProxyErrorHeaders(response, error);
    return sendJson(response, 502, { error: getErrorMessage(error) });
  }
};
