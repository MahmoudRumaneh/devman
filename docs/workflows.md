# Workflows

Devman API runs requests in order, grouped into stages, so a real multi-step flow — create a resource, capture its ID, use that ID in the next request — can be built once and re-run any time.

Live version of this page: **[devman-api.com/automated-api-testing](https://devman-api.com/automated-api-testing)**.

## Groups and stages

Requests are organized into named groups. Groups and their endpoints run top to bottom. You can:

- Search, reorder, duplicate, rename, and collapse groups
- Select several groups and run only that selection — every row still waits for the previous response, and selected groups still run top to bottom
- Drag the `⠿` handle on a row to move it into a different group, or on a group header to reorder groups

## Suite JSON

A staged suite is a small JSON file. Requests run in `stage` order:

```json
{
  "base_url": "https://api.example.com/v1",
  "tokens": { "API_TOKEN": "" },
  "steps": [
    {
      "name": "create user",
      "stage": 10,
      "method": "POST",
      "path": "/users",
      "auth_var": "API_TOKEN",
      "body": { "name": "Ada Lovelace" },
      "expect_status": 201,
      "assert": ".data.id != null",
      "capture": { "USER_ID": ".data.id" }
    },
    {
      "name": "read user",
      "stage": 20,
      "method": "GET",
      "path": "/users/${USER_ID}",
      "auth_var": "API_TOKEN",
      "expect_status": 200,
      "continue_on_fail": true
    }
  ]
}
```

| Field | Purpose |
| --- | --- |
| `stage` | Groups requests and controls execution order. |
| `auth_var` | Names the variable used as the bearer token. |
| `continue_on_fail` | Allows later requests to continue after this request fails. |
| `foreach` | Expands one step across a list of supplied values. |

See [captures.md](captures.md) for `capture`, and [assertions.md](assertions.md) for `expect_status`/`assert`.

Use **Download template** in the app for a ready-to-edit example, or **Export JSON** to save your current workspace in this format.

## What's automatic

- Requests run in stage order, reusing captured values as they go.
- Transient network and server failures are retried automatically, with the retry count shown on the result.
- A Markdown report can be exported when the run finishes.

## What's not (yet)

There's no headless CLI runner today — workflows run in the browser. Suites export as JSON, so they can be versioned in git and re-imported, but not executed outside the browser from this project alone.

## See also

- [Variables](variables.md)
- [Captures](captures.md)
- [Assertions](assertions.md)
- [Getting started](getting-started.md)
