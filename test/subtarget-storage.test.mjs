import assert from "node:assert/strict";
import { test } from "node:test";
import { subtargetStorage } from "../scripts/subtarget-storage.mjs";

// Synthetic excerpt following llvmorg-23.1.3's SubtargetEmitter.cpp:
// featureKeyValues(), cpuKeyValues(), emitGenMCSubtargetInfo().
const features = `extern const llvm::SubtargetFeatureKVStorage< 1, 9> X86FeatureKVStorage = {
  {
    { sizeof(SubtargetFeatureKV) * 1 + 1, sizeof(SubtargetFeatureKV) * 1 + 1,
      X86::FeatureTest, { 0x2 } },
  },
    "\\000feature\\000"};
`;
const processors = `extern const llvm::SubtargetSubTypeKVStorage< 2, 16> X86SubTypeKVStorage = {
  {
   { sizeof(SubtargetSubTypeKV) * 2 + 1, { 0x1 }, { 0x3 }, 7 },
   { sizeof(SubtargetSubTypeKV) * 1 + 7, { 0x2 }, { 0x4 }, 8 },
  },
    "\\000other\\000gen" "eric\\000"};
`;
const generated = features + processors;

test("relative feature data and generic masks survive scheduling-model removal", () => {
  const output = subtargetStorage(generated, "X86");
  assert(output.startsWith(features.trimEnd()));
  assert(output.includes('{ { sizeof(SubtargetSubTypeKV), { 0x2 }, { 0x4 }, 0 } }, "generic"'));
  assert(output.includes("X86SchedModels[] = { MCSchedModel::Default }"));
  assert(!output.includes("other"));
  const atStart = generated.replace("+ 7,", "+ 0,")
    .replace('"\\000other\\000gen" "eric\\000"', '"generic\\000"');
  assert(subtargetStorage(atStart, "X86").includes("{ 0x2 }, { 0x4 }"));
});

test("missing or duplicated generated declarations require adapter review", () => {
  assert.throws(() => subtargetStorage(processors, "X86"), /Review generated Feature storage/);
  assert.throws(() => subtargetStorage(features + generated, "X86"), /Review generated Feature storage/);
  assert.throws(() => subtargetStorage(features, "X86"), /Review generated SubType storage/);
});

test("processor strings must identify exactly one complete generic name", () => {
  assert.throws(() => subtargetStorage(generated.replace("eric", "eral"), "X86"), /Missing generic/);
  const suffix = generated.replace('"\\000other\\000gen" "eric\\000"', '"notgeneric\\000"');
  assert.throws(() => subtargetStorage(suffix, "X86"), /Missing generic/);
  const duplicate = generated.replace('"eric\\000"', '"eric\\000generic\\000"');
  assert.throws(() => subtargetStorage(duplicate, "X86"), /Duplicate generic/);
});

test("changed row offsets and string boundaries cannot silently select another processor", () => {
  assert.throws(() => subtargetStorage(generated.replace("+ 7,", "+ 8,"), "X86"), /Review generated generic/);
  const noBoundary = features + processors.replace("  },\n", "  }, ");
  assert.throws(() => subtargetStorage(noBoundary, "X86"), /string table boundary/);
  assert.throws(() => subtargetStorage(generated.replace("\\000other", "\\qother"), "X86"), SyntaxError);
});
