// Adapt the pinned upstream MC factory translation unit without modifying LLVM.
// Decoder, printer and instruction-analysis implementations remain upstream code.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [source, subtargetPath, output] = process.argv.slice(2);
let cpp = await readFile(source, 'utf8');
assert.equal(createHash('sha256').update(cpp).digest('hex'),
  '3b4c2232418874f815b9b39d7dd572f0ad7d6302bfd8a582e85245bdc50077d5',
  'Review the MC adapter when changing the pinned LLVM source');
const marker = '// Force static initialization.';
assert.equal(cpp.split(marker).length, 2);
cpp = cpp.slice(0, cpp.indexOf(marker));
const apple = '  if (SyntaxVariant == 1)\n    return new AArch64AppleInstPrinter(MAI, MII, MRI);\n';
assert(cpp.includes(apple));
cpp = cpp.replace(apple, '');
// Keep the generated feature data and hardware-mode logic verbatim. Only the
// public API's fixed "generic" CPU is needed, with no scheduling model.
const subtarget = await readFile(subtargetPath, 'utf8');
function extract(pattern, label) {
  const matches = [...subtarget.matchAll(pattern)];
  assert.equal(matches.length, 1, `Review generated ${label} after LLVM changes`);
  return matches[0][0];
}
const featureTable = extract(/extern const llvm::SubtargetFeatureKV AArch64FeatureKV\[\] = \{[\s\S]*?\n\};/g, 'feature table');
const generic = extract(/^ \{ "generic", .* &\w+Model \},$/gm, 'generic CPU')
  .replace(/&\w+Model/, '&MCSchedModel::Default');
let mcClass = extract(/struct AArch64GenMCSubtargetInfo : public MCSubtargetInfo \{[\s\S]*?(?=static inline MCSubtargetInfo \*createAArch64MCSubtargetInfoImpl)/g, 'MC subtarget class');
const resolver = /  unsigned resolveVariantSchedClass\([\s\S]*?\n  \}\n/g;
assert.equal([...mcClass.matchAll(resolver)].length, 1);
mcClass = mcClass.replace(resolver, '');
let factory = extract(/static inline MCSubtargetInfo \*createAArch64MCSubtargetInfoImpl\([^]*?\n\}/g, 'MC subtarget factory');
const schedulingTables = 'AArch64WriteProcResTable, AArch64WriteLatencyTable, AArch64ReadAdvanceTable';
assert(factory.includes(schedulingTables));
factory = factory.replace(schedulingTables, 'nullptr, nullptr, nullptr');
const include = '#define GET_SUBTARGETINFO_MC_DESC\n#include "AArch64GenSubtargetInfo.inc"';
assert(cpp.includes(include));
cpp = cpp.replace(include, `
namespace llvm {
${featureTable}
extern const llvm::SubtargetSubTypeKV AArch64SubTypeKV[] = {
${generic}
};
extern const llvm::StringRef AArch64Names[] = { "generic" };
${mcClass}
${factory}
} // namespace llvm
`);
cpp += `
// Package-specific registration: only the fixed A64 disassembly API.
extern "C" void LLVMInitializeAArch64DisassemblyMC() {
  Target &T = getTheAArch64leTarget();
  RegisterMCAsmInfoFn AsmInfo(T, createAArch64MCAsmInfo);
  TargetRegistry::RegisterMCInstrInfo(T, createAArch64MCInstrInfo);
  TargetRegistry::RegisterMCRegInfo(T, createAArch64MCRegisterInfo);
  TargetRegistry::RegisterMCSubtargetInfo(T, createAArch64MCSubtargetInfo);
  TargetRegistry::RegisterMCInstrAnalysis(T, createAArch64InstrAnalysis);
  TargetRegistry::RegisterMCInstPrinter(T, createAArch64MCInstPrinter);
}
`;
await writeFile(output, '// Adapted from pinned LLVM; Apache-2.0 WITH LLVM-exception.\n' + cpp);
