'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createDevmanServer } = require('../server');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (typeof address !== 'object' || address === null) throw new Error('Test server did not expose an address');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, 'close');
}

function createFixtureServer() {
  let origin = '';
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);

    if (request.url === '/openapi.json') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'Local fixture API', version: '1.0.0' },
        servers: [{ url: origin }],
        paths: {
          '/echo/{id}': {
            post: {
              parameters: [{ name: 'id', in: 'path', required: true, example: 42, schema: { type: 'integer' } }],
              requestBody: {
                content: { 'application/json': { example: { name: 'Devman' } } },
              },
              responses: { 200: { description: 'OK' } },
            },
          },
          '/download': {
            get: { responses: { 200: { description: 'File' } } },
          },
        },
      }));
      return;
    }

    if (request.url === '/echo/42' && request.method === 'POST') {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('X-Fixture', 'echo');
      response.end(JSON.stringify({ method: request.method, body: body.toString('utf8') }));
      return;
    }

    if (request.url === '/download') {
      response.statusCode = 206;
      response.setHeader('Content-Type', 'application/octet-stream');
      response.setHeader('Content-Disposition', 'attachment; filename="fixture.bin"');
      response.end(Buffer.from([0, 1, 2, 3, 255]));
      return;
    }

    response.statusCode = 404;
    response.end('not found');
  });
  return { server, setOrigin(value) { origin = value; } };
}

test('local server imports private OpenAPI, proxies JSON, streams binary, and serves the app', async (context) => {
  const fixture = createFixtureServer();
  const fixtureOrigin = await listen(fixture.server);
  fixture.setOrigin(fixtureOrigin);
  const devmanServer = createDevmanServer();
  const devmanOrigin = await listen(devmanServer);
  context.after(async () => {
    await close(devmanServer);
    await close(fixture.server);
  });

  const page = await fetch(devmanOrigin);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Devman API<\/title>/);

  const swaggerResponse = await fetch(`${devmanOrigin}/api/swagger-import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: `${fixtureOrigin}/openapi.json` }),
  });
  assert.equal(swaggerResponse.status, 200);
  const imported = await swaggerResponse.json();
  assert.equal(imported.title, 'Local fixture API');
  assert.equal(imported.baseUrl, fixtureOrigin);
  assert.equal(imported.operations[0].path, '/echo/42');

  const proxyResponse = await fetch(`${devmanOrigin}/api/proxy-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'POST',
      url: `${fixtureOrigin}/echo/42`,
      headers: { 'Content-Type': 'application/json' },
      bodyKind: 'text',
      body: '{"name":"Devman"}',
    }),
  });
  assert.equal(proxyResponse.status, 200);
  assert.equal(proxyResponse.headers.get('x-devman-proxy'), 'upstream');
  assert.deepEqual(await proxyResponse.json(), { method: 'POST', body: '{"name":"Devman"}' });

  const binaryResponse = await fetch(`${devmanOrigin}/api/proxy-stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'GET', url: `${fixtureOrigin}/download` }),
  });
  assert.equal(binaryResponse.status, 206);
  assert.equal(binaryResponse.headers.get('content-disposition'), 'attachment; filename="fixture.bin"');
  assert.deepEqual(Buffer.from(await binaryResponse.arrayBuffer()), Buffer.from([0, 1, 2, 3, 255]));
});
