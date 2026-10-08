# acLife Server

The backend for [acLife](../README.md). A single Go binary that provides the REST API, a server-sent event stream for live sync, session management, subscriptions and push notifications.

The server stores only ciphertext. It never sees event contents or passwords, so it can be run by anyone without being trusted with your data. See the [main README](../README.md#how-it-works) for the security model.

## What it does

- **Accounts**: SRP login (the password never reaches the server), email verification, session management, lockout after repeated failed logins
- **Storage**: encrypted events and settings, with per-user storage quotas
- **Sync**: incremental sync by hashed week buckets, plus a live `/stream` (SSE) so devices see changes immediately
- **Notifications**: schedules event notifications and delivers them by Web Push, or through the stream to the desktop app
- **Subscriptions**: optional Stripe integration (checkout, customer portal, webhooks)
- **Email**: queued, rate-limited SMTP delivery for verification mails
- **Abuse protection**: rate limiting, proof-of-work on registration, domain allow and block lists

## Requirements

- Go 1.26 or newer
- MariaDB or MySQL. MariaDB 11.8 is what CI and development use.
- An SMTP server, unless you set `DISABLE_EMAIL_VERIFICATION=true`

Database migrations are embedded in the binary and run automatically at startup. Create an empty database and a user with full access to it first.

If the database's binary log is enabled, `binlog_format` must be `MIXED` or `ROW`. The server uses `READ COMMITTED` transactions, and `STATEMENT` makes writes fail.

## Getting a build

Prebuilt, GPG-signed binaries for Linux, macOS and Windows are attached to every [release](https://github.com/atar4xis/acLife/releases). Verify them against the checksums and the key in [`KEYS`](../KEYS).

To build from source:

```bash
git clone https://github.com/atar4xis/acLife.git
cd acLife/server
./build.sh    # writes bin/acLife
```

## Configuration

Configuration lives in a `.env` file in the working directory, which the server requires at startup. Copy the template and fill it in:

```bash
cp .env.default .env
```

The server also refuses to start if a required variable is missing or invalid.

### Required

| Variable | Description |
|---|---|
| `DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_PORT`, `DB_NAME` | Database connection |
| `SESSION_KEY` | Secret for signing session cookies, at least 32 characters. Changing it logs everyone out. |
| `SERVER_URL` | Public URL of this server |
| `CLIENT_URL` | URL the web client is served from. Used in verification email links. |
| `CORS_ALLOWED_ORIGINS` | Comma-separated origins allowed to call the API |
| `PORT` | Port to listen on |

### Email

| Variable | Description |
|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Outgoing mail. Required unless email verification is disabled. |
| `DISABLE_EMAIL_VERIFICATION` | `true` lets people register without confirming their email |
| `VERIFICATION_EMAIL_SUBJECT`, `VERIFICATION_EMAIL_BODY` | Override the verification mail (`{url}` is the link) |
| `MAIL_HOURLY_LIMIT` | Total mails sent per hour, default 400 |
| `MAIL_DOMAIN_HOURLY_LIMIT` | Mails per hour to one unlisted domain, default 100 |

### Registration and access

| Variable | Description |
|---|---|
| `DISABLE_REGISTRATION` | `true` closes sign-ups |
| `EMAIL_DOMAIN_WHITELIST`, `EMAIL_DOMAIN_BLACKLIST` | Allow or block email domains. Set only one. |
| `ACCESS_TOKEN_EXPIRY_DAYS` | Session lifetime, default 3 |
| `PRIVACY_URL`, `TERMS_URL` | Links shown to users when signing up |

### Limits

| Variable | Description |
|---|---|
| `MAX_USER_BYTES` | Default storage per user, default 250 MiB |
| `MAX_SAVE_BODY_BYTES` | Largest save request, default 16 MiB |
| `MAX_PUSH_SUBSCRIPTIONS` | Push subscriptions per user, default 50 |

### Push notifications

Web Push needs a VAPID key pair. Generate one with any VAPID tool and set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. `PUSH_ALLOWED_ENDPOINTS` restricts which push services clients may register, and the default covers the major browsers.

### Subscriptions (Stripe)

Stripe is optional. Without `STRIPE_API_KEY` the server runs with no subscription requirement and every account has full access. When it is set, a subscription is required for calendar and settings sync.

| Variable | Description |
|---|---|
| `STRIPE_API_KEY` | Enables subscriptions |
| `STRIPE_PRODUCT_ID` | The product users subscribe to |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for the webhook |

Point a Stripe webhook at `<SERVER_URL>/stripe/webhook` and send it `checkout.session.completed`, `customer.subscription.updated` and `customer.subscription.deleted`.

### Other

| Variable | Description |
|---|---|
| `IS_BEHIND_PROXY` | Trust the `X-Real-IP` header as the client address (used for rate limiting and login lockouts). Only set this behind a proxy that overwrites the header. |
| `STORAGE_DIR` | Directory for server-side files |

## Deploying

- **Run one instance.** Rate limits, login lockouts and sessions are kept in memory, so the server isn't built for multiple replicas.
- **Use HTTPS.** Session cookies are `Secure` and `SameSite=None`. Only `localhost` works over plain HTTP.
- **Behind a reverse proxy**, set `IS_BEHIND_PROXY=true` and make the proxy overwrite the client address, for nginx `proxy_set_header X-Real-IP $remote_addr;`. Without this, all users appear to come from the proxy's address and share the same limits. Turn proxy buffering off for the `/stream` route (the server already sends `X-Accel-Buffering: no`).
- **Database collation**: if you already have tables, make sure the database and tables use the same collation before upgrading, otherwise foreign keys in new migrations can fail.

## Development

```bash
cp .env.default .env
go run main.go     # or `air` for live reload
```

Run the web client from [`../client`](../client/README.md) against it.

### Tests

Tests that touch the database need a MariaDB or MySQL server and are skipped without one. Each run creates and drops its own `aclife_test_*` database.

```bash
./dev_test.sh                   # uses DB_* from .env
./dev_test.sh ./handlers        # one package

TEST_DB_USER=root TEST_DB_PASSWORD=secret go test ./...   # explicit credentials
```

Before sending a change, also run `go vet ./...` and `gofmt -l .`.

### Layout

| Path | Contents |
|---|---|
| `main.go` | Startup and wiring |
| `routes/` | Route tables and middleware |
| `handlers/` | Request handlers and background workers |
| `database/` | Connection, transactions, embedded `migrations/` |
| `session/` | Cookie sessions |
| `stream/` | In-memory SSE hub |
| `push/`, `mail/` | Web Push delivery and the mail queue |
| `constants/` | Limits and environment configuration |
| `internal/testutil/` | Test fixtures |

To add a route, register it in `routes/`, write the handler in `handlers/`, and mirror any size or length limit in `constants/constants.go`. To change the schema, add the next numbered pair of `.up.sql` and `.down.sql` files to `database/migrations/`, and never edit one that has been released.

## Notable dependencies

- [gorilla/mux](https://github.com/gorilla/mux) and [gorilla/securecookie](https://github.com/gorilla/securecookie): routing and session cookies
- [mz.attahri.com/code/srp](https://mz.attahri.com/code/srp): Secure Remote Password
- [stripe-go](https://github.com/stripe/stripe-go): Stripe
- [webpush-go](https://github.com/SherClockHolmes/webpush-go): Web Push
- [sqlx](https://github.com/jmoiron/sqlx) and [golang-migrate](https://github.com/golang-migrate/migrate): database access and migrations
- [godotenv](https://github.com/joho/godotenv): `.env` loading
