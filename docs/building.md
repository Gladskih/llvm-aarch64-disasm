# Building and contributing

These instructions apply to a checkout of the repository. Package consumers use the prebuilt WASM and do not need a native toolchain.

The source repository contains no generated runtime or metadata. A clean checkout first builds pinned LLVM and Emscripten into ignored `artifacts/`, then emits the complete npm package into ignored `dist/`. Subsequent TypeScript development can use `npm test` without rebuilding LLVM.

To rebuild on Linux or WSL, install Git, curl, Python 3, CMake 3.20+, Ninja, and a host C++ compiler, then run:

```sh
npm ci
npm run build:wasm
npm test
npx playwright install chromium
npm run test:browser
npm run verify:package
npm pack --dry-run
npm pack --ignore-scripts --json > pack-result.json
node scripts/inspect-tarball.mjs
node scripts/test-tarball.mjs
```

`npm pack` checks the artifact hash, validates WASM, and runs a decode smoke test before producing the tarball. `scripts/test-tarball.mjs` checks that the tarball installs and decodes with lifecycle scripts disabled. These commands do not publish anything or require npm credentials.

The build script installs a local pinned emsdk and builds only host `llvm-tblgen` plus AArch64 MC libraries. [`upstream.json`](../upstream.json) pins LLVM 21.1.8 by commit and source archive SHA-256, and Emscripten 4.0.23 by SDK commit/version. Set `BUILD_DIR` to reuse build inputs and `JOBS` to limit parallelism (default 4). In WSL, a Linux-filesystem build directory is substantially faster than `/mnt/c`. Allow several GB of disk and RAM. CMake/Ninja and the host compiler are build prerequisites; CI fixes the runner OS, while emitted WASM uses the pinned Emscripten toolchain.

Release builds use `-Oz`, LTO, dead-code elimination, no filesystem, no LLVM threads, and no unrelated target backends. `artifacts/build-info.json` records the actual WASM size/hash and extracted LLVM archive inputs before LTO. It also records the repository commit and whether the source tree was dirty. Generated outputs remain ignored; commit only sources, configuration, documentation, and required notices. The build verifies the checked-in licenses against the pinned upstream texts. Review the [metadata design and limits](metadata.md) when updating LLVM.

Every push and pull request invokes the shared WASM workflow: build once, run Node and Chromium tests, verify metadata/provenance and MC footprint, inspect the package allowlist, then install the real tarball with lifecycle scripts disabled and decode `ret`. Actions artifacts carry the exact verified tarball, its checksum, provenance, package inventory, link map, and archive extraction report. The same workflow can be run manually; select `cold` to bypass caches.

CI separately caches LLVM sources, emsdk/toolchain, and reusable host `llvm-tblgen` plus WASM/bridge CMake state. Keys depend on pins and native build configuration, not README or TypeScript edits. Local source directories include the LLVM commit/archive hash; CMake state directories include the pins and build configuration hash. New pins therefore select compatible state automatically, and an existing emsdk checkout fetches missing pinned commits. Old cache directories may be removed when no longer needed. Warm builds still regenerate metadata, check footprint/licenses, and write fresh provenance.

Release `0.1.0` by downloading the package artifact from successful CI for the final clean commit, verifying its checksum and `build-info.json` source commit, and repeating the tarball smoke check. Confirm `npm whoami` and that the version is absent, then publish that exact tarball with `npm publish ./llvm-aarch64-disasm-0.1.0.tgz --access public --ignore-scripts`. Test the registry package using `node scripts/test-tarball.mjs llvm-aarch64-disasm@0.1.0`. Consumers never run LLVM, Emscripten, CMake, Python, or native compilers. LLVM/Emscripten update automation is intentionally deferred.

The MC adapter in `scripts/prepare-mc.mjs` replaces broad target-MC registration with the six factories used by the public API. It preserves LLVM's standard printer and instruction analysis. It retains generated feature data and hardware-mode behavior for `generic,+all`, but replaces scheduling data with LLVM's default empty model. Adaptation happens in the build directory; the upstream checkout is not patched. Its source-hash and structure checks must be reviewed when updating LLVM.

`scripts/verify-mc-footprint.mjs` checks the post-LTO link map and archive extraction report on every WASM build. It rejects scheduling-model tables, encoding, object writers, broad target-MC registration, and Apple-specific formatting. LLVM may merge identical register-name tables under an Apple symbol name; the checker verifies those tables are identical to the standard printer's tables before allowing them.

Measured size reductions with LLVM 21.1.8 / Emscripten 4.0.23:

| Build | WASM bytes | gzip bytes (level 9) |
| --- | ---: | ---: |
| Original broad MC registration | 2,212,358 | 602,350 |
| Disassembly-only registration and standard printer | 1,688,444 | 453,039 |
| Scheduling models removed | 1,112,084 | 366,477 |

Both reductions passed all 10 Node and 3 Chromium tests. Full structured output was also compared with the original module for 90,491 distinct encodings: 24,955 encodings extracted from the pinned LLVM AArch64 MC tests plus 65,536 deterministic random words. The comparison included successful, soft-fail, and invalid results, full-width/wrapping branch targets, and byte-for-byte identical `features.js`. This is regression evidence, not exhaustive verification of all 32-bit encodings.

To repeat that comparison when optimizing the native build, save the previous `dist/` directory before rebuilding, then run:

```sh
node scripts/compare-decoders.mjs /path/to/saved-dist/index.js "$BUILD_DIR/sources/llvm-<commit>-<archive-sha256>/llvm/test/MC/AArch64"
```

The saved directory must include its loader, WASM, and feature metadata. If `BUILD_DIR` is unset, use `.build` for the LLVM source path.
