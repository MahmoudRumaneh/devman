'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  applyUpstreamResponseHeaders,
  buildUpstreamRequest,
  streamUpstreamResponse,
} = require('../lib/proxy-stream');

test('builds an exact binary upstream request body', () => {
  const request = buildUpstreamRequest({
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': '1' },
    bodyKind: 'binary',
    body: Buffer.from('binary contents').toString('base64'),
  });

  assert.equal(request.method, 'PUT');
  assert.equal(request.headers['Content-Type'], 'application/pdf');
  assert.equal(request.headers['Content-Length'], undefined);
  assert.deepEqual(request.body, Buffer.from('binary contents'));
});

test('builds multipart text and file fields with a generated boundary', async () => {
  const request = buildUpstreamRequest({
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data', 'X-Test': 'yes' },
    bodyKind: 'multipart',
    parts: [
      { kind: 'text', name: 'title', value: 'Example' },
      {
        kind: 'file',
        name: 'asset',
        fileName: 'hello.txt',
        type: 'text/plain',
        data: Buffer.from('hello').toString('base64'),
      },
    ],
  });

  assert.ok(request.body instanceof FormData);
  assert.equal(request.headers['Content-Type'], undefined);
  assert.equal(request.headers['X-Test'], 'yes');
  assert.equal(request.body.get('title'), 'Example');
  const file = request.body.get('asset');
  assert.ok(file instanceof File);
  assert.equal(file.name, 'hello.txt');
  assert.equal(await file.text(), 'hello');
});

test('streams upstream bytes and preserves safe download metadata', async () => {
  const upstream = new Response('streamed file', {
    status: 206,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="sample.pdf"',
      'Content-Length': '13',
    },
  });
  const response = new EventEmitter();
  response.headers = {};
  response.chunks = [];
  response.setHeader = (name, value) => { response.headers[name] = value; };
  response.write = (chunk) => { response.chunks.push(chunk); return true; };
  response.end = () => { response.ended = true; };
  response.destroy = (error) => { throw error; };

  applyUpstreamResponseHeaders(upstream, response, 2, 18);
  await streamUpstreamResponse(upstream, response);

  assert.equal(response.statusCode, 206);
  assert.equal(response.headers['X-Devman-Proxy'], 'upstream');
  assert.equal(response.headers['X-Devman-Content-Length'], '13');
  assert.equal(response.headers['content-length'], undefined);
  assert.equal(response.headers['content-disposition'], 'attachment; filename="sample.pdf"');
  assert.equal(Buffer.concat(response.chunks).toString(), 'streamed file');
  assert.equal(response.ended, true);
});
