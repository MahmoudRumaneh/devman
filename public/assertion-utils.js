(function exposeAssertionUtils(root, factory) {
  'use strict';

  const assertionUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = assertionUtils;
  if (root) root.DevmanAssertionUtils = assertionUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  function normalizeAssertions(value) {
    if (Array.isArray(value)) {
      return value
        .filter((assertion) => typeof assertion === 'string')
        .map((assertion) => assertion.trim())
        .filter(Boolean);
    }

    if (typeof value !== 'string') return [];
    const assertion = value.trim();
    if (!assertion) return [];

    try {
      const parsed = JSON.parse(assertion);
      if (Array.isArray(parsed)) return normalizeAssertions(parsed);
    } catch (_) {
      // A plain jq expression is the normal single-assertion representation.
    }

    return [assertion];
  }

  function isQueryParameterEchoAssertion(expression, requestUrl) {
    if (typeof expression !== 'string' || typeof requestUrl !== 'string') return false;
    const match = expression.trim().match(
      /^\.data\.([A-Za-z_][A-Za-z0-9_]*)\s*==\s*("(?:[^"\\]|\\.)*")$/,
    );
    if (!match) return false;

    try {
      const expectedValue = JSON.parse(match[2]);
      const queryValue = new URL(requestUrl).searchParams.get(match[1]);
      return typeof expectedValue === 'string' && queryValue === expectedValue;
    } catch (_) {
      return false;
    }
  }

  return { isQueryParameterEchoAssertion, normalizeAssertions };
}));
