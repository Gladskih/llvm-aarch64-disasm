# MC size experiments

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
