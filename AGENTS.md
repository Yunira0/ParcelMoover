# Repository guidance for agents

## Vendor API parity

For every vendor-facing capability or behavior change in `client/` or `/api`, update the matching Partner API (`/api/v1`) in the same work. Reuse the dashboard service and vendor ownership rules. Keep API-key authentication, idempotency for writes, rate limits, request validation, and structured errors consistent with neighboring Partner API endpoints. Update `server/src/lib/openapi.ts`, `docs/PARTNER_API.md`, and the interactive console in `server/docs-static/partner-api.html`; regenerate the served reference with `npm run docs:build` in `server/`. Add focused checks for the route and its vendor scope. If an action must remain staff-only, document that boundary explicitly.
