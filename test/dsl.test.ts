import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileDsl, runDslTests } from '../src/dsl.js';

const dslSource = `
combinators:
  1: constant
    "signal-A" = 1
  A1: arithmetic
    "signal-A" RG * 3 -> "signal-B"
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
      apply signal "signal-A" = 2 to network InputNet
    tick 1:
      assert signal "signal-B" = 9 on output of A1
  set-constant:
    tick 0:
      set constant combinator 1 signals:
        "signal-A" = 4
    tick 1:
      assert signal "signal-B" = 12 on output of A1
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

test('compileDsl inlines imported subcircuit endpoints', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsl-subcircuit-'));
  try {
    const childPath = join(dir, 'child.circuit-dsl');
    const rootPath = join(dir, 'root.circuit-dsl');

    writeFileSync(childPath, `
circuit: child

combinators:
  IN: input medium-electric-pole
  OUT: output medium-electric-pole
  G: arithmetic
    "signal-A" RG * 2 -> "signal-B"

wires:
  network CIN: red
    IN out -> G in
  network COUT: red
    G out -> OUT in
`, 'utf8');

    writeFileSync(rootPath, `
circuit: root
  imports: child

combinators:
  SRC: constant
    "signal-A" = 3
  SUB: circuit child
  SNK: arithmetic
    "signal-B" RG * 1 -> "signal-C"

wires:
  network N1: red
    SRC out -> SUB IN
  network N2: red
    SUB OUT -> SNK in

tests:
  embedded:
    tick 2:
      assert signal "signal-C" = 6 on output of SNK
`, 'utf8');

    const source = `
circuit: root
  imports: child

combinators:
  SRC: constant
    "signal-A" = 3
  SUB: circuit child
  SNK: arithmetic
    "signal-B" RG * 1 -> "signal-C"

wires:
  network N1: red
    SRC out -> SUB IN
  network N2: red
    SUB OUT -> SNK in

tests:
  embedded:
    tick 2:
      assert signal "signal-C" = 6 on output of SNK
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
  IN: input medium-electric-pole
`, 'utf8');

    const source = `
circuit: root
  imports: child

combinators:
  SRC: constant
    "signal-A" = 1
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
