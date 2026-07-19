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

  return { normalizeAssertions };
}));
