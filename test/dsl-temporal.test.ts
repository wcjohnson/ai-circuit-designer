import test from 'node:test';
import assert from 'node:assert/strict';
import { runDslTests } from '../src/dsl.js';

test('legacy apply/assert accept optional signal keyword', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 2 -> "B"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  optional-signal:
    tick 0:
      apply "A" = 3 to pin SRC red continuously
    tick 2:
      assert "A" = 3 on pin SRC red
      assert "B" = 6 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests[0]?.passed, true);
});

test('tick window sometimes checks bounded latency without exact tick dependency', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  window-sometimes:
    tick 0:
      apply "A" = 7 to pin SRC red
      assert window [+0, +3]: sometimes "A" = 7 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  const assertions = result.tests[0]?.assertions ?? [];
  assert.ok(assertions.some((entry) => entry.description.includes('assert window')));
});

test('window never and always evaluate over full window', () => {
  const source = `
combinators:
  C: constant
    "A" = 5
  P: pole medium-electric-pole

wires:
  network N: red
    C -> P

tests:
  window-never-always:
    tick 0:
      assert window [0, 3]: always "A" = 5 on network N
      assert window [0, 3]: never "A" = 0 on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  assert.equal(result.tests[0]?.assertions.filter((a) => a.description.includes('assert window')).length, 2);
});

test('rising_edge can raise event and event block can assert a relative window', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  edge-event-window:
    tick 0:
      apply "A" = 4 to pin SRC red continuously
    rising_edge "A" > 0 on pin SRC red:
      raise event SEEN
    event SEEN:
      assert window [+0, +2]: sometimes "A" = 4 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('dynamic horizon extends when runtime-computable window appears', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  extend-horizon:
    tick 2:
      apply "A" = 1 to pin SRC red continuously
    rising_edge "A" > 0 on pin OUT red:
      assert window [+0, +5]: sometimes "A" = 1 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  const simulationTicks = result.tests[0]?.simulation.ticks.length ?? 0;
  assert.ok(simulationTicks >= 8, `expected dynamic horizon extension, got ${simulationTicks} ticks`);
});

test('apply/assert actions are rejected inside non-tick temporal blocks', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole

wires:
  network In: red
    SRC -> SRC

tests:
  invalid-non-tick-action:
    whenever "A" > 0 on pin SRC red:
      apply "A" = 1 to pin SRC red
`;

  assert.throws(
    () => runDslTests(source),
    /only 'raise event', 'assert window', 'assert at', and 'assert:' actions are allowed/
  );
});

test('assert: shorthand is equivalent to assert at +0: always', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  immediate-assert:
    tick 0:
      assert: "A" = 1 on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  const windowAssertions = (result.tests[0]?.assertions ?? []).filter((entry) => entry.description.includes('assert window'));
  assert.equal(windowAssertions.length, 1);
});

test('assert: supports exactly/nothing condition forms', () => {
  const source = `
combinators:
  P1: pole medium-electric-pole
  P2: pole medium-electric-pole

wires:
  network N: red
    P1 -> P2

tests:
  immediate-bag-assert:
    tick 0:
      assert: nothing on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('assert at +T shorthand works for relative single-tick temporal checks', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  at-relative:
    tick 0:
      apply "A" = 9 to pin SRC red
      assert at +1: always "A" = 9 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('assert at T shorthand works for absolute single-tick temporal checks', () => {
  const source = `
combinators:
  C: constant
    "A" = 5

wires:
  network N: red
    C -> C

tests:
  at-absolute:
    tick 0:
      assert at 0: always "A" = 5 on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('window assertions require explicit never/always/sometimes keyword', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  invalid-window-check:
    tick 0:
      assert window [0, 2]: "A" = 1 on network N
`;

  assert.throws(
    () => runDslTests(source),
    /unknown test action|unsupported signal token/
  );
});

test('event blocks run once per raised occurrence in the same tick', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  multi-event-occurrence:
    tick 0:
      raise event E
      raise event E
    event E:
      assert window [+0, +0]: always "A" = 1 on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  const windowAssertions = (result.tests[0]?.assertions ?? []).filter((entry) => entry.description.includes('assert window'));
  assert.equal(windowAssertions.length, 2);
});

test('rising_edge triggers only on false-to-true transition', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  rising-once:
    tick 0:
      apply "A" = 1 to pin SRC red continuously
    rising_edge "A" > 0 on pin OUT red:
      raise event HIT
    event HIT:
      assert window [+0, +0]: always "A" = 1 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
  const windowAssertions = (result.tests[0]?.assertions ?? []).filter((entry) => entry.description.includes('assert window'));
  assert.equal(windowAssertions.length, 1);
});

test('relative windows require signed offsets on both bounds', () => {
  const source = `
combinators:
  C: constant
    "A" = 1

wires:
  network N: red
    C -> C

tests:
  bad-relative-window:
    tick 0:
      assert window [0, +2]: sometimes "A" = 1 on network N
`;

  assert.throws(
    () => runDslTests(source),
    /relative windows require signed offsets on both bounds|window range must be either relative/
  );
});

test('runtime-computable long windows extend horizon and resolve at window end', () => {
  const source = `
combinators:
  SRC: io medium-electric-pole
  AMP: arithmetic
    "A" R * 1 -> "A"
  OUT: io medium-electric-pole

wires:
  network In: red
    SRC -> AMP in
  network Out: red
    AMP out -> OUT

tests:
  long-window-end-resolution:
    tick 0:
      apply "A" = 1 to pin SRC red continuously
    rising_edge "A" > 0 on pin OUT red:
      assert window [+0, +20]: sometimes "A" = 2 on pin OUT red
`;

  const result = runDslTests(source);
  assert.equal(result.passed, false);
  const testResult = result.tests[0];
  const noMatch = (testResult?.assertions ?? []).find((entry) => entry.description.includes('no match in window'));
  assert.ok(noMatch);
  const tickCount = testResult?.simulation.ticks.length ?? 0;
  assert.ok(tickCount >= 21, `expected extended horizon for long window, got ${tickCount} ticks`);
});

test('temporal conditions support exactly(...) bag equality', () => {
  const source = `
combinators:
  C: constant
    "A" = 1
    "B" = 2

wires:
  network N: red
    C -> C

tests:
  exact-temporal:
    rising_edge exactly("A" = 1, "B" = 2) on network N:
      raise event GOOD
    event GOOD:
      assert window [+0, +0]: always exactly("A" = 1, "B" = 2) on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});

test('temporal conditions support nothing alias for empty bag checks', () => {
  const source = `
combinators:
  P1: pole medium-electric-pole
  P2: pole medium-electric-pole

wires:
  network N: red
    P1 -> P2

tests:
  nothing-temporal:
    rising_edge nothing on network N:
      raise event EMPTY
    event EMPTY:
      assert window [+0, +0]: always nothing on network N
`;

  const result = runDslTests(source);
  assert.equal(result.passed, true);
});
