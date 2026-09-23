# cURL import

Paste one or more complete cURL commands into **Quick add endpoints** and Devman API imports the method, URL, headers, cookies, body, and supported upload definitions.

Live version of this page: **[devman-api.com/curl-api-testing](https://devman-api.com/curl-api-testing)**.

## Supported syntax

Bash (single-quoted, backslash line continuations), PowerShell (backtick continuations), and Windows Command Prompt (caret continuations) are all parsed automatically — paste a command as-is from whichever shell it was copied from.

```bash
curl 'https://api.example.com/users' \
  -X POST \
  -H 'authorization: Bearer ${API_TOKEN}' \
  -H 'content-type: application/json' \
  --data '{"name":"Ada"}'
```

## Multiple commands at once

Paste several complete cURL commands into the same box — each one becomes its own request row.

## What's imported, what isn't

The HTTP method, URL, headers, cookies, and request body (raw, URL-encoded, multipart, or binary) are all imported, including multipart file-upload field placeholders.

File paths referenced in a pasted command (`-F`, `--data-binary @file`, etc.) are **never read from disk automatically**, for security. Reselect the upload file in the browser before running that request.

## See also

- [OpenAPI & Swagger import](openapi.md)
- [Postman collection import](postman.md)
- [Getting started](getting-started.md)
