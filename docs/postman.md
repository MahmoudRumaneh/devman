# Postman collection import

Devman API imports Postman Collection v2.0 and v2.1 JSON exports directly — no conversion step.

Live version of this page: **[devman-api.com/postman-alternative](https://devman-api.com/postman-alternative)** (includes a full feature comparison with Postman).

## What's supported

- Nested folders
- Collection variables
- Bearer tokens and API keys
- Raw, URL-encoded, multipart, binary, and GraphQL request bodies

## What's not

Postman environments are separate files and aren't embedded in a collection export — collection variables import automatically, but you'll need to enter any missing environment values yourself through Devman's variable controls (see [variables.md](variables.md)).

Postman pre-request scripts, test scripts, certificates, proxy settings, and unsupported authentication schemes are not executed. Recreate the relevant checks with Devman variables and [jq assertions](assertions.md) instead.

## Importing

Drop the exported collection JSON onto the workspace, or use **Import JSON / Postman** in the app. Choose to replace the current workspace or append the imported groups after your existing ones.

## Devman API vs Postman

For a full, sourced feature-by-feature comparison — including where Postman is ahead (AI test generation, hosted Flows, team collaboration) — see [devman-api.com/postman-alternative](https://devman-api.com/postman-alternative).

## See also

- [OpenAPI & Swagger import](openapi.md)
- [cURL import](curl.md)
- [Getting started](getting-started.md)
