#include "llvm/ADT/ArrayRef.h"
#include "llvm/MC/MCAsmInfo.h"
#include "llvm/MC/MCContext.h"
#include "llvm/MC/MCDisassembler/MCDisassembler.h"
#include "llvm/MC/MCInst.h"
#include "llvm/MC/MCInstPrinter.h"
#include "llvm/MC/MCInstrAnalysis.h"
#include "llvm/MC/MCInstrInfo.h"
#include "llvm/MC/MCRegisterInfo.h"
#include "llvm/MC/MCSubtargetInfo.h"
#include "llvm/MC/TargetRegistry.h"
#include "llvm/Support/raw_ostream.h"
#include <memory>
#include <algorithm>
#include <string>
#include <vector>

extern "C" void LLVMInitializeAArch64TargetInfo();
extern "C" void LLVMInitializeAArch64DisassemblyMC();
extern "C" void LLVMInitializeAArch64Disassembler();

using namespace llvm;
namespace {
struct Decoder {
  Triple triple{"aarch64-none-unknown"};
  std::unique_ptr<MCRegisterInfo> registers;
  std::unique_ptr<MCAsmInfo> assembly;
  std::unique_ptr<MCSubtargetInfo> subtarget;
  std::unique_ptr<MCInstrInfo> instructions;
  std::unique_ptr<MCContext> context;
  std::unique_ptr<MCDisassembler> disassembler;
  std::unique_ptr<MCInstPrinter> printer;
  std::unique_ptr<MCInstrAnalysis> analysis;
  Decoder() {
    LLVMInitializeAArch64TargetInfo();
    LLVMInitializeAArch64DisassemblyMC();
    LLVMInitializeAArch64Disassembler();
    std::string error;
    const auto *target = TargetRegistry::lookupTarget(triple, error);
    registers.reset(target->createMCRegInfo(triple.str()));
    assembly.reset(target->createMCAsmInfo(*registers, triple.str(), MCTargetOptions{}));
    // LLVM's intended permissive disassembly mode, not a real processor.
    subtarget.reset(target->createMCSubtargetInfo(triple.str(), "generic", "+all"));
    instructions.reset(target->createMCInstrInfo());
    context = std::make_unique<MCContext>(triple, assembly.get(), registers.get(), subtarget.get());
    disassembler.reset(target->createMCDisassembler(*subtarget, *context));
    printer.reset(target->createMCInstPrinter(triple, 0, *assembly, *instructions, *registers));
    analysis.reset(target->createMCInstrAnalysis(instructions.get()));
  }
};
Decoder &getDecoder() {
  static Decoder decoder;
  return decoder;
}

// Shared with the binary metadata ABI and its JS control-flow names.
unsigned controlFlow(Decoder &decoder, const MCInst &inst) {
  auto &a = *decoder.analysis;
  return a.isCall(inst) ? 1 : a.isReturn(inst) ? 2 :
      a.isConditionalBranch(inst) ? 3 : a.isIndirectBranch(inst) ? 5 :
      a.isUnconditionalBranch(inst) ? 4 : 0;
}
}

// Seven little-endian uint32 fields, copied by JS before the next invocation:
// status (0 invalid, 1 success, 2 soft-fail), length, opcode, flow, hasTarget, low, high.
static void decodeInstruction(uint32_t word, unsigned length, uint64_t address,
                              MCInst &inst, uint32_t *result) {
  auto &decoder = getDecoder();
  const uint8_t bytes[] = {uint8_t(word), uint8_t(word >> 8),
                           uint8_t(word >> 16), uint8_t(word >> 24)};
  uint64_t size = 0;
  auto status = decoder.disassembler->getInstruction(inst, size,
      ArrayRef<uint8_t>(bytes, std::min(length, 4u)), address, nulls());
  result[1] = uint32_t(size);
  if (status == MCDisassembler::Fail) return;
  result[0] = status == MCDisassembler::Success ? 1 : 2;
  result[2] = inst.getOpcode();
  result[3] = controlFlow(decoder, inst);
  uint64_t target;
  auto &a = *decoder.analysis;
  if ((a.isBranch(inst) || a.isCall(inst)) && a.evaluateBranch(inst, address, size, target)) {
    result[4] = 1;
    result[5] = uint32_t(target);
    result[6] = uint32_t(target >> 32);
  }
}

extern "C" const uint32_t *decode_metadata(uint32_t word, unsigned length,
                                          uint32_t addressLow, uint32_t addressHigh) {
  static uint32_t result[7];
  std::fill(std::begin(result), std::end(result), 0);
  MCInst inst;
  decodeInstruction(word, length, (uint64_t(addressHigh) << 32) | addressLow, inst, result);
  return result;
}

extern "C" const char *opcode_name(unsigned opcode) {
  auto &decoder = getDecoder();
  return opcode < decoder.instructions->getNumOpcodes()
      ? decoder.instructions->getName(opcode).data() : "";
}

// Four uint32 fields per operand: kind (0 other, 1 register, 2 immediate),
// register ID / immediate low bits, immediate high bits, register-name pointer.
static void writeOperands(Decoder &decoder, const MCInst &inst, std::vector<uint32_t> &out) {
  out.clear();
  for (const auto &operand : inst) {
    if (operand.isReg()) {
      out.insert(out.end(), {1, unsigned(operand.getReg()), 0,
          uint32_t(uintptr_t(decoder.registers->getName(operand.getReg())))});
    } else if (operand.isImm()) {
      const uint64_t value = uint64_t(operand.getImm());
      out.insert(out.end(), {2, uint32_t(value), uint32_t(value >> 32), 0});
    } else {
      out.insert(out.end(), {0, 0, 0, 0});
    }
  }
}

// Metadata prefix followed by text pointer, operand count and operand-buffer pointer.
// Storage belongs to this module; JS copies it before another decoder invocation.
extern "C" const uint32_t *decode_full(uint32_t word, unsigned length,
                                      uint32_t addressLow, uint32_t addressHigh) {
  auto &decoder = getDecoder();
  static uint32_t result[10];
  static std::string formatted;
  static std::vector<uint32_t> operands;
  std::fill(std::begin(result), std::end(result), 0);
  const uint64_t address = (uint64_t(addressHigh) << 32) | addressLow;
  MCInst inst;
  decodeInstruction(word, length, address, inst, result);
  if (result[0] == 0) return result;
  formatted.clear();
  raw_string_ostream stream(formatted);
  decoder.printer->printInst(&inst, address, "", *decoder.subtarget, stream);
  writeOperands(decoder, inst, operands);
  result[7] = uint32_t(uintptr_t(formatted.c_str()));
  result[8] = inst.getNumOperands();
  result[9] = uint32_t(uintptr_t(operands.data()));
  return result;
}
