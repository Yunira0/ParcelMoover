# Client loading performance

Run `npm run check:performance` in `client/` to build production assets and
check their compressed JavaScript budgets. The check counts shared static
dependencies once per page and excludes code loaded only after optional actions.

Measured on 4 October 2026 from the same local checkout before and after the
loading changes:

| Cold page load | Before, gzip JS | After, gzip JS |
| --- | ---: | ---: |
| Homepage | 166.3 kB | 107.9 kB |
| Admin dashboard, including navigation | 188.0 kB | 145.5 kB |
| Vendor dashboard, including navigation | 188.0 kB | 142.4 kB |
| Admin orders, including navigation | 354.9 kB | 184.0 kB |
| Vendor orders, including navigation | 354.9 kB | 169.9 kB |

The homepage remains eager so its heading and tracking form can render without
waiting for another route download. Login, public tracking and the authenticated
shell load separately. Dashboard and Orders select the existing role-specific
page without downloading the other roles' pages. Nested Suspense boundaries keep
navigation mounted while the content loads. Spreadsheet exports import SheetJS
on demand; export handlers wait for completion. The homepage uses responsive,
high-priority hero imagery and renders its content immediately without a motion
runtime or entrance delay.

These are browser loading changes. Dashboard/Partner API capabilities, requests,
vendor ownership, authentication, idempotency and data freshness are unchanged;
there is no corresponding `/api/v1` contract change.

A public request to `https://portal.parcelmoover.com/` returned its first byte
in approximately 278 ms. Its compressed entry asset returned in 129 ms and had
Cloudflare `HIT`, gzip compression and one-year immutable caching. These single
samples support investigating client startup first; they do not rule out
regional latency or intermittent hosting problems. Bundle sizes measure download
work, not Core Web Vitals or a guaranteed improvement in seconds. The changes
require deployment before production users receive them.

The 5 October follow-up audit adds on-demand spreadsheet parsing, a bounded
dashboard trend query, and optional API/Prisma timings. See
[FIRST_LOAD_AUDIT.md](FIRST_LOAD_AUDIT.md) for the page-by-page asset report,
synthetic database benchmark, measurement limitations and next checks.
