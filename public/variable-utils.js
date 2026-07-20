(function exposeVariableUtils(root, factory) {
  'use strict';

  const variableUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = variableUtils;
  if (root) root.DevmanVariableUtils = variableUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const VARIABLE_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

  function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  function extractVariableNames(value) {
    if (typeof value !== 'string' || !value) return [];
    return [...new Set([...value.matchAll(VARIABLE_REFERENCE_PATTERN)].map((match) => match[1]))];
  }

  function collectEndpointVariables(row) {
    if (!isRecord(row)) return [];
    const variables = new Map();
    const ensure = (name) => {
      if (!VARIABLE_NAME_PATTERN.test(name)) return null;
      if (!variables.has(name)) {
        variables.set(name, {
          name,
          locations: new Set(),
          used: false,
          captured: false,
          captureFilter: '',
        });
      }
      return variables.get(name);
    };
    const collect = (value, location) => {
      extractVariableNames(value).forEach((name) => {
        const variable = ensure(name);
        if (!variable) return;
        variable.used = true;
        variable.locations.add(location);
      });
    };

    collect(row.path, 'Path');
    collect(row.body, 'Body');
    if (isRecord(row.headers)) {
      Object.values(row.headers).forEach((value) => collect(value, 'Headers'));
    }
    if (Array.isArray(row.formData)) {
      row.formData.forEach((part) => {
        if (isRecord(part)) collect(part.value, 'Form data');
      });
    }
    const assertions = Array.isArray(row.assert) ? row.assert : [row.assert];
    assertions.forEach((assertion) => collect(assertion, 'Assertions'));

    if (typeof row.authVar === 'string' && VARIABLE_NAME_PATTERN.test(row.authVar)) {
      const variable = ensure(row.authVar);
      variable.used = true;
      variable.locations.add('Authorization');
    }

    if (isRecord(row.capture)) {
      Object.entries(row.capture).forEach(([name, filter]) => {
        const variable = ensure(name);
        if (!variable) return;
        variable.captured = true;
        variable.captureFilter = typeof filter === 'string' ? filter : '';
      });
    }

    return [...variables.values()]
      .map((variable) => ({ ...variable, locations: [...variable.locations] }))
      .sort((left, right) => Number(right.used) - Number(left.used) || left.name.localeCompare(right.name));
  }

  return { collectEndpointVariables, extractVariableNames };
}));
