// LLVM 23 SubtargetEmitter.cpp emits relative string offsets in these storages.
// Preserve feature masks verbatim; retain only the API's fixed generic processor.
import assert from "node:assert/strict";

function storage(source, target, kind) {
  const pattern = new RegExp("extern const llvm::Subtarget" + kind +
    "KVStorage<[^>]+> " + target + kind + "KVStorage = \\{[\\s\\S]*?\\};(?=\\n|$)", "g");
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, "Review generated " + kind + " storage after LLVM changes");
  return matches[0][0];
}

function genericFeatures(table) {
  const separator = table.indexOf("  },\n");
  assert(separator >= 0, "Missing processor string table boundary");
  const strings = table.slice(separator + 5);
  const literals = [...strings.matchAll(/"(?:[^"\\]|\\.)*"/g)];
  const decoded = literals.map(([literal]) => JSON.parse(literal.replace(/\\([0-7]{3})/g,
    (_, octal) => "\\u00" + parseInt(octal, 8).toString(16).padStart(2, "0")))).join("");
  const names = Buffer.from(decoded, "latin1");
  const offset = names.indexOf("generic\0");
  assert(offset >= 0 && (offset === 0 || names[offset - 1] === 0), "Missing generic CPU name");
  assert.equal(names.indexOf("generic\0", offset + 1), -1, "Duplicate generic CPU name");
  const pattern = new RegExp("^   \\{ sizeof\\(SubtargetSubTypeKV\\) \\* \\d+ \\+ " + offset +
    ", (.+), \\d+ \\},$", "gm");
  const rows = [...table.matchAll(pattern)];
  assert.equal(rows.length, 1, "Review generated generic CPU row after LLVM changes");
  return rows[0][1];
}

export function subtargetStorage(source, target) {
  const features = storage(source, target, "Feature");
  const generic = genericFeatures(storage(source, target, "SubType"));
  return `${features}
extern const llvm::SubtargetSubTypeKVStorage<1, 8> ${target}SubTypeKVStorage = {
  { { sizeof(SubtargetSubTypeKV), ${generic}, 0 } }, "generic"
};
extern const llvm::MCSchedModel ${target}SchedModels[] = { MCSchedModel::Default };
`;
}
