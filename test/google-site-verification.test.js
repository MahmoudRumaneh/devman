'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const verificationFileName = 'google6fff67ae3705aaced.html';

test('Google site-verification content exactly matches its public filename', () => {
  const verificationPath = path.join(__dirname, '..', 'public', verificationFileName);
  const content = fs.readFileSync(verificationPath, 'utf8').trim();

  assert.equal(content, `google-site-verification: ${verificationFileName}`);
});
