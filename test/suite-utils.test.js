'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { groupNameForStage } = require('../public/suite-utils');

test('uses the first non-empty goal as the imported group name', () => {
  const steps = [
    { stage: 10, name: 'first request' },
    { stage: 10, goal: '  Authenticate creator  ', name: 'second request' },
    { stage: 20, goal: 'Load dashboard', name: 'third request' },
  ];

  assert.equal(groupNameForStage(10, steps), 'Authenticate creator');
  assert.equal(groupNameForStage(20, steps), 'Load dashboard');
});

test('falls back to the stage label when no goal is provided', () => {
  assert.equal(groupNameForStage(30, [{ stage: 30, name: 'request' }]), 'Stage 30');
});
