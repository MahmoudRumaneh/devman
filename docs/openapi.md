# OpenAPI & Swagger import

Devman API imports OpenAPI 3.x and Swagger 2.0 documents — JSON or YAML — and turns every documented operation into a request-ready row.

Live version of this page: **[devman-api.com/openapi-testing](https://devman-api.com/openapi-testing)** and **[devman-api.com/swagger-testing](https://devman-api.com/swagger-testing)**.

## What you can paste

- A direct OpenAPI 3.x or Swagger 2.0 document URL (JSON or YAML)
- The URL of a **Swagger UI page** — Devman API discovers the embedded spec document automatically, no need to find the raw file URL

## What gets mapped automatically

- The document's `servers` entry (OpenAPI 3.x) can be used as your workspace Base URL — optional, on by default during import.
- Path, query, header, and cookie parameters, including their examples, prefill each request.
- JSON, text, URL-encoded, multipart, and binary request body examples prefill the body.
- `securitySchemes` (OpenAPI 3.x) or `securityDefinitions` (Swagger 2.0) — bearer, basic, and API key (header, cookie, or query) — map to token variables automatically, so secured operations send the right auth without manual header editing.

```yaml
openapi: 3.0.3
servers:
  - url: https://api.example.com/v1
paths:
  /users/{id}:
    get:
      security:
        - bearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema: { type: string }
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

## What's not converted

OpenAPI callbacks, webhooks, and non-HTTP operations are not turned into executable rows.

## Swagger UI behind a login

The import fetches the Swagger UI page or spec document directly, without credentials. Pages that require a login typically won't resolve — download the spec file and import it directly instead.

## Refreshing after the spec changes

Re-run the import and choose to **replace** the current endpoints or **append** only the new ones, skipping duplicate method/path pairs.

## See also

- [Postman collection import](postman.md)
- [cURL import](curl.md)
- [Getting started](getting-started.md)
