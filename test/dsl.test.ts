import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDsl, runDslTests } from '../src/dsl.js';

const dslSource = `
combinators:
  1: constant
    "A" = 1
  A1: arithmetic
    "A" RG * 3 -> "B"
  Sel: selector
    operation: rocket-capacity

wires:
  network InputNet: red
    1 out -> A1 in
  network OutputNet: red
    A1 out -> Sel in

tests:
  apply-boost:
    tick 0:
      apply signal "A" = 2 to network InputNet
    tick 1:
      assert signal "B" = 9 on output of A1
  set-constant:
    tick 0:
      set constant combinator 1 signals:
        "A" = 4
    tick 1:
      assert signal "B" = 12 on output of A1
`;

test('compileDsl compiles blueprint and preserves selector operation for unsupported simulation modes', () => {
  const compiled = compileDsl(dslSource, { includeBlueprintString: true });

  assert.equal(compiled.blueprint.entities.length, 3);
  const selector = compiled.blueprint.entities.find((entity) => entity.name === 'selector-combinator');
  assert.ok(selector);
  assert.equal((selector?.control_behavior as { operation?: string } | undefined)?.operation, 'rocket-capacity');
  assert.match(compiled.blueprintString ?? '', /^0[A-Za-z0-9+/=]+$/);

  const inputNetwork = compiled.networks.find((network) => network.id === 'InputNet');
  assert.ok(inputNetwork);
  assert.equal(inputNetwork?.color, 'red');
});

test('runDslTests executes apply/assert and set-constant actions on scheduled ticks', () => {
  const result = runDslTests(dslSource);

  assert.equal(result.passed, true);
  assert.equal(result.tests.length, 2);
  assert.ok(result.tests.every((testCase) => testCase.passed));

  const applyTest = result.tests.find((testCase) => testCase.name === 'apply-boost');
  assert.ok(applyTest);
  assert.ok(applyTest?.assertions.every((assertion) => assertion.passed));

  const setConstantTest = result.tests.find((testCase) => testCase.name === 'set-constant');
  assert.ok(setConstantTest);
  assert.ok(setConstantTest?.assertions.every((assertion) => assertion.passed));
});

test('runDslTests supports continuously applied signals', () => {
  const source = `
combinators:
  P: pole medium-electric-pole
  C: arithmetic
    "A" RG * 1 -> "A"

wires:
  network In: red
    P -> C in

tests:
  continuous-apply:
    tick 0:
      apply signal "A" = 5 to network In continuously
    tick 3:
      assert signal "A" = 5 on output of C
    tick 4:
      apply signal "A" = 0 to network In continuously
    tick 6:
      assert signal "A" = 0 on output of C
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0]?.passed, true);
});

test('runDslTests supports apply/assert on named io poles', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 2 -> "B"
  SINK: io medium-electric-pole

wires:
  network InputNet: red
    SRC -> AMP in
  network OutputNet: red
    AMP out -> SINK

tests:
  io-targets:
    tick 0:
      apply signal "A" = 3 to pin SRC red continuously
    tick 2:
      assert signal "A" = 3 on pin SRC red
      assert signal "B" = 6 on pin SINK red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests.length, 1);
  assert.equal(result.tests[0]?.passed, true);
});

test('runDslTests requires explicit wire color on pin apply/assert actions', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 2 -> "B"
  SINK: io medium-electric-pole

wires:
  network InputNet: red
    SRC -> AMP in
  network OutputNet: red
    AMP out -> SINK

tests:
  missing-color:
    tick 0:
      apply signal "A" = 3 to pin SRC continuously
`;

  assert.throws(
    () => runDslTests(source),
    /unknown test action/
  );
});

test('runDslTests supports assert exactly(...) on network targets', () => {
  const source = `
combinators:
  C: constant
    "A" = 1
    "B" = 2
  P: pole medium-electric-pole

wires:
  network N: red
    C -> P

tests:
  exact-bag-network:
    tick 0:
      assert exactly("A" = 1, "B" = 2) on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests[0]?.passed, true);
});

test('assert exactly(...) fails when target contains extra non-zero signals', () => {
  const source = `
combinators:
  C: constant
    "A" = 1
    "B" = 2
  P: pole medium-electric-pole

wires:
  network N: red
    C -> P

tests:
  extra-signal:
    tick 0:
      assert exactly("A" = 1) on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, false);
  assert.equal(result.tests[0]?.passed, false);
  assert.equal(result.tests[0]?.assertions[0]?.passed, false);
});

test('assert exactly() supports empty expected bag', () => {
  const source = `
combinators:
  P1: pole medium-electric-pole
  P2: pole medium-electric-pole

wires:
  network N: red
    P1 -> P2

tests:
  empty-exact-bag:
    tick 0:
      assert exactly() on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests[0]?.passed, true);
});

test('assert nothing on <target> is an alias for assert exactly() on <target>', () => {
  const source = `
combinators:
  P1: pole medium-electric-pole
  P2: pole medium-electric-pole

wires:
  network N: red
    P1 -> P2

tests:
  empty-nothing:
    tick 0:
      assert nothing on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests[0]?.passed, true);
});

test('exactly(...) entries reject non-equality comparators', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  invalid-exact-comparator:
    tick 0:
      assert exactly("A" > 0) on network N
`;

  assert.throws(
    () => runDslTests(source),
    /exactly\(\.\.\.\) entries must use '=' only/
  );
});

test('exactly(...) entries reject duplicate signals', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  duplicate-exact-signal:
    tick 0:
      assert exactly("A" = 1, "A" = 1) on network N
`;

  assert.throws(
    () => runDslTests(source),
    /duplicate signal/
  );
});

test('compileDsl parses item(name[,quality]) signals', () => {
  const source = `
combinators:
  C1: constant
    item(iron-plate) = 2
    item(copper-plate,legendary) = 3
`;

  const compiled = compileDsl(source);
  const constant = compiled.blueprint.entities.find((entity) => entity.name === 'constant-combinator') as any;
  const filters = constant?.control_behavior?.sections?.sections?.[0]?.filters ?? [];

  assert.deepEqual(filters, [
    { index: 1, type: 'item', name: 'iron-plate', count: 2 },
    { index: 2, type: 'item', name: 'copper-plate', quality: 'legendary', count: 3 }
  ]);
});

test('compileDsl rejects unsupported virtual signal tokens', () => {
  const source = `
combinators:
  C1: constant
    signal-A = 1
`;

  assert.throws(
    () => compileDsl(source),
    /unsupported signal token 'signal-A'/
  );
});

test('compileDsl rejects unsupported virtual aliases longer than one character', () => {
  const source = `
combinators:
  C1: constant
    DI = 1
`;

  assert.throws(
    () => compileDsl(source),
    /unsupported signal token 'DI'/
  );
});

test('compileDsl ignores lines starting with // comments', () => {
  const source = `
// top level comment
combinators:
  // combinator comment
  C1: constant
    // signal comment
    "A" = 1

wires:
  // network comment
  network N1: red
    C1 -> C1

tests:
  // test comment
  comment-lines:
    tick 0:
      // action comment
      assert signal "A" = 1 on network N1
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('compileDsl does not treat # as a comment marker', () => {
  const source = `
# not-a-comment
combinators:
  C1: constant
    "A" = 1
`;

  assert.throws(
    () => compileDsl(source),
    /expected top-level section header/
  );
});

test('compileDsl rejects circuit.description metadata', () => {
  const source = `
circuit: demo
  description: old metadata field

combinators:
  C1: constant
    "A" = 1
`;

  assert.throws(
    () => compileDsl(source, { sourcePath: 'demo.circuit-dsl' }),
    /unsupported circuit metadata key 'description'/
  );
});

test('compileDsl rejects decider each-LHS with every/everything wildcard output', () => {
  const source = `
combinators:
  D1: decider
    conditions:
      each R > 0
    outputs:
      every = input R
`;

  assert.throws(
    () => compileDsl(source),
    /cannot use 'every'\/'everything' output wildcard/
  );
});

test('compileDsl inlines imported subcircuit endpoints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsl-subcircuit-'));
  try {
    const childPath = join(dir, 'child.circuit-dsl');
    const rootPath = join(dir, 'root.circuit-dsl');

    writeFileSync(childPath, `
circuit: child

combinators:
  IN: io medium-electric-pole
  OUT: io medium-electric-pole
  G: arithmetic
    "A" RG * 2 -> "B"

wires:
  network CIN: red
    IN -> G in
  network COUT: red
    G out -> OUT
`, 'utf8');

    writeFileSync(rootPath, `
circuit: root
  imports: child

combinators:
  SRC: constant
    "A" = 3
  SUB: circuit child
  SNK: arithmetic
    "B" RG * 1 -> "C"

wires:
  network N1: red
    SRC out -> SUB IN
  network N2: red
    SUB OUT -> SNK in

tests:
  embedded:
    tick 2:
      assert signal "C" = 6 on output of SNK
`, 'utf8');

    const source = `
circuit: root
  imports: child

combinators:
  SRC: constant
    "A" = 3
  SUB: circuit child
  SNK: arithmetic
    "B" RG * 1 -> "C"

wires:
  network N1: red
    SRC out -> SUB IN
  network N2: red
    SUB OUT -> SNK in

tests:
  embedded:
    tick 2:
      assert signal "C" = 6 on output of SNK
`;

    const compiled = compileDsl(source, { sourcePath: rootPath });
    assert.ok(compiled.entities['SUB::IN']);
    assert.ok(compiled.entities['SUB::OUT']);
    assert.ok(compiled.entities['SUB::G']);

    const testResult = runDslTests(source, { sourcePath: rootPath });
    assert.equal(testResult.passed, true);
    assert.equal(testResult.tests.length, 1);
    assert.equal(testResult.tests[0]?.passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileDsl enforces circuit name matching filename stem', () => {
  const source = `
circuit: different-name

combinators:
  P: pole medium-electric-pole
`;

  assert.throws(
    () => compileDsl(source, { sourcePath: join('circuits', 'expected-name.circuit-dsl') }),
    /must match filename stem/
  );
});

test('compileDsl fails when imported circuit is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsl-import-missing-'));
  try {
    const rootPath = join(dir, 'root.circuit-dsl');
    const source = `
circuit: root
  imports: child

combinators:
  SUB: circuit child
`;

    assert.throws(
      () => compileDsl(source, { sourcePath: rootPath }),
      /Imported circuit 'child' not found/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileDsl fails when subcircuit endpoint does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsl-endpoint-missing-'));
  try {
    const childPath = join(dir, 'child.circuit-dsl');
    const rootPath = join(dir, 'root.circuit-dsl');

    writeFileSync(childPath, `
circuit: child

combinators:
  IN: io medium-electric-pole
`, 'utf8');

    const source = `
circuit: root
  imports: child

combinators:
  SRC: constant
    "A" = 1
  SUB: circuit child

wires:
  network N1: red
    SRC out -> SUB MISSING
`;

    assert.throws(
      () => compileDsl(source, { sourcePath: rootPath }),
      /Unknown subcircuit endpoint 'MISSING'/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compileDsl requires explicit in/out on two-sided combinators', () => {
  const source = `
combinators:
  P: pole medium-electric-pole
  A: arithmetic
    "A" R * 1 -> "A"

wires:
  network N: red
    P -> A
`;

  assert.throws(
    () => compileDsl(source),
    /must specify 'in' or 'out'/
  );
});

test('compileDsl packs entities into 9x9 and pins io input/output columns', () => {
  const source = `
combinators:
  IN: io medium-electric-pole
  OUT: io medium-electric-pole
  A: arithmetic
    "A" R * 1 -> "A"

wires:
  network N1: red
    IN -> A in
  network N2: red
    A out -> OUT
`;

  const compiled = compileDsl(source);
  const entityById = new Map(Object.entries(compiled.entities));

  const inEntity = compiled.blueprint.entities.find((entity) => entity.entity_number === Number(entityById.get('IN')));
  const outEntity = compiled.blueprint.entities.find((entity) => entity.entity_number === Number(entityById.get('OUT')));
  assert.ok(inEntity);
  assert.ok(outEntity);
  assert.equal(inEntity?.position.x, 0.5);
  assert.equal(outEntity?.position.x, 8.5);

  for (const entity of compiled.blueprint.entities) {
    assert.ok(entity.position.x >= 0.5 && entity.position.x <= 8.5);
    assert.ok(entity.position.y >= 0.5 && entity.position.y <= 8.5);
  }
});

test('compileDsl sets player_description to DSL combinator id', () => {
  const source = `
combinators:
  IN: io medium-electric-pole
  OUT: io medium-electric-pole
  C1: constant
    "A" = 1
  A1: arithmetic
    "A" R + 1 -> "A"
  D1: decider
    conditions:
      "A" R > 0
    outputs:
      "A" = input R
  S1: selector
    operation: count
    count_signal: C

wires:
  network N1: red
    IN -> A1 in
    A1 out -> D1 in
    D1 out -> S1 in
    S1 out -> OUT
`;

  const compiled = compileDsl(source);
  const entityNumberById = new Map(Object.entries(compiled.entities).map(([id, number]) => [id, Number(number)]));

  for (const [id, entityNumber] of entityNumberById) {
    const entity = compiled.blueprint.entities.find((candidate) => candidate.entity_number === entityNumber);
    assert.ok(entity, `Expected compiled entity for combinator '${id}'.`);
    assert.equal((entity as { player_description?: string }).player_description, id);
  }
});

test('compileDsl warns when circuit cannot fit in 9x9 grid', () => {
  const arithmeticLines = Array.from({ length: 29 }, (_, index) => {
    const id = `A${index + 1}`;
    return `  ${id}: arithmetic\n    "A" R * 1 -> "A"`;
  }).join('\n');

  const source = `
combinators:
${arithmeticLines}
`;

  const warnings: string[] = [];
  const originalWarn = console.warn;
  let compiled: ReturnType<typeof compileDsl> | undefined;

  console.warn = (message?: unknown, ...rest: unknown[]) => {
    warnings.push([message, ...rest].map((part) => String(part)).join(' '));
  };

  try {
    compiled = compileDsl(source);
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(compiled);
  assert.ok(warnings.some((warning) => /Warning: circuit cannot fit into a 9x9 blueprint grid/.test(warning)));
  assert.ok(compiled.blueprint.entities.some((entity) => entity.position.y > 8.5));
});

