'use strict';

const jqPromise = require('jq-web');
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
    const parsedInput = JSON.parse(input);
    const jq = await jqPromise;
    const result = jq.json(parsedInput, filter);

    if (mode === 'assert') return sendJson(response, 200, { ok: true, pass: Boolean(result) });

    const value = result === null || result === undefined
      ? ''
      : typeof result === 'object' ? JSON.stringify(result) : String(result);
    return sendJson(response, 200, { ok: true, value });
  } catch (error) {
    return sendJson(response, 200, { ok: false, error: getErrorMessage(error) });
  }
};
