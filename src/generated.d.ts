declare module '*llvm-aarch64.js' {
  interface Module {
    HEAPU8: Uint8Array;
    _malloc(size: number): number;
    _free(pointer: number): void;
    _decode(pointer: number, length: number, low: number, high: number): number;
    UTF8ToString(pointer: number): string;
  }
  export default function createModule(options: {
    wasmBinary?: Uint8Array;
    locateFile: (path: string) => string;
  }): Promise<Module>;
}
declare module '*features.js' {
  const metadata: unknown;
  export default metadata;
}
