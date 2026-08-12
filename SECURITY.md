# Security policy

## Reporting a vulnerability

Please do not open a public GitHub issue for a vulnerability that could expose credentials, private API data, or deployment infrastructure.

Report it privately through [mhmoud.life](https://mhmoud.life) and include:

- The affected version or commit.
- Clear reproduction steps.
- The potential impact.
- Any suggested mitigation.

Remove real access tokens, passwords, tenant identifiers, private URLs, and response data before sending a report. You should receive an acknowledgement as soon as the maintainer reviews it. Please allow time for a fix before publishing vulnerability details.

## Supported version

Security fixes are applied to the latest version on the `main` branch. Older commits and third-party deployments may not contain the latest protections.

## Deployment guidance

- Prefer local mode when testing private APIs.
- Never enter production credentials into a deployment you do not control.
- Set `ALLOWED_PROXY_HOSTS` on shared deployments to restrict which public APIs the proxy can reach.
- Keep dependencies updated and review automated security alerts.
