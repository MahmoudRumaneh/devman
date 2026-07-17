'use strict';

const { getErrorMessage, getJsonBody, sendJson } = require('../lib/api');
const { importOpenApiFromUrl } = require('../lib/swagger-import');

module.exports = async function swaggerImport(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed' });
  }

  try {
    const payload = await getJsonBody(request);
    const url = typeof payload.url === 'string' ? payload.url : '';
    const imported = await importOpenApiFromUrl(url);
    return sendJson(response, 200, imported);
  } catch (error) {
    return sendJson(response, 400, { error: getErrorMessage(error) });
  }
};
