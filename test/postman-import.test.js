'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  countPostmanRequests,
  isPostmanCollection,
  postmanCollectionToSuite,
} = require('../public/postman-import');

const COLLECTION = {
  info: {
    name: 'Example API',
    _postman_id: 'collection-1',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'https://api.example.com/v1' },
    { key: 'accessToken', value: 'secret-token' },
    { key: 'userId', value: '42' },
  ],
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}' }] },
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Read user',
          request: {
            method: 'GET',
            auth: { type: 'inherit' },
            header: [{ key: 'X-Client', value: 'Devman' }],
            url: {
              raw: '{{baseUrl}}/users/:userId?expand=profile&hidden=yes',
              variable: [{ key: 'userId', value: '42' }],
              query: [
                { key: 'expand', value: 'profile' },
                { key: 'hidden', value: 'yes', disabled: true },
              ],
            },
          },
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            header: [],
            body: { mode: 'raw', raw: '{"name":"Ada"}', options: { raw: { language: 'json' } } },
            url: '{{baseUrl}}/users',
          },
        },
      ],
    },
  ],
};

test('recognizes and counts nested Postman v2 collections', () => {
  assert.equal(isPostmanCollection(COLLECTION), true);
  assert.equal(countPostmanRequests(COLLECTION), 2);
  assert.equal(isPostmanCollection({ info: {}, item: [] }), false);
  assert.equal(countPostmanRequests({
    info: { name: 'String request', _postman_id: 'string-request' },
    item: [{ name: 'Health', request: 'https://api.example.com/health' }],
  }), 1);
});

test('converts nested Postman requests, variables, auth, and raw bodies to a staged suite', () => {
  const suite = postmanCollectionToSuite(COLLECTION);

  assert.equal(suite.base_url, 'https://api.example.com/v1');
  assert.deepEqual(suite.vars, { ACCESS_TOKEN: 'secret-token', USER_ID: '42' });
  assert.deepEqual(suite.tokens, { ACCESS_TOKEN: 'secret-token' });
  assert.equal(suite.steps.length, 2);
  assert.equal(suite.steps[0].goal, 'Users');
  assert.equal(suite.steps[0].path, '/users/${USER_ID}?expand=profile');
  assert.equal(suite.steps[0].auth_var, 'ACCESS_TOKEN');
  assert.deepEqual(suite.steps[0].headers, { 'X-Client': 'Devman' });
  assert.equal(suite.steps[1].headers['Content-Type'], 'application/json');
  assert.equal(suite.steps[1].body, '{"name":"Ada"}');
});

test('converts urlencoded, multipart, binary, GraphQL, and API-key requests', () => {
  const suite = postmanCollectionToSuite({
    info: { name: 'Bodies', _postman_id: 'collection-2' },
    item: [
      {
        name: 'Encoded',
        request: {
          method: 'POST',
          url: 'https://api.example.com/form',
          body: { mode: 'urlencoded', urlencoded: [{ key: 'name', value: 'A B' }] },
        },
      },
      {
        name: 'Upload',
        request: {
          method: 'POST',
          url: 'https://api.example.com/upload',
          body: { mode: 'formdata', formdata: [
            { key: 'title', value: 'Cover', type: 'text' },
            { key: 'asset', type: 'file', src: '/tmp/cover.png' },
          ] },
        },
      },
      {
        name: 'Binary',
        request: { method: 'PUT', url: 'https://api.example.com/file', body: { mode: 'file', file: { src: '/tmp/a.pdf' } } },
      },
      {
        name: 'GraphQL',
        request: {
          method: 'POST',
          url: 'https://api.example.com/graphql',
          body: { mode: 'graphql', graphql: { query: 'query { viewer { id } }', variables: '{}' } },
        },
      },
      {
        name: 'API key',
        request: {
          method: 'GET',
          url: 'https://api.example.com/private',
          auth: { type: 'apikey', apikey: [
            { key: 'key', value: 'X-API-Key' },
            { key: 'value', value: 'key-value' },
            { key: 'in', value: 'header' },
          ] },
        },
      },
    ],
  });

  assert.equal(suite.steps[0].body, 'name=A%20B');
  assert.equal(suite.steps[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(suite.steps[1].bodyMode, 'multipart');
  assert.equal(suite.steps[1].formData[1].file.name, 'cover.png');
  assert.equal(suite.steps[2].bodyMode, 'binary');
  assert.equal(suite.steps[2].binaryFile.name, 'a.pdf');
  assert.deepEqual(JSON.parse(suite.steps[3].body), { query: 'query { viewer { id } }', variables: {} });
  assert.equal(suite.steps[4].headers['X-API-Key'], 'key-value');
});
