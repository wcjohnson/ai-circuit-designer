import { test } from 'node:test';
import assert from 'node:assert/strict';
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
