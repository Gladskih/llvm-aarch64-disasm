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
#include "llvm/Support/JSON.h"
#include "llvm/Support/raw_ostream.h"
#include <memory>
#include <string>

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
}

// Result storage is owned by this module; JS copies it before the next call.
extern "C" const char *decode(const uint8_t *bytes, unsigned length,
                               uint32_t addressLow, uint32_t addressHigh) {
  static Decoder decoder;
  static std::string result;
  const uint64_t address = (uint64_t(addressHigh) << 32) | addressLow;
  MCInst inst;
  uint64_t size = 0;
  auto status = decoder.disassembler->getInstruction(inst, size,
      ArrayRef<uint8_t>(bytes, length), address, nulls());
  json::Object object{{"status", status == MCDisassembler::Success ? "success" :
                      status == MCDisassembler::SoftFail ? "soft-fail" : "invalid"},
                      {"length", int64_t(size)}};
  if (status != MCDisassembler::Fail) {
    object["opcode"] = int64_t(inst.getOpcode());
    object["opcodeName"] = decoder.instructions->getName(inst.getOpcode());
    std::string formatted;
    raw_string_ostream stream(formatted);
    decoder.printer->printInst(&inst, address, "", *decoder.subtarget, stream);
    object["text"] = StringRef(formatted).trim().str();
    auto &a = *decoder.analysis;
    object["controlFlow"] = a.isCall(inst) ? "call" : a.isReturn(inst) ? "return" :
        a.isConditionalBranch(inst) ? "conditional-branch" :
        a.isIndirectBranch(inst) ? "indirect-branch" :
        a.isUnconditionalBranch(inst) ? "unconditional-branch" : "none";
    uint64_t target;
    if ((a.isBranch(inst) || a.isCall(inst)) && a.evaluateBranch(inst, address, size, target))
      object["target"] = std::to_string(target);
    json::Array operands;
    for (const auto &operand : inst) {
      if (operand.isReg())
        operands.push_back(json::Object{{"kind", "register"}, {"id", int64_t(operand.getReg())},
                                       {"name", decoder.registers->getName(operand.getReg())}});
      else if (operand.isImm())
        operands.push_back(json::Object{{"kind", "immediate"}, {"value", std::to_string(operand.getImm())}});
      else operands.push_back(json::Object{{"kind", "other"}});
    }
    object["operands"] = std::move(operands);
  }
  result.clear();
  raw_string_ostream output(result);
  output << json::Value(std::move(object));
  return result.c_str();
}
