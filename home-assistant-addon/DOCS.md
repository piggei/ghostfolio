# Ghostfolio-NG Home Assistant Add-on Documentation

## Overview

Ghostfolio-NG runs inside Home Assistant as a native add-on.

The add-on provides:

- Ghostfolio-NG application
- Home Assistant Ingress integration
- Nginx reverse proxy
- Integrated Redis with persistent storage
- Automatically generated persistent application secrets
- s6-overlay service supervision

A separate PostgreSQL server is required. PostgreSQL is not included
in the add-on.

The add-on supports AMD64 and ARM64 architectures.

## Requirements

Before installation, prepare:

- A Home Assistant installation supporting add-ons
- A reachable PostgreSQL server
- A PostgreSQL database for Ghostfolio
- A PostgreSQL user with the permissions required by Ghostfolio
- Network connectivity between the add-on and PostgreSQL

Use a dedicated test database when evaluating a new installation
or a new application version.

Do not connect an experimental installation to a production
Ghostfolio database without a verified backup and migration plan.

## Installation

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fpiggei%2Fghostfolio%23feat%2Fhome-assistant-addon)

Add the following repository to Home Assistant:

https://github.com/piggei/ghostfolio#feat/home-assistant-addon

Alternatively, add it manually:

1. Open Home Assistant.
2. Navigate to Settings > Add-ons.
3. Open the add-on store.
4. Open the repositories menu.
5. Add the repository URL.
6. Refresh the add-on store if necessary.
7. Select Ghostfolio-NG.
8. Configure the PostgreSQL connection.
9. Install and start the add-on.
10. Review the startup logs.

If a new release does not immediately appear in the add-on store,
refresh the repository or check for updates again.

The add-on uses the stable identity:

- Name: Ghostfolio-NG
- Slug: `ghostfolio_ng`

Existing installations should retain their add-on data when
updating the same add-on identity.

## PostgreSQL configuration

PostgreSQL is external and must be reachable from the add-on container.

Configure the following options in the Home Assistant add-on settings:

| Option | Description | Default |
| --- | --- | --- |
| `database_host` | PostgreSQL hostname or IPv4 address | Empty |
| `database_port` | PostgreSQL TCP port | `5432` |
| `database_name` | Ghostfolio database name | `ghostfolio` |
| `database_user` | PostgreSQL username | Empty |
| `database_pass` | PostgreSQL password | Empty |

All five options must be supplied with valid values before the
application can start.

Example configuration:

```yaml
database_host: postgres.example.local
database_port: 5432
database_name: ghostfolio
database_user: ghostfolio
database_pass: REPLACE_WITH_YOUR_PASSWORD
```

Replace the example values with your PostgreSQL configuration.

The add-on retrieves its options through the authenticated
Home Assistant Supervisor API using Bashio.

The runtime constructs `DATABASE_URL` from the retrieved options.
The username, password and database name are URI-encoded to support
special characters.

The add-on does not depend on a generated `/data/options.json` file.

PostgreSQL connectivity and password encoding with special characters
have been verified. IPv6 database host formatting has not been validated.

## Supervisor configuration

During startup, the Ghostfolio service retrieves its configuration
from Home Assistant Supervisor through Bashio.

The service receives the Supervisor environment through s6-overlay
and uses the authenticated Supervisor API.

Missing or invalid required configuration prevents the application
from starting.

Configuration is retrieved at runtime. The add-on does not create
or read `/data/options.json`.

## First startup

During startup, the add-on:

1. Prepares persistent storage under `/data`.
2. Generates application secrets if they do not already exist.
3. Starts the authenticated Redis service.
4. Waits for Redis readiness.
5. Retrieves the PostgreSQL options through Bashio and the
   authenticated Supervisor API.
6. Constructs `DATABASE_URL`, including URI encoding of its components.
7. Starts Ghostfolio through its original entrypoint.
8. Starts the Nginx Ingress proxy.

The Ghostfolio entrypoint performs database migrations and
database seeding before starting the application.

The first startup can therefore take longer than subsequent starts.
Review the add-on logs if the application does not become healthy.

## Application secrets

The following secrets are generated automatically:

- `REDIS_PASSWORD`
- `ACCESS_TOKEN_SALT`
- `JWT_SECRET_KEY`

Each value is generated using 32 random bytes encoded as hexadecimal.

Secrets are stored in:

```text
/data/secrets/ghostfolio.env
```

The directory is created with restrictive permissions, and the
secrets file is protected from access by other users.

Existing valid secrets are reused on subsequent starts.

If an existing secrets file is invalid, initialization fails rather
than silently replacing the values.

Do not delete or regenerate application secrets during normal
updates or troubleshooting. Losing these values can affect
authentication and application access.

Include the secrets directory in your backup strategy.

## Redis

Redis runs inside the add-on container and is bound to:

```text
127.0.0.1:6379
```

Password authentication is enabled.

Redis persistence uses append-only files with:

```text
appendonly yes
appendfsync everysec
```

Redis data and configuration are stored under:

```text
/data/redis/
```

Redis is an internal service and is not intended to be exposed
to other containers or external networks.

## Home Assistant Ingress

Home Assistant Ingress provides access to Ghostfolio without
requiring a separately exposed application port.

The internal Nginx proxy listens on port `8099` and forwards
requests to Ghostfolio on port `3333`.

The proxy uses the `X-Ingress-Path` header supplied by Home Assistant
Supervisor to adapt frontend paths to the active Ingress prefix.

The integration handles:

- Angular HTML `base href`
- Absolute API paths in JavaScript responses
- Absolute asset paths in JavaScript responses
- Relative redirects
- PWA manifest `start_url`
- PWA manifest icon paths

Manifest rewriting is restricted to the dedicated
`site.webmanifest` endpoint. Other JSON API responses are not
subjected to manifest-specific substitutions.

Without an Ingress prefix, the original manifest paths are preserved.

Ingress access and application navigation have been verified
on a real Home Assistant installation.

Standalone PWA installation and launch behavior have not been
fully qualified.

## Optional direct access

The add-on declares port `3333/tcp` as an optional externally
published port.

When enabled in Home Assistant, direct access bypasses
the Nginx Ingress proxy.

Only expose this port on trusted networks and use appropriate
network security controls.

Ingress is the recommended access method for normal Home Assistant
usage.

## Health check

The container health check uses:

```text
http://localhost:3333/api/v1/health
```

A healthy container indicates that this endpoint is responding.

It does not guarantee that every external data provider,
frontend operation or financial data update is working correctly.

## Updates and versioning

<!-- release-current:start -->

Current add-on version: **3.99.3**.
Ghostfolio NG: `integration-3.99.0-24`.
Source image: `ghcr.io/piggei/ghostfolio-ng@sha256:c5836caab45f808db74413cbc832699c4d9cf68244801bd984710ba822e06e15`.

<!-- release-current:end -->

Ghostfolio-NG application releases and Home Assistant add-on versions
are independently versioned.

Three identifiers are relevant:

- **Ghostfolio version:** the upstream application version.
- **NG integration tag:** the specific Ghostfolio-NG build.
- **Add-on version:** the version advertised to Home Assistant Supervisor.

Multiple NG releases can share the same upstream Ghostfolio version
while producing different Home Assistant add-on versions.

The release manifest records the complete release identity,
including the NG source commit, immutable source image digest
and approved add-on source revision.

The automated publication process:

1. Verifies the completed Ghostfolio-NG release and its provenance.
2. Reserves a unique add-on version.
3. Qualifies the AMD64 image.
4. Qualifies the ARM64 image on a native runner.
5. Publishes and verifies both final architecture images.
6. Activates the release metadata.
7. Creates or verifies the corresponding versioned Git tag.

The advertised add-on version advances only after both final
architecture images have been published and verified.

The Home Assistant changelog is generated from the release notes
and maintained integration-specific changes.

After a new publication, Home Assistant may need to refresh
the add-on repository metadata before displaying the latest version
and changelog.

See [release state contract](releases/README.md) and
[release workflow and recovery](releases/WORKFLOW.md)
for maintainer documentation.

### Before updating

1. Back up the external PostgreSQL database.
2. Back up the Home Assistant add-on data.
3. Review the release changelog.
4. Check the target add-on version.
5. Install the update through Home Assistant Supervisor.
6. Review startup logs and application health.

Database migrations may execute during application startup.

Avoid downgrading Ghostfolio against a database that has already
been migrated without a verified recovery procedure.

Do not delete persistent add-on data when updating the application.

## Backups and restoration

Back up both:

1. The external PostgreSQL database.
2. The Home Assistant add-on persistent data directory.

The add-on data includes:

- Redis persistence files under `/data/redis/`
- Application secrets under `/data/secrets/`

A Home Assistant backup does not automatically guarantee that
an external PostgreSQL database has been backed up.

Coordinate PostgreSQL backups separately.

When restoring:

1. Restore the PostgreSQL database from a compatible backup.
2. Restore the add-on persistent data, including application secrets
   and Redis data.
3. Verify the PostgreSQL connection settings.
4. Start the add-on.
5. Review startup logs and application health.

Before restoring a database, verify compatibility with the
Ghostfolio application version.

Do not replace existing application secrets with newly generated
values when restoring an existing installation.

## Troubleshooting

### PostgreSQL connection failure

Verify:

- PostgreSQL hostname and port
- Database name
- Username and password
- Network connectivity from the add-on
- PostgreSQL permissions
- PostgreSQL server availability

Check the startup logs for database connection or Prisma errors.

### Redis startup failure

Check the add-on logs and the persistent `/data/redis/` directory.

Do not remove persistent Redis data without understanding
the impact on the running application.

### Invalid persistent secrets

Inspect file permissions and restore the secrets from a
known-good backup.

Do not replace the secrets automatically.

### Ghostfolio does not become healthy

Inspect startup logs for:

- PostgreSQL connection failures
- Prisma migration errors
- Redis initialization failures
- NestJS application initialization errors

Verify that the database is reachable and that the configured
credentials are correct.

### Ingress displays a blank page

Check the browser developer tools for failed JavaScript, CSS,
asset and API requests.

Verify the Ingress path and redirect behavior.

If necessary, compare Ingress access with the optional direct
application port.

### Changelog or update not visible

Refresh the Home Assistant add-on repository metadata and
check for updates again.

Verify that the repository points to the correct branch:

```text
https://github.com/piggei/ghostfolio#feat/home-assistant-addon
```

### Nginx logs

Nginx access and error logs are currently written to temporary
files inside the container. They are not integrated into the
normal Home Assistant add-on log stream.

## Current limitations

- PostgreSQL must be provided and backed up externally.
- IPv6 PostgreSQL connection formatting has not been validated.
- Standalone PWA installation and launch behavior have not been
  fully qualified.
- The PWA manifest `url` field has not been validated for
  standalone installation outside the Ingress context.
- Nginx access and error logs are not integrated into the
  Home Assistant add-on log stream.

