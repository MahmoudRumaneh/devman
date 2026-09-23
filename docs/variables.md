# Variables

Devman API lets you reuse values — tokens, IDs, anything — across requests with `${VARIABLE_NAME}` placeholders, without hardcoding them into every path or body.

## Placeholders

Use `${VARIABLE_NAME}` anywhere in a path, header, or body:

```text
PATCH /users/${USER_ID}
```

```json
{ "authorId": "${USER_ID}", "title": "New post" }
```

Placeholders resolve at request time. If a variable hasn't been set or captured yet, it resolves to an empty string.

## Where values come from

- **Manually** — paste a value into a token profile or a custom variable field.
- **Captured automatically** — extracted from an earlier response with a jq expression. See [captures.md](captures.md).
- **Imported** — Postman collection variables, or a suite JSON's top-level `tokens`/`vars` objects.

## Token profiles

Manage multiple bearer-token profiles (e.g. admin, regular user, service account) and switch which one a request uses without retyping the token. Devman API also inspects JWT metadata for a pasted token without leaving the page.

## Show variables

Use **Show variables** in the workspace to see every variable's current resolved value at a glance — useful for confirming a capture actually populated what you expect before the next request runs.

## Import/export

A suite JSON's `tokens` and `vars` objects seed variables on import. **Export JSON** includes current variable values in the exported workspace.

> [!CAUTION]
> Exported suite JSON can contain pasted tokens. Review exported files before sharing or committing them.

## See also

- [Captures](captures.md) — how variables get populated from responses
- [Workflows](workflows.md)
- [Assertions](assertions.md)
- [Getting started](getting-started.md)
