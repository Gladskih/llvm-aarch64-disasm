#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
BUILD=${BUILD_DIR:-"$ROOT/.build"}
mkdir -p "$BUILD"
BUILD=$(cd "$BUILD" && pwd)
JOBS=${JOBS:-4}
readarray -t PINS < <(python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); print(p["llvmCommit"]); print(p["emsdkCommit"]); print(p["emscriptenVersion"]); print(p["llvmArchiveSha256"])' "$ROOT/upstream.json")
SOURCE="$BUILD/sources/llvm-${PINS[0]}-${PINS[3]}"
# Separate incompatible CMake/toolchain states without requiring manual cleanup.
CONFIG_KEY=$(cat "$ROOT/upstream.json" "$ROOT/scripts/build-wasm.sh" "$ROOT/native/CMakeLists.txt" "$ROOT/scripts/prepare-mc.mjs" | sha256sum | cut -d' ' -f1)
STATE="$BUILD/state/$CONFIG_KEY"
mkdir -p "$BUILD/sources" "$STATE" "$ROOT/artifacts"
if [[ ! -f "$SOURCE/.source-commit" ]]; then
  STAGING=$(mktemp -d "$BUILD/sources/extract.XXXXXX")
  trap 'rm -rf -- "$STAGING"' EXIT
  curl -fL --retry 3 "https://codeload.github.com/llvm/llvm-project/tar.gz/${PINS[0]}" -o "$STAGING/llvm.tar.gz"
  echo "${PINS[3]}  $STAGING/llvm.tar.gz" | sha256sum --check
  mkdir "$STAGING/source"
  tar -xzf "$STAGING/llvm.tar.gz" --strip-components=1 -C "$STAGING/source"
  echo "${PINS[0]}" > "$STAGING/source/.source-commit"
  mv "$STAGING/source" "$SOURCE"
fi
[[ $(cat "$SOURCE/.source-commit") == "${PINS[0]}" ]]
if [[ ! -d "$BUILD/emsdk/.git" ]]; then
  git clone https://github.com/emscripten-core/emsdk.git "$BUILD/emsdk"
fi
if ! git -C "$BUILD/emsdk" cat-file -e "${PINS[1]}^{commit}" 2>/dev/null; then
  git -C "$BUILD/emsdk" fetch origin "${PINS[1]}"
fi
git -C "$BUILD/emsdk" checkout --detach "${PINS[1]}"
"$BUILD/emsdk/emsdk" install "${PINS[2]}"
"$BUILD/emsdk/emsdk" activate "${PINS[2]}"
# emsdk_env.sh can reference unset variables.
set +u
source "$BUILD/emsdk/emsdk_env.sh"
set -u
COMMON=(-G Ninja -DCMAKE_BUILD_TYPE=Release -DLLVM_TARGETS_TO_BUILD=AArch64
  -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF
  -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_LIBXML2=OFF
  -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_LIBEDIT=OFF
  -DLLVM_ENABLE_BINDINGS=OFF -DLLVM_INCLUDE_EXAMPLES=OFF)
cmake -S "$SOURCE/llvm" -B "$STATE/host" "${COMMON[@]}"
cmake --build "$STATE/host" --target llvm-tblgen -j "$JOBS"
"$STATE/host/bin/llvm-tblgen" --dump-json -I "$SOURCE/llvm/include" \
  -I "$SOURCE/llvm/lib/Target/AArch64" \
  "$SOURCE/llvm/lib/Target/AArch64/AArch64.td" -o "$STATE/aarch64-records.json"
python3 "$ROOT/scripts/generate-metadata.py" "$STATE/aarch64-records.json" "$ROOT/artifacts/features.js"
emcmake cmake -S "$SOURCE/llvm" -B "$STATE/wasm" "${COMMON[@]}" \
  -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten -DLLVM_DEFAULT_TARGET_TRIPLE=aarch64-none-unknown \
  -DLLVM_TABLEGEN="$STATE/host/bin/llvm-tblgen" -DLLVM_ENABLE_THREADS=OFF \
  -DLLVM_ENABLE_BACKTRACES=OFF -DLLVM_ENABLE_UNWIND_TABLES=OFF \
  -DCMAKE_C_FLAGS_RELEASE='-Oz -DNDEBUG -flto' -DCMAKE_CXX_FLAGS_RELEASE='-Oz -DNDEBUG -flto'
cmake --build "$STATE/wasm" --target LLVMAArch64Disassembler LLVMAArch64Desc LLVMAArch64Info -j "$JOBS"
emcmake cmake -S "$ROOT/native" -B "$STATE/bridge" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DLLVM_DIR="$STATE/wasm/lib/cmake/llvm" \
  -DLLVM_SOURCE_ROOT="$SOURCE/llvm" -DLLVM_BUILD_ROOT="$STATE/wasm"
cmake --build "$STATE/bridge" -j "$JOBS"
node "$ROOT/scripts/verify-mc-footprint.mjs" "$STATE/bridge" "$STATE/wasm/lib/Target/AArch64"
mkdir -p "$ROOT/artifacts" "$ROOT/licenses"
cp "$STATE/bridge/llvm-aarch64.js" "$STATE/bridge/llvm-aarch64.wasm" "$ROOT/artifacts/"
cmp "$SOURCE/LICENSE.TXT" "$ROOT/licenses/LLVM.txt"
cmp "$BUILD/emsdk/upstream/emscripten/LICENSE" "$ROOT/licenses/emscripten-LICENSE.txt"
cmp "$BUILD/emsdk/upstream/emscripten/AUTHORS" "$ROOT/licenses/emscripten-AUTHORS.txt"
cmp "$BUILD/emsdk/upstream/emscripten/system/lib/libc/musl/COPYRIGHT" "$ROOT/licenses/musl.txt"
cmp "$BUILD/emsdk/upstream/emscripten/system/lib/libcxx/LICENSE.TXT" "$ROOT/licenses/libcxx.txt"
cmp "$BUILD/emsdk/upstream/emscripten/system/lib/compiler-rt/LICENSE.TXT" "$ROOT/licenses/compiler-rt.txt"
python3 "$ROOT/scripts/build-manifest.py" "$STATE/bridge" "$ROOT"

# Complete the publishable package after generating the runtime and provenance.
npm --prefix "$ROOT" run build
