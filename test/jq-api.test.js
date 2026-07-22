'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const jqHandler = require('../api/jq');

function callJq(body) {
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      end(rawBody) { resolve({ statusCode: this.statusCode, body: JSON.parse(rawBody) }); },
    };
    jqHandler({ method: 'POST', body }, response);
  });
}

test('captures a nested value', async () => {
  const response = await callJq({ mode: 'capture', filter: '.data.id', input: '{"data":{"id":42}}' });
  assert.deepEqual(response.body, { ok: true, value: '42' });
});

test('evaluates true and false assertions with jq exit semantics', async () => {
  const passing = await callJq({ mode: 'assert', filter: '.status == "ok"', input: '{"status":"ok"}' });
  const failing = await callJq({ mode: 'assert', filter: '.status == "ready"', input: '{"status":"ok"}' });
  assert.equal(passing.body.pass, true);
  assert.equal(failing.body.pass, false);
});

test('an assertion on a missing nested field fails cleanly instead of erroring', async () => {
  const response = await callJq({
    mode: 'assert',
    filter: '.data.seo.title | contains("expected")',
    input: '{"data":{"id":1}}',
  });
  assert.equal(response.body.ok, true);
  assert.equal(response.body.pass, false);
});
