#!/usr/bin/env python3
"""Offline qualification of an already verified payload; never changes source refs."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
BUNDLE = Path(sys.argv[1]).resolve(strict=True)
REPORT = Path(sys.argv[2]).resolve()
REPORT.mkdir(parents=True, exist_ok=True)
HA = Path('/home/pj/repo/ghostfolio-ha-addon')
NODE = str(BUNDLE / 'bin/node')
OFFLINE = [sys.executable, str(HERE / 'offline-run.py')]
results = []


def run(name, command, cwd=REPO, expected=0, env=None):
    environment = dict(os.environ)
    environment.pop('NODE_OPTIONS', None)
    environment.pop('NODE_PATH', None)
    environment.pop('LD_LIBRARY_PATH', None)
    environment.pop('LD_PRELOAD', None)
    if env:
        environment.update(env)
    result = subprocess.run(OFFLINE + list(map(str, command)), cwd=cwd,
                            env=environment, text=True, capture_output=True)
    (REPORT / (name + '.log')).write_text(result.stdout + result.stderr)
    assert result.returncode == expected, (name, result.returncode, result.stdout, result.stderr)
    results.append({'check': name, 'exit': result.returncode, 'expected': expected})
    print(name, 'PASS', flush=True)
    return result


for directory, sha in [(REPO, 'f6ea73ca1f28750abd3b061023cab6a4f3443638'),
                       (HA, 'bfaf9ff86325d3d6fb25c37785e854cc583077df')]:
    assert subprocess.check_output(['git', '-C', str(directory), 'rev-parse', 'HEAD'], text=True).strip() == sha
probe = run('network-denied', [sys.executable, '-c', 'import socket; socket.socket()'], expected=1)
assert 'PermissionError' in probe.stderr
run('inventory', [NODE, BUNDLE / 'wrappers/verify-inventory.mjs', BUNDLE, HERE / 'inventory.json'])
assert run('node-version', [NODE, '--version']).stdout.strip() == 'v22.23.4'
assert run('actionlint-version', [BUNDLE / 'bin/actionlint', '--version']).stdout.splitlines()[0] == '1.7.12'
assert run('yaml-version', [NODE, '-p', 'require(' + json.dumps(str(BUNDLE / 'prettier/node_modules/yaml/package.json')) + ').version']).stdout.strip() == '2.9.0'
run('prettier', [NODE, BUNDLE / 'wrappers/prettier-check.mjs'])
run('prettier-harness', [NODE, BUNDLE / 'wrappers/prettier-check.mjs',
                       '.github/workflows/ghostfolio-ng-ha-qualification.yml',
                       'scripts/ghostfolio-ng-ha-qualification.test.mjs',
                       'docs/ci/ghostfolio-ng-ha-qualification.md',
                       HERE / 'source/wrappers/prettier-check.mjs'])
workflows = ['.github/workflows/ghostfolio-ng-ha-orchestrator.yml',
             '.github/workflows/ghostfolio-ng-ha-qualification.yml']
run('actionlint', [BUNDLE / 'bin/actionlint', *workflows])
run('yaml-unique', [NODE, BUNDLE / 'wrappers/yaml-unique.mjs', *workflows])
for file in sorted((REPO / 'scripts').glob('ghostfolio-ng-ha-*.mjs')):
    run('syntax-' + file.stem, [NODE, '--check', file])
for name, files, cwd, count in [
    ('orchestrator', sorted((REPO / 'scripts').glob('ghostfolio-ng-ha-orchestrator*.test.mjs')), REPO, 107),
    ('ha', sorted((HA / 'scripts').glob('home-assistant-addon-*.test.mjs')), HA, 174),
    ('security', [REPO / 'scripts/ghostfolio-ng-ha-qualification.test.mjs'], REPO, 3)
]:
    result = run(name, [NODE, '--test', '--experimental-test-isolation=none', *files], cwd=cwd,
                 env={'HA_CONTRACT_DIR': str(HA)})
    for line in [f'# tests {count}', f'# pass {count}', '# fail 0', '# skipped 0', '# cancelled 0', '# todo 0']:
        assert line in result.stdout.splitlines(), (name, line)
with tempfile.TemporaryDirectory(prefix='ha-tools-negative-') as tmp:
    tmp = Path(tmp)
    for name, content in [('duplicate.yaml', 'one: 1\none: 2\n'), ('malformed.yaml', 'one: [\n')]:
        file = tmp / name
        file.write_text(content)
        invalid = run(name, [NODE, BUNDLE / 'wrappers/yaml-unique.mjs', file], expected=1)
        assert str(file) in invalid.stderr
    run('yaml-missing', [NODE, BUNDLE / 'wrappers/yaml-unique.mjs', tmp / 'missing.yaml'], expected=1)
    bad = tmp / 'bad.mjs'
    bad.write_text('const x=1')
    run('format-invalid', [NODE, BUNDLE / 'wrappers/prettier-check.mjs', bad], expected=1)
    run('format-missing', [NODE, BUNDLE / 'wrappers/prettier-check.mjs', tmp / 'missing.mjs'], expected=1)
    # Change only a non-executed payload notice; restore bytes/mode in every case.
    file = BUNDLE / 'licenses/actionlint/LICENSE.txt'
    original = file.read_bytes()
    try:
        file.write_bytes(original + b'CORRUPTED')
        run('inventory-corrupt', [NODE, BUNDLE / 'wrappers/verify-inventory.mjs', BUNDLE, HERE / 'inventory.json'], expected=1)
        file.unlink()
        run('inventory-missing', [NODE, BUNDLE / 'wrappers/verify-inventory.mjs', BUNDLE, HERE / 'inventory.json'], expected=1)
    finally:
        file.write_bytes(original)
        file.chmod(0o644)
    run('inventory-restored', [NODE, BUNDLE / 'wrappers/verify-inventory.mjs', BUNDLE, HERE / 'inventory.json'])
REPORT.joinpath('results.json').write_text(json.dumps({'status': 'PASS', 'node_tests': 284,
                                                   'network': 'kernel seccomp socket syscalls denied',
                                                   'checks': results}, indent=2) + '\n')
