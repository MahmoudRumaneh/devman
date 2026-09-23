# Deployment

Devman API can be used three ways: the hosted app, a local Node server, or your own Vercel deployment.

## Hosted app

**[devman-api.com](https://devman-api.com)** — no setup, free, no account.

## Run locally

```bash
git clone https://github.com/MahmoudRumaneh/devman.git
cd devman
npm ci
npm start
```

Binds to `127.0.0.1` only — suitable for testing localhost and private-network APIs directly from your machine. See [getting-started.md](getting-started.md).

## Deploy your own Vercel instance

The included [`vercel.json`](../vercel.json) and serverless functions under [`api/`](../api/) are ready to deploy:

1. Fork this repository.
2. Import the fork into Vercel.
3. Keep the project framework set to **Other** and deploy.
4. Optionally set `ALLOWED_PROXY_HOSTS` to a comma-separated hostname allowlist, e.g. `api.example.com,staging-api.example.com`.

Hosted deployments reject localhost, private networks, reserved IP addresses, credential-bearing URLs, and non-HTTP protocols by default. `ALLOWED_PROXY_HOSTS` is strongly recommended for any shared deployment.

## Security and privacy

- Use a local instance for private/internal APIs — the local server binds to `127.0.0.1` only.
- Don't paste production secrets into a deployment you don't control.
- Workspace state, including pasted tokens, is stored in the browser's local storage, never sent anywhere except the request you explicitly run.
- Requests are forwarded through the local server or the deployment's serverless proxy, to avoid browser CORS restrictions.
- Public deployments can't reach private network targets; configure `ALLOWED_PROXY_HOSTS` to restrict public targets further.
- The built-in issue reporter never adds URLs, tokens, tenant IDs, request bodies, or responses to its diagnostics.

If you discover a security vulnerability, don't publish credentials or exploit details in a public issue — contact the maintainer privately through [mhmoud.life](https://mhmoud.life). Full policy: [SECURITY.md](../SECURITY.md).

## See also

- [Getting started](getting-started.md)
- [Workflows](workflows.md)
