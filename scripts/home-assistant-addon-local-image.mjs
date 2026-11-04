import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

import { architectures, sha256 } from './home-assistant-addon-oci.mjs';

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const manifestTypes = new Set([
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
]);
const indexTypes = new Set([
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json'
]);
const maxJson = 4 * 1024 * 1024;

function json(bytes) {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const value = JSON.parse(source);
  // JSON.parse checks grammar; this second pass rejects duplicate object keys,
  // including escaped spellings of the same key, before any field is trusted.
  const stack = [];
  const tokens = source.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g);
  for (const token of tokens ?? []) {
    if (token === '{' || token === '[') {
      assert.ok(stack.length < 64, 'Archive JSON exceeds nesting limit');
      stack.push(token === '{' ? { keys: new Set(), key: true } : {});
    } else if (token === '}' || token === ']') stack.pop();
    else if (token === ',' && stack.at(-1)?.keys) stack.at(-1).key = true;
    else if (token.startsWith('"') && stack.at(-1)?.key) {
      const key = JSON.parse(token);
      assert.ok(!stack.at(-1).keys.has(key), 'Duplicate JSON key');
      stack.at(-1).keys.add(key);
      stack.at(-1).key = false;
    }
  }
  return value;
}

function path(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.length > 0 && value.length <= 255, 'Invalid archive path');
  assert.ok(!/\s/.test(value), 'Invalid archive path');
  assert.match(value, /^[A-Za-z0-9_.+/-]+$/, 'Invalid archive path');
  assert.ok(
    value.split('/').every((part) => part && part !== '.' && part !== '..'),
    'Unsafe archive path'
  );
  return value;
}

// Read the outer Docker-save tar only. Image layers are opaque files here and
// are never extracted, executed, or interpreted as paths on the host.
export function localImageIdentity(archive, arch, labels, rootfs) {
  assert.ok(Object.hasOwn(architectures, arch));
  const fd = openSync(archive, 'r');
  try {
    const size = fstatSync(fd).size;
    assert.ok(
      size >= 1024 && size <= 64 * 1024 ** 3 && size % 512 === 0,
      'Invalid archive size'
    );
    const read = (offset, length) => {
      const bytes = Buffer.alloc(length);
      assert.equal(
        readSync(fd, bytes, 0, length, offset),
        length,
        'Truncated archive'
      );
      return bytes;
    };
    const entries = new Map();
    let offset = 0;
    let ended = false;
    const number = (bytes) => {
      const field = bytes.toString('latin1');
      assert.match(field, /^ *[0-7]+[\0 ]*$/, 'Invalid tar number');
      const value = parseInt(field, 8);
      assert.ok(Number.isSafeInteger(value));
      return value;
    };
    const field = (bytes) => {
      const end = bytes.indexOf(0);
      if (end >= 0) assert.ok(bytes.subarray(end).every((b) => b === 0));
      return bytes.subarray(0, end < 0 ? bytes.length : end).toString('utf8');
    };
    while (offset + 512 <= size) {
      const header = read(offset, 512);
      if (header.every((b) => b === 0)) {
        assert.ok(offset + 1024 <= size, 'Missing tar end marker');
        for (let at = offset; at < size; at += 65536)
          assert.ok(
            read(at, Math.min(65536, size - at)).every((b) => b === 0),
            'Data after tar end marker'
          );
        ended = true;
        break;
      }
      let checksum = 0;
      for (let i = 0; i < 512; i++)
        checksum += i >= 148 && i < 156 ? 32 : header[i];
      assert.equal(
        number(header.subarray(148, 156)),
        checksum,
        'Tar checksum mismatch'
      );
      assert.equal(
        header.subarray(257, 263).toString(),
        'ustar\0',
        'Unsupported tar format'
      );
      assert.equal(
        header.subarray(263, 265).toString(),
        '00',
        'Unsupported tar version'
      );
      const type = header[156];
      assert.ok([0, 48, 53].includes(type), 'Unsupported tar entry type');
      assert.equal(
        field(header.subarray(157, 257)),
        '',
        'Archive links are forbidden'
      );
      const prefix = field(header.subarray(345, 500));
      let name = [prefix, field(header.subarray(0, 100))]
        .filter(Boolean)
        .join('/');
      if (type === 53 && name.endsWith('/')) name = name.slice(0, -1);
      path(name);
      assert.ok(!entries.has(name), 'Duplicate archive entry');
      assert.ok(entries.size < 4096, 'Too many archive entries');
      const length = number(header.subarray(124, 136));
      if (type === 53) assert.equal(length, 0, 'Nonempty archive directory');
      const next = offset + 512 + Math.ceil(length / 512) * 512;
      assert.ok(next <= size, 'Truncated tar entry');
      const padding = next - offset - 512 - length;
      if (padding)
        assert.ok(
          read(offset + 512 + length, padding).every((b) => b === 0),
          'Nonzero tar padding'
        );
      entries.set(name, {
        offset: offset + 512,
        size: length,
        regular: type !== 53
      });
      offset = next;
    }
    assert.ok(ended, 'Missing tar end marker');
    for (const name of entries.keys()) {
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = entries.get(parts.slice(0, i).join('/'));
        assert.ok(!parent?.regular, 'Archive parent is not a directory');
      }
    }
    const entry = (name) => {
      const item = entries.get(path(name));
      assert.ok(item?.regular, 'Missing regular archive entry');
      return item;
    };
    const bytes = (name) => {
      const item = entry(name);
      assert.ok(item.size <= maxJson, 'Archive JSON exceeds limit');
      return read(item.offset, item.size);
    };
    const hash = (name) => {
      const item = entry(name);
      const result = createHash('sha256');
      for (let at = 0; at < item.size; at += 1024 * 1024)
        result.update(
          read(item.offset + at, Math.min(1024 * 1024, item.size - at))
        );
      return `sha256:${result.digest('hex')}`;
    };
    const saved = json(bytes('manifest.json'));
    assert.ok(
      Array.isArray(saved) && saved.length === 1,
      'Expected exactly one saved image'
    );
    const image = saved[0];
    assert.match(
      image.Config,
      /^(?:[a-f0-9]{64}\.json|blobs\/sha256\/[a-f0-9]{64})$/,
      'Unsupported config reference'
    );
    const configBytes = bytes(image.Config);
    const configDigest = sha256(configBytes);
    assert.equal(
      image.Config.replace(/^blobs\/sha256\//, '').replace(/\.json$/, ''),
      configDigest.slice(7),
      'Local config digest mismatch'
    );
    const config = json(configBytes);
    assert.equal(config.os, 'linux');
    assert.equal(
      config.architecture,
      architectures[arch],
      'Local architecture mismatch'
    );
    assert.equal(config.rootfs?.type, 'layers');
    assert.ok(Array.isArray(config.rootfs.diff_ids));
    for (const digest of config.rootfs.diff_ids) {
      assert.equal(typeof digest, 'string');
      assert.equal(digest.length, 71);
      assert.match(digest, digestPattern);
    }
    assert.deepEqual(config.rootfs.diff_ids, rootfs, 'Local rootfs mismatch');
    for (const [key, value] of Object.entries(labels))
      assert.equal(
        config.config?.Labels?.[key],
        value,
        `Local provenance mismatch: ${key}`
      );
    assert.ok(Array.isArray(image.Layers));
    assert.equal(
      image.Layers.length,
      config.rootfs.diff_ids.length,
      'Local layer count mismatch'
    );
    image.Layers.forEach(entry);
    let manifestDigest = null;
    if (entries.has('index.json') || entries.has('oci-layout')) {
      assert.equal(json(bytes('oci-layout')).imageLayoutVersion, '1.0.0');
      let index = json(bytes('index.json'));
      const seen = new Set();
      for (;;) {
        assert.equal(index.schemaVersion, 2);
        assert.ok(!index.mediaType || indexTypes.has(index.mediaType));
        assert.ok(
          Array.isArray(index.manifests) && index.manifests.length === 1,
          'Ambiguous OCI image index'
        );
        const desc = index.manifests[0];
        assert.equal(typeof desc.digest, 'string');
        assert.equal(desc.digest.length, 71);
        assert.match(desc.digest, digestPattern);
        assert.ok(
          !seen.has(desc.digest) && seen.size < 4,
          'Invalid OCI index depth'
        );
        seen.add(desc.digest);
        if (desc.platform) {
          assert.equal(desc.platform.os, 'linux');
          assert.equal(desc.platform.architecture, architectures[arch]);
        }
        const name = `blobs/sha256/${desc.digest.slice(7)}`;
        const raw = bytes(name);
        assert.equal(desc.size, raw.length, 'OCI descriptor size mismatch');
        assert.equal(
          sha256(raw),
          desc.digest,
          'Local manifest digest mismatch'
        );
        const document = json(raw);
        assert.equal(document.schemaVersion, 2);
        assert.equal(document.mediaType, desc.mediaType);
        if (indexTypes.has(desc.mediaType)) {
          index = document;
          continue;
        }
        assert.ok(
          manifestTypes.has(desc.mediaType),
          'Unsupported OCI manifest'
        );
        assert.ok(!document.manifests, 'Expected single-platform manifest');
        assert.equal(
          document.config?.digest,
          configDigest,
          'OCI config reference mismatch'
        );
        assert.equal(
          document.config.size,
          configBytes.length,
          'OCI config size mismatch'
        );
        assert.ok(
          [
            'application/vnd.oci.image.config.v1+json',
            'application/vnd.docker.container.image.v1+json'
          ].includes(document.config.mediaType)
        );
        assert.equal(image.Config, `blobs/sha256/${configDigest.slice(7)}`);
        assert.ok(Array.isArray(document.layers));
        assert.equal(document.layers.length, image.Layers.length);
        document.layers.forEach((layer, i) => {
          assert.ok(
            [
              'application/vnd.oci.image.layer.v1.tar',
              'application/vnd.oci.image.layer.v1.tar+gzip',
              'application/vnd.oci.image.layer.v1.tar+zstd',
              'application/vnd.docker.image.rootfs.diff.tar',
              'application/vnd.docker.image.rootfs.diff.tar.gzip'
            ].includes(layer.mediaType),
            'Unsupported OCI layer'
          );
          assert.equal(typeof layer.digest, 'string');
          assert.equal(layer.digest.length, 71);
          assert.match(layer.digest, digestPattern);
          assert.equal(
            image.Layers[i],
            `blobs/sha256/${layer.digest.slice(7)}`
          );
          assert.equal(
            layer.size,
            entry(image.Layers[i]).size,
            'OCI layer size mismatch'
          );
          assert.equal(
            hash(image.Layers[i]),
            layer.digest,
            'Local layer digest mismatch'
          );
        });
        manifestDigest = desc.digest;
        break;
      }
    } else {
      image.Layers.forEach((name, i) =>
        assert.equal(
          hash(name),
          config.rootfs.diff_ids[i],
          'Local layer DiffID mismatch'
        )
      );
    }
    return {
      os: config.os,
      architecture: config.architecture,
      config_digest: configDigest,
      manifest_digest: manifestDigest
    };
  } finally {
    closeSync(fd);
  }
}
