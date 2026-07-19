'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { looksLikeCurl, parseCurlText, tokenizeShell } = require('../public/curl-parser');

test('imports a browser cURL command with headers, bearer authorization, and cookies', () => {
  const input = String.raw`curl 'https://api.example.com/api/v1/business-details' \
    -H 'accept: application/json, text/plain, */*' \
    -H 'authorization: Bearer sample-token' \
    -b 'session=abc; theme=dark' \
    -H 'if-none-match: W/"sample"' \
    -H 'x-tenant-id: tenant-1'`;

  const parsed = parseCurlText(input);

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.routes.length, 1);
  assert.equal(parsed.routes[0].method, 'GET');
  assert.equal(parsed.routes[0].path, 'https://api.example.com/api/v1/business-details');
  assert.equal(parsed.routes[0].headers.authorization, 'Bearer sample-token');
  assert.equal(parsed.routes[0].headers.Cookie, 'session=abc; theme=dark');
  assert.equal(parsed.routes[0].headers['x-tenant-id'], 'tenant-1');
});

test('infers POST and preserves a quoted JSON request body', () => {
  const parsed = parseCurlText(String.raw`curl --json '{"name":"A B","active":true}' https://api.example.com/users`);

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.routes[0].method, 'POST');
  assert.equal(parsed.routes[0].body, '{"name":"A B","active":true}');
  assert.equal(parsed.routes[0].headers['Content-Type'], 'application/json');
  assert.equal(parsed.routes[0].bodyMode, 'raw');
});

test('prepares multipart text and file fields without trying to read local files', () => {
  const parsed = parseCurlText(String.raw`curl https://api.example.com/assets -F 'title=Cover image' -F 'asset=@/tmp/cover.png;type=image/png;filename=hero.png'`);

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.routes[0].method, 'POST');
  assert.equal(parsed.routes[0].bodyMode, 'multipart');
  assert.deepEqual(parsed.routes[0].formData, [
    { name: 'title', kind: 'text', value: 'Cover image', file: null },
    { name: 'asset', kind: 'file', value: '', file: { name: 'hero.png', type: 'image/png', size: 0 } },
  ]);
});

test('moves data to the query string for curl --get', () => {
  const parsed = parseCurlText(`curl --get https://api.example.com/search --data 'q=hello%20world' --data 'page=2'`);

  assert.deepEqual(parsed.issues, []);
  assert.equal(parsed.routes[0].method, 'GET');
  assert.equal(parsed.routes[0].path, 'https://api.example.com/search?q=hello%20world&page=2');
  assert.equal(parsed.routes[0].body, '');
});

test('imports multiple cURL commands as separate request rows', () => {
  const parsed = parseCurlText(`curl https://api.example.com/one
curl -X DELETE https://api.example.com/two`);

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.routes.map(({ method, path }) => ({ method, path })), [
    { method: 'GET', path: 'https://api.example.com/one' },
    { method: 'DELETE', path: 'https://api.example.com/two' },
  ]);
});

test('reports malformed commands without executing their contents', () => {
  assert.equal(looksLikeCurl('  $ curl https://api.example.com'), true);
  const tokenized = tokenizeShell(`curl 'https://api.example.com`);
  assert.match(tokenized.issue.message, /unclosed quote/);

  const parsed = parseCurlText('curl https://api.example.com --unknown-option value');
  assert.equal(parsed.routes.length, 0);
  assert.match(parsed.issues[0].message, /Unsupported cURL option/);
});
