#!/usr/bin/env python3
"""Bind deterministic local review metadata to the finished payload (no downloads)."""
from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parent
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
payload = sha(root / 'payload.tar.xz')
inventory = sha(root / 'inventory.json')
script = '''#!/bin/sh
# These literal digests and this script require independent review in harness commit H.
set -eu
umask 022
root=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -ne 1 ] || [ -e "$1" ]; then
  echo 'usage: verify-and-extract.sh NEW_DESTINATION (must not exist)' >&2
  exit 1
fi
(
  cd "$root"
  printf '%s  %s\\n' '@PAYLOAD@' 'payload.tar.xz' '@INVENTORY@' 'inventory.json' | sha256sum --check --strict >&2
)
mkdir -p -- "$1"
dest=$(CDPATH='' cd -- "$1" && pwd)
tar -xJf "$root/payload.tar.xz" --no-same-owner --no-same-permissions -C "$dest"
"$dest/bin/node" "$dest/wrappers/verify-inventory.mjs" "$dest" "$root/inventory.json" >&2
printf '%s\\n' "$dest"
'''.replace('@PAYLOAD@', payload).replace('@INVENTORY@', inventory)
verifier = root / 'verify-and-extract.sh'
verifier.write_text(script)
verifier.chmod(0o755)
manifest = json.loads((root / 'manifest.json').read_text())
records = json.loads((root / 'inventory.json').read_text())
components = [
    {'component': 'node', 'version': manifest['node'],
     'spdx': 'MIT AND LicenseRef-Node-ThirdParty-Notices',
     'embedded_runtime_versions': manifest['node_embedded_runtime_versions'],
     'source': 'https://nodejs.org/dist/v22.23.4/', 'provenance': manifest['node_source'],
     'sha256': manifest['node_source']['binary_sha256'], 'notices': ['licenses/node/LICENSE'],
     'obligations': 'Retain complete upstream Node and embedded-component license notices/disclaimers. Referenced ICU GPL configuration helper scripts are not shipped; their upstream additional-permission text is retained, not applied as a blanket license to Node.',
     'review': 'Exact upstream binary unchanged; system glibc/libstdc++/libgcc not conveyed. No claim that Node has only one license.'},
    {'component': 'actionlint', 'version': '1.7.12', 'spdx': 'MIT',
     'source': 'https://github.com/rhysd/actionlint/releases/tag/v1.7.12',
     'provenance': 'SLSA-verified official artifact; exact digest exception R3',
     'sha256': manifest['actionlint']['sha256'], 'notices': ['licenses/actionlint/LICENSE.txt'],
     'obligations': 'Retain MIT copyright, permission notice and disclaimer.'}
]
components.append({'component': 'New qualification runtime wrappers', 'version': '05D-R5-review-candidate',
                   'spdx': 'MIT', 'source': 'New readable source under ci-tooling/source, proposed scope in LICENSE-SCOPE.md',
                   'sha256': sha(root / 'inventory.json'), 'digest_scope': 'payload inventory binds exact wrapper source bytes',
                   'notices': ['licenses/qualification-helpers/LICENSE'],
                   'obligations': 'Retain proposed MIT license/copyright/disclaimer; new-code licensing scope requires human review before publication'})
for package in manifest['npm_packages']:
    assert package['spdx'] in {'MIT', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause'}, package['name']
    components.append({'component': package['name'], 'version': package['version'],
                       'spdx': package['spdx'], 'source': package['resolved'],
                       'provenance': 'Cached archive verified against existing lockfile SHA-512 ' + package['integrity'],
                       'sha256': package['archive_sha256'], 'notices': package['license_files'],
                       'obligations': package['obligations'], 'review': package['license_note']})
for component in manifest['embedded_go_components']:
    components.append({'component': component['component'], 'version': component['version'],
                       'spdx': component['spdx'], 'source': component['source'],
                       'provenance': component.get('go_h1', 'Go build version metadata plus upstream tagged license'),
                       'sha256': component['sha256'], 'digest_scope': component['digest_scope'],
                       'notices': [n['payload_path'] for n in component['notices']],
                       'notice_sha256': [n['sha256'] for n in component['notices']],
                       'obligations': component['obligations'],
                       'parent_binary_sha256': manifest['actionlint']['sha256']})
licenses = {'schema_version': 2, 'scope': 'Redistributed files only; exact byte inventory defines scope. Assessment records grants, required notices, provenance and remaining limits, not blanket legal certification.',
            'components': components,
            'license_refs': {'LicenseRef-Node-ThirdParty-Notices': 'Complete unmodified upstream licenses/node/LICENSE, including multiple embedded component notices; no separate build/configuration helper code is conveyed.'},
            'not_redistributed': ['ShellCheck', 'Python', 'PyYAML', 'glibc', 'libstdc++', 'libgcc', 'all distribution shared libraries'],
            'all_notice_files': [record['path'] for record in records if record['path'].startswith('licenses/')]}
(root / 'licenses.json').write_text(json.dumps(licenses, indent=2) + '\n')
sizes = {}
for record in records:
    component = record['path'].split('/')[0]
    sizes[component] = sizes.get(component, 0) + record['size']
report = {'archive_bytes': (root / 'payload.tar.xz').stat().st_size,
          'unpacked_bytes': sum(record['size'] for record in records),
          'payload_files': len(records), 'bytes_by_component': sizes,
          'archive_sha256': payload, 'inventory_sha256': inventory}
(root / 'size-report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
