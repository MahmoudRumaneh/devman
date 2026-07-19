(function exposeSuiteUtils(root, factory) {
  'use strict';

  const suiteUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = suiteUtils;
  if (root) root.DevmanSuiteUtils = suiteUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function groupNameForStage(stage, steps) {
    const matchingStep = (Array.isArray(steps) ? steps : []).find((step) =>
      isRecord(step) &&
      (step.stage ?? 0) === stage &&
      typeof step.goal === 'string' &&
      step.goal.trim());
    return matchingStep ? matchingStep.goal.trim() : `Stage ${stage}`;
  }

  return { groupNameForStage };
}));
