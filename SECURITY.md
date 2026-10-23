# Security Policy

This server holds Login with Amazon credentials that can read, and when writes are enabled change, live Amazon advertising accounts. We take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository:
[Report a vulnerability](https://github.com/get-mcp-ads/amazon-ads-mcp-server/security/advisories/new),
or write to hello@getmcpads.com. Do not include live tokens or customer data.

We aim to acknowledge a report within 3 business days and to ship a fix or a documented mitigation within 30 days. We will credit you in the advisory unless you ask us not to.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## What this server does with your credentials

- The client ID, client secret and refresh token are read once from the environment at startup and kept in memory. Access tokens are obtained and renewed in memory. A refresh token returned by Amazon replaces the old one in memory only. Nothing is written to disk, and a test fails the build if a source file writes files.
- Configuration errors name the variable to fix and never repeat its value. Provider error text is passed through a redaction step that removes the configured secrets and any Login with Amazon token shape (`Atza|`, `Atzr|`).
- **Requests go only to Amazon's regional hosts**, declared in `src/core/hosts.ts`: `advertising-api.amazon.com`, `advertising-api-eu.amazon.com` and `advertising-api-fe.amazon.com` for the API, and `api.amazon.com`, `api.amazon.co.uk` and `api.amazon.co.jp` for token renewal. The region is fixed at startup. *A test fails the build if another host appears in the source.*
- **No fetch follows a redirect.** Every outbound call sets `redirect: "error"` and a timeout, and responses are read with a size limit. *A test fails the build if any fetch omits either.*
- API paths are allowlisted, and every request carries one profile from `AMAZON_ADS_PROFILE_IDS` in the `Amazon-Advertising-API-Scope` header. Other profiles are refused before any request.
- No telemetry, no analytics, no phone-home.

## Signed URLs returned by Amazon

Report downloads and asset uploads use a signed URL that Amazon returns. That URL is data, so it is validated before use:

- HTTPS only, with no embedded user name, password or custom port.
- The host must be an Amazon S3 host. IP literals, `localhost`, `.internal` and `.local` names are refused, so a crafted value cannot reach the machine running the server, a private network or a cloud metadata endpoint.
- No redirect is followed.
- No Amazon credential is attached to that request.

Media URLs in asset and product results are returned to the model as data and are never fetched by this server. Only Amazon's own media hosts are kept.

## Writes

Writes are registered only when `AMAZON_ADS_ENABLE_WRITES` is exactly `true`. Every write previews first. Preview, report and upload tokens are AES-256-GCM sealed with a key derived in memory from the client secret, bound to the client ID and region, and expire. A change with an uncertain outcome is never retried automatically.

## Handling your credentials safely

- Use a Login with Amazon security profile dedicated to this server, so you can revoke it on its own.
- Treat the refresh token and the client secret like passwords.
- Your MCP client configuration file is usually plain text on disk. Check its permissions, and never commit it.
- List only the profiles you need in `AMAZON_ADS_PROFILE_IDS`.

## Scope

Vulnerabilities in the Amazon Ads API itself are not in scope here; report those to Amazon.
