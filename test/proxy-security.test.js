'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateProxyUrl } = require('../lib/proxy-security');

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
