import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function changelogSections(changelog) {
  return [
    ...changelog.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)
  ].map(([, heading, body]) => ({
    heading,
    body: body.trim(),
    version: heading.split(' ')[0]
  }));
}

export function includedReleases(sections, current, previous) {
  const numeric = (version) => version.split('.').map(Number);
  const compare = (a, b) => {
    const left = numeric(a);
    const right = numeric(b);
    return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
  };
  return sections.filter(
    ({ version }) =>
      /^\d+\.\d+\.\d+$/.test(version) &&
      compare(version, current) <= 0 &&
      (!previous ? version === current : compare(version, previous) > 0)
  );
}

export function integratedPullRequestsMarkdown(manifest) {
  if (!manifest || !Array.isArray(manifest.pullRequests)) {
    throw new Error('Invalid integrated PR manifest');
  }

  const categories = new Map();
  const numbers = new Set();

  for (const pr of manifest.pullRequests) {
    if (
      !Number.isSafeInteger(pr.number) ||
      pr.number <= 0 ||
      typeof pr.title !== 'string' ||
      !pr.title.trim() ||
      typeof pr.category !== 'string' ||
      !pr.category.trim()
    ) {
      throw new Error('Invalid integrated PR entry');
    }

    if (numbers.has(pr.number)) {
      throw new Error(`Duplicate integrated PR #${pr.number}`);
    }

    numbers.add(pr.number);

    if (!categories.has(pr.category)) {
      categories.set(pr.category, []);
    }

    categories
      .get(pr.category)
      .push(
        `- [#${pr.number} — ${pr.title}](https://github.com/ghostfolio/ghostfolio/pull/${pr.number})`
      );
  }

  if (categories.size === 0) {
    return 'No additional upstream Pull Requests are currently listed.';
  }

  return [...categories]
    .map(([category, entries]) => `### ${category}\n\n${entries.join('\n')}`)
    .join('\n\n');
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

export function generateRelease() {
  const {
    IMAGE: image,
    TAG: tag,
    GITHUB_REPOSITORY: repository,
    GITHUB_SHA: sha
  } = process.env;
  if (!image || !tag || !repository || !sha)
    throw new Error('Missing release environment');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  const sections = changelogSections(readFileSync('CHANGELOG.md', 'utf8'));
  // Only tags reachable from this integration branch can define the previous release.
  const previousTag = git(
    'tag',
    '--merged',
    sha,
    '--list',
    'integration-*',
    '--sort=-creatordate'
  )
    .split('\n')
    .find((value) => value && value !== tag);
  const previousVersion = previousTag
    ? JSON.parse(git('show', `${previousTag}:package.json`)).version
    : '3.92.0';
  const official = includedReleases(sections, version, previousVersion).map(
    (section) => {
      let body = section.body;
      const url = `https://github.com/ghostfolio/ghostfolio/releases/tag/${section.version}`;
      try {
        const release = JSON.parse(
          execFileSync(
            'gh',
            [
              'api',
              `repos/ghostfolio/ghostfolio/releases/tags/${section.version}`
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          )
        );
        body = release.body || body;
      } catch {
        console.warn(
          `Official release ${section.version} unavailable; using the checked-in changelog.`
        );
      }
      return `### [Ghostfolio ${section.version}](${url})\n\n${body.replace(/^### /gm, '#### ').trim()}`;
    }
  );
  const unreleased = sections.find(
    ({ version: value }) => value === 'Unreleased'
  );
  const changes = previousTag
    ? git(
        'log',
        '--first-parent',
        '--format=- %s (%h)',
        `${previousTag}..${sha}`
      )
    : git('log', '--first-parent', '-12', '--format=- %s (%h)', sha);
  const manifest = JSON.parse(
    readFileSync('docker/integrated-prs.json', 'utf8')
  );
  const integratedPrs = integratedPullRequestsMarkdown(manifest);

  const notes =
    `# Ghostfolio Integration — ${tag}\n\n` +
    `This release is built from the \`integration/ghostfolio-all-pr\` branch, ` +
    `based on Ghostfolio **${version}**. It combines upstream updates with ` +
    `custom features and independently proposed contributions.\n\n` +
    `## Release information\n\n` +
    `- Source commit: [${sha.slice(0, 9)}](https://github.com/${repository}/commit/${sha})\n` +
    `- Docker image: \`${image}:${tag}\`\n` +
    `- Rolling integration channel: \`${image}:integration\`\n` +
    `- Immutable commit tag: \`${image}:sha-${sha}\`\n` +
    `- Supported architectures: Linux AMD64 and ARM64\n\n` +
    `## Integrated Pull Requests\n\n` +
    `The following contributions are maintained in the integration branch ` +
    `while undergoing independent upstream review. Inclusion does not imply ` +
    `acceptance or merger into the official Ghostfolio project.\n\n` +
    `${integratedPrs}\n\n` +
    `## Installation\n\n` +
    `Download \`docker-compose.yml\` and \`ghostfolio.env.example\` from this ` +
    `release. Copy \`ghostfolio.env.example\` to \`.env\` and configure the ` +
    `required passwords and randomly generated secrets.\n\n` +
    '```sh\ndocker compose pull\ndocker compose up -d\n```\n\n' +
    `Ghostfolio is available on port 3333. The Compose configuration includes ` +
    `PostgreSQL and Redis, with persistent PostgreSQL storage.\n\n` +
    `Database migrations and seeding run during application startup. ` +
    `Back up the database and preserve existing volumes and configuration ` +
    `before upgrading.\n\n` +
    `## Offline installation\n\n` +
    `Download the archive matching your architecture and load it using:\n\n` +
    `\`\`\`sh\ndocker load -i ghostfolio-${tag}-linux-amd64.tar.gz\n` +
    `docker compose up -d --pull never\n\`\`\`\n\n` +
    `For ARM64, use the archive ending in \`linux-arm64.tar.gz\`. ` +
    `PostgreSQL and Redis images must also be available locally or downloadable. ` +
    `Verify the release assets with \`sha256sum -c SHA256SUMS\`.\n\n` +
    `## Updating the integration channel\n\n` +
    `To follow the latest successfully published integration build, set ` +
    `the Ghostfolio image in Docker Compose to \`${image}:integration\`.\n\n` +
    '```sh\ndocker compose pull\ndocker compose up -d\n```\n\n' +
    `For reproducible deployments, prefer a version-specific or commit-based tag.\n\n` +
    `## Official Ghostfolio updates\n\n` +
    (official.join('\n\n') ||
      `No new official Ghostfolio release since the previous integration build (${version}).`) +
    (unreleased?.body
      ? `\n\n### Additional upstream changes\n\n${unreleased.body.replace(/^### /gm, '#### ')}`
      : '') +
    `\n\n## Integration-specific changes\n\n${changes}\n\n` +
    `## Project status\n\n` +
    `This is an unofficial integration release maintained independently of ` +
    `the Ghostfolio upstream project.\n\n` +
    `Official project: https://github.com/ghostfolio/ghostfolio\n\n` +
    `Integration fork: https://github.com/${repository}\n`;
  mkdirSync('release-assets', { recursive: true });
  writeFileSync('release-assets/notes.md', notes);
  // A standalone copy uses the versioned image and an environment file beside the compose file.
  const compose = readFileSync('docker/docker-compose.yml', 'utf8')
    .replace('docker.io/ghostfolio/ghostfolio:latest', `${image}:${tag}`)
    .replaceAll('../.env', '.env');
  writeFileSync('release-assets/docker-compose.yml', compose);
  writeFileSync(
    'release-assets/ghostfolio.env.example',
    readFileSync('.env.example')
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  generateRelease();
