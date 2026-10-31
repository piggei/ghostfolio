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
- PostgreSQL connection configuration through add-on options
- s6-overlay service supervision
- Application services running as an unprivileged user

## Architecture

The add-on image extends the Ghostfolio All-PR Docker image.

The runtime includes:

- Ghostfolio (Angular frontend and NestJS backend)
- Redis bound to the container loopback interface
- Nginx reverse proxy for Home Assistant Ingress
- s6-overlay for initialization and service supervision

PostgreSQL is an external dependency and must be configured separately.

The application listens on port 3333. The Ingress proxy listens
internally on port 8099.

## Supported architectures

The add-on is configured for:

- amd64
- aarch64

The amd64 implementation has been tested locally.

The aarch64 build and runtime still require validation.

## Installation

The intended add-on repository is:

https://github.com/piggei/ghostfolio#feat/home-assistant-addon

The repository branch and container images must be published before
installation through Home Assistant Supervisor.

See [DOCS.md](DOCS.md) for configuration and installation instructions.

## Container images

The add-on uses architecture-specific images:

- ghcr.io/piggei/ghostfolio-ha-all-pr-amd64
- ghcr.io/piggei/ghostfolio-ha-all-pr-aarch64

The add-on version determines the image tag requested by Supervisor.

The initial planned add-on version is 0.1.0.

The image build accepts GHOSTFOLIO_IMAGE to select a specific
Ghostfolio All-PR image.

Release builds should use an immutable source image digest to
ensure both architectures use the same Ghostfolio release.

## Persistent data

The Home Assistant add-on data directory stores:

- /data/secrets/ghostfolio.env
- /data/redis/

Application secrets are generated during initial startup and reused
on subsequent starts.

The external PostgreSQL database stores the Ghostfolio application
data and must be backed up independently.

## Development and release status

The add-on is under development.

The following have been tested locally on amd64:

- Docker image build
- s6-overlay service initialization
- Persistent secrets initialization and reuse
- Redis startup and persistence
- PostgreSQL connectivity
- Ghostfolio application startup
- Application health endpoint
- Nginx reverse proxy
- Simulated Home Assistant Ingress redirects and asset requests

The following remain to be validated:

- Native aarch64 build and runtime
- Published GHCR images
- Installation through Home Assistant Supervisor
- Full browser navigation through real Home Assistant Ingress
- Automated release workflow execution

The GitHub Actions workflow is initially intended for manual releases.

## License

Ghostfolio is distributed under the license provided in the
upstream Ghostfolio repository.

The Home Assistant add-on includes additional integration scripts
and configuration. Consult the relevant upstream projects for
their respective license terms.
