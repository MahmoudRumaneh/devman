'use strict';

const MAX_BODY_BYTES = 1_000_000;

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function getJsonBody(request) {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return Promise.resolve(request.body);
  }

  if (typeof request.body === 'string' || Buffer.isBuffer(request.body)) {
    return Promise.resolve(JSON.parse(request.body.toString('utf-8')));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;

    request.on('data', (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

module.exports = { getErrorMessage, getJsonBody, sendJson };
