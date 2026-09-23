# Getting started

Devman API is a free, open-source REST API testing workspace that runs in your browser. This page covers the fastest path from zero to a passing request.

## Use the hosted app

Open **[devman-api.com](https://devman-api.com)**. No install, no account, no sign-up — your workspace is saved in the browser's local storage.

## Or run it locally

Requirements: [Node.js 24](https://nodejs.org/), npm, and optionally [`jq`](https://jqlang.github.io/jq/) for assertions and captures.

```bash
git clone https://github.com/MahmoudRumaneh/devman.git
cd devman
npm ci
npm start
```

Open [http://127.0.0.1:8787](http://127.0.0.1:8787). On macOS or Linux, `./start.sh` does the same and tries to open the browser automatically:

```bash
PORT=9000 ./start.sh
```

For deploying your own hosted instance, see [deployment.md](deployment.md).

## Your first flow

1. Enter the API's base URL under **Connection**.
2. Add any bearer tokens the endpoints need.
3. Add requests — import [OpenAPI/Swagger](openapi.md), a [Postman collection](postman.md), a [cURL command](curl.md), a Devman suite, or paste plain routes:

   ```text
   POST /auth/login
   GET /users/me
   PATCH /users/${USER_ID}
   ```

4. Arrange related requests into groups — see [workflows.md](workflows.md) for staged execution order.
5. Set the expected status for each request, then click **Run all**.
6. Inspect response headers, bodies, [captured variables](captures.md), timing, retry count, and pass/fail results.
7. Download a Markdown report, or export the workspace as JSON for later use.

> [!CAUTION]
> Exported suite JSON can contain pasted tokens. Review exported files before sharing or committing them.

## Next

- [OpenAPI & Swagger import](openapi.md)
- [Postman collection import](postman.md)
- [cURL import](curl.md)
- [Workflows](workflows.md) — staged, sequential execution
- [Variables](variables.md) and [captures](captures.md)
- [Assertions](assertions.md)
- [Deployment](deployment.md)

Back to the [project README](../README.md).
