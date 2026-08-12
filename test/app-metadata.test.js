'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');

test('keeps the public diagnostics version synchronized with package.json', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const match = html.match(/<meta name="application-version" content="([^"]+)"/);

  assert.ok(match, 'public/index.html must expose the application version');
  assert.equal(match[1], packageJson.version);
});
