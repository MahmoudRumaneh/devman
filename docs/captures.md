# Captures

A capture extracts a value out of one response with a [jq](https://jqlang.github.io/jq/) expression and stores it as a [variable](variables.md) for every request that follows.

## Basic capture

```json
{
  "name": "create user",
  "stage": 10,
  "method": "POST",
  "path": "/users",
  "expect_status": 201,
  "capture": { "USER_ID": ".data.id" }
}
```

`USER_ID` is now available as `${USER_ID}` in every later step in the same workspace — for example:

```json
{
  "name": "read user",
  "stage": 20,
  "method": "GET",
  "path": "/users/${USER_ID}"
}
```

`capture` maps variable names to jq filters; multiple captures per step are supported.

## foreach

Expand one step across a list of supplied values — run the same request once per item, without duplicating the step:

```json
{
  "name": "delete each id",
  "stage": 30,
  "method": "DELETE",
  "path": "/users/${ID}",
  "foreach": { "var": "ID", "in": ["101", "102", "103"] }
}
```

## Requirements

Captures and [jq assertions](assertions.md) run through a jq evaluator. The hosted app and Vercel deployments include this automatically; if you run the local Node server yourself, install [`jq`](https://jqlang.github.io/jq/) for captures and assertions to work.

## Inspecting captured values

Use **Show variables** in the workspace to see every captured value's current state before the next request runs.

## See also

- [Variables](variables.md)
- [Assertions](assertions.md)
- [Workflows](workflows.md)
- [Getting started](getting-started.md)
