# Docker releases of the integration branch

Every push to `integration/ghostfolio-all-pr` in `piggei/ghostfolio` runs
`.github/workflows/integration-release.yml`. The workflow also declares a manual
trigger. GitHub shows that trigger once the workflow is present on the default
branch; automatic publication from the integration branch does not require this.

After the tests pass, native AMD64 and ARM64 runners build the application. Only
when both builds succeed does the workflow publish a GitHub prerelease and advance
the `ghcr.io/piggei/ghostfolio:integration` channel. A failed build does not advance
that channel. These are integration builds with the fork's custom features.

Each release has a unique `integration-UPSTREAM_VERSION-RUN.ATTEMPT` tag, Docker
archives for both architectures, a standalone `docker-compose.yml`, `ghostfolio.env.example`
and SHA256 checksums. The registry also provides a `sha-FULL_COMMIT` tag. Prefer the
release tag for reproducible installations; the `integration` tag follows the most
recent successfully published build.

## Install

Download `docker-compose.yml` and `ghostfolio.env.example` from the same release, put them in
a new directory, copy `ghostfolio.env.example` to `.env` and fill in passwords and random
secrets. From that directory:

```sh
docker compose pull
docker compose up -d
```

Open port 3333 on the host to use Ghostfolio. PostgreSQL and Redis are provided by
the Compose file; PostgreSQL data is kept in a named volume. For an existing
installation, keep its environment and volumes and back up the database before
updating, because the application applies migrations on startup.

To follow the moving integration channel, replace the application image in the
Compose file with `ghcr.io/piggei/ghostfolio:integration`, then repeat the commands
above when you want to update. Publishing a new image does not update running
servers automatically.

Alternatively, download the archive matching your architecture and load it with
`docker load -i ARCHIVE.tar.gz`, then use `docker compose up -d --pull never`.
The image in the archive matches the release Compose file. PostgreSQL and Redis
still need to be available on the host or downloadable from their registries.

## GitHub configuration

The workflow uses the automatic `GITHUB_TOKEN` with `packages: write` and
`contents: write`; no Docker Hub credentials are required. The package links to
this fork rather than the upstream repository. If GitHub initially creates it as
private, change its visibility to public at:

<https://github.com/users/piggei/packages/container/ghostfolio/settings>

Public visibility allows anonymous pulls. The release archives provide another
installation route independent of registry authentication.

## Release notes

`scripts/integration-release.mjs` includes the official Ghostfolio release notes
between the previous integration release's upstream version and the current
version. It fetches them from `ghostfolio/ghostfolio`, falling back to the checked-in
changelog if the release API is unavailable. The first publication uses 3.92.0 as
its baseline, so it includes the 3.93.0 and 3.94.0 release notes. The notes also
include the checked-in Unreleased section and the integration branch's commits.

The upstream Docker Hub workflow only publishes in the upstream repository or
when `DOCKER_REPOSITORY` has explicitly been configured, avoiding accidental
publication to the upstream image name from this fork.
