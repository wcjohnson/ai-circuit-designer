DSL Spec (AI-Friendly)

This file describes the supported DSL consumed by the CLI `compile` and `test` commands.

Design goals:

- Easy for humans and agents to write and edit.
- Stable output for regression tests.
- Explicit errors for unsupported or malformed syntax.

Sections

The document has up to 4 top-level sections:

- `circuit: <name>`

- `combinators:`
- `wires:`
- `tests:`

Sections can appear in any order. Missing sections are allowed.

Circuit metadata section

Optional top-level declaration:

- `circuit: <circuit_name>`

Body keys:

- `description: <arbitrary text>`
- `imports: <space-separated circuit names>`

Rules:

- If `circuit:` is present, `<circuit_name>` must match the source filename stem before `.circuit-dsl` (or `.circuit_dsl`) or compilation fails.
- Imported circuits are loaded from files relative to the current DSL file.

Indentation and formatting

- Indentation is significant.
- Spaces and tabs are both accepted.
- Empty lines are ignored.
- Line comments are supported: text after `#` on a line is ignored.

Signals

Signal token forms:

- `"signal-A"` (quoted name)
- `signal-A` (unquoted name)
- `type:name` (explicit type), for example `item:iron-ore`
- `name@quality` or `type:name@quality`, for example `item:iron-ore@rare`

Special signal keywords:

- `each` -> `virtual/signal-each`
- `any` or `anything` -> `virtual/signal-anything`
- `every` or `everything` -> `virtual/signal-everything`

Wire selectors for signal reads:

- `R` (red only)
- `G` (green only)
- `RG` or omitted (both)

Combinators section

Each entry starts with:

- `<combinator-id>: <kind>`

Kinds:

- `constant`
- `arithmetic`
- `decider`
- `selector`
- `pole <entity-name>`
- `input <entity-name>`
- `output <entity-name>`
- `circuit <imported-circuit-name>`

`<combinator-id>` is a string key used by wires/tests. If it is a positive integer string (for example `1`), it is used as the entity number when possible.

Constant combinator

Body is signal assignments:

- `<signal> = <integer>`

These compile into one logistic section in `control_behavior.sections.sections[0].filters`.

Arithmetic combinator

Body is exactly one expression line:

- `<signal-read> <op> <signal-read|integer> -> <signal>`

`<signal-read>` is `<signal>` optionally followed by `R|G|RG`.

Supported operators:

- `+`, `-`, `*`, `/`, `%`, `^`, `<<`, `>>`, `AND`, `OR`, `XOR`

Decider combinator

Body contains subsections:

- `conditions:`
- `outputs:`

Condition lines:

- `[AND|OR] <signal-read> <comparator> <signal-read|integer>`

Comparators:

- `<`, `<=`, `>`, `>=`, `=`, `==`, `!=`, `≤`, `≥`, `≠`

Output lines:

- `<signal> = input [R|G|RG]`
- `<signal> = <integer>`

Selector combinator

Body is key-value settings:

- `<key>: <value>`

Supported keys:

- `operation`
- `select_max`
- `index_signal`
- `index_constant`
- `count_signal`
- `random_update_interval`
- `quality_filter`
- `select_quality_from_signal`
- `quality_source_static`
- `quality_source_signal`
- `quality_destination_signal`

Notes:

- `operation` is passed through as-is (lowercased) to blueprint control behavior.
- Unsupported operations may still compile; simulation support is separate.
- `quality_filter` accepts either a raw string or `<quality> <comparator> <anything>` form.

Pole

Declaration form:

- `<id>: pole <entity-name>`

Poles are wiring junctions only and do not produce/transform signals.

Input / Output

- `input` and `output` are pole-equivalent in blueprint shape.
- They mark interface points for other circuits.

Circuit combinator

Declaration form:

- `<id>: circuit <imported-circuit-name>`

Notes:

- Circuit combinators represent embedded imported circuits.
- They do not support a body.

Wires section

Wire networks are declared by header:

- `network <network-id>: <red|green>`

Then one or more edges:

- `<from-id> <in|out> -> <to-id> <in|out>`
- `<from-id> <in|out> -> <subcircuit-id> <input-or-output-id>`
- `<subcircuit-id> <input-or-output-id> -> <to-id> <in|out>`

Connector semantics:

- `constant` and `pole` use one shared connector (`in`/`out` are accepted and treated the same).
- `input` and `output` are one-connector (pole-equivalent).
- `arithmetic`, `decider`, `selector` are two-sided:
  - `in` -> connector 1
  - `out` -> connector 2

Tests section

Each test has a header:

- `<test-name>:`

Inside each test, define per-tick blocks:

- `tick <n>:`

Inside each tick block, supported actions:

- `apply signal <signal> = <integer> to network <network-id>`
- `assert signal <signal> = <integer> on network <network-id>`
- `assert signal <signal> = <integer> on input of <combinator-id>`
- `assert signal <signal> = <integer> on output of <combinator-id>`
- `set constant combinator <combinator-id> signals:` plus nested signal assignments

Test action semantics

- `apply signal`: injects an external input at that tick onto the named network's representative connector.
- `set constant combinator ... signals:`:
  - sets an override signal map for that constant combinator starting at that tick,
  - implemented by injecting per-tick deltas vs original blueprint constants.
- `assert ... on network`: checks the network signal value on that tick.
- `assert ... on input of`: checks the sum of matching input-connector signals across red+green networks.
- `assert ... on output of`: checks output-connector signal value without double-counting mirrored red/green broadcasts.

Compile behavior

`compile` parses DSL and emits:

- `blueprint` JSON
- optional `blueprintString` when requested
- `networks` metadata (for test network references)
- `entities` map from DSL combinator id to entity number
- parsed `tests`

Subcircuit embedding behavior:

- Imported DSLs are loaded recursively and inlined during compilation.
- Embedded circuit combinators become normal combinators in the compiled blueprint.
- Wires to `<subcircuit-id> <io-id>` resolve to imported `input`/`output` combinators.
- Simulation behaves as if imported combinators were authored inline in the root circuit.

Test behavior

`test` runs each DSL test independently:

- simulation ticks = `max(action.tick) + 1`
- pass/fail per assertion and per test
- returns simulation frames to support debugging

Errors and validation

- Unknown combinator/network references throw hard errors.
- Unknown action/section/parameter syntax throws hard errors.
- Duplicate combinator ids throw hard errors.
- Missing required nested bodies (for example empty `tick` block or empty wire network) throw hard errors.

Example

```
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
```
