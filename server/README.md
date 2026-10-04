# acLife Server

Backend for acLife, written in Go, provides REST APIs, session management, database access, payment handling, and authentication for the client.


## Installation

```bash
git clone https://github.com/atar4xis/acLife.git
cd acLife/server
go mod download
```

## Configuration

- `constants/constants.go`: Contains default constants and settings used throughout the server.
- `.env`: Environment-specific configuration (database credentials, API keys, ports, etc.)

A `.env.default` file is included as a template. Copy it to `.env` and adjust as needed.

```bash
cp .env.default .env
```

## Development

```bash
go run main.go
# or
air
```

## Test

```bash
go test ./...
```

Tests that touch the database need a MariaDB/MySQL server and skip without one.
Set `TEST_DB_USER` (plus optional `TEST_DB_PASSWORD`, `TEST_DB_HOST`, `TEST_DB_PORT`), each test run creates and drops its own `aclife_test_x` database.

```bash
TEST_DB_USER=root TEST_DB_PASSWORD=secret go test ./...
```

## Build

```bash
./build.sh
```

## Notable Dependencies

- **gorilla/mux**: Routing for REST endpoints
- **gorilla/sessions**: Cookie session management
- **stripe-go**: Stripe API integration
- **mz.attahri.com/code/srp/v3**: Secure Remote Password authentication
- **joho/godotenv**: Load environment variables from .env