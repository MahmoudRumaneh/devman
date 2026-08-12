(function exposeFileNameUtils(root, factory) {
  'use strict';

  const fileNameUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = fileNameUtils;
  if (root) root.DevmanFileNameUtils = fileNameUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const INVALID_FILE_NAME_CHARACTERS = new Set('/\\?%*:|"<>');
  const TRAILING_FILE_NAME_CHARACTERS = /[.\s]+$/g;
  const REPEATED_DASHES = /-{2,}/g;
  const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const MAX_FILE_NAME_LENGTH = 160;

  function replaceInvalidFileNameCharacters(value) {
    return [...value].map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || INVALID_FILE_NAME_CHARACTERS.has(character)
        ? '-'
        : character;
    }).join('');
  }

  function sanitizeFileName(value, fallback = 'download') {
    const normalizedFallback = String(fallback || 'download').trim() || 'download';
    const normalizedValue = String(value ?? '').normalize('NFKC').trim();
    const sanitized = replaceInvalidFileNameCharacters(normalizedValue)
      .replace(REPEATED_DASHES, '-')
      .replace(TRAILING_FILE_NAME_CHARACTERS, '')
      .slice(0, MAX_FILE_NAME_LENGTH)
      .replace(TRAILING_FILE_NAME_CHARACTERS, '');
    if (!sanitized || sanitized === '.' || sanitized === '..') return normalizedFallback;
    return WINDOWS_RESERVED_FILE_NAME.test(sanitized) ? `-${sanitized}` : sanitized;
  }

  function fileNameWithExtension(value, extension, fallback = 'download') {
    const normalizedExtension = String(extension || '').startsWith('.')
      ? String(extension)
      : `.${String(extension || '')}`;
    const safeName = sanitizeFileName(value, fallback);
    if (!normalizedExtension || normalizedExtension === '.') return safeName;
    return safeName.toLowerCase().endsWith(normalizedExtension.toLowerCase())
      ? safeName
      : `${safeName}${normalizedExtension}`;
  }

  return { fileNameWithExtension, sanitizeFileName };
}));
