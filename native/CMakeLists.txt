cmake_minimum_required(VERSION 3.20)
project(aarch64_disasm LANGUAGES C CXX)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../upstream.json" UPSTREAM_JSON)
string(JSON PINNED_LLVM_VERSION GET "${UPSTREAM_JSON}" llvmVersion)
find_package(LLVM ${PINNED_LLVM_VERSION} EXACT REQUIRED CONFIG)
find_program(NODE_EXECUTABLE node REQUIRED)
set(AARCH64_SOURCE "${LLVM_SOURCE_ROOT}/lib/Target/AArch64")
set(AARCH64_GENERATED "${LLVM_BUILD_ROOT}/lib/Target/AArch64")
set(MINIMAL_MC "${CMAKE_CURRENT_BINARY_DIR}/AArch64DisassemblyMC.cpp")
add_custom_command(OUTPUT "${MINIMAL_MC}"
  COMMAND "${NODE_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/prepare-mc.mjs"
    "${AARCH64_SOURCE}/MCTargetDesc/AArch64MCTargetDesc.cpp"
    "${AARCH64_GENERATED}/AArch64GenSubtargetInfo.inc" "${MINIMAL_MC}"
  DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/../scripts/prepare-mc.mjs"
    "${AARCH64_SOURCE}/MCTargetDesc/AArch64MCTargetDesc.cpp"
    "${AARCH64_GENERATED}/AArch64GenSubtargetInfo.inc"
  VERBATIM)
add_executable(llvm-aarch64 bridge.cpp "${MINIMAL_MC}")
target_compile_features(llvm-aarch64 PRIVATE cxx_std_17)
target_include_directories(llvm-aarch64 PRIVATE ${LLVM_INCLUDE_DIRS})
target_include_directories(llvm-aarch64 PRIVATE
  "${AARCH64_SOURCE}" "${AARCH64_SOURCE}/MCTargetDesc" "${AARCH64_GENERATED}")
target_compile_definitions(llvm-aarch64 PRIVATE ${LLVM_DEFINITIONS})
llvm_map_components_to_libnames(LLVM_LIBS AArch64Disassembler AArch64Desc AArch64Info MCDisassembler MC Support)
target_link_libraries(llvm-aarch64 PRIVATE ${LLVM_LIBS})
target_compile_options(llvm-aarch64 PRIVATE -Oz -flto -fno-exceptions -fno-rtti)
target_link_options(llvm-aarch64 PRIVATE
  -Oz -flto --no-entry
  "-Wl,-Map=${CMAKE_BINARY_DIR}/llvm-aarch64.map"
  "-Wl,--why-extract=${CMAKE_BINARY_DIR}/archive-inputs.tsv"
  "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sENVIRONMENT=web,worker,node"
  "-sALLOW_MEMORY_GROWTH=1" "-sFILESYSTEM=0" "-sASSERTIONS=0"
  "-sSTACK_SIZE=1048576"
  "-sEXPORTED_FUNCTIONS=['_decode_full','_decode_metadata','_opcode_name']"
  "-sEXPORTED_RUNTIME_METHODS=['UTF8ToString','HEAPU8']")
set_target_properties(llvm-aarch64 PROPERTIES SUFFIX ".js")
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/linked-libraries.txt" CONTENT "${LLVM_LIBS}\n")
