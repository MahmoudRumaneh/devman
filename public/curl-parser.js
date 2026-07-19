(function exposeCurlParser(root, factory) {
  'use strict';

  const parser = factory();
  if (typeof module === 'object' && module.exports) module.exports = parser;
  if (root) root.DevmanCurlParser = parser;
}(typeof window !== 'undefined' ? window : null, () => {
  'use strict';

  const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
  const VALUE_OPTIONS = new Set([
    '--cacert', '--cert', '--connect-timeout', '--dns-interface', '--interface', '--key',
    '--limit-rate', '--max-time', '--output', '--proto', '--proxy', '--request-target',
    '--resolve', '--retry', '--retry-delay', '--tls-max', '--write-out', '-o', '-w', '-x',
  ]);
  const FLAG_OPTIONS = new Set([
    '--compressed', '--fail', '--fail-with-body', '--http1.0', '--http1.1', '--http2',
    '--http2-prior-knowledge', '--include', '--insecure', '--location', '--location-trusted',
    '--no-buffer', '--path-as-is', '--show-error', '--silent', '--ssl-no-revoke', '--verbose',
    '-0', '-1', '-2', '-i', '-k', '-l', '-n', '-s', '-sS', '-v',
  ]);
  const SHELL_DIALECT = Object.freeze({
    POSIX: 'posix',
    WINDOWS_CMD: 'windows-cmd',
    POWERSHELL: 'powershell',
  });

  function isCurlExecutable(value) {
    return /(?:^|[\\/])curl(?:\.exe)?$/i.test(value);
  }

  function splitCurlCommands(text) {
    const commands = [];
    let current = [];
    String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach((line) => {
      const startsCommand = /^\s*(?:\$\s*)?(?:[^\s]*[\\/])?curl(?:\.exe)?(?:\s|$)/i.test(line);
      const previousContinues = current.length > 0 && /[\\^`]\s*$/.test(current[current.length - 1]);
      if (startsCommand && current.length && !previousContinues) {
        commands.push(current.join('\n'));
        current = [];
      }
      if (line.trim() || current.length) current.push(line);
    });
    if (current.some((line) => line.trim())) commands.push(current.join('\n'));
    return commands;
  }

  function detectShellDialect(text) {
    if (/(?:^|\s)\^"|\^\s*(?:\n|$)/m.test(text)) return SHELL_DIALECT.WINDOWS_CMD;
    if (/`["'$`]|`\s*(?:\n|$)/m.test(text)) return SHELL_DIALECT.POWERSHELL;
    return SHELL_DIALECT.POSIX;
  }

  function normalizeWindowsCmd(text) {
    let normalized = '';
    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '^' && index + 1 < text.length) {
        index += 1;
        normalized += text[index] === '\n' ? '\\\n' : text[index];
      } else {
        normalized += text[index];
      }
    }
    return normalized;
  }

  function normalizePowerShell(text) {
    let normalized = '';
    let quote = '';

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (quote === "'") {
        if (character === "'" && next === "'") {
          normalized += "'\"'\"'";
          index += 1;
        } else {
          normalized += character;
          if (character === "'") quote = '';
        }
        continue;
      }

      if (character === '`' && index + 1 < text.length) {
        index += 1;
        if (next === '\n') normalized += '\\\n';
        else if ('"\\\'#'.includes(next)) normalized += `\\${next}`;
        else if (/\s/.test(next)) normalized += quote === '"' ? next : `\\${next}`;
        else normalized += next;
        continue;
      }

      normalized += character;
      if (!quote && (character === "'" || character === '"')) quote = character;
      else if (quote === '"' && character === '"') quote = '';
    }

    return normalized;
  }

  function normalizeShellSyntax(text) {
    const normalizedNewlines = String(text || '').replace(/\r\n?/g, '\n');
    const dialect = detectShellDialect(normalizedNewlines);
    if (dialect === SHELL_DIALECT.WINDOWS_CMD) return normalizeWindowsCmd(normalizedNewlines);
    if (dialect === SHELL_DIALECT.POWERSHELL) return normalizePowerShell(normalizedNewlines);
    return normalizedNewlines;
  }

  function tokenizeShell(text) {
    const normalizedText = normalizeShellSyntax(text);
    const tokens = [];
    let token = '';
    let quote = '';
    let tokenStarted = false;
    let line = 1;
    let tokenLine = 1;

    const pushToken = () => {
      if (!tokenStarted) return;
      tokens.push({ value: token, line: tokenLine });
      token = '';
      tokenStarted = false;
    };

    for (let index = 0; index < normalizedText.length; index += 1) {
      const character = normalizedText[index];
      if (character === '\n') line += 1;

      if (quote === "'") {
        if (character === "'") quote = '';
        else token += character;
        continue;
      }
      if (quote === '"') {
        if (character === '"') {
          quote = '';
        } else if (character === '\\' && index + 1 < normalizedText.length) {
          const next = normalizedText[index + 1];
          if (next === '\n') {
            index += 1;
            line += 1;
          } else if ('\\"$`'.includes(next)) {
            token += next;
            index += 1;
          } else {
            token += character;
          }
        } else {
          token += character;
        }
        continue;
      }

      if (character === "'" || character === '"') {
        if (!tokenStarted) tokenLine = line;
        tokenStarted = true;
        quote = character;
      } else if (character === '\\') {
        if (normalizedText[index + 1] === '\n') {
          index += 1;
          line += 1;
        } else if (index + 1 < normalizedText.length) {
          if (!tokenStarted) tokenLine = line;
          tokenStarted = true;
          token += normalizedText[index + 1];
          index += 1;
        } else {
          return { tokens, issue: { line, message: 'The cURL command ends with an unfinished escape' } };
        }
      } else if (/\s/.test(character)) {
        pushToken();
      } else if (character === '#' && !tokenStarted) {
        while (index + 1 < normalizedText.length && normalizedText[index + 1] !== '\n') index += 1;
      } else {
        if (!tokenStarted) tokenLine = line;
        tokenStarted = true;
        token += character;
      }
    }

    if (quote) return { tokens, issue: { line, message: 'The cURL command contains an unclosed quote' } };
    pushToken();
    return { tokens, issue: null };
  }

  function assignHeader(headers, name, value) {
    const normalizedName = name.trim();
    if (!normalizedName) return;
    const existingName = Object.keys(headers)
      .find((candidate) => candidate.toLowerCase() === normalizedName.toLowerCase());
    if (existingName && existingName !== normalizedName) delete headers[existingName];
    headers[normalizedName] = value;
  }

  function removeHeader(headers, name) {
    const existingName = Object.keys(headers)
      .find((candidate) => candidate.toLowerCase() === name.toLowerCase());
    if (existingName) delete headers[existingName];
  }

  function parseHeader(value, headers, line, issues) {
    const separator = value.indexOf(':');
    if (separator > 0) {
      assignHeader(headers, value.slice(0, separator), value.slice(separator + 1).trimStart());
      return;
    }
    if (value.endsWith(';') && value.length > 1) {
      assignHeader(headers, value.slice(0, -1), '');
      return;
    }
    issues.push({ line, message: `Invalid cURL header “${value}”` });
  }

  function fileNameFromPath(path) {
    return String(path || '').split(/[\\/]/).filter(Boolean).pop() || 'upload.bin';
  }

  function parseFormPart(value, line, issues, forceText = false) {
    const separator = value.indexOf('=');
    if (separator < 1) {
      issues.push({ line, message: `Invalid multipart field “${value}”` });
      return null;
    }
    const name = value.slice(0, separator);
    const rawValue = value.slice(separator + 1);
    if (rawValue.startsWith('<')) {
      issues.push({ line, message: `Multipart field “${name}” reads text from a local file, which must be entered manually` });
      return null;
    }
    if (forceText || !rawValue.startsWith('@')) {
      return { name, kind: 'text', value: rawValue, file: null };
    }

    const segments = rawValue.slice(1).split(';');
    const path = segments.shift() || '';
    let type = '';
    let declaredName = '';
    segments.forEach((segment) => {
      const equalsIndex = segment.indexOf('=');
      const key = equalsIndex < 0 ? segment : segment.slice(0, equalsIndex);
      const optionValue = equalsIndex < 0 ? '' : segment.slice(equalsIndex + 1);
      if (key === 'type') type = optionValue;
      if (key === 'filename') declaredName = optionValue;
    });
    const fileName = declaredName || fileNameFromPath(path);
    return { name, kind: 'file', value: '', file: { name: fileName, type, size: 0 } };
  }

  function optionWithInlineValue(argument, shortOption, longOption) {
    if (argument.startsWith(`${longOption}=`)) return argument.slice(longOption.length + 1);
    if (argument.startsWith(shortOption) && argument !== shortOption && !argument.startsWith('--')) {
      return argument.slice(shortOption.length);
    }
    return null;
  }

  function basicAuthorization(credentials) {
    const bytes = new TextEncoder().encode(credentials);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return `Basic ${btoa(binary)}`;
  }

  function parseCurlCommand(commandText, commandIndex) {
    const tokenized = tokenizeShell(commandText);
    const issues = tokenized.issue ? [tokenized.issue] : [];
    const tokens = tokenized.tokens;
    if (!tokens.length) return { route: null, issues };
    if (tokens[0].value === '$') tokens.shift();
    if (!tokens.length || !isCurlExecutable(tokens[0].value)) {
      return { route: null, issues: [{ line: tokens[0]?.line || 1, message: 'A cURL command must start with curl' }] };
    }

    let method = '';
    let url = '';
    let forceGet = false;
    let forceHead = false;
    let usedJson = false;
    const headers = {};
    const cookies = [];
    const dataValues = [];
    const formData = [];
    let binaryFile = null;

    const takeNext = (index, option) => {
      const next = tokens[index + 1];
      if (!next) {
        issues.push({ line: tokens[index].line, message: `${option} is missing its value` });
        return null;
      }
      return next;
    };

    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      const argument = token.value;
      let inlineValue;
      let next;

      inlineValue = optionWithInlineValue(argument, '-X', '--request');
      if (argument === '-X' || argument === '--request' || argument.startsWith('--request=') || inlineValue !== null) {
        next = inlineValue !== null ? { value: inlineValue, line: token.line } : takeNext(index, argument);
        if (inlineValue === null) index += 1;
        if (next) method = next.value.toUpperCase();
        continue;
      }
      inlineValue = optionWithInlineValue(argument, '-H', '--header');
      if (argument === '-H' || argument === '--header' || argument.startsWith('--header=') || inlineValue !== null) {
        next = inlineValue !== null ? { value: inlineValue, line: token.line } : takeNext(index, argument);
        if (inlineValue === null) index += 1;
        if (next) parseHeader(next.value, headers, next.line, issues);
        continue;
      }
      inlineValue = optionWithInlineValue(argument, '-b', '--cookie');
      if (argument === '-b' || argument === '--cookie' || argument.startsWith('--cookie=') || inlineValue !== null) {
        next = inlineValue !== null ? { value: inlineValue, line: token.line } : takeNext(index, argument);
        if (inlineValue === null) index += 1;
        if (next?.value.startsWith('@')) issues.push({ line: next.line, message: 'Cookie files cannot be imported; paste the cookie value instead' });
        else if (next) cookies.push(next.value);
        continue;
      }
      if (argument === '--url' || argument.startsWith('--url=')) {
        next = argument.startsWith('--url=') ? { value: argument.slice(6), line: token.line } : takeNext(index, argument);
        if (!argument.startsWith('--url=')) index += 1;
        if (next) url = next.value;
        continue;
      }
      if (argument === '--json' || argument.startsWith('--json=')) {
        next = argument.startsWith('--json=') ? { value: argument.slice(7), line: token.line } : takeNext(index, argument);
        if (!argument.startsWith('--json=')) index += 1;
        if (next?.value.startsWith('@')) issues.push({ line: next.line, message: 'JSON files cannot be read from your device; paste the JSON value instead' });
        else if (next) dataValues.push(next.value);
        usedJson = true;
        continue;
      }
      const dataOption = ['-d', '--data', '--data-raw', '--data-binary', '--data-urlencode']
        .find((option) => argument === option || argument.startsWith(`${option}=`) ||
          (option === '-d' && argument.startsWith('-d') && argument !== '-d' && !argument.startsWith('--')));
      if (dataOption) {
        const inlineData = argument.startsWith(`${dataOption}=`)
          ? argument.slice(dataOption.length + 1)
          : dataOption === '-d' && argument !== '-d' ? argument.slice(2) : null;
        next = inlineData !== null ? { value: inlineData, line: token.line } : takeNext(index, argument);
        if (inlineData === null) index += 1;
        if (next?.value.startsWith('@')) {
          if (dataOption === '--data-binary') {
            binaryFile = { name: fileNameFromPath(next.value.slice(1)), type: '', size: 0 };
          } else {
            issues.push({ line: next.line, message: `${dataOption} reads a local file; paste its contents instead` });
          }
        } else if (next) {
          dataValues.push(next.value);
        }
        continue;
      }
      const formOption = argument === '-F' || argument === '--form' || argument === '--form-string' ||
        argument.startsWith('--form=') || argument.startsWith('--form-string=') ||
        (argument.startsWith('-F') && argument !== '-F' && !argument.startsWith('--'));
      if (formOption) {
        const separatorIndex = argument.indexOf('=');
        const inlineForm = argument.startsWith('-F') && argument !== '-F'
          ? argument.slice(2)
          : separatorIndex > 0 ? argument.slice(separatorIndex + 1) : null;
        next = inlineForm !== null ? { value: inlineForm, line: token.line } : takeNext(index, argument);
        if (inlineForm === null) index += 1;
        if (next) {
          const part = parseFormPart(next.value, next.line, issues, argument.startsWith('--form-string'));
          if (part) formData.push(part);
        }
        continue;
      }
      if (argument === '-T' || argument === '--upload-file' || argument.startsWith('--upload-file=')) {
        next = argument.startsWith('--upload-file=')
          ? { value: argument.slice(14), line: token.line }
          : takeNext(index, argument);
        if (!argument.startsWith('--upload-file=')) index += 1;
        if (next) binaryFile = { name: fileNameFromPath(next.value), type: '', size: 0 };
        if (!method) method = 'PUT';
        continue;
      }
      if (argument === '-A' || argument === '--user-agent' || argument.startsWith('--user-agent=')) {
        next = argument.startsWith('--user-agent=')
          ? { value: argument.slice(13), line: token.line }
          : takeNext(index, argument);
        if (!argument.startsWith('--user-agent=')) index += 1;
        if (next) assignHeader(headers, 'User-Agent', next.value);
        continue;
      }
      if (argument === '-e' || argument === '--referer' || argument.startsWith('--referer=')) {
        next = argument.startsWith('--referer=')
          ? { value: argument.slice(10), line: token.line }
          : takeNext(index, argument);
        if (!argument.startsWith('--referer=')) index += 1;
        if (next) assignHeader(headers, 'Referer', next.value);
        continue;
      }
      if (argument === '--oauth2-bearer' || argument.startsWith('--oauth2-bearer=')) {
        next = argument.startsWith('--oauth2-bearer=')
          ? { value: argument.slice(16), line: token.line }
          : takeNext(index, argument);
        if (!argument.startsWith('--oauth2-bearer=')) index += 1;
        if (next) assignHeader(headers, 'Authorization', `Bearer ${next.value}`);
        continue;
      }
      inlineValue = optionWithInlineValue(argument, '-u', '--user');
      if (argument === '-u' || argument === '--user' || argument.startsWith('--user=') || inlineValue !== null) {
        next = inlineValue !== null ? { value: inlineValue, line: token.line } : takeNext(index, argument);
        if (inlineValue === null) index += 1;
        if (next) assignHeader(headers, 'Authorization', basicAuthorization(next.value));
        continue;
      }
      if (argument === '-I' || argument === '--head') { forceHead = true; continue; }
      if (argument === '-G' || argument === '--get') { forceGet = true; continue; }
      if (argument === '--next') {
        issues.push({ line: token.line, message: 'Use a separate cURL command instead of --next' });
        continue;
      }
      if (VALUE_OPTIONS.has(argument) || [...VALUE_OPTIONS].some((option) => argument.startsWith(`${option}=`))) {
        if (!argument.includes('=')) index += 1;
        continue;
      }
      if (FLAG_OPTIONS.has(argument)) continue;
      if (argument.startsWith('-')) {
        issues.push({ line: token.line, message: `Unsupported cURL option “${argument}”` });
        continue;
      }
      if (!url) url = argument;
      else issues.push({ line: token.line, message: `Unexpected cURL value “${argument}”` });
    }

    if (!url) issues.push({ line: 1, message: 'The cURL command is missing a URL' });
    else {
      try {
        const parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('unsupported protocol');
      } catch (_) {
        issues.push({ line: 1, message: 'The cURL URL must be a complete HTTP or HTTPS URL' });
      }
    }
    if (method && !HTTP_METHODS.has(method)) issues.push({ line: 1, message: `Unsupported method “${method}”` });

    if (cookies.length) assignHeader(headers, 'Cookie', cookies.join('; '));
    removeHeader(headers, 'Content-Length');
    if (usedJson) {
      if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
        assignHeader(headers, 'Content-Type', 'application/json');
      }
      if (!Object.keys(headers).some((name) => name.toLowerCase() === 'accept')) {
        assignHeader(headers, 'Accept', 'application/json');
      }
    }

    let finalUrl = url;
    if (forceGet && dataValues.length) {
      finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${dataValues.join('&')}`;
    }
    const bodyMode = formData.length ? 'multipart' : binaryFile ? 'binary' : 'raw';
    const inferredMethod = formData.length || binaryFile || dataValues.length ? 'POST' : 'GET';
    const finalMethod = forceHead ? 'HEAD' : forceGet ? 'GET' : method || inferredMethod;
    const body = forceGet ? '' : dataValues.join('&');
    const route = issues.length ? null : {
      method: finalMethod,
      path: finalUrl,
      headers,
      body,
      bodyMode,
      formData,
      binaryFile,
      role: 'none',
      authVar: '',
      note: `Imported from cURL${commandIndex > 0 ? ` ${commandIndex + 1}` : ''}`,
    };
    return { route, issues };
  }

  function parseCurlText(text) {
    const commands = splitCurlCommands(text);
    const routes = [];
    const issues = [];
    commands.forEach((command, index) => {
      const parsed = parseCurlCommand(command, index);
      if (parsed.route) routes.push(parsed.route);
      parsed.issues.forEach((issue) => issues.push({
        ...issue,
        command: index + 1,
      }));
    });
    return { routes, issues, sourceType: 'curl' };
  }

  function looksLikeCurl(text) {
    const withoutLeadingComments = String(text || '').replace(/^\s*(?:#[^\n]*(?:\n|$)\s*)*/, '');
    return /^(?:\$\s*)?(?:[^\s]*[\\/])?curl(?:\.exe)?(?:\s|$)/i.test(withoutLeadingComments);
  }

  return { looksLikeCurl, parseCurlText, tokenizeShell };
}));
