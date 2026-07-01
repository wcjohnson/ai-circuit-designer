# DSL Spec

This file describes a DSL for Factorio circuits.

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

Sections can appear in any order and can be omitted if they have no content.

Circuit metadata section

Optional top-level declaration:

- `circuit: <circuit_name>`

Body keys:

- `imports: <space-separated circuit names>` (optional)

Rules:

- If `circuit:` is present, `<circuit_name>` must match the source filename stem before `.circuit-dsl` (or `.circuit_dsl`) or compilation fails.
- Imported circuits are loaded from files relative to the current DSL file.
- If there are no imports, omit `imports:`.
- Channel/interface notes should be placed in a top-of-file `//` multi-line comment block for agent readability.

Indentation and formatting

- Indentation is significant.
- Spaces and tabs are both accepted.
- Empty lines are ignored.
- Comment lines are supported when the first non-whitespace characters are `//`.

Signals

Signal token forms:

- Virtual shorthand: `A` through `Z`, and `0` through `9`
  - Example: `A` compiles to Factorio virtual signal `signal-A`
  - Example: `7` compiles to Factorio virtual signal `signal-7`
- Item signal: `item(<item-name>)` or `item(<item-name>,<quality>)`
  - Example: `item(iron-plate)`
  - Example: `item(iron-plate,legendary)`
  - `normal` quality is implicit and omitted in compiled output

Unsupported signal forms now fail compilation (for example `signal-A`, `type:name`, or `name@quality`).

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
- `else_outputs:` (optional)

Condition lines:

- `[AND|OR] <signal-read> <comparator> <signal-read|integer>`

Comparators:

- `<`, `<=`, `>`, `>=`, `=`, `==`, `!=`, `≤`, `≥`, `≠`

Output lines:

- `<signal> = input [R|G|RG]`
- `<signal> = <integer>`

`outputs:` are emitted when decider conditions evaluate true.

`else_outputs:` lines use the same syntax and are emitted when decider conditions evaluate false.

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

- `apply [signal] <signal> = <integer> to network <network-id>`
- `apply [signal] <signal> = <integer> to network <network-id> continuously`
- `apply [signal] <signal> = <integer> to pin <combinator-id> <red|green>`
- `apply [signal] <signal> = <integer> to pin <combinator-id> <red|green> continuously`
- `assert [signal] <signal> = <integer> on network <network-id>`
- `assert [signal] <signal> = <integer> on pin <combinator-id> <red|green>`
- `assert [signal] <signal> = <integer> on input of <combinator-id>`
- `assert [signal] <signal> = <integer> on output of <combinator-id>`
- `assert exactly(<signal> = <integer>[, <signal> = <integer> ...]) on network <network-id>`
- `assert exactly(<signal> = <integer>[, <signal> = <integer> ...]) on pin <combinator-id> <red|green>`
- `assert exactly(<signal> = <integer>[, <signal> = <integer> ...]) on input of <combinator-id>`
- `assert exactly(<signal> = <integer>[, <signal> = <integer> ...]) on output of <combinator-id>`
- `assert nothing on network <network-id>`
- `assert nothing on pin <combinator-id> <red|green>`
- `assert nothing on input of <combinator-id>`
- `assert nothing on output of <combinator-id>`
- `set constant combinator <combinator-id> signals:` plus nested signal assignments

`[signal]` means the literal keyword `signal` is optional for compatibility.

Test action semantics

- `apply [signal]`: injects an external input at that tick onto the named network's representative connector.
- `apply [signal] ... to pin <id> <red|green>`: resolves the named pin endpoint on that wire color to its attached network and injects exactly as a network-targeted apply would.
- `apply [signal] ... continuously`: starts or updates a continuous injected value from that tick onward.
  - continuous values are applied every tick until overridden by another continuous assignment for the same `<network-id>` + `<signal>`.
  - assigning `0` continuously stops the continuous injection for that `<network-id>` + `<signal>`.
- `assert [signal] ... on pin <id> <red|green>`: resolves the named pin endpoint on that wire color to its attached network and checks the network signal value.
- `assert exactly(...) on <target>`: checks full signal-bag equality for that target.
  - `assert nothing on <target>` is an alias for `assert exactly() on <target>` and is the preferred empty-bag form for readability.
  - comparison is bag-wide, not single-signal.
  - only `=` is allowed inside `exactly(...)` entries.
  - signal order in `exactly(...)` is not significant.
  - each signal may appear at most once in an `exactly(...)` list.
  - any additional non-zero signal on the target that is not listed causes failure.
  - omitting a signal means it is expected to be absent/zero on that target.
- `set constant combinator ... signals:`:
  - sets an override signal map for that constant combinator starting at that tick,
  - implemented by injecting per-tick deltas vs original blueprint constants.
- `assert ... on network`: checks the network signal value on that tick.
- `assert ... on input of`: checks the sum of matching input-connector signals across red+green networks.
- `assert ... on output of`: checks output-connector signal value without double-counting mirrored red/green broadcasts.

Temporal test semantics (non-breaking)

Existing `tests:` syntax and behavior remain unchanged. The forms below are additive.

Goals:

- Validate correctness and latency without binding tests to exact tick numbers.
- Allow circuit refactors that shift internal pipeline timing as long as bounded latency and behavior contracts are preserved.
- Keep deterministic evaluation and machine-readable failures.

Non-breaking rule:

- Existing `tick <n>:` blocks and all existing actions/assertions continue to parse and run exactly as before.
- New syntax forms below are additive.

Extended test block headers

Inside a test, in addition to `tick <n>:` blocks, the following block headers are allowed in the same position:

- `whenever <condition>:`
- `rising_edge <condition>:`
- `event <event-name>:`

`<condition>` forms:

- Scalar comparison: `<signal> <comparator> <integer> on <target>`
- Bag equality: `exactly(<signal> = <integer>[, <signal> = <integer> ...]) on <target>`
- Empty bag alias: `nothing on <target>` (equivalent to `exactly() on <target>`, preferred)

`<target>` forms:

- `network <network-id>`
- `pin <combinator-id> <red|green>`
- `input of <combinator-id>`
- `output of <combinator-id>`

Header semantics:

- `whenever <condition>:` level-triggered. The block is evaluated on each tick where the condition is true.
- `rising_edge <condition>:` rising-edge triggered. The block is evaluated only on ticks where condition transitions false->true.
- `event <event-name>:` event-triggered. The block is evaluated once for each occurrence of `<event-name>`.

Event statement

Inside any test block (`tick`, `whenever`, `rising_edge`, or `event`), allow:

- `raise event <event-name>`

Event semantics:

- Events are scoped to a single test and do not leak across tests.
- Each `raise event` creates one event occurrence at the current tick.
- Multiple raises of the same event in one tick create multiple occurrences.

Window assertions

New assertion form:

- `assert window [<start>, <end>]: <window-check>`
- `assert at <tick-or-offset>: <window-check>`
- `assert: <condition>`

Shorthand semantics:

- `assert at +T: <window-check>` is shorthand for `assert window [+T, +T]: <window-check>`.
- `assert at T: <window-check>` is shorthand for `assert window [T, T]: <window-check>`.
- Relative `assert at` uses signed offsets (`+n`/`-n`); absolute `assert at` uses plain integers.
- `assert: <condition>` is shorthand for `assert at +0: always <condition>`.

Window range forms:

- Relative window: `assert window [+0, +8]: ...`
- Absolute window: `assert window [0, 8]: ...`
- Relative single-tick shorthand: `assert at +3: ...`
- Absolute single-tick shorthand: `assert at 12: ...`
- Immediate single-tick shorthand: `assert: ...` (current block-anchor tick)

Range semantics:

- Bounds are inclusive.
- `<start>` and `<end>` are integers.
- Relative ranges require signed offsets (`+n` or `-n`) and are interpreted relative to the current block-anchor tick.
- Absolute ranges are global simulation ticks.
- `<start>` must be `<= <end>` after resolving relative offsets.

Window checks

After `assert window [..]:` or `assert at ..:`, supported checks are:

- `never <condition>`
- `always <condition>`
- `sometimes <condition>`

Condition form in temporal checks:

- Use the same `<condition>` forms listed above and allow signal shorthands.
- Omit the literal word `signal` in scalar comparisons.
- Examples:
  - `"A" = 7 on pin OUT red`
  - `"X" = 0 on network LatchOut`
  - `"A" > 0 on pin IN red`
  - `exactly("A" = 7, "B" = 2) on pin OUT red`
  - `nothing on pin OUT red`

Block-anchor tick rules (for relative windows)

- In `tick <n>:` blocks, anchor tick = `n`.
- In `whenever <condition>:` blocks, anchor tick = current tick where condition evaluated true.
- In `rising_edge <condition>:` blocks, anchor tick = rising-edge tick.
- In `event <event-name>:` blocks, anchor tick = event occurrence tick.

Evaluation model

- `never`: passes if condition is false for every tick in window.
- `always`: passes if condition is true for every tick in window.
- `sometimes`: passes if condition is true for at least one tick in window.

Failure timing:

- `never` and `always` may fail as soon as a violating tick is observed.
- `sometimes` fails only after the window end is reached without a match.

Interaction with simulation horizon:

- If a resolved window extends beyond simulated final tick, evaluate assertion status on observed ticks.
- If status is already decidable as pass before horizon end, pass the assertion.
- If status is already decidable as fail before horizon end, fail the assertion.
- If status is undecidable because the missing tail could change the outcome, fail with a horizon-ambiguity error.

Decidability guidance:

- `sometimes`: pass early once a matching tick is seen; if no match observed before truncation, horizon-ambiguity fail.
- `never`: fail early on first violation; pass only when entire window is observed.
- `always`: fail early on first violation; pass only when entire window is observed.

Deterministic ordering

For each simulation tick, process test logic in this order:

1. Evaluate and execute matching `tick <n>:` blocks for this tick.
2. Evaluate and execute matching `rising_edge <condition>:` blocks for this tick.
3. Evaluate and execute matching `whenever <condition>:` blocks for this tick.
4. Dispatch `event <event-name>:` blocks for events raised during steps 1-3 of the same tick, in raise order.

This ordering ensures deterministic behavior and reproducible event-relative windows.

Validation rules (new)

- `assert window` must have exactly one range and one window-check.
- `assert at` must have exactly one tick-or-offset and one window-check.
- `assert:` must have exactly one `<condition>` and implies `always` at relative offset `+0`.
- Relative ranges must use signed offsets on both bounds.
- Relative `assert at` offsets must be signed (`+n` or `-n`).
- `event <event-name>` and `raise event <event-name>` require non-empty event names matching identifier token rules used for test names.
- Scalar `rising_edge`/`whenever` conditions use the same comparator set as decider conditions (`<`, `<=`, `>`, `>=`, `=`, `==`, `!=`, `≤`, `≥`, `≠`).
- In `exactly(...)`:
  - entries must use `=` only (no `<`, `<=`, `>`, `>=`, `!=`, `==`, `≤`, `≥`, `≠`).
  - each listed signal must be unique.
  - empty lists are allowed and mean the target bag must be empty.
- `nothing on <target>` is valid wherever `exactly() on <target>` is valid and is preferred in new tests/specs.

Examples

Bounded latency without exact arrival tick:

```
tests:
  bounded-latency:
    rising_edge "A" > 0 on pin IN red:
      assert window [+0, +5]: sometimes "A" = 7 on pin OUT red
```

Single-tick shorthand assertion:

```
tests:
  single-tick-check:
    tick 0:
      apply signal "A" = 1 to pin IN red
      assert at +1: always "A" = 1 on pin MID red
      assert at 3: always "A" = 1 on pin OUT red
      assert: "A" = 1 on pin IN red
```

No-flicker contract around a custom event:

```
tests:
  no-flicker:
    rising_edge "A" > 0 on pin IN red:
      raise event MY_EVENT

    event MY_EVENT:
      assert window [+0, +8]: never "X" = 1 on pin OUT red
      assert window [+0, +5]: sometimes "A" = 7 on pin OUT red
```

Absolute global window assertion:

```
tests:
  absolute-window:
    tick 0:
      apply signal "A" = 1 to pin IN red continuously
    tick 1:
      assert window [0, 8]: always "A" >= 0 on pin OUT red
```

Exact bag equality assertion:

```
tests:
  exact-output:
    tick 2:
      assert exactly("A" = 1, "B" = 2) on output of SUM
```

Empty bag assertion (preferred spelling):

```
tests:
  exact-empty-output:
    tick 2:
      assert nothing on output of SUM
```

Compile behavior

`compile` parses DSL and emits:

- `blueprint` JSON
- optional `blueprintString` when requested
- `networks` metadata (for test network references)
- `entities` map from DSL combinator id to entity number
- parsed `tests`

Blueprint layout behavior:

- Entities are packed into a 9x9 tile grid.
- Positions use Factorio entity centers.
  - 1x1 entities (for example poles, io, constants): tile `(col,row)` center is `(col-0.5,row-0.5)`.
  - 1x2 combinators (arithmetic/decider/selector): top tile row `row` center is `(col-0.5,row)`.
- Named `io` pins inferred as input-only are placed in column 1.
- Named `io` pins inferred as output-only are placed in column 9.
- If a circuit cannot fit in the 9x9 packing constraints, compilation emits a warning and no blueprint output should be produced.

Subcircuit embedding behavior:

- Imported DSLs are loaded recursively and inlined during compilation.
- Embedded circuit combinators become normal combinators in the compiled blueprint.
- Wires to `<subcircuit-id> <io-id>` resolve to imported `input`/`output` combinators.
- Simulation behaves as if imported combinators were authored inline in the root circuit.

Test behavior

`test` runs each DSL test independently:

- simulation ticks are computed from required evaluation horizon and may grow during execution:
  - initial base horizon = `max(action.tick) + 1` (legacy behavior)
  - include any temporal windows whose endpoints are computable before simulation starts
  - during each simulation step, if any unresolved temporal window becomes computable, automatically extend horizon to include that window end tick + 1
  - if a simulation step is reached where every unresolved temporal window is currently incomputable, terminate simulation at that step and evaluate unresolved temporal assertions using the horizon-ambiguity rules from the temporal section
- pass/fail per assertion and per test
- returns simulation frames to support debugging

Temporal horizon computability:

- A temporal window endpoint is computable when its anchor tick is statically known from the test structure.
- `tick <n>:` anchors are statically known.
- `event <name>:` anchors are statically known only when every event occurrence that can trigger the block is produced from statically known anchors (for example, `tick` blocks or other statically anchored events).
- `whenever <condition>:` and `rising_edge <condition>:` anchors are generally runtime-dependent and not statically computable.
- Runtime-dependent anchors may become computable at runtime when the triggering tick is observed.
- When such a runtime anchor becomes computable, resolve its window endpoint immediately and extend horizon as described above.
- If runtime anchors remain unresolved and no further windows are computable, stop simulation and apply the existing horizon-ambiguity rule from the temporal section.

Errors and validation

- Unknown combinator/network references throw hard errors.
- Unknown action/section/parameter syntax throws hard errors.
- Duplicate combinator ids throw hard errors.
- Missing required nested bodies (for example empty `tick` block or empty wire network) throw hard errors.

Example

```
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
      apply "A" = 2 to network InputNet
    tick 1:
      assert "B" = 9 on output of A1
  set-constant:
    tick 0:
      set constant combinator 1 signals:
        "A" = 4
    tick 1:
      assert "B" = 12 on output of A1
```
