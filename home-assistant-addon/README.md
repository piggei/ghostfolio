# Ghostfolio-NG Home Assistant Add-on

Run Ghostfolio-NG directly inside Home Assistant with native Ingress
support, integrated Redis, persistent application secrets and
architecture-specific container images.

The add-on is maintained in the
[piggei/ghostfolio repository](https://github.com/piggei/ghostfolio)
and uses the independently maintained Ghostfolio-NG distribution.

It supports AMD64 and ARM64 and requires an external PostgreSQL
server. PostgreSQL is not included in the add-on.

## Features

- Ghostfolio-NG application
- Native Home Assistant Ingress integration
- Optional direct access to the application
- Integrated Redis with password authentication
- Persistent Redis storage using append-only files
- Automatically generated and persistent application secrets
- PostgreSQL configuration through Home Assistant options
- Authenticated Supervisor API configuration retrieval using Bashio
- s6-overlay service supervision
- Application services running as an unprivileged user

## Architecture

The add-on image extends an immutable Ghostfolio-NG application image.

The runtime consists of:

- Ghostfolio (Angular frontend and NestJS backend)
- Redis bound to the container loopback interface
- Nginx reverse proxy for Home Assistant Ingress
- s6-overlay for initialization and service supervision
- Bashio for retrieving configuration from Home Assistant Supervisor

The application listens internally on port 3333.
The Ingress proxy listens internally on port 8099.

PostgreSQL is external and must be reachable from the add-on.

## Supported architectures

- `amd64`
- `aarch64`

Both architectures are built and qualified independently on native
GitHub Actions runners. Final images are published only after both
architectures have passed qualification.

## Installation

[![Add repository to Home Assistant](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fpiggei%2Fghostfolio%23feat%2Fhome-assistant-addon)

Add-on repository:

https://github.com/piggei/ghostfolio#feat/home-assistant-addon

After adding the repository:

1. Refresh the Home Assistant add-on store if necessary.
2. Select Ghostfolio-NG.
3. Configure the external PostgreSQL connection.
4. Install and start the add-on.
5. Open the application through Home Assistant Ingress.
6. Review the startup logs and application health.

See [DOCS.md](DOCS.md) for complete installation,
configuration, update, backup and troubleshooting instructions.

## Container images

The add-on uses separate architecture-specific images:

- `ghcr.io/piggei/ghostfolio-ng-ha-amd64`
- `ghcr.io/piggei/ghostfolio-ng-ha-aarch64`

Home Assistant Supervisor selects the appropriate image using
the add-on version declared in `config.yaml`.

<!-- release-current:start -->

Current add-on version: **3.99.3**.
Ghostfolio NG: `integration-3.99.0-24`.
Source image: `ghcr.io/piggei/ghostfolio-ng@sha256:c5836caab45f808db74413cbc832699c4d9cf68244801bd984710ba822e06e15`.

<!-- release-current:end -->

Each release is associated with an immutable Ghostfolio-NG source
image digest. Both architecture images are qualified against the
same source identity before the new add-on version is activated.

## Persistent data

The add-on stores persistent runtime data under `/data`:

- `/data/secrets/ghostfolio.env`
- `/data/redis/`

Application secrets are generated during initial startup and
reused on subsequent starts.

Do not delete or regenerate these secrets during normal updates.

The external PostgreSQL database contains the Ghostfolio application
data and must be backed up independently.

## Release and maintenance

Ghostfolio-NG application releases and Home Assistant add-on versions
are independently versioned.

A new NG integration release can result in a new add-on version,
even when the upstream Ghostfolio version has not changed.

The automated release process verifies the NG release provenance,
reserves an add-on version, qualifies both architectures, publishes
the immutable images and activates the release metadata.

The current advertised version is updated only after both final
architecture images have been successfully published and verified.

For the release contract, recovery procedures and maintainer
permissions, see:

- [Release state contract](releases/README.md)
- [Release workflow and recovery](releases/WORKFLOW.md)

## License

Ghostfolio is distributed under the license provided by the
upstream Ghostfolio repository.

The Home Assistant add-on also contains integration-specific
scripts and configuration. Consult the respective projects
for their applicable license terms.
