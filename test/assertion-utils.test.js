'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAssertions } = require('../public/assertion-utils');

test('normalizes assertion arrays and removes unusable values', () => {
  assert.deepEqual(normalizeAssertions([' .data.id != null ', '', null, 42]), [
    '.data.id != null',
  ]);
});

test('treats one jq assertion string as one expression', () => {
  assert.deepEqual(normalizeAssertions('.data.total >= 0'), ['.data.total >= 0']);
});

test('supports JSON-encoded assertion arrays from persisted imports', () => {
  assert.deepEqual(normalizeAssertions('[".ok", " .data.id "]'), ['.ok', '.data.id']);
});

test('uses no assertions for malformed non-string persisted values', () => {
  assert.deepEqual(normalizeAssertions({ filter: '.ok' }), []);
  assert.deepEqual(normalizeAssertions(null), []);
});
