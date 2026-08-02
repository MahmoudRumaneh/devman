'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverResourceUrls,
  extractEmbeddedDocument,
  importOpenApiFromUrl,
  normalizeOpenApiDocument,
  parseDocumentText,
} = require('../lib/swagger-import');

const SAMPLE_DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Pet API', version: '1.2.0' },
  servers: [{ url: '/api/v1' }],
  security: [{ bearer: [] }],
  paths: {
    '/pets/{id}': {
      get: {
        summary: 'Read a pet',
        tags: ['Pets'],
        parameters: [
          { name: 'include', in: 'query', required: true, schema: { type: 'string', default: 'owner' } },
          { name: 'x-client', in: 'header', required: true, schema: { type: 'string', example: 'devman' } },
        ],
        responses: {
          200: { description: 'OK' },
          204: { description: 'No content' },
          404: { description: 'Missing' },
        },
      },
      post: {
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/PetInput' } },
          },
        },
        responses: { 201: { description: 'Created' } },
      },
    },
  },
  components: {
    schemas: {
      PetInput: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'Milo' },
          age: { type: 'integer', minimum: 1 },
        },
      },
    },
  },
};

test('parses direct OpenAPI YAML documents', () => {
  const parsed = parseDocumentText(`
openapi: 3.0.0
info:
  title: Example
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
`);

  assert.equal(parsed.info.title, 'Example');
  assert.ok(parsed.paths['/health']);
});

test('extracts a JSON OpenAPI document embedded by Swagger UI', () => {
  const initializer = `window.onload = () => { const options = ${JSON.stringify({
    swaggerDoc: SAMPLE_DOCUMENT,
    customOptions: { filter: true },
  })}; return options; };`;

  const parsed = extractEmbeddedDocument(initializer);
  assert.equal(parsed.info.title, 'Pet API');
  assert.ok(parsed.paths['/pets/{id}']);
});

test('prioritizes Swagger UI initializer discovery and resolves relative URLs', () => {
  const urls = discoverResourceUrls(`
    <script src="./swagger-ui-bundle.js"></script>
    <script src="./docs/swagger-ui-init.js"></script>
    <a href="./openapi.json">spec</a>
  `, 'https://example.com/api/docs');

  assert.equal(urls[0], 'https://example.com/api/docs/swagger-ui-init.js');
  assert.ok(urls.includes('https://example.com/api/openapi.json'));
  assert.ok(!urls.some((url) => url.includes('swagger-ui-bundle.js')));
});

test('normalizes operations, security, parameters, examples, and base URL', () => {
  const imported = normalizeOpenApiDocument(
    SAMPLE_DOCUMENT,
    'https://example.com/api/docs/swagger-ui-init.js',
    'https://example.com/api/docs',
  );

  assert.equal(imported.title, 'Pet API');
  assert.equal(imported.baseUrl, 'https://example.com/api/v1');
  assert.equal(imported.operations.length, 2);
  assert.deepEqual(imported.operations[0], {
    method: 'GET',
    path: '/pets/{id}?include=owner',
    summary: 'Read a pet',
    tags: ['Pets'],
    group: 'Pets',
    secured: true,
    headers: { 'x-client': 'devman' },
    body: '',
    expect: '2xx',
  });
  assert.equal(imported.operations[1].secured, false);
  assert.equal(imported.operations[1].expect, '2xx');
  assert.deepEqual(JSON.parse(imported.operations[1].body), { name: 'Milo', age: 1 });
});

test('preserves an OpenAPI 2XX response range as the success expectation', () => {
  const imported = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Range API', version: '1' },
    paths: {
      '/jobs': {
        post: {
          responses: { '2XX': { description: 'Any successful response' } },
        },
      },
    },
  }, 'https://example.com/openapi.json', 'https://example.com/openapi.json');

  assert.equal(imported.operations[0].expect, '2xx');
});

test('prepares multipart and binary OpenAPI request bodies for file selection', () => {
  const imported = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Upload API', version: '1' },
    paths: {
      '/assets': {
        post: {
          requestBody: {
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', example: 'Cover' },
                    asset: { type: 'string', format: 'binary' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Created' } },
        },
      },
      '/archive': {
        put: {
          requestBody: {
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
            },
          },
          responses: { 204: { description: 'Stored' } },
        },
      },
    },
  }, 'https://example.com/openapi.json', 'https://example.com/openapi.json');

  assert.equal(imported.operations[0].bodyMode, 'multipart');
  assert.deepEqual(imported.operations[0].formData, [
    { name: 'title', kind: 'text', value: 'Cover', file: null },
    { name: 'asset', kind: 'file', value: '', file: null },
  ]);
  assert.equal(imported.operations[1].bodyMode, 'binary');
});

test('discovers and imports an embedded document through a Swagger UI page', async () => {
  const pages = new Map([
    ['https://example.com/api/docs', '<script src="./docs/swagger-ui-init.js"></script>'],
    ['https://example.com/api/docs/swagger-ui-init.js', `const options = ${JSON.stringify({ swaggerDoc: SAMPLE_DOCUMENT })};`],
  ]);
  const requests = [];
  const fetchImplementation = async (input, init) => {
    const url = input.toString();
    requests.push({ url, init });
    const body = pages.get(url);
    return new Response(body || 'not found', {
      status: body ? 200 : 404,
      headers: { 'content-type': body?.startsWith('<') ? 'text/html' : 'text/javascript' },
    });
  };

  const imported = await importOpenApiFromUrl('https://example.com/api/docs', {
    fetchImplementation,
    validateUrl: async (url) => new URL(url),
  });

  assert.equal(imported.title, 'Pet API');
  assert.equal(imported.operations.length, 2);
  assert.ok(requests.length >= 2);
  assert.ok(requests.every(({ init }) => init.cache === 'no-store'));
  assert.ok(requests.every(({ init }) => init.headers['Cache-Control'] === 'no-cache'));
  assert.ok(requests.every(({ init }) => init.headers['ngrok-skip-browser-warning'] === 'true'));
  assert.ok(requests.every(({ init }) => init.headers['X-Tunnel-Skip-AntiPhishing-Page'] === 'true'));
});
