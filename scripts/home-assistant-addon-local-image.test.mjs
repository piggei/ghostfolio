import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import { localImageIdentity } from './home-assistant-addon-local-image.mjs';
import { sha256 } from './home-assistant-addon-oci.mjs';
import { Docker } from './home-assistant-addon-pipeline.mjs';

const labels = {
  'io.ghostfolio.ha.identity': 'test-identity',
  'org.opencontainers.image.revision': 'a'.repeat(40)
};
const bytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
function tar(files) {
  const chunks = [];
  for (const file of files) {
    const content = file.bytes ?? Buffer.alloc(0);
    const header = Buffer.alloc(512);
    header.write(file.name, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(
      file.sizeField ?? content.length.toString(8).padStart(11, '0') + '\0',
      124
    );
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header[156] = file.type ?? 48;
    if (file.link) header.write(file.link, 157, 100);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((n, byte) => n + byte, 0);
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(
      header,
      content,
      Buffer.alloc(
        (512 - (content.length % 512)) % 512,
        file.paddingBad ? 1 : 0
      )
    );
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}
function fixture(arch = 'amd64', oci = true, modify = () => {}) {
  const layer = Buffer.from('opaque layer bytes');
  const layerDigest = sha256(layer);
  const config = {
    os: 'linux',
    architecture: arch,
    rootfs: { type: 'layers', diff_ids: [layerDigest] },
    config: { Labels: labels }
  };
  const setup = { config, rawConfig: null };
  modify(setup, 'config');
  const raw = setup.rawConfig ?? bytes(config);
  const digest = sha256(raw);
  const configPath = oci
    ? 'blobs/sha256/' + digest.slice(7)
    : digest.slice(7) + '.json';
  const layerPath = oci
    ? 'blobs/sha256/' + layerDigest.slice(7)
    : layerDigest.slice(7) + '/layer.tar';
  const saved = [
    { Config: configPath, RepoTags: ['example:ci'], Layers: [layerPath] }
  ];
  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    config: {
      mediaType: 'application/vnd.oci.image.config.v1+json',
      digest,
      size: raw.length
    },
    layers: [
      {
        mediaType: 'application/vnd.oci.image.layer.v1.tar',
        digest: layerDigest,
        size: layer.length
      }
    ]
  };
  modify(manifest, 'manifest');
  const manifestRaw = bytes(manifest);
  const manifestDigest = sha256(manifestRaw);
  const index = {
    schemaVersion: 2,
    manifests: [
      {
        mediaType: manifest.mediaType,
        digest: manifestDigest,
        size: manifestRaw.length,
        platform: { os: 'linux', architecture: arch }
      }
    ]
  };
  modify(saved, 'saved');
  modify(index, 'index');
  const files = [
    { name: configPath, bytes: raw },
    { name: layerPath, bytes: layer },
    { name: 'manifest.json', bytes: bytes(saved) }
  ];
  if (oci)
    files.push(
      { name: 'index.json', bytes: bytes(index) },
      { name: 'oci-layout', bytes: bytes({ imageLayoutVersion: '1.0.0' }) },
      { name: 'blobs/sha256/' + manifestDigest.slice(7), bytes: manifestRaw }
    );
  modify(files, 'files');
  return {
    files,
    configDigest: digest,
    manifestDigest,
    rootfs: config.rootfs.diff_ids
  };
}
function check(t, f, arch = 'amd64') {
  const dir = mkdtempSync(join(tmpdir(), 'ha-archive-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'image.tar');
  writeFileSync(path, tar(f.files));
  return { path, read: () => localImageIdentity(path, arch, labels, f.rootfs) };
}
for (const arch of ['amd64', 'arm64'])
  for (const oci of [false, true]) {
    test(`raw config bytes bind ${arch} ${oci ? 'OCI/containerd' : 'classic'} archive`, (t) => {
      const f = fixture(arch, oci);
      const result = check(t, f, arch === 'arm64' ? 'aarch64' : 'amd64').read();
      assert.equal(result.config_digest, f.configDigest);
      assert.notEqual(f.configDigest, f.manifestDigest);
      assert.equal(result.manifest_digest, oci ? f.manifestDigest : null);
      assert.equal(result.architecture, arch);
    });
  }
const invalid = [
  [
    'wrong OS',
    (v, s) => {
      if (s === 'config') v.config.os = 'windows';
    }
  ],
  [
    'wrong architecture',
    (v, s) => {
      if (s === 'config') v.config.architecture = 'arm64';
    }
  ],
  [
    'wrong labels',
    (v, s) => {
      if (s === 'config') v.config.config.Labels = {};
    }
  ],
  [
    'malformed config',
    (v, s) => {
      if (s === 'config') v.rawConfig = Buffer.from('{');
    }
  ],
  [
    'duplicate JSON config keys',
    (v, s) => {
      if (s === 'config')
        v.rawConfig = Buffer.from('{"os":"linux","os":"linux"}');
    }
  ],
  [
    'escaped duplicate JSON key',
    (v, s) => {
      if (s === 'config')
        v.rawConfig = Buffer.from('{"os":"linux","\\u006fs":"linux"}');
    }
  ],
  [
    'multiple saved images',
    (v, s) => {
      if (s === 'saved') v.push({ ...v[0] });
    }
  ],
  [
    'ambiguous OCI index',
    (v, s) => {
      if (s === 'index') v.manifests.push({ ...v.manifests[0] });
    }
  ],
  [
    'wrong config descriptor',
    (v, s) => {
      if (s === 'manifest') v.config.digest = 'sha256:' + 'f'.repeat(64);
    }
  ],
  [
    'wrong config descriptor size',
    (v, s) => {
      if (s === 'manifest') v.config.size++;
    }
  ],
  [
    'wrong manifest descriptor digest',
    (v, s) => {
      if (s === 'index') v.manifests[0].digest = 'sha256:' + 'e'.repeat(64);
    }
  ],
  [
    'wrong manifest descriptor size',
    (v, s) => {
      if (s === 'index') v.manifests[0].size++;
    }
  ],
  [
    'wrong descriptor platform',
    (v, s) => {
      if (s === 'index') v.manifests[0].platform.architecture = 'arm64';
    }
  ],
  [
    'unsupported manifest media type',
    (v, s) => {
      if (s === 'manifest') v.mediaType = 'application/unknown';
    }
  ],
  [
    'unsupported layer media type',
    (v, s) => {
      if (s === 'manifest') v.layers[0].mediaType = 'application/unknown';
    }
  ],
  [
    'wrong layer size',
    (v, s) => {
      if (s === 'manifest') v.layers[0].size++;
    }
  ],
  [
    'missing layer',
    (v, s) => {
      if (s === 'saved') v[0].Layers[0] = 'missing';
    }
  ],
  [
    'layer count mismatch',
    (v, s) => {
      if (s === 'saved') v[0].Layers = [];
    }
  ],
  [
    'config filename hash mismatch',
    (v, s) => {
      if (s === 'files') v[0].bytes = Buffer.from(v[0].bytes.toString() + ' ');
    }
  ],
  [
    'corrupt layer',
    (v, s) => {
      if (s === 'files') v[1].bytes[0] ^= 1;
    }
  ],
  [
    'duplicate tar entry',
    (v, s) => {
      if (s === 'files') v.push({ ...v[0] });
    }
  ],
  [
    'archive traversal',
    (v, s) => {
      if (s === 'files')
        v.push({ name: '../outside', bytes: Buffer.from('x') });
    }
  ],
  [
    'absolute archive path',
    (v, s) => {
      if (s === 'files') v.push({ name: '/outside', bytes: Buffer.from('x') });
    }
  ],
  [
    'symlink',
    (v, s) => {
      if (s === 'files') v.push({ name: 'link', type: 50, link: 'outside' });
    }
  ],
  [
    'hardlink',
    (v, s) => {
      if (s === 'files') v.push({ name: 'link', type: 49, link: v[0].name });
    }
  ],
  [
    'PAX path override',
    (v, s) => {
      if (s === 'files')
        v.push({
          name: 'pax',
          type: 120,
          bytes: Buffer.from('20 path=../outside\n')
        });
    }
  ],
  [
    'oversized JSON',
    (v, s) => {
      if (s === 'files')
        v.find((x) => x.name === 'manifest.json').bytes = Buffer.alloc(
          4 * 1024 * 1024 + 1,
          32
        );
    }
  ],
  [
    'missing OCI layout',
    (v, s) => {
      if (s === 'files')
        v.splice(
          v.findIndex((x) => x.name === 'oci-layout'),
          1
        );
    }
  ],
  [
    'index with another config',
    (v, s) => {
      if (s === 'saved') v[0].Config = '../bad';
    }
  ]
];
for (const [name, modify] of invalid)
  test(`reject ${name}`, (t) => {
    const f = fixture('amd64', true, modify);
    assert.throws(check(t, f).read);
  });
for (const name of [
  'checksum',
  'truncated',
  'trailing data',
  'missing end markers',
  'rootfs mismatch'
]) {
  test(`reject ${name}`, (t) => {
    const f = fixture();
    const h = check(t, f);
    let content = tar(f.files);
    if (name === 'checksum') content[20] ^= 1;
    if (name === 'truncated') content = content.subarray(0, content.length - 1);
    if (name === 'trailing data') content[content.length - 1] = 1;
    if (name === 'missing end markers')
      content = content.subarray(0, content.length - 1024);
    if (name === 'rootfs mismatch') f.rootfs = ['sha256:' + '9'.repeat(64)];
    writeFileSync(h.path, content);
    assert.throws(h.read);
  });
}
for (const classicId of [false, true])
  test(`Docker binds exported config to opaque ${classicId ? 'config' : 'manifest'} handle`, (t) => {
    const f = fixture('amd64', !classicId);
    const h = check(t, f);
    const handle = classicId ? f.configDigest : f.manifestDigest;
    let temporary;
    class FakeDocker extends Docker {
      run(args) {
        if (args[1] === 'inspect')
          return JSON.stringify([
            {
              Id: handle,
              Os: 'linux',
              Architecture: 'amd64',
              RootFS: { Type: 'layers', Layers: f.rootfs }
            }
          ]);
        assert.deepEqual(args.slice(0, 3), ['image', 'save', '--output']);
        assert.equal(args[4], handle);
        temporary = dirname(args[3]);
        copyFileSync(h.path, args[3]);
        return '';
      }
    }
    const docker = new FakeDocker();
    const local = docker.localIdentity('example:ci', 'amd64', labels);
    assert.equal(local.handle, handle);
    assert.equal(local.config_digest, f.configDigest);
    docker.assertLocalReference('example:ci', local, 'amd64');
    assert.equal(existsSync(temporary), false);
    assert.throws(() =>
      docker.assertLocalReference(
        'example:ci',
        { handle: 'sha256:' + '0'.repeat(64) },
        'amd64'
      )
    );
  });

for (const [name, change] of [
  [
    'noncanonical tar number',
    (files) => {
      files[0].sizeField =
        '0\0' + files[0].bytes.length.toString(8).padStart(9, '0') + '\0';
    }
  ],
  [
    'nonzero tar padding',
    (files) => {
      files[0].paddingBad = true;
    }
  ],
  [
    'regular-file archive parent',
    (files) => {
      files.push({ name: 'blobs', bytes: Buffer.from('x') });
    }
  ]
])
  test(`reject ${name}`, (t) => {
    const f = fixture('amd64', true, (files, stage) => {
      if (stage === 'files') change(files);
    });
    assert.throws(check(t, f).read);
  });
test('reject excessive JSON nesting before trusting configuration', (t) => {
  const f = fixture('amd64', true, (value, stage) => {
    if (stage === 'config') {
      let nested = {};
      for (let i = 0; i < 70; i++) nested = { child: nested };
      value.config.extra = nested;
    }
  });
  assert.throws(check(t, f).read, /nesting limit/);
});
