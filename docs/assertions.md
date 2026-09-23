# Assertions

Devman API validates a response two ways: an expected HTTP status code, and an optional jq assertion against the response body.

## Expected status

Set `expect_status` (or the equivalent field in the UI) on a request. A response that doesn't match is marked as a failure.

## jq assertions

`assert` runs one [jq](https://jqlang.github.io/jq/) expression — or an array of expressions — against the response body:

```json
{
  "name": "create user",
  "method": "POST",
  "path": "/users",
  "expect_status": 201,
  "assert": ".data.id != null"
}
```

Multiple checks:

```json
"assert": [".data.id != null", ".data.email | test(\"@\")"]
```

## PASS, BUG, and FAIL — the distinction

A successful HTTP response whose jq assertion fails is **not** automatically treated as a failed request. It's flagged as a non-blocking **BUG** (review note) instead, separate from FAIL/ERROR (wrong status code, network error, or timeout). This keeps "the API responded, but the data looks wrong" visually distinct from "the request didn't work at all" — both are visible in the run summary and the exported report.

## Where checks run

The hosted app and Vercel deployments evaluate jq client-side/serverless via `jq-wasm` — no setup needed. If you run the local Node server yourself, install [`jq`](https://jqlang.github.io/jq/); the local server shells out to the system binary.

## See also

- [Captures](captures.md) — extracting values, not just checking them
- [Workflows](workflows.md)
- [Getting started](getting-started.md)
