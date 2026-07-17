'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkRequestError, fetchWithNetworkRetry } = require('../lib/fetch-retry');

test('retries a transient GET failure and returns the attempt count', async () => {
  let calls = 0;
  const expectedResponse = { status: 200 };
  const fetchImplementation = async () => {
    calls += 1;
    if (calls < 3) throw new TypeError('fetch failed');
    return expectedResponse;
  };

  const result = await fetchWithNetworkRetry('https://example.com', { method: 'GET' }, {
    fetchImplementation,
    sleep: async () => {},
  });

  assert.equal(result.response, expectedResponse);
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
});

test('does not retry a mutating request', async () => {
  let calls = 0;
  const fetchImplementation = async () => {
    calls += 1;
    throw new TypeError('fetch failed');
  };

  await assert.rejects(
    fetchWithNetworkRetry('https://example.com', { method: 'POST' }, { fetchImplementation }),
    (error) => error instanceof NetworkRequestError && error.attempts === 1,
  );
  assert.equal(calls, 1);
});

test('does not retry after the shared timeout signal aborts', async () => {
  let calls = 0;
  const controller = new AbortController();
  const fetchImplementation = async () => {
    calls += 1;
    controller.abort();
    throw new DOMException('Timed out', 'TimeoutError');
  };

  await assert.rejects(
    fetchWithNetworkRetry('https://example.com', {
      method: 'GET',
      signal: controller.signal,
    }, { fetchImplementation }),
    (error) => error instanceof NetworkRequestError && error.attempts === 1,
  );
  assert.equal(calls, 1);
});
