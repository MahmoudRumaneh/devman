'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateLocalProxyUrl, validateProxyUrl } = require('../lib/proxy-security');

test('local mode accepts private HTTP APIs but still rejects unsafe URL forms', () => {
  assert.equal(validateLocalProxyUrl('http://127.0.0.1:3000/openapi.json').hostname, '127.0.0.1');
  assert.throws(() => validateLocalProxyUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);
  assert.throws(() => validateLocalProxyUrl('https://user:pass@example.com'), /cannot contain credentials/);
});

test('rejects unsupported protocols', async () => {
  await assert.rejects(validateProxyUrl('file:///etc/passwd'), /Only HTTP and HTTPS/);
});

test('rejects localhost targets', async () => {
  await assert.rejects(validateProxyUrl('http://localhost:3000'), /Private and local/);
});

test('rejects private IPv4 targets', async () => {
  await assert.rejects(validateProxyUrl('http://127.0.0.1'), /Private and reserved/);
  await assert.rejects(validateProxyUrl('http://192.168.1.1'), /Private and reserved/);
});

test('rejects loopback, mapped, multicast, and translation-prefix IPv6 targets', async () => {
  await assert.rejects(validateProxyUrl('http://[::1]'), /Private and reserved/);
  await assert.rejects(validateProxyUrl('http://[::ffff:127.0.0.1]'), /Private and reserved/);
  await assert.rejects(validateProxyUrl('http://[ff02::1]'), /Private and reserved/);
  await assert.rejects(validateProxyUrl('http://[64:ff9b::7f00:1]'), /Private and reserved/);
});
