#!/usr/bin/env node
// Zero-dependency local server for Devman API (plain Node.js, no npm install needed).
//
// Serves the static UI (public/) and exposes endpoints the page's JS calls
// same-origin, so the browser never has to fight the target API's CORS policy:
//
//   POST /api/proxy        -> forwards one HTTP request to any URL server-side
//                              and returns {status, headers, body, ms}
//   POST /api/jq           -> runs a jq filter against JSON text (used to evaluate
//                              "assert" and "capture" when importing a full
//                              engine-suite JSON, so semantics match engine.sh
//                              exactly instead of reimplementing jq in the browser)
//   POST /api/save-report  -> writes a Markdown report into ../../devman-api-reports/
//
// Binds to 127.0.0.1 only (not 0.0.0.0) since /api/proxy will fetch whatever
// URL the page asks for.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fetchWithNetworkRetry } = require('./lib/fetch-retry');
const { importOpenApiFromUrl } = require('./lib/swagger-import');
const { fileNameWithExtension } = require('./public/file-name-utils');
const {
  applyUpstreamResponseHeaders,
  buildUpstreamRequest,
  streamUpstreamResponse,
} = require('./lib/proxy-stream');

const WEB_DIR = __dirname;
const PUBLIC_DIR = path.join(WEB_DIR, 'public');
const REPORTS_DIR = path.resolve(WEB_DIR, '..', '..', 'devman-api-reports');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw.length) return {};
  return JSON.parse(raw.toString('utf-8'));
}

function serveStatic(req, res) {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, reqPath));
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendJson(res, 404, { error: 'not found' });
  }
  const ext = path.extname(filePath);
  const data = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': data.length });
  res.end(data);
}

async function handleProxy(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: `bad request body: ${e.message}` });
  }

  const method = (payload.method || 'GET').toUpperCase();
  const url = payload.url || '';
  const headers = payload.headers || {};
  const bodyText = payload.body;

  const started = Date.now();
  try {
    const { response: resp, attempts } = await fetchWithNetworkRetry(url, {
      method,
      headers,
      body: bodyText != null && method !== 'GET' && method !== 'HEAD' ? bodyText : undefined,
      signal: AbortSignal.timeout(25_000),
    });
    const text = await resp.text();
    const outHeaders = {};
    resp.headers.forEach((v, k) => { outHeaders[k] = v; });
    return sendJson(res, 200, {
      status: resp.status,
      headers: outHeaders,
      body: text,
      ms: Date.now() - started,
      attempts,
    });
  } catch (e) {
    return sendJson(res, 200, {
      status: 0,
      headers: {},
      body: JSON.stringify({ error: String(e.message || e) }),
      ms: Date.now() - started,
      attempts: Number.isInteger(e?.attempts) ? e.attempts : 1,
    });
  }
}

async function handleProxyStream(req, res) {
  try {
    const payload = await readJsonBody(req);
    const upstreamRequest = buildUpstreamRequest(payload);
    const started = Date.now();
    const controller = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const { response: upstream, attempts } = await fetchWithNetworkRetry(payload.url || '', {
      ...upstreamRequest,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300_000)]),
    });
    applyUpstreamResponseHeaders(upstream, res, attempts, Date.now() - started);
    return streamUpstreamResponse(upstream, res);
  } catch (error) {
    res.setHeader('X-Devman-Proxy', 'error');
    return sendJson(res, 502, { error: error instanceof Error ? error.message : String(error) });
  }
}

function handleJq(req, res) {
  readJsonBody(req)
    .then((payload) => {
      const mode = payload.mode === 'assert' ? 'assert' : 'capture';
      const filter = typeof payload.filter === 'string' ? payload.filter : '.';
      const input = typeof payload.input === 'string' ? payload.input : '';
      const args = mode === 'assert' ? ['-e', filter] : ['-r', `(${filter}) // empty`];

      const result = spawnSync('jq', args, { input, encoding: 'utf-8', timeout: 5000 });
      if (result.error) {
        return sendJson(res, 200, { ok: false, error: `jq not available: ${result.error.message}` });
      }
      if (mode === 'assert') {
        return sendJson(res, 200, { ok: true, pass: result.status === 0 });
      }
      return sendJson(res, 200, { ok: true, value: result.status === 0 ? result.stdout.trim() : '' });
    })
    .catch((e) => sendJson(res, 400, { error: `bad request body: ${e.message}` }));
}

async function handleSaveReport(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: `bad request body: ${e.message}` });
  }

  const rawName = typeof payload.name === 'string' ? payload.name : 'devman-api';
  const fileName = fileNameWithExtension(rawName, '.md', 'devman-api');
  const markdown = payload.markdown || '';

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const outPath = path.join(REPORTS_DIR, fileName);
  fs.writeFileSync(outPath, markdown, 'utf-8');
  return sendJson(res, 200, { path: outPath });
}

async function handleSwaggerImport(req, res) {
  let payload;
  try {
    payload = await readJsonBody(req);
    const url = typeof payload.url === 'string' ? payload.url : '';
    const imported = await importOpenApiFromUrl(url);
    return sendJson(res, 200, imported);
  } catch (error) {
    return sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/proxy') return await handleProxy(req, res);
    if (req.method === 'POST' && req.url === '/api/proxy-stream') return await handleProxyStream(req, res);
    if (req.method === 'POST' && req.url === '/api/jq') return handleJq(req, res);
    if (req.method === 'POST' && req.url === '/api/save-report') return await handleSaveReport(req, res);
    if (req.method === 'POST' && req.url === '/api/swagger-import') return await handleSwaggerImport(req, res);
    if (req.method === 'GET') return serveStatic(req, res);
    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJson(res, 500, { error: String(e.message || e) });
  }
});

const port = Number(process.argv[2]) || 8787;
fs.mkdirSync(REPORTS_DIR, { recursive: true });
server.listen(port, '127.0.0.1', () => {
  console.log(`Devman API running at http://127.0.0.1:${port}`);
  console.log(`Reports saved to ${REPORTS_DIR}`);
  const jqCheck = spawnSync('jq', ['--version']);
  if (jqCheck.error) {
    console.log('Note: jq not found on PATH — importing a full suite JSON (assert/capture) needs it. Manual endpoint rows work fine without it.');
  }
});
