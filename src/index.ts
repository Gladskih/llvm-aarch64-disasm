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
export interface Disassembler {
  /** Decode little-endian A64 words. The address wraps at 64 bits. */
  decode(bytes: Uint8Array, options?: { address?: bigint }): DecodeResult[];
}
export interface LoadOptions {
  /** Override the colocated WASM URL for a bundler, CDN, or asset pipeline. */
  wasmURL?: string | URL;
  /** Supply bytes to avoid fetching (also useful in Node and restrictive CSPs). */
  wasmBinary?: Uint8Array;
}

export async function createDisassembler(options: LoadOptions = {}): Promise<Disassembler> {
  const url = options.wasmURL ?? new URL('./llvm-aarch64.wasm', import.meta.url);
  const module = await createModule({
    ...(options.wasmBinary ? { wasmBinary: options.wasmBinary } : {}),
    locateFile: () => String(url),
  });
  return {
    decode(bytes, { address = 0n } = {}) {
      if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]')
        throw new TypeError('bytes must be a Uint8Array');
      if (typeof address !== 'bigint' || address < 0n || address > 0xffffffffffffffffn)
        throw new RangeError('address must be an unsigned 64-bit bigint');
      const results: DecodeResult[] = [];
      if (!bytes.length) return results;
      const pointer = module._malloc(4);
      if (!pointer) throw new Error('WASM allocation failed');
      try {
        for (let offset = 0; offset < bytes.length; offset += 4) {
          const count = Math.min(4, bytes.length - offset);
          module.HEAPU8.set(bytes.subarray(offset, offset + count), pointer);
          const pc = BigInt.asUintN(64, address + BigInt(offset));
          const raw = JSON.parse(module.UTF8ToString(module._decode(
            pointer, count, Number(pc & 0xffffffffn), Number(pc >> 32n),
          )));
          const location = { offset, address: pc, length: raw.length, bytesConsumed: count };
          if (raw.status === 'invalid') {
            results.push({ ...location, status: 'invalid' });
          } else {
            const text: string = raw.text.replace(/\s+/g, ' ').trim();
            results.push({
              ...location, status: raw.status, opcode: raw.opcode, opcodeName: raw.opcodeName,
              text, mnemonic: text.split(' ', 1)[0], controlFlow: raw.controlFlow,
              ...(raw.target !== undefined ? { target: BigInt(raw.target) } : {}),
              operands: raw.operands.map((operand: { kind: string; value?: string }) =>
                operand.kind === 'immediate' ? { ...operand, value: BigInt(operand.value!) } : operand),
              features: requirements[metadata.opcodes[raw.opcodeName]] ?? unknownRequirements,
            });
          }
        }
      } finally { module._free(pointer); }
      return results;
    },
  };
}
