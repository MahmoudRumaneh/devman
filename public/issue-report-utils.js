(function exposeIssueReportUtils(root, factory) {
  'use strict';

  const issueReportUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = issueReportUtils;
  if (root) root.DevmanIssueReportUtils = issueReportUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const DEFAULT_ISSUE_TITLE = '[Bug] ';

  function buildIssueReportBody(diagnostics) {
    const diagnosticLines = Object.entries(diagnostics)
      .map(([label, value]) => `- ${label}: ${String(value)}`);

    return [
      '## What happened?',
      '',
      'Please describe the problem and what you were trying to do.',
      '',
      '## Steps to reproduce',
      '',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## Expected behavior',
      '',
      'What did you expect Devman API to do?',
      '',
      '## Auto-generated diagnostics',
      '',
      ...diagnosticLines,
      '',
      '> For your safety, Devman API does not include URLs, tokens, tenant IDs, request bodies, or responses here. Remove anything else you do not want to share publicly.',
      '',
      '## Extra notes',
      '',
      'Add screenshots or a screen recording if they would help explain the problem.',
    ].join('\n');
  }

  function buildIssueReportUrl(baseUrl, diagnostics) {
    const url = new URL(baseUrl);
    url.searchParams.set('title', DEFAULT_ISSUE_TITLE);
    url.searchParams.set('body', buildIssueReportBody(diagnostics));
    return url.toString();
  }

  return { buildIssueReportBody, buildIssueReportUrl };
}));
