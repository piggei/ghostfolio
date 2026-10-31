# Ghostfolio All-PR Add-on Documentation

## Overview

This add-on runs Ghostfolio All-PR inside Home Assistant.

It includes Ghostfolio, Redis, Nginx, and s6-overlay.

A separate PostgreSQL server is required.

## Requirements

Before installation, prepare:

- A Home Assistant installation supporting add-ons
- A reachable PostgreSQL server
- A PostgreSQL database for Ghostfolio
- A PostgreSQL user with the permissions required by Ghostfolio
- Network connectivity between the add-on and PostgreSQL

Do not use an existing production Ghostfolio database for initial
testing unless you have explicitly planned the migration and
verified your backups.

## Installation

After the add-on branch and images have been published:

1. Open Home Assistant.
2. Navigate to Settings > Add-ons.
3. Open the add-on store.
4. Open the repositories menu.
5. Add the repository URL:

   https://github.com/piggei/ghostfolio#feat/home-assistant-addon

6. Refresh the add-on store if necessary.
7. Select Ghostfolio All-PR.
8. Configure the PostgreSQL connection.
9. Start the add-on.
10. Review the startup logs.

Installation from the repository and the published images has
not yet been validated on a real Home Assistant Supervisor.

## PostgreSQL configuration

The following add-on options are available:

| Option | Description |
| --- | --- |
| database_host | PostgreSQL hostname or IPv4 address |
| database_port | PostgreSQL TCP port |
| database_name | Ghostfolio database name |
| database_user | PostgreSQL username |
| database_pass | PostgreSQL password |

Example configuration:

    database_host: postgres.example.local
    database_port: 5432
    database_name: ghostfolio
    database_user: ghostfolio
    database_pass: REPLACE_WITH_YOUR_PASSWORD

The example is illustrative and must be adapted to your environment.

The add-on constructs DATABASE_URL from these options.

The username, password, and database name are URI-encoded to
support special characters.

IPv6 database host formatting has not been validated.

## First startup

During startup, the add-on:

1. Prepares persistent storage under /data.
2. Generates application secrets if they do not already exist.
3. Starts the authenticated Redis service.
4. Waits for Redis readiness.
5. Configures the PostgreSQL connection.
6. Starts Ghostfolio through its original entrypoint.
7. Starts the Nginx Ingress proxy.

The Ghostfolio entrypoint performs database migrations and
database seeding before starting the application.

Use a dedicated test database when validating a new version.

## Application secrets

The following secrets are generated automatically:

- REDIS_PASSWORD
- ACCESS_TOKEN_SALT
- JWT_SECRET_KEY

Each value is generated using 32 random bytes encoded as hexadecimal.

Secrets are stored in:

    /data/secrets/ghostfolio.env

The file is created with restrictive permissions.

Existing valid secrets are reused on subsequent starts.

If the file is invalid, initialization fails rather than silently
replacing the existing values.

Do not delete or regenerate application secrets during normal
updates or troubleshooting.

## Redis

Redis runs inside the add-on container.

It is bound to:

    127.0.0.1:6379

Password authentication is enabled.

Redis persistence uses append-only files with:

    appendonly yes
    appendfsync everysec

Redis data and configuration are stored under:

    /data/redis/

Redis is not intended to be exposed to other containers.

## Home Assistant Ingress

The Nginx proxy listens internally on port 8099.

It forwards requests to Ghostfolio on port 3333.

The proxy supports rewriting selected frontend paths and redirects
using the Home Assistant Ingress path header.

Local tests have verified:

- Relative redirects with an Ingress prefix
- Italian and English frontend pages
- JavaScript and CSS resources
- Static assets
- The application health API

These tests used simulated Ingress headers.

Real Supervisor Ingress behavior and full browser navigation
remain to be tested.

## Optional direct access

The add-on declares port 3333 as an optional externally
published port.

If enabled in Home Assistant, direct access bypasses the
Ingress proxy.

Only expose this port on trusted networks and use appropriate
network security controls.

## Health check

The container health check uses:

    http://localhost:3333/api/v1/health

A healthy container indicates that this endpoint is responding.

It does not guarantee that every external data provider or
frontend operation is working correctly.

## Backups

Back up both:

1. The external PostgreSQL database.
2. The Home Assistant add-on persistent data directory.

The add-on data includes Redis persistence files and application
secrets.

A Home Assistant backup does not automatically guarantee that
an external PostgreSQL database has been backed up.

Coordinate PostgreSQL backups separately.

Before restoring a database, verify compatibility with the
Ghostfolio application version.

## Updates

The add-on version and Ghostfolio application version are
independent.

Published add-on images should be built from a specific
Ghostfolio All-PR release digest.

Before updating:

1. Back up PostgreSQL and persistent add-on data.
2. Review the Ghostfolio release changes.
3. Verify the target image version.
4. Update the add-on.
5. Check the startup logs and application health.

Database migrations may be executed during application startup.

Avoid downgrading Ghostfolio against a database that has already
been migrated without a verified recovery procedure.

## Troubleshooting

### PostgreSQL connection failure

Verify the configured hostname, port, database name, username,
password, network connectivity, and PostgreSQL permissions.

### Redis startup failure

Check the add-on logs and the persistent /data/redis directory.

Do not remove persistent Redis data without understanding the
impact on the running application.

### Invalid persistent secrets

Inspect file permissions and restore the secrets from a
known-good backup.

Do not replace the secrets automatically.

### Ghostfolio does not become healthy

Inspect startup logs for Prisma migration errors, database
connection failures, and NestJS initialization errors.

### Ingress displays a blank page

Check the browser developer tools for failed JavaScript, CSS,
asset, and API requests.

Verify the Ingress path and redirect behavior.

### Nginx logs

The current implementation writes Nginx access and error logs
to temporary files inside the container.

Integration of these logs into the Home Assistant add-on log
stream remains a development task.

## Current limitations

- PostgreSQL must be provided externally.
- Native aarch64 runtime has not been validated.
- Real Home Assistant Supervisor installation is not yet tested.
- The automated GHCR publication workflow has not yet been run.
- Nginx logging integration is not finalized.
- IPv6 PostgreSQL connection formatting has not been tested.
