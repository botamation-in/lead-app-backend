NODE_ENV=production
PORT=8086

AUTH_SERVICE_URL=https://auth.urbanchat.in
AUTH_FRONTEND_URL=https://auth.urbanchat.in
FRONTEND_BASE_URL=https://leads.urbanchat.in

COOKIE_DOMAIN=.urbanchat.in


# ── MongoDB ───────────────────────────────────────────────────────────────────
MONGO_DB_NAME=ucapps-leads

# ── Queue identity ────────────────────────────────────────────────────────────
APP_ACCT=urbanchat


# ── Lead Queue tuning ─────────────────────────────────────────────────────────
LEAD_QUEUE_CONCURRENCY=100
LEAD_QUEUE_ACCT_RATE_LIMIT_MAX=100
LEAD_QUEUE_ACCT_RATE_LIMIT_WINDOW_MS=60000
LEAD_QUEUE_JOB_ATTEMPTS=3
LEAD_QUEUE_BACKOFF_DELAY_MS=3000

# ── Lead Queue retention ──────────────────────────────────────────────────────
LEAD_QUEUE_COMPLETED_AGE_S=3600
LEAD_QUEUE_COMPLETED_COUNT=1000
LEAD_QUEUE_FAILED_AGE_S=86400

# ── Lead HTTP Rate Limiter (API key path only) ────────────────────────────────
# Rejects at the HTTP layer before the job even reaches the queue.
LEAD_RATE_LIMIT_MAX=100
LEAD_RATE_LIMIT_WINDOW_S=60
LEAD_RATE_LIMIT_FAIL_OPEN=true
