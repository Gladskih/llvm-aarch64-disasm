# llvm-aarch64-disasm

An AArch64 (A64) disassembler for JavaScript and TypeScript, powered by upstream LLVM MC compiled to WebAssembly. Returns **structured instruction data, control-flow information, and LLVM-derived architectural feature requirements**. Ships with prebuilt WASM and requires no native toolchain at install time.

AArch64 (A64) only. Supports little-endian instruction words, including the extensions understood by LLVM 21.1.8.

```sh
npm install llvm-aarch64-disasm
```

```js
import { createDisassembler, featureDefinitions } from 'llvm-aarch64-disasm';

const disassembler = await createDisassembler();
const instructions = disassembler.decode(
  new Uint8Array([0x02, 0x00, 0x00, 0x94]), // bl +8
  { address: 0x1000n },
);
const instruction = instructions[0];
if (instruction.status !== 'invalid') {
  console.log(instruction.mnemonic, instruction.target); // bl, 4104n
  console.log(instruction.features.predicates);
}
console.log(featureDefinitions.FeatureNEON.armName); // FEAT_AdvSIMD
```

`decode()` returns one result per four-byte word, including invalid words and a final truncated tail. Results include `offset`, `address`, LLVM's `length`, and `bytesConsumed`. Successful and soft-fail results additionally expose `opcode`, `opcodeName`, `mnemonic`, `text`, raw MC `operands`, `controlFlow`, optional direct `target`, and `features`. Numeric opcodes, register IDs, record names, and printer aliases are scoped to the pinned LLVM version, not a stable cross-version ISA identifier. Addresses, targets, and immediate operands use `bigint`; JSON serialization requires a replacer. Address arithmetic wraps at 64 bits.

Statuses are `success`, `soft-fail` (LLVM decoded an architecturally questionable instruction), and `invalid`. A truncated input has `length: 0`; complete words have `length: 4`. `bytesConsumed` always advances over the supplied input. Soft-fail retains decoded fields. Control flow comes from LLVM MC instruction analysis; it is not a full semantic model of exceptions, system instructions, or indirect targets.

**Feature requirements:** `features.predicates` is a conjunction of named LLVM assembler predicates. Expressions preserve `all_of`, `any_of`, and `not`; `{ feature: 'FeatureSVE' }` refers to `featureDefinitions`. For example, vector `add z0.s, z0.s, z0.s` has an `any_of` requirement for SVE or SME. Follow `implies` transitively for LLVM dependencies. `armName` preserves LLVM's authoritative label verbatim, including grouped labels such as `FEAT_AES, FEAT_PMULL`; it does not assert that every label in a group is necessary for this particular instruction.

Keys such as `FeatureNEON` are LLVM record identifiers and may change when the pinned LLVM version is upgraded. The corresponding `armName`, such as `FEAT_AdvSIMD`, is the architectural label supplied by LLVM.

This is **opcode-level LLVM metadata**, not a complete Arm architectural legality oracle. Empty predicates mean LLVM records no assembler gate; `known: false` means the returned opcode has no extracted record. System-register operands, aliases, runtime execution modes, and handwritten decoder checks can impose additional restrictions. Disassembly uses LLVM's permissive `+all` mode; the synthetic `FeatureAll` bypass is removed from reported requirements. See [metadata design and limits](docs/metadata.md).

Browsers load the WASM beside the emitted JS by default. Serve `.wasm` as `application/wasm`. With bundlers, copy the asset and pass its URL explicitly (for example `import wasmURL from 'llvm-aarch64-disasm/llvm-aarch64.wasm?url'` with Vite):

```js
const disassembler = await createDisassembler({ wasmURL });
// Or supply a Uint8Array to avoid fetching:
const offline = await createDisassembler({ wasmBinary });
```

Requires modern ES modules, WebAssembly, and BigInt (Node 20+ is also supported). Use a Web Worker for large synchronous decode operations. CSP must allow WebAssembly compilation.

[`upstream.json`](upstream.json) pins LLVM 21.1.8 by commit and source archive SHA-256, and Emscripten 4.0.23 by SDK commit/version. Git contains sources and required notices only. CI reproducibly builds the runtime and metadata from these pins, tests the complete package, and produces the prebuilt npm tarball. No installation lifecycle scripts or native tools are needed by npm consumers. To build the WASM and package from a clean checkout, run `npm run build:wasm` on Linux or WSL after installing the [build prerequisites](docs/building.md). That guide also covers development tests, package verification, and CI.

Original wrapper code is MIT; LLVM and generated LLVM artifacts are Apache-2.0 WITH LLVM-exception. Redistribute [LICENSE](LICENSE), [licenses/LLVM.txt](licenses/LLVM.txt), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) with the package and follow their attribution/notice requirements. The build adapts LLVM's MC initialization to omit unused subsystems; decoding remains upstream LLVM.

## Metadata-only decoding

`createDisassembler()` also returns `decodeMetadata(bytes, { address })` for ISA scans
and control-flow traversal. It uses the same LLVM decoder, permissive `+all` mode,
feature requirements, statuses, lengths, address wrapping and truncated-tail behavior
as `decode()`. Successful results contain `offset`, `address`, `length`,
`bytesConsumed`, `status`, `opcode`, `features`, `controlFlow` and optional `target`.
It omits `text`, `mnemonic`, `opcodeName` and `operands`.

This path avoids instruction printing, operand materialization and JSON serialization.
The private WASM bridge returns seven little-endian 32-bit fields, copied before the
next call. Feature metadata is cached by LLVM opcode, with opcode names resolved only
on first use. Results own their scalar values and share immutable feature metadata.
`Disassembler` remains the existing text-decoder interface; `MetadataDisassembler`
extends it with the new method. No disposal or persistent input buffer is required.

## Full decoding performance

`decode()` retains its complete result contract, including assembly text, mnemonic,
opcode name, raw MC operands, feature requirements and control flow. It now uses
binary WASM result records instead of JSON. Register and opcode names are cached;
signed immediate values are transferred as 64-bit integers without decimal conversion.
Returned objects own their text and operands and remain valid after subsequent calls.

Use `decode()` when details are needed, or `decodeMetadata()` when scanning ISA usage.
Both decode each instruction once. Full decoding still performs LLVM instruction
printing and allocates operand objects, so metadata-only scanning remains faster.
