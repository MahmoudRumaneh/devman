'use strict';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
// Apply the same bounded transport-retry policy to every HTTP method supported
// by the proxy. A failed fetch has no usable upstream response, so excluding a
// method here makes otherwise recoverable connection failures permanent.
const RETRYABLE_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

class NetworkRequestError extends Error {
  constructor(cause, attempts) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(message, { cause });
    this.name = 'NetworkRequestError';
    this.attempts = attempts;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithNetworkRetry(input, init = {}, options = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const fetchImplementation = options.fetchImplementation || fetch;
  const sleep = options.sleep || wait;
  const configuredAttempts = Number.isInteger(options.maxAttempts) && options.maxAttempts > 0
    ? options.maxAttempts
    : DEFAULT_MAX_ATTEMPTS;
  const maxAttempts = RETRYABLE_METHODS.has(method) ? configuredAttempts : 1;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && options.retryDelayMs >= 0
    ? options.retryDelayMs
    : DEFAULT_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetchImplementation(input, init);
      return { response, attempts: attempt };
    } catch (error) {
      const canRetry = attempt < maxAttempts && !init.signal?.aborted;
      if (!canRetry) throw new NetworkRequestError(error, attempt);
      await sleep(retryDelayMs * (2 ** (attempt - 1)));
    }
  }

  throw new NetworkRequestError(new Error('Request failed'), maxAttempts);
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_DELAY_MS,
  NetworkRequestError,
  RETRYABLE_METHODS,
  fetchWithNetworkRetry,
};
