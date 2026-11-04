#!/usr/bin/env python3
"""Repackage verified LOCAL sources; never installs, downloads or edits sources."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
SOURCE = Path('/home/pj/repo/ghostfolio-italian-localization')
CACHE = Path('/home/pj/.npm/_cacache/content-v2/sha512')
ACTION = Path('/usr/local/bin/actionlint')
EVIDENCE = HERE / 'provenance/actionlint'
EXPECTED_ACTION = 'c872d6db8c6bf83a8eaa704fc93999f027d55dffbc63b8a6abdccb47df5f4cd4'
sha = lambda b: hashlib.sha256(b).hexdigest()
lock = json.loads((SOURCE / 'package-lock.json').read_text())['packages']
package_records = []
os.environ['LC_ALL'] = 'C'


def copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    target.chmod(0o755 if os.access(source, os.X_OK) else 0o644)




with tempfile.TemporaryDirectory(prefix='ha-tools-build-') as temp:
    root = Path(temp) / 'bundle'
    root.mkdir()
    node_archive = Path('/home/pj/.nvm/.cache/bin/node-v22.23.4-linux-x64/node-v22.23.4-linux-x64.tar.xz')
    node_raw = node_archive.read_bytes()
    assert sha(node_raw) == '1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce'
    with tarfile.open(fileobj=io.BytesIO(node_raw), mode='r:xz') as tar:
        for name, destination in [('bin/node', 'runtime/bin/node'), ('LICENSE', 'licenses/node/LICENSE')]:
            member = tar.getmember('node-v22.23.4-linux-x64/' + name)
            assert member.isfile()
            data = tar.extractfile(member).read()
            if name == 'bin/node':
                assert sha(data) == '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90'
            target = root / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o755 if name == 'bin/node' else 0o644)

    node_embedded_versions = json.loads(subprocess.check_output([str(root / 'runtime/bin/node'), '-p', 'JSON.stringify(process.versions)'], text=True))

    seen = set()

    def npm(name, parent=SOURCE):
        base = parent
        while not (base / 'node_modules' / name / 'package.json').exists():
            if base == base.parent:
                raise RuntimeError('Unresolved dependency ' + name)
            base = base.parent
        package = (base / 'node_modules' / name).resolve()
        if package in seen:
            return
        seen.add(package)
        rel = package.relative_to(SOURCE)
        record = lock[str(rel)]
        integrity = record['integrity']
        assert integrity.startswith('sha512-')
        expected = base64.b64decode(integrity[7:])
        hex_digest = expected.hex()
        archive = CACHE / hex_digest[:2] / hex_digest[2:4] / hex_digest[4:]
        raw = archive.read_bytes()
        assert hashlib.sha512(raw).digest() == expected, name
        target = root / 'prettier' / rel
        target.mkdir(parents=True)
        license_files = []
        with tarfile.open(fileobj=io.BytesIO(raw), mode='r:gz') as tar:
            members = tar.getmembers()
            seen_paths = set()
            for m in members:
                p = Path(m.name)
                assert p.parts[0] == 'package' and '..' not in p.parts and not p.is_absolute()
                assert m.isdir() or m.isfile(), m.name
                assert m.name not in seen_paths
                seen_paths.add(m.name)
                if not m.isfile():
                    continue
                relfile = Path(*p.parts[1:])
                if (any(part in {'test', 'tests', '__tests__', '.github', 'benchmark', 'benchmarks', 'docs'} for part in relfile.parts)
                        or relfile.name.lower().startswith(('readme', 'changelog', 'history'))
                        or relfile.name.endswith(('.map', '.d.ts', '.spec.js', '.test.js'))):
                    continue
                # Preserve published runtime assets and notices; omit test/debug/type-only assets.
                assert 'node_modules' not in relfile.parts
                dest = target / relfile
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(tar.extractfile(m).read())
                dest.chmod(0o755 if m.mode & 0o111 else 0o644)
                if re.search(r'(?i)(license|licence|notice|copyright)', relfile.name):
                    lic = root / 'licenses/npm' / rel / relfile
                    copy(dest, lic)
                    license_files.append(str(lic.relative_to(root)))
        actual = json.loads((target / 'package.json').read_text())
        assert actual['name'] == name and actual['version'] == record['version']
        if not license_files:
            # Retain source-distributed notice verbatim; flag missing standalone license.
            assert name == 'javascript-natural-sort'
            for notice in ['naturalSort.js', 'package.json']:
                lic = root / 'licenses/npm' / rel / notice
                copy(target / notice, lic)
                license_files.append(str(lic.relative_to(root)))
        if name == 'javascript-natural-sort':
            # Upstream grants MIT in both integrity-verified package metadata and source.
            # Preserve its author notice verbatim; supply standard MIT terms, never invent a year.
            reference = root / 'prettier/node_modules/@babel/helper-string-parser/LICENSE'
            terms = reference.read_text()
            terms = terms[terms.index('Permission is hereby granted'):]
            full_terms = root / 'licenses/npm' / rel / 'MIT-TERMS.txt'
            full_terms.write_text(terms)
            license_files.append(str(full_terms.relative_to(root)))
        package_records.append({'name': name, 'version': actual['version'],
                                'path': str(Path('prettier') / rel),
                                'resolved': record['resolved'], 'integrity': integrity,
                                'license': actual.get('license'), 'license_files': license_files,
                                'archive_sha256': sha(raw), 'spdx': actual.get('license'),
                                'obligations': 'Preserve upstream copyright/license/disclaimer; Apache-2.0 additionally retain NOTICE if supplied, mark changes and observe patent/termination clauses',
                                'license_note': 'Explicit upstream SPDX MIT grant in package.json and author/source notice preserved; standard MIT terms supplied separately without inventing copyright attribution/year' if name == 'javascript-natural-sort' else None})
        for child in actual.get('dependencies', {}):
            npm(child, package)

    for name in ['prettier', 'prettier-plugin-organize-attributes', '@trivago/prettier-plugin-sort-imports', 'yaml']:
        npm(name)
    assert len(seen) == 29
    assert sha(ACTION.read_bytes()) == EXPECTED_ACTION
    copy(ACTION, root / 'actionlint/actionlint')
    copy(EVIDENCE / 'LICENSE.txt', root / 'licenses/actionlint/LICENSE.txt')
    evidence = EVIDENCE
    for name in ['actionlint-attestation.json', 'actionlint-identity-verification.json',
                 'actionlint-build.txt', 'binary-comparison.json']:
        copy(evidence / name, root / 'provenance/actionlint' / name)
    copy(EVIDENCE / 'checksums.json', root / 'provenance/actionlint/checksums.json')

    go_records = json.loads((HERE / 'provenance/actionlint-modules/inventory.json').read_text())
    for component in go_records:
        assert component['spdx'] in {'MIT', 'Apache-2.0', 'BSD-3-Clause', 'Apache-2.0 AND MIT'}
        for notice in component['notices']:
            source = HERE / notice['path']
            assert sha(source.read_bytes()) == notice['sha256']
            relative = source.relative_to(HERE / 'provenance/actionlint-modules')
            target = root / 'licenses/go' / relative
            copy(source, target)
            notice['payload_path'] = target.relative_to(root).as_posix()

    node_verification = json.loads((HERE / 'provenance/node/verification-accepted.json').read_text())
    assert node_verification['archive_sha256'] == sha(node_raw)
    assert node_verification['pgp_fingerprint'] == '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356'
    assert node_verification['accepted_by_user'] and node_verification['signed_checksum_match']
    copy(HERE / 'provenance/node/verification-accepted.json', root / 'provenance/node/verification-accepted.json')

    copy(HERE / 'LICENSE', root / 'licenses/qualification-helpers/LICENSE')
    copy(HERE / 'LICENSE-SCOPE.md', root / 'licenses/qualification-helpers/SCOPE.md')

    for src in sorted((HERE / 'source').rglob('*')):
        if src.is_file():
            copy(src, root / src.relative_to(HERE / 'source'))
    manifest = {
        'schema_version': 1, 'platform': 'linux-amd64',
        'node': '22.23.4', 'node_embedded_runtime_versions': node_embedded_versions,
        'node_source': {'archive_sha256': sha(node_raw), 'archive': str(node_archive), 'binary_sha256': '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90', 'trust': 'Task 05D-R4: user accepted independent PGP verification and signed official SHASUMS256.txt match', 'verification': node_verification}, 'yaml': '2.9.0',
        'actionlint': {'version': '1.7.12', 'sha256': EXPECTED_ACTION,
                       'archive_sha256': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
                       'exception': 'Task 05D-R3 accepts ONLY attested official binary with +dirty/vcs.modified=true'},
        'embedded_go_components': go_records,
        'npm_packages': sorted(package_records, key=lambda x: x['path']),
        'platform_contract': {'runner': 'ubuntu-24.04', 'architecture': 'x86_64', 'system_abi': 'Node official binary requires glibc >=2.28, libstdc++ GLIBCXX_3.4.21, CXXABI_1.3.9; OS libraries intentionally not redistributed'},
        'exclusions': 'no ShellCheck, Python, PyYAML, glibc or associated shared libraries; no npm dev/test/debug/type-only assets',
        'runtime_scope': 'Node 22.23.4 and JavaScript static tools; host ABI is explicit runner platform, never host JS tooling'
    }
    (root / 'manifest.json').write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    inventory = []
    for file in sorted(root.rglob('*')):
        if file.is_file():
            inventory.append({'path': file.relative_to(root).as_posix(), 'size': file.stat().st_size,
                              'sha256': sha(file.read_bytes()), 'executable': bool(file.stat().st_mode & 0o111)})
    (HERE / 'inventory.json').write_text(json.dumps(inventory, indent=2) + '\n')
    (HERE / 'SHA256SUMS').write_text(''.join(f"{r['sha256']}  {r['path']}\n" for r in inventory))
    shutil.copyfile(root / 'manifest.json', HERE / 'manifest.json')
    # Deterministic source snapshot archive, excludes outer inventories to avoid self-reference.
    with tarfile.open(HERE / 'payload.tar.xz.tmp', 'w:xz', preset=1) as tar:
        for file in sorted(root.rglob('*')):
            if file.is_file():
                data = file.read_bytes()
                info = tarfile.TarInfo(file.relative_to(root).as_posix())
                info.size = len(data)
                info.mode = 0o755 if file.stat().st_mode & 0o111 else 0o644
                info.mtime = 0
                tar.addfile(info, io.BytesIO(data))
    (HERE / 'payload.tar.xz.tmp').replace(HERE / 'payload.tar.xz')
    print('FILES', len(inventory), 'UNPACKED', sum(x['size'] for x in inventory))
    print('ARCHIVE', (HERE / 'payload.tar.xz').stat().st_size, 'SHA256', sha((HERE / 'payload.tar.xz').read_bytes()))
