# Open local orchestrator qualification

Run `./scripts/qualify-ha-orchestrator-local.sh` from this harness checkout.
It runs 107 immutable P orchestrator tests, 174 immutable C HA tests, all 3 current
harness security tests, Actionlint, duplicate-key YAML validation, Prettier, Node
and Bash syntax, inline shell syntax and whitespace checks. It never installs
software, fetches Git refs, changes system packages or invokes a release.

This is **OPEN_LOCAL** validation with developer-installed tools and a possibly
uncommitted harness. It does not establish the immutable H qualification provided
by GitHub Actions with the reviewed, hash-verified bundle. P/C are always extracted
from exact local Git objects into temporary directories; current branch source
cannot replace them. The original worktrees/refs/registry are not modified.

## Prerequisites and exact versions

- Node **22.x** with `--experimental-test-isolation` support (22.23.4 recommended to match CI); npm is needed only for manual setup.
- Actionlint **1.7.12** on PATH, or `HA_QUALIFY_ACTIONLINT=/absolute/path`.
- Prettier **3.9.10**, organize-attributes **1.0.0**, sort-imports **6.0.2**.
- `yaml` **2.9.0** (ISC, already in the repository lockfile; no runtime dependencies).
- Git, tar, Bash; a fully materialized non-promisor clone with P/C objects locally available.
  Promisor/partial clones are rejected and lazy fetching is disabled. Populate
  objects manually before qualification; the script never fetches them.
- Optional ShellCheck, checked explicitly if installed; its version is recorded.

Set `HA_QUALIFY_NODE_MODULES` to your independently installed tools' node_modules
folder. If unset, the script checks this repository's existing node_modules.
Set `HA_QUALIFY_NODE` to select a Node executable for the entry-point shell script.
Missing objects/tools or wrong required versions are reported before tests.
No global installation is performed by qualification.

## Ubuntu / Debian manual setup (developer executes these commands)

Install OS prerequisites using your normal package policy:

```bash
sudo apt-get update
sudo apt-get install git tar xz-utils bash ca-certificates curl gnupg libstdc++6 libgcc-s1
# Optional local analysis only; not redistributed in the hosted bundle:
sudo apt-get install shellcheck
```

Ubuntu/Debian's default Node version may not be 22. Check `node --version` before
using it. Install an official verified Node 22 distribution in your home directory
or use your existing Node version manager. For the CI-compatible 22.23.4 binary,
verify Node's signed SHASUMS256.txt with a trusted release key before extraction;
R4 accepted archive SHA-256
`1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce` and signing
fingerprint `5BE8A3F6C8A5C01D106C0AD820B1A390B168D356`. Obtain keys through a
trusted channel; do not trust a key merely because it arrives with the archive.
If nvm is already installed, an explicit user-run setup is:

```bash
nvm install 22.23.4
nvm use 22.23.4
node --version
```

Alternatively, after obtaining and verifying the official archive yourself:

```bash
node_prefix="$HOME/.local/share/node-22.23.4"
mkdir -p "$node_prefix"
tar -xJf /path/to/verified/node-v22.23.4-linux-x64.tar.xz \
  --strip-components=1 -C "$node_prefix"
export PATH="$node_prefix/bin:$PATH"
node --version
```

See [official release instructions](https://github.com/nodejs/node#verifying-binaries).

Install the JavaScript tools into a separate user-owned prefix, not globally and
not into the application's package manifest:

```bash
tools_prefix="$HOME/.local/share/ghostfolio-ha-qualification"
mkdir -p "$tools_prefix"
npm install --prefix "$tools_prefix" --ignore-scripts --no-audit --no-fund --save-exact \
  prettier@3.9.10 prettier-plugin-organize-attributes@1.0.0 \
  @trivago/prettier-plugin-sort-imports@6.0.2 yaml@2.9.0
export HA_QUALIFY_NODE_MODULES="$tools_prefix/node_modules"
```

These are explicit manual installation instructions. The qualifier itself never
runs npm or a package manager. Keep the generated tools lockfile if you want to
reproduce your local setup; this remains distinct from the reviewed CI archive.

Actionlint 1.7.12 may be installed under your home directory after checking its
official archive. For Linux AMD64 the approved archive SHA-256 is
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`:

```bash
set -euo pipefail
archive_dir="$(mktemp -d)"
curl --fail --location --output "$archive_dir/actionlint.tar.gz" \
  https://github.com/rhysd/actionlint/releases/download/v1.7.12/actionlint_1.7.12_linux_amd64.tar.gz
printf '%s  %s\n' \
  8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 \
  "$archive_dir/actionlint.tar.gz" | sha256sum --check --strict
# With a CLI supporting attestations, verify official repository provenance:
gh attestation verify --repo rhysd/actionlint "$archive_dir/actionlint.tar.gz"
mkdir -p "$HOME/.local/share/ghostfolio-actionlint-1.7.12"
tar -xzf "$archive_dir/actionlint.tar.gz" \
  -C "$HOME/.local/share/ghostfolio-actionlint-1.7.12" actionlint LICENSE.txt
export HA_QUALIFY_ACTIONLINT="$HOME/.local/share/ghostfolio-actionlint-1.7.12/actionlint"
```

The exact attested official binary carries upstream dirty build metadata; R3
accepts only its approved digest. Another build is not accepted by the hosted
bundle. Open local qualification checks the reported version and records local
provenance limitations rather than claiming immutable CI equivalence.

## Other Linux distributions

Use the distribution's package manager for Git/tar/Bash and optional ShellCheck,
then the same user-local Node/Actionlint and npm tool-prefix procedure. Official
Linux GNU Node binaries require a compatible glibc/C++ runtime; Alpine/musl is not
a supported execution platform for that binary. Choose a distribution-supported
Node 22 installation for the open local path instead. On non-AMD64 machines use
a separately verified matching Actionlint/Node distribution; the hosted bundle
is AMD64 only. No architecture/version fallback is automatic.

## Run and interpret the report

```bash
./scripts/qualify-ha-orchestrator-local.sh --report-dir /tmp/ha-local-qualification
```

- Exit **0**: SUCCESS, exactly **284** tests, static checks passed.
- Exit **2**: MISSING_OR_INCOMPATIBLE_PREREQUISITE; no successful qualification claimed.
- Exit **1**: FAILED tests/static checks; inspect the named log.

`result.json` records mode, actual tool versions, P/C, checks and final status.
If Node itself cannot start or has a different major version, the shell entry
point prints the prerequisite error and exits 2; no Node-generated JSON report
can be produced in that case.
The stdout summary always identifies the open local path. Temporary source
snapshots are cleaned on completion; logs remain in the requested report directory.
Optional ShellCheck absence is reported explicitly and does not skip a mandatory
test or replace Actionlint. A present ShellCheck failure fails local qualification.
