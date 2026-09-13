"""Extract resolved TableGen records. Never infer requirements from mnemonics.

The schema is pinned to LLVM; unknown predicate forms fail the build.
"""
import json
import pathlib
import sys


def generate(records):
    assert records['!tablegen_json_version'] == 1
    classes = records['!instanceof']
    feature_names = set(classes['SubtargetFeature'])

    def expression(node):
        if node['kind'] == 'def':
            name = node['def']
            assert name in feature_names, name
            # FeatureAll is an LLVM disassembler bypass, not a CPU requirement.
            return False if name == 'FeatureAll' else {'feature': name}
        assert node['kind'] == 'dag', node
        op = node['operator']['def']
        assert op in ('all_of', 'any_of', 'not'), node
        args = [expression(arg[0]) for arg in node['args']]
        if op == 'not':
            assert len(args) == 1
            return not args[0] if isinstance(args[0], bool) else {'not': args[0]}
        absorbing = op == 'any_of'
        if any(x is absorbing for x in args):
            return absorbing
        args = [x for x in args if x is not (not absorbing)]
        if not args:
            return not absorbing
        return args[0] if len(args) == 1 else {op: args}

    features = {}
    for name in sorted(feature_names - {'FeatureAll'}):
        record = records[name]
        features[name] = {
            'llvmName': record['Name'],
            'description': record['Desc'],
            # Keep grouped upstream labels verbatim; do not claim each applies.
            'armName': record.get('ArchFeatureName') or None,
            'implies': [x['def'] for x in record['Implies']],
        }
    requirements, indices, opcodes = [], {}, {}
    for name in sorted(classes['Instruction']):
        record = records[name]
        if record.get('Namespace') != 'AArch64' or record.get('isPseudo'):
            continue
        predicates, ignored = [], []
        for reference in record['Predicates']:
            pred = records[reference['def']]
            if pred['AssemblerMatcherPredicate']:
                predicates.append({'name': reference['def'],
                                   'expression': expression(pred['AssemblerCondDag'])})
            else:
                ignored.append(reference['def'])
        requirement = {'predicates': predicates, 'nonAssemblerPredicates': ignored}
        key = json.dumps(requirement, sort_keys=True)
        if key not in indices:
            indices[key] = len(requirements)
            requirements.append(requirement)
        opcodes[name] = indices[key]
    return {'features': features, 'requirements': requirements, 'opcodes': opcodes}


if __name__ == '__main__':
    result = generate(json.loads(pathlib.Path(sys.argv[1]).read_text()))
    output = pathlib.Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('// Generated from pinned LLVM TableGen; Apache-2.0 WITH LLVM-exception.\n'
                      'export default ' + json.dumps(result, separators=(',', ':'), sort_keys=True) + ';\n')
    print(f'Generated {len(result["opcodes"])} opcode entries, {len(result["requirements"])} predicate sets')
