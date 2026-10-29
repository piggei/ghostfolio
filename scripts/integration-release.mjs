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
  const notes =
    `# Ghostfolio integration\n\n` +
    `Build del branch \`integration/ghostfolio-all-pr\`, basata su Ghostfolio **${version}**. ` +
    `Include le personalizzazioni del fork e i commit upstream integrati dopo la release ufficiale.\n\n` +
    `- Commit: [${sha.slice(0, 9)}](https://github.com/${repository}/commit/${sha})\n` +
    `- Immagine: \`${image}:${tag}\`\n` +
    `- Versione immutabile per commit: \`${image}:sha-${sha}\`\n` +
    `- Architetture: Linux AMD64 e ARM64.\n\n` +
    `## Installazione\n\n` +
    `Scarica \`docker-compose.yml\` e \`.env.example\` dagli allegati, copia quest'ultimo in \`.env\` ` +
    `e configura password e chiavi casuali. Dalla stessa cartella esegui:\n\n` +
    '```sh\ndocker compose pull\ndocker compose up -d\n```\n\n' +
    `L'applicazione è disponibile sulla porta 3333. PostgreSQL e Redis sono inclusi nel Compose; ` +
    `i dati sono conservati nel volume PostgreSQL. Per un'installazione esistente, conserva configurazione e volumi ` +
    `e salva un backup del database prima di aggiornare: all'avvio vengono applicate le migrazioni.\n\n` +
    `Se il pacchetto GHCR richiede autenticazione, il proprietario può renderlo pubblico nelle ` +
    `[impostazioni del pacchetto](https://github.com/users/${repository.split('/')[0]}/packages/container/${repository.split('/')[1]}/settings). ` +
    `In alternativa scarica l'archivio della tua architettura e importalo senza accedere al registry:\n\n` +
    `\`\`\`sh\ndocker load -i ghostfolio-${tag}-linux-amd64.tar.gz\ndocker compose up -d --pull never\n\`\`\`\n\n` +
    `Per ARM64 usa il file con suffisso \`linux-arm64.tar.gz\`. Gli archivi contengono solo l'applicazione; ` +
    `PostgreSQL e Redis devono essere disponibili o scaricabili. Verifica gli allegati con \`sha256sum -c SHA256SUMS\`.\n\n` +
    `Per seguire gli aggiornamenti automatici, sostituisci il tag dell'immagine nel Compose con \`integration\` ` +
    `e ripeti \`docker compose pull && docker compose up -d\`. Il server si aggiorna quando esegui questi comandi.\n\n` +
    `## Aggiornamenti ufficiali di Ghostfolio\n\n` +
    (official.join('\n\n') ||
      `Nessuna nuova versione ufficiale rispetto alla release precedente (Ghostfolio ${version}).`) +
    (unreleased?.body
      ? `\n\n### Ulteriori aggiornamenti integrati\n\n${unreleased.body.replace(/^### /gm, '#### ')}`
      : '') +
    `\n\n## Modifiche del branch di integrazione\n\n${changes}\n`;
  mkdirSync('release-assets', { recursive: true });
  writeFileSync('release-assets/notes.md', notes);
  // A standalone copy uses the versioned image and an environment file beside the compose file.
  const compose = readFileSync('docker/docker-compose.yml', 'utf8')
    .replace('docker.io/ghostfolio/ghostfolio:latest', `${image}:${tag}`)
    .replaceAll('../.env', '.env');
  writeFileSync('release-assets/docker-compose.yml', compose);
  writeFileSync('release-assets/.env.example', readFileSync('.env.example'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  generateRelease();
