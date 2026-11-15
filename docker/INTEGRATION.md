# Ghostfolio-NG Docker releases

Ghostfolio-NG is an unofficial integration distribution of Ghostfolio.
It combines the upstream application with independently maintained
features and integration-specific patches. Inclusion in this branch
does not imply that an upstream Pull Request has been accepted or merged.

This document describes the Docker release workflow for
`integration/ghostfolio-all-pr`.

## Release workflow

Every push to `integration/ghostfolio-all-pr` in
`piggei/ghostfolio` starts
`.github/workflows/integration-release.yml`. The workflow also declares
`workflow_dispatch`; GitHub exposes that manual trigger according to
the workflow's availability on the repository default branch.

The workflow runs these stages:

1. Read the upstream Ghostfolio version from `package.json` and
   allocate the integration tag.
2. Install dependencies and run release-specific tests, build-info
   tests and the complete application test suite.
3. Build and smoke-test AMD64 and ARM64 images on native runners.
4. Export architecture-specific Docker archives.
5. Verify the candidate images and construct a temporary multi-platform
   candidate from their immutable digests.
6. Generate release notes, Compose configuration, environment example
   and SHA256 checksums.
7. Qualify the distributable Compose deployment.
8. Promote and verify immutable GHCR release tags.
9. Publish the GitHub Release and advance the rolling integration
   channel only when release ordering permits it.

The workflow uses a concurrency group with
`cancel-in-progress: false`. A failed verification or architecture
build prevents publication. The rolling integration channel is
advanced only after the immutable release has been published and
verified. If a newer integration release has already been published,
an older run does not move the channel backwards.

## Version and image references

The integration tag has this format:

```text
integration-UPSTREAM_VERSION-RUN_NUMBER
```

For example, the verified release in this branch is
`integration-3.99.0-24`.

The run number is GitHub Actions' `GITHUB_RUN_NUMBER`; the current
workflow does not append a run-attempt suffix.

Each release also has an immutable commit tag:

```text
sha-FULL_COMMIT
```

The published GHCR image is:

```text
ghcr.io/piggei/ghostfolio-ng:integration-UPSTREAM_VERSION-RUN_NUMBER
ghcr.io/piggei/ghostfolio-ng:sha-FULL_COMMIT
ghcr.io/piggei/ghostfolio-ng:integration
```

The version-specific integration tag and commit tag are immutable
release references. The `integration` tag is a rolling channel and
may advance to a newer successfully published release.

Prefer the version-specific tag or commit tag for reproducible
deployments. Use `integration` only when you intentionally want to
follow the latest published integration build.

## Release assets

Each published GitHub Release contains:

- `docker-compose.yml`
- `ghostfolio.env.example`
- `ghostfolio-ng-TAG-linux-amd64.tar.gz`
- `ghostfolio-ng-TAG-linux-arm64.tar.gz`
- `SHA256SUMS`

The Compose file and environment example are generated for the
specific release. Download them from the same GitHub Release as the
image archives.

The Compose deployment includes:

- Ghostfolio-NG application
- PostgreSQL 15
- Redis 8

PostgreSQL data is stored in a named Docker volume. Redis and
PostgreSQL are health-checked before the application starts.

The application exposes port `3333` on the host. Protect that port
with the network controls appropriate to your environment.

## Install with Docker Compose

1. Open the [Ghostfolio-NG releases](https://github.com/piggei/ghostfolio/releases)
   and select the required integration release.
2. Download `docker-compose.yml` and `ghostfolio.env.example`
   from that same release.
3. Place both files in a new deployment directory.
4. Copy `ghostfolio.env.example` to `.env`.
5. Configure the database credentials and required application
   secrets in `.env`.
6. Start the deployment:

```sh
docker compose pull
docker compose up -d
```

Open Ghostfolio at:

```text
http://HOST:3333
```

Replace `HOST` with the address of the Docker host.

The example Compose file includes PostgreSQL and Redis. PostgreSQL
data is stored in the named `postgres` volume. Keep the environment
file and volumes when updating an existing installation.

Database migrations and seeding run during application startup.
Back up the database and preserve the existing volumes and
configuration before upgrading.

## Offline or archive installation

The release archives contain the application image for one
architecture. Download the archive matching the Docker host:

- AMD64: `ghostfolio-ng-TAG-linux-amd64.tar.gz`
- ARM64: `ghostfolio-ng-TAG-linux-arm64.tar.gz`

Verify the downloaded files from the release asset directory:

```sh
sha256sum -c SHA256SUMS
```

Load the matching application image:

```sh
docker load -i ghostfolio-ng-TAG-linux-amd64.tar.gz
```

For ARM64, use the archive ending in `linux-arm64.tar.gz`.

Then start the release Compose deployment without pulling the
application image:

```sh
docker compose up -d --pull never
```

The PostgreSQL and Redis images must also be available locally or
downloadable from their respective registries. The application
archive does not contain those service images.

## Updating an installation

Before updating:

1. Back up the PostgreSQL database.
2. Preserve the existing `.env` file.
3. Preserve the Docker volumes.
4. Review the release notes and target version.
5. Download the Compose file and environment example from the
   same target release.

For a version-specific deployment, use the Compose file supplied
with that release and pull the corresponding image.

To follow the rolling integration channel, change the application
image in the Compose file to:

```text
ghcr.io/piggei/ghostfolio-ng:integration
```

Then update when desired:

```sh
docker compose pull
docker compose up -d
```

Publishing a new image does not update running Docker deployments
automatically.

Do not replace an existing `.env` file with the example during
an update. Preserve the existing credentials and secrets.

Database migrations may run during startup. Avoid downgrading the
application against a database that has already been migrated
unless a verified database recovery procedure is available.

## Release notes and integrated contributions

The release generator is implemented in
`scripts/integration-release.mjs`.

It includes the official Ghostfolio release notes between the
previous integration release's upstream version and the current
application version. Official release notes are retrieved from
the upstream GitHub Releases API; if that API is unavailable,
the checked-in upstream changelog is used as a fallback.

The release notes also include:

- The Unreleased section from the checked-in changelog, when present.
- Integration branch commit history since the previous integration
  release.
- Integrated upstream Pull Requests.
- Integration-specific local patches.
- Docker installation instructions.
- Home Assistant add-on information and links.

The first integration release uses the documented upstream baseline
`3.92.0`. Subsequent releases derive the previous version from
integration tags reachable from the release commit.

### Integrated Pull Requests and local patches

The persistent inventory is maintained in
`docker/integrated-prs.json`.

It distinguishes two types of contribution:

- `pullRequests`: contributions proposed to the official Ghostfolio
  repository. Their presence in All-PR does not imply upstream
  acceptance or merge.
- `localPatches`: locally maintained changes without an upstream
  Pull Request. Each patch has a stable identifier, source reference
  and provenance manifest or documentation under `docker/patches/`
  or `docs/`.

The release generator validates both collections and renders
separate **Integrated Pull Requests** and **Local Patches** sections.

Integration-specific changes are listed separately from the Git
commit history. Official Ghostfolio release notes remain unchanged.

When adding a local patch, update its provenance manifest or
documentation and the persistent inventory. The `localPatches`
field remains optional for compatibility with older manifests.

## GitHub and GHCR permissions

The workflow uses the repository-provided `GITHUB_TOKEN`.

The release job requires:

- `contents: write` to create and publish GitHub Releases.
- `packages: write` to publish and promote GHCR images.
- `actions: read` for workflow artifact access.

No Docker Hub credentials are required for Ghostfolio-NG publication.
The image package belongs to the `piggei/ghostfolio` fork.

Public package visibility allows anonymous image pulls. If the
package is initially private, review its visibility and access
settings in the
[Ghostfolio-NG GHCR package settings](https://github.com/users/piggei/packages/container/ghostfolio-ng/settings).

The upstream Docker Hub workflow only publishes in the upstream
repository or when `DOCKER_REPOSITORY` has explicitly been
configured. This prevents the fork from accidentally publishing
to the upstream image name.

## Current verified release

The latest end-to-end verified NG integration release documented
at the time of this update is:

| Item                   | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Integration tag        | `integration-3.99.0-24`                                                     |
| Source commit          | `f0c04418df139244ff6a41443a2ca08407993a01`                                  |
| Version-specific image | `ghcr.io/piggei/ghostfolio-ng:integration-3.99.0-24`                        |
| Commit image           | `ghcr.io/piggei/ghostfolio-ng:sha-f0c04418df139244ff6a41443a2ca08407993a01` |
| Rolling channel        | `ghcr.io/piggei/ghostfolio-ng:integration`                                  |
| Architectures          | Linux AMD64 and ARM64                                                       |

The same NG release was consumed by the automated Home Assistant
publisher, which activated add-on version `3.99.3`.

Future releases must use the tag, commit and image references
generated by their own workflow run. Do not copy these example
values into a new deployment.

## Related documentation

- [Ghostfolio-NG Home Assistant add-on](../home-assistant-addon/README.md)
- [Home Assistant add-on user documentation](../home-assistant-addon/DOCS.md)
- [Home Assistant release state contract](../home-assistant-addon/releases/README.md)
- [Home Assistant release workflow](../home-assistant-addon/releases/WORKFLOW.md)
