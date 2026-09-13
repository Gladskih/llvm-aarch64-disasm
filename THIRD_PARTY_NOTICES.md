# Third-party notices

The WebAssembly decoder incorporates code from the LLVM Project, copyright the LLVM Project contributors, distributed primarily under `Apache-2.0 WITH LLVM-exception`. The applicable LLVM license text is included in `licenses/LLVM.txt`. LLVM-generated feature metadata and instruction tables are derived from the same upstream project and are distributed under the applicable LLVM licensing terms.

The build generates an adapted LLVM MC factory translation unit derived from upstream LLVM source. It omits unused registration paths, the Apple printer choice, and CPU scheduling models. The upstream LLVM source checkout itself is not modified. The adapted translation unit retains the applicable LLVM licensing notices; the bridge and extraction/adaptation scripts are original MIT-licensed code.

LLVM source: [https://github.com/llvm/llvm-project](https://github.com/llvm/llvm-project), with the pinned version and commit recorded in `upstream.json`. LLVM is a project of the LLVM Foundation. This package is independent and is not affiliated with or endorsed by the LLVM Foundation.

The generated loader and WASM runtime support are produced by Emscripten, which is dual-licensed under the MIT License and the University of Illinois/NCSA Open Source License. See `licenses/emscripten-AUTHORS.txt` and `licenses/emscripten-LICENSE.txt`. The linked runtime includes musl libc, libc++, and compiler-rt; their notices and license terms are included in `licenses/musl.txt`, `licenses/libcxx.txt`, and `licenses/compiler-rt.txt`. Rebuilding uses the pinned SDK recorded in `upstream.json`.

Some test instruction encodings and expected assembly output are based on LLVM MC test fixtures and are distributed under the applicable LLVM licensing terms.
