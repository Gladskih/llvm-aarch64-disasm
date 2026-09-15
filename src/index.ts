import createModule from './llvm-aarch64.js';
import generated from './features.js';

/** Feature IDs are LLVM TableGen record names, scoped to the pinned LLVM version. */
export type FeatureExpression = boolean | { readonly feature: string } |
  { readonly all_of: readonly FeatureExpression[] } |
  { readonly any_of: readonly FeatureExpression[] } | { readonly not: FeatureExpression };

export interface FeatureDefinition {
  readonly llvmName: string;
  readonly description: string;
  /** Verbatim upstream label, possibly grouping several FEAT_* names. */
  readonly armName: string | null;
  /** LLVM feature implication edges; resolve transitively for dependencies. */
  readonly implies: readonly string[];
}

export interface FeatureRequirements {
  readonly source: 'llvm-tablegen';
  /** Opcode predicates, not a complete architectural legality specification. */
  readonly scope: 'opcode';
  readonly known: boolean;
  /** All predicates must hold. Empty means no LLVM assembler feature gate. */
  readonly predicates: readonly { readonly name: string; readonly expression: FeatureExpression }[];
  /** Code-generation predicates not used by the MC assembler feature checker. */
  readonly nonAssemblerPredicates: readonly string[];
}

interface Metadata {
  features: Record<string, FeatureDefinition>;
  requirements: Omit<FeatureRequirements, 'source' | 'scope' | 'known'>[];
  opcodes: Record<string, number>;
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
const metadata = freeze(generated as Metadata);
export const llvmVersion = '21.1.8';
export const featureDefinitions: Readonly<Record<string, FeatureDefinition>> = metadata.features;
const requirements = metadata.requirements.map(r => freeze({
  source: 'llvm-tablegen' as const, scope: 'opcode' as const, known: true, ...r,
}));
const unknownRequirements: FeatureRequirements = freeze({
  source: 'llvm-tablegen', scope: 'opcode', known: false, predicates: [], nonAssemblerPredicates: [],
});

export type Operand = { readonly kind: 'register'; readonly id: number; readonly name: string } |
  { readonly kind: 'immediate'; readonly value: bigint } | { readonly kind: 'other' };
export type ControlFlow = 'none' | 'call' | 'return' | 'conditional-branch' |
  'unconditional-branch' | 'indirect-branch';
interface Location {
  readonly offset: number;
  readonly address: bigint;
  /** LLVM-reported size: 4 for complete words, 0 for truncated input. */
  readonly length: number;
  /** Number of input bytes consumed, including an invalid/truncated tail. */
  readonly bytesConsumed: number;
}
export interface DecodedInstruction extends Location {
  readonly status: 'success' | 'soft-fail';
  /** Numeric opcode and record name are version-scoped LLVM identities. */
  readonly opcode: number;
  readonly opcodeName: string;
  readonly mnemonic: string;
  readonly text: string;
  readonly controlFlow: ControlFlow;
  readonly target?: bigint;
  /** Raw MC operands, including implicit/tied operands; not a semantic IR. */
  readonly operands: readonly Operand[];
  readonly features: FeatureRequirements;
}
export interface InvalidInstruction extends Location {
  readonly status: 'invalid';
}
export type DecodeResult = DecodedInstruction | InvalidInstruction;
/** LLVM decoding without assembly formatting or operand materialization. */
export type InstructionMetadata = Omit<DecodedInstruction, 'opcodeName' | 'mnemonic' | 'text' | 'operands'>;
export type MetadataDecodeResult = InstructionMetadata | InvalidInstruction;
export interface Disassembler {
  /** Decode little-endian A64 words. The address wraps at 64 bits. */
  decode(bytes: Uint8Array, options?: { address?: bigint }): DecodeResult[];
}
export interface MetadataDisassembler extends Disassembler {
  /** Same byte/address/status contract as decode(), with only opcode, features and control flow. */
  decodeMetadata(bytes: Uint8Array, options?: { address?: bigint }): MetadataDecodeResult[];
}
export interface LoadOptions {
  /** Override the colocated WASM URL for a bundler, CDN, or asset pipeline. */
  wasmURL?: string | URL;
  /** Supply bytes to avoid fetching (also useful in Node and restrictive CSPs). */
  wasmBinary?: Uint8Array;
}

function validateInput(bytes: Uint8Array, address: bigint): void {
  if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
    throw new TypeError('bytes must be a Uint8Array');
  if (typeof address !== 'bigint' || address < 0n || address > 0xffffffffffffffffn)
    throw new RangeError('address must be an unsigned 64-bit bigint');
}

type WasmModule = Awaited<ReturnType<typeof createModule>>;

function readOperands(module: WasmModule, raw: DataView, names: Map<number, string>): Operand[] {
  const operands: Operand[] = [];
  const view = new DataView(module.HEAPU8.buffer, raw.getUint32(36, true), raw.getUint32(32, true) * 16);
  for (let offset = 0; offset < view.byteLength; offset += 16) {
    switch (view.getUint32(offset, true)) {
      case 1: {
        const id = view.getUint32(offset + 4, true);
        let name = names.get(id);
        if (name === undefined) {
          name = module.UTF8ToString(view.getUint32(offset + 12, true));
          names.set(id, name);
        }
        operands.push({ kind: 'register', id, name });
        break;
      }
      case 2: operands.push({ kind: 'immediate', value: view.getBigInt64(offset + 4, true) }); break;
      default: operands.push({ kind: 'other' });
    }
  }
  return operands;
}

function createBinaryDecoder<Instruction extends InstructionMetadata>(
  module: WasmModule,
  decodeWord: WasmModule['_decode_metadata'],
  materialize: (instruction: InstructionMetadata, raw: DataView, opcodeName: string) => Instruction
) {
  const byOpcode = new Map<number, { name: string; features: FeatureRequirements }>();
  const flows: ControlFlow[] = ['none', 'call', 'return', 'conditional-branch',
    'unconditional-branch', 'indirect-branch'];
  const opcodeInfo = (opcode: number) => {
    let value = byOpcode.get(opcode);
    if (!value) {
      const name = module.UTF8ToString(module._opcode_name(opcode));
      value = { name, features: requirements[metadata.opcodes[name]] ?? unknownRequirements };
      byOpcode.set(opcode, value);
    }
    return value;
  };
  return (bytes: Uint8Array, { address = 0n }: { address?: bigint } = {}): (Instruction | InvalidInstruction)[] => {
    validateInput(bytes, address);
    const input = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const results: (Instruction | InvalidInstruction)[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const count = Math.min(4, bytes.length - offset);
      const pc = BigInt.asUintN(64, address + BigInt(offset));
      const pointer = decodeWord(count === 4 ? input.getUint32(offset, true) : 0,
        count, Number(pc & 0xffffffffn), Number(pc >> 32n));
      // native/bridge.cpp: seven uint32 metadata fields, optionally followed by full details.
      // Refresh after the native call, which can grow WASM memory.
      const raw = new DataView(module.HEAPU8.buffer, pointer);
      const location = { offset, address: pc, length: raw.getUint32(4, true), bytesConsumed: count };
      if (raw.getUint32(0, true) === 0) {
        results.push({ ...location, status: 'invalid' });
      } else {
        const opcode = raw.getUint32(8, true);
        const info = opcodeInfo(opcode);
        results.push(materialize({ ...location,
          status: raw.getUint32(0, true) === 1 ? 'success' : 'soft-fail',
          opcode, controlFlow: flows[raw.getUint32(12, true)],
          ...(raw.getUint32(16, true) ? { target: raw.getBigUint64(20, true) } : {}),
          features: info.features }, raw, info.name));
      }
    }
    return results;
  };
}

export async function createDisassembler(options: LoadOptions = {}): Promise<MetadataDisassembler> {
  const url = options.wasmURL ?? new URL('./llvm-aarch64.wasm', import.meta.url);
  const module = await createModule({
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    locateFile: () => String(url),
  });
  const registerNames = new Map<number, string>();
  return {
    decodeMetadata: createBinaryDecoder(module, module._decode_metadata, instruction => instruction),
    decode: createBinaryDecoder(module, module._decode_full, (instruction, raw, opcodeName) => {
      const text = module.UTF8ToString(raw.getUint32(28, true)).replace(/\s+/g, ' ').trim();
      return { ...instruction, opcodeName, text, mnemonic: text.split(' ', 1)[0],
        operands: readOperands(module, raw, registerNames) };
    }),
  };
}
