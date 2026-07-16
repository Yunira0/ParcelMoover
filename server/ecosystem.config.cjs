// ecosystem.config.cjs
// PM2 process config — the non-Docker alternative to the compose stack.
// Run from the server/ directory after `npm ci && npm run build`:
//   pm2 start ecosystem.config.cjs --env production
module.exports = {
  apps: [
    {
      name: "parcelmoover-api",

      // compiled entrypoint ("build": "prisma generate && tsc")
      script: "dist/index.js",
      cwd: __dirname,

      // cluster mode: one process per CPU core, PM2 load-balances the port.
      // Safe here because rate limiting lives in Redis, not process memory —
      // in-memory state would break across cluster workers.
      instances: "max",
      exec_mode: "cluster",

      // ── restart policy ──
      autorestart: true,
      max_memory_restart: "512M",   // restart a worker that leaks past this
      min_uptime: "10s",            // must stay up 10s to count as "started"
      max_restarts: 10,             // give up after 10 crashes within min_uptime
      restart_delay: 3000,          // wait 3s between crash restarts

      // ── graceful shutdown / zero-downtime reload ──
      kill_timeout: 8000,           // SIGTERM → 8s to close connections → SIGKILL
      wait_ready: false,            // set true only if index.js calls process.send('ready')
      listen_timeout: 10000,

      // ── logs ──
      out_file: "/var/log/parcelmoover/out.log",
      error_file: "/var/log/parcelmoover/error.log",
      merge_logs: true,             // cluster workers share one file
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      time: true,

      // ── env ──
      env: {
        NODE_ENV: "development",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
        // Everything secret (DATABASE_URL, JWT_SECRET, SMTP creds…) comes
        // from server/.env loaded by dotenv, NOT hardcoded here — this file
        // gets committed to git.
        REDIS_HOST: "127.0.0.1",
        REDIS_PORT: 6379,
        TRUST_PROXY: "true",
        TRUSTED_PROXIES: "127.0.0.1",
      },
    },
  ],
};
