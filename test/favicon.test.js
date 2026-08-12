'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDirectory = path.join(__dirname, '..', 'public');

function readPngDimensions(buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buffer.subarray(0, 8).equals(pngSignature), true);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test('favicon.ico contains crisp PNG images for standard browser sizes', () => {
  const icon = fs.readFileSync(path.join(publicDirectory, 'favicon.ico'));
  assert.equal(icon.readUInt16LE(0), 0);
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 4);

  const sizes = Array.from({ length: 4 }, (_, index) => {
    const entryOffset = 6 + (index * 16);
    const encodedSize = icon.readUInt8(entryOffset);
    const size = encodedSize === 0 ? 256 : encodedSize;
    const dataLength = icon.readUInt32LE(entryOffset + 8);
    const dataOffset = icon.readUInt32LE(entryOffset + 12);
    assert.deepEqual(readPngDimensions(icon.subarray(dataOffset, dataOffset + dataLength)), {
      width: size,
      height: size,
    });
    return size;
  });

  assert.deepEqual(sizes, [16, 32, 48, 256]);
});

test('homepage declares ICO, PNG, and Apple touch favicon fallbacks', () => {
  const html = fs.readFileSync(path.join(publicDirectory, 'index.html'), 'utf8');
  assert.match(html, /href="\/favicon\.ico\?v=1\.0\.5" sizes="any"/);
  assert.match(html, /sizes="32x32" href="\/favicon-32x32\.png\?v=1\.0\.5"/);
  assert.match(html, /sizes="16x16" href="\/favicon-16x16\.png\?v=1\.0\.5"/);
  assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png\?v=1\.0\.5"/);
});
