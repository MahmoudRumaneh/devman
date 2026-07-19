'use strict';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;
// API test runs commonly use PUT, PATCH, and DELETE for idempotent state
// transitions. Retrying their transient transport failures makes those runs as
// resilient as reads while POST remains single-attempt because it normally
// creates a new resource on every call.
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']);

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
