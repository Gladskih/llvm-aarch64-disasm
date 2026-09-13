import { createDisassembler } from '../dist/index.js';
const decoder = await createDisassembler();
postMessage(decoder.decode(new Uint8Array([2, 0, 0, 0x94]), { address: 0x1000n })[0]);
