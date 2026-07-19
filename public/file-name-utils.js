(function exposeFileNameUtils(root, factory) {
  'use strict';

  const fileNameUtils = factory();
  if (typeof module === 'object' && module.exports) module.exports = fileNameUtils;
  if (root) root.DevmanFileNameUtils = fileNameUtils;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const INVALID_FILE_NAME_CHARACTERS = /[\u0000-\u001f\u007f/\\?%*:|"<>]/g;
  const TRAILING_FILE_NAME_CHARACTERS = /[.\s]+$/g;
  const REPEATED_DASHES = /-{2,}/g;
  const WINDOWS_RESERVED_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
  const MAX_FILE_NAME_LENGTH = 160;

  function sanitizeFileName(value, fallback = 'download') {
    const normalizedFallback = String(fallback || 'download').trim() || 'download';
    const sanitized = String(value ?? '')
      .normalize('NFKC')
      .trim()
      .replace(INVALID_FILE_NAME_CHARACTERS, '-')
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
