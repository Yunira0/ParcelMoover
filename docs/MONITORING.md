# Monitoring with pm-stats

`pm-stats` prints ParcelMoover's numbers in the terminal on the production
server. It only reads data, so it is safe to run at any time. Everything stays
on our own server: there is no outside analytics service.

## Running it

SSH into the EC2 host, then:

```
pm-stats users              # who is using the system
pm-stats riders             # Android APK vs browser, app versions
pm-stats riders --outdated  # riders to remind about the app update
pm-stats api                # traffic, speed, errors, server health (last hour)
pm-stats api --last 24h     # or --last 7d
pm-stats vendors            # Partner API calls and webhook health
pm-stats vendors --all      # every vendor, not just the top 15
pm-stats business           # orders, deliveries, returns, COD today
pm-stats business --branch Pokhara   # one branch only
pm-stats live               # everything on one screen; q to quit
pm-stats --help
```

Add `--json` to any command except `live` for scripts (e.g. `| jq`), or
`--no-color` to paste into chat.

Install the command once on the host (the deploy keeps the file up to date):

```
sudo ln -sf /var/www/express-app/deploy/pm-stats /usr/local/bin/pm-stats
```

The wrapper runs inside whichever release slot (`app` or `app-green`) is
serving traffic. Locally, from `server/`:

```
npm run --silent stats -- users
```

## What the numbers mean

All days and times are Nepal time (NPT).

### users

| Number | Meaning |
| --- | --- |
| Online | People with a logged-in request in the last 5 minutes |
| Today / 7 days / 30 days | Different people with at least one logged-in request in that many Nepal calendar days |
| Total | Accounts that are not deleted and not deactivated |
| Active of total | 30-day active people as a share of Total |
| Not seen in 30 days | Total minus 30-day active |
| New vendor sign-ups | Vendor accounts created in that window |

People are grouped by role: anyone with the rider role is a **rider**, then
vendors and vendor staff are **vendors**, and everyone else is **staff**. A
person is counted once, in the first group that matches.

### riders

The rider app sends its platform (`android` / `web`) and version with every
request. APKs built before that are still recognised as Android, with no
version ("Android app, very old"). **Latest** is the highest app version seen
in the last 30 days. `--outdated` lists riders whose last-used APK is older, by
branch, so someone can remind them to update.

### api

Every `/api` request is counted by route (`/api/parcels/:id`, never the real
URL), status, time taken and app: **Dashboard**, **Rider app** (rider role or
the app's headers) or **Partner API** (`/api/v1`). Speeds are
estimated from time buckets: **typical** is the middle request, **slow 5%**
means 5 in every 100 requests take that long or longer. ▲ marks a request
type slower than 1 second. **Errors** are requests the server failed (HTTP
5xx). The server line shows CPU, memory, disk, database connections and the
cache (Redis).

### vendors

Partner API calls per API key today: how many, the share that failed (any
4xx or 5xx), and the last call. Webhooks show today's deliveries per vendor.
**Needs attention** flags: more than 3% of a key's calls failing (with the
most common error), webhook deliveries failing or retrying, a webhook turned
off after repeated failures, and a key that was busy yesterday but has made
no calls for 2 hours.

### business

Uses the dashboard's own definitions, so the numbers match it. Today so far is
compared with the **same time last week** (fair for a day still in progress);
yesterday is the full day. COD collected is the cash collected on parcels
delivered in the window; cancelled orders never count. Branch means where the
order was picked up; `--branch <name>` narrows every number to branches whose
name contains it.

### live

One screen of boxed panels: users, traffic, server, rider app, business,
alerts and the latest server errors. Traffic and server update every 5
seconds; the database numbers every 30 seconds. Keys: `r` update now, `p`
pause, `q` quit. On a terminal narrower than 110 columns the panels stack.

## How it works

- **People:** every logged-in request passes `auth.middleware.ts`, which calls
  `recordUserActivity` (`server/src/services/analytics/track.ts`). That writes
  one row per person per Nepal day to `user_daily_activity`, at most once a
  minute per person, with the rider app's platform and version.
- **Requests:** `usageTracking.middleware.ts` counts every finished `/api`
  request in memory (`services/analytics/traffic.ts`) and saves the counts to
  Redis every 10 seconds, per minute (kept 2 days), per hour (kept 8 days) and,
  for Partner API keys, per day (kept 40 days).
- Neither ever blocks or fails a request.
- `pm-stats` reads them (`server/src/services/analytics/queries/`) and prints
  them (`server/src/scripts/stats/`).

Limits to know:

- People counts start from the day this shipped; the 7- and 30-day numbers
  fill in over the following month, and `pm-stats users` says so until they
  have.
- Our Redis does not save to disk, so traffic and Partner API counts start over
  if Redis restarts. People counts are in Postgres and are not affected.
- Rider versions appear once riders install rider app 1.4.3 or later; older
  apps show as "Android app, very old".
- There are no downtime alerts yet. `pm-stats` runs on the server, so it cannot
  report that the server itself is down; that needs a check from outside,
  which we have left for later.
