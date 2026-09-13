"""Record extracted archive members (before LTO), not all configured targets."""
import hashlib
import json
import pathlib
import re
import sys
import subprocess

build, root = map(pathlib.Path, sys.argv[1:])
wasm = (root / 'artifacts/llvm-aarch64.wasm').read_bytes()
libraries = sorted(set(re.findall(r'lib(LLVM\w+)\.a', (build / 'archive-inputs.tsv').read_text())))
assert libraries and not any('X86' in lib for lib in libraries), libraries
manifest = dict(json.loads((root / 'upstream.json').read_text()),
                sourceCommit=subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip(),
                sourceDirty=bool(subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain', '--untracked-files=normal'], text=True).strip()),
                wasmBytes=len(wasm), wasmSha256=hashlib.sha256(wasm).hexdigest(),
                linkedLibraries=libraries)
(root / 'artifacts/build-info.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
