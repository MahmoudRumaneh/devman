'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectEndpointVariables,
  extractVariableNames,
} = require('../public/variable-utils');

test('extracts unique variable references without partial or invalid names', () => {
  assert.deepEqual(
    extractVariableNames('${FIRST_ID}/${FIRST_ID}?timezone=${ORIGINAL_PROFILE_TIMEZONE} ${1_INVALID}'),
    ['FIRST_ID', 'ORIGINAL_PROFILE_TIMEZONE'],
  );
});

test('collects variables used and captured by an imported endpoint', () => {
  const variables = collectEndpointVariables({
    path: '/products/${FIRST_COURSE_ID}/buyers',
    authVar: 'CREATOR_TOKEN',
    headers: { 'X-Timezone': '${ORIGINAL_PROFILE_TIMEZONE}' },
    body: '{"timezone":"${ORIGINAL_PROFILE_TIMEZONE}"}',
    assert: ['.data.courseId == "${FIRST_COURSE_ID}"'],
    capture: { BUYER_ID: '.data.buyers[0].id' },
  });

  assert.deepEqual(variables, [
    {
      name: 'CREATOR_TOKEN',
      locations: ['Authorization'],
      used: true,
      captured: false,
      captureFilter: '',
    },
    {
      name: 'FIRST_COURSE_ID',
      locations: ['Path', 'Assertions'],
      used: true,
      captured: false,
      captureFilter: '',
    },
    {
      name: 'ORIGINAL_PROFILE_TIMEZONE',
      locations: ['Body', 'Headers'],
      used: true,
      captured: false,
      captureFilter: '',
    },
    {
      name: 'BUYER_ID',
      locations: [],
      used: false,
      captured: true,
      captureFilter: '.data.buyers[0].id',
    },
  ]);
});
