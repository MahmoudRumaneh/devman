'use strict';

const { raw } = require('jq-wasm/inline');
const { getErrorMessage, getJsonBody, sendJson } = require('../lib/api');

module.exports = async function jq(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  try {
    const payload = await getJsonBody(request);
    const mode = payload.mode === 'assert' ? 'assert' : 'capture';
    const filter = typeof payload.filter === 'string' ? payload.filter : '.';
    const input = typeof payload.input === 'string' ? payload.input : '';
    JSON.parse(input);

    if (mode === 'assert') {
      const result = await raw(input, `try (${filter}) catch false`, ['-e']);
      if (result.stderr && result.exitCode > 1) {
        return sendJson(response, 200, { ok: false, error: result.stderr.trim() });
      }
      return sendJson(response, 200, { ok: true, pass: result.exitCode === 0 });
    }

    const result = await raw(input, `(${filter}) // empty`, ['-r']);
    if (result.exitCode !== 0) return sendJson(response, 200, { ok: false, error: result.stderr.trim() });
    return sendJson(response, 200, { ok: true, value: result.stdout.trim() });
  } catch (error) {
    return sendJson(response, 200, { ok: false, error: getErrorMessage(error) });
  }
};
