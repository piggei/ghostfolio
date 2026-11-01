# Ghostfolio All-PR Home Assistant Add-on

Run Ghostfolio All-PR as a Home Assistant add-on with an integrated
Redis service, persistent application secrets, and Home Assistant Ingress.

This add-on uses the Ghostfolio integration image published by
[piggei/ghostfolio](https://github.com/piggei/ghostfolio).

It does not build Ghostfolio from source or include a PostgreSQL server.

## Features

- Ghostfolio All-PR application
- Home Assistant Ingress support
- Optional direct access to the Ghostfolio web interface
- Integrated Redis with password authentication
- Persistent Redis storage using append-only files
- Automatically generated persistent application secrets
- PostgreSQL connection configuration through Home Assistant options
- Authenticated Supervisor API configuration retrieval using Bashio
- No dependency on a generated `/data/options.json` file
- s6-overlay service supervision
- Application services running as an unprivileged user

## Architecture

The add-on image extends the Ghostfolio All-PR Docker image.

The runtime includes:

- Ghostfolio (Angular frontend and NestJS backend)
- Redis bound to the container loopback interface
- Nginx reverse proxy for Home Assistant Ingress
- s6-overlay for initialization and service supervision
- Bashio for retrieving add-on options from Home Assistant Supervisor

PostgreSQL is an external dependency and must be configured separately.

The application listens on port 3333. The Ingress proxy listens
internally on port 8099.

## Supported architectures

The add-on supports:

- amd64
- aarch64

Both architecture builds and native runtime smoke tests have been
validated. The aarch64 test runs on a native ARM64 GitHub Actions runner.

## Installation

The add-on repository is:

https://github.com/piggei/ghostfolio#feat/home-assistant-addon

Installation through Home Assistant Supervisor requires the corresponding
versioned container images to be published in GHCR.

See [DOCS.md](DOCS.md) for configuration and installation instructions.

## Container images

The add-on uses architecture-specific images:

- `ghcr.io/piggei/ghostfolio-ha-all-pr-amd64`
- `ghcr.io/piggei/ghostfolio-ha-all-pr-aarch64`

The add-on version determines the image tag requested by Supervisor.

The current add-on version is **0.1.1**.

Release builds use an immutable Ghostfolio source image digest to ensure
both architectures are built from the same Ghostfolio release.

The GitHub Actions release workflow is triggered by publishing a versioned
Git tag matching `home-assistant-addon/v*`.

## Persistent data

The Home Assistant add-on data directory stores:

- `/data/secrets/ghostfolio.env`
- `/data/redis/`

Application secrets are generated during initial startup and reused
on subsequent starts.

The external PostgreSQL database stores the Ghostfolio application
data and must be backed up independently.

## Development and release status

Version 0.1.1 includes the Supervisor configuration retrieval fix.

The following have been validated locally on amd64 and/or through
automated native ARM64 GitHub Actions tests:

- Docker image build
- s6-overlay service initialization
- Authenticated Supervisor API requests through Bashio
- Configuration retrieval without `/data/options.json`
- Persistent secrets initialization and reuse
- Redis startup and password authentication
- PostgreSQL connectivity using credentials containing special characters
- Ghostfolio application startup and health endpoint
- Application services running as the unprivileged `node` user
- Nginx reverse proxy
- Simulated Home Assistant Ingress redirects and asset requests

The native ARM64 workflow also verifies the application database session,
persistent secrets, Redis authentication, and cleanup of isolated test
resources.

The following remain to be validated or improved:

- Installation and startup of version 0.1.1 through a real Home Assistant Supervisor
- Full browser navigation through real Home Assistant Ingress
- Integration of Nginx access and error logs into the Home Assistant log stream
- IPv6 PostgreSQL connection formatting

The published 0.1.0 release remains available independently.

## License

Ghostfolio is distributed under the license provided in the
upstream Ghostfolio repository.

The Home Assistant add-on includes additional integration scripts
and configuration. Consult the relevant upstream projects for
their respective license terms.
