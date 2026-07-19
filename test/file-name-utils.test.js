'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fileNameWithExtension,
  sanitizeFileName,
} = require('../public/file-name-utils');

test('preserves a readable report name and replaces unsafe separators', () => {
  assert.equal(
    fileNameWithExtension('Creator / Revenue: July', '.md', 'devman-api'),
    'Creator - Revenue- July.md',
  );
});

test('does not duplicate an existing file extension', () => {
  assert.equal(fileNameWithExtension('release report.md', '.md'), 'release report.md');
  assert.equal(fileNameWithExtension('workspace.json', '.json'), 'workspace.json');
});

test('replaces cross-platform invalid filename characters and uses a fallback', () => {
  assert.equal(sanitizeFileName('one\\two?three*four|five'), 'one-two-three-four-five');
  assert.equal(sanitizeFileName(' ... ', 'devman-api'), 'devman-api');
  assert.equal(fileNameWithExtension('CON', '.md'), '-CON.md');
});
