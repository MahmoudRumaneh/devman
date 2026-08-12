'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIssueReportBody,
  buildIssueReportUrl,
} = require('../public/issue-report-utils');

test('buildIssueReportBody creates a structured report with diagnostics and a privacy reminder', () => {
  const body = buildIssueReportBody({
    'Devman API version': '1.0.0',
    'Workspace endpoints': 4,
    'Swagger imported': 'Yes',
  });

  assert.match(body, /^## What happened\?/);
  assert.match(body, /## Steps to reproduce/);
  assert.match(body, /- Devman API version: 1\.0\.0/);
  assert.match(body, /- Workspace endpoints: 4/);
  assert.match(body, /does not include URLs, tokens, tenant IDs, request bodies, or responses/);
});

test('buildIssueReportUrl safely encodes the issue title and body', () => {
  const reportUrl = buildIssueReportUrl(
    'https://github.com/MahmoudRumaneh/api-tool/issues/new',
    { Theme: 'Auto (dark)', Viewport: '390 x 844' },
  );
  const parsed = new URL(reportUrl);

  assert.equal(parsed.origin, 'https://github.com');
  assert.equal(parsed.pathname, '/MahmoudRumaneh/api-tool/issues/new');
  assert.equal(parsed.searchParams.get('title'), '[Bug] ');
  assert.match(parsed.searchParams.get('body'), /- Theme: Auto \(dark\)/);
  assert.match(parsed.searchParams.get('body'), /- Viewport: 390 x 844/);
});
