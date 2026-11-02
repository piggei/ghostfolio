# Ghostfolio-NG Home Assistant Add-on

Run Ghostfolio-NG as a Home Assistant add-on with an integrated
Redis service, persistent application secrets, and Home Assistant Ingress.

This add-on uses the Ghostfolio integration image published by
[piggei/ghostfolio](https://github.com/piggei/ghostfolio).

It does not build Ghostfolio from source or include a PostgreSQL server.

## Features

- Ghostfolio-NG application
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

The add-on image extends the Ghostfolio-NG Docker image.

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

- `ghcr.io/piggei/ghostfolio-ng-ha-amd64`
- `ghcr.io/piggei/ghostfolio-ng-ha-aarch64`

The add-on version determines the image tag requested by Supervisor.

The current add-on version is **0.2.0**.

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

## Ghostfolio-NG 0.1.3 qualification

Version 0.1.3 updates the add-on base image to Ghostfolio-NG
`integration-3.94.0-11`, pinned to its verified immutable OCI digest.

The following checks have passed on local AMD64:

- Docker image build and Nginx configuration validation.
- Startup with S6 Overlay, Redis and PostgreSQL.
- Authenticated Home Assistant Supervisor mock configuration.
- Ghostfolio health endpoint returning HTTP 200.
- Nginx Ingress proxy redirecting to the localized application.
- Persistent secrets remaining unchanged after container restart.

Native ARM64 qualification completed successfully, and version 0.1.3
images were published and independently verified on GHCR.
Installation through a real Home Assistant Supervisor remains to be verified.

## Ghostfolio-NG 0.2.0

Version 0.2.0 completes the transition to the Ghostfolio-NG identity.

Changes include:

- Home Assistant add-on name: Ghostfolio-NG.
- Add-on slug: `ghostfolio_ng`.
- Architecture-specific images renamed to `ghostfolio-ng-ha-*`.
- Updated repository metadata and OCI image labels.
- Continued use of the verified Ghostfolio-NG integration image.

The application runtime, PostgreSQL configuration, Redis persistence,
Supervisor API integration and Ingress implementation remain unchanged.

Version 0.2.0 requires renewed AMD64 and ARM64 qualification and
publication of its architecture-specific images before installation.

## Development and release status

Version 0.1.2 includes the Home Assistant Ingress routing and
PWA manifest compatibility fixes.

The following have been validated locally on amd64 and through
automated native ARM64 GitHub Actions tests:

- Docker image build and Nginx configuration
- s6-overlay service initialization
- Authenticated Supervisor API requests through Bashio
- Configuration retrieval without `/data/options.json`
- Persistent secrets initialization and reuse
- Redis startup and password authentication
- PostgreSQL connectivity using credentials containing special characters
- Ghostfolio application startup and health endpoint
- Application services running as the unprivileged `node` user
- Angular HTML base path rewriting
- JavaScript API path rewriting, including the tested Angular chunk
- Home Assistant Ingress API responses
- PWA manifest rewriting for Ingress
- PWA icon requests through Ingress
- Preservation of the original manifest without Ingress
- Direct Ghostfolio API access
- Financial API JSON response integrity
- Nginx reverse proxy and simulated Ingress redirects

The native ARM64 workflow also verifies the application database session,
persistent secrets, Redis authentication, Ingress routing, PWA resources,
and cleanup of isolated test resources.

The following remain to be validated or improved:

- Installation and startup of version 0.1.2 through a real Home Assistant Supervisor
- Full browser navigation through real Home Assistant Ingress
- PWA standalone installation and launch behavior
- The PWA manifest `url` field, which still reports the internal container address
- Integration of Nginx access and error logs into the Home Assistant log stream
- IPv6 PostgreSQL connection formatting

The published 0.1.0 and 0.1.1 releases remain available independently.

## License

Ghostfolio is distributed under the license provided in the
upstream Ghostfolio repository.

The Home Assistant add-on includes additional integration scripts
and configuration. Consult the relevant upstream projects for
their respective license terms.
