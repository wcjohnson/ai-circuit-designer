---
name: factorio-dsl-circuit-designer
description: 'Generate Factorio circuit DSL from natural-language behavior specs. Use when asked to turn a circuit idea into combinators, wires, and correctness-focused unit tests in the project DSL.'
argument-hint: 'Describe what the circuit should do and constraints/edge cases to verify'
user-invocable: true
---

# Factorio DSL Circuit Designer

Generate a complete DSL circuit design from a human behavior description.

File and output conventions:
- Store all circuit designs under `circuits/`.
- Circuit DSL extension is `.circuit-dsl`.
- For `circuits/X.circuit-dsl`, compiled outputs are `circuits/X.blueprint.json` and `circuits/X.blueprint.txt`.
- Whenever an existing `circuits/X.circuit-dsl` file is changed, recompile and update both `circuits/X.blueprint.json` and `circuits/X.blueprint.txt` in the same change.

Output includes:
- `circuit: <name>` section with metadata
- `combinators:` section
- `wires:` section
- `tests:` section with meaningful assertions

Primary reference: [DSL specification](../../../DSL.md)

## When To Use

Use this skill when a user asks for any of the following:
- "Design a Factorio circuit that..."
- "Write DSL for this circuit behavior"
- "Generate circuit tests for this logic"
- "Turn this spec into combinators and wires"
- "Update this circuit design with change X"

Do not use for simulator internals or schema migration tasks unless the request is explicitly to produce DSL text.

## Inputs To Collect

From the user request, extract:
- Intended behavior and target output signals
- Input signals and expected ranges
- Stateful behavior requirements (if any)
- Tick expectations (for delayed combinator outputs)
- Constraints (entity count, allowed combinator types, required ops)

If missing, infer conservative defaults and state assumptions explicitly.

Assumption policy:
- Mention assumptions only when they could realistically change circuit behavior or test outcomes.
- Do not include low-impact or obvious assumptions.

## Procedure

1. Translate behavior into a signal contract.
- Define input signals and output signals.
- Write expected behavior in short, testable statements.

1a. Define embeddable circuit metadata.
- Always include `circuit: <name>` where `<name>` matches the target filename stem.
- Add a brief top-of-file `//` function summary (1-2 lines) describing what the circuit does.
- Add a top-of-file `//` multi-line comment block with agent-friendly channel semantics for every interface combinator.
- For interface combinators, describe each channel by ID and role in one compact sentence, for example:
  - `// Channels: SIG_IN (input): ...; RESET_IN (input): ...; OUT (output): ...`
- Measure per-input-pin latency (ticks from input application to intended output effect) using DSL tests or probe runs, and record those latency values in the `Channels:` comment.
- Keep the `Channels:` latency information updated whenever circuit logic changes.
- Include `imports:` only when one or more imported subcircuits are actually used; otherwise omit `imports:`.

2. Choose combinator strategy.
- Prefer the minimum possible total combinator count that satisfies behavior.
- Use `constant` for fixtures/default values.
- Use `arithmetic` for transforms and scaling.
- Use `decider` for branching/gating.
- Use `selector` only when operation semantics are required.
- Use `pole` only to route or join networks.
- Prefer `input` and `output` combinator kinds for externally exposed circuit interfaces.

3. Assign stable IDs and layout intent.
- Use deterministic IDs (`1`, `2`, `A1`, `D1`, etc.).
- Keep IDs readable and consistent with role.

4. Build `combinators:` section.
- Emit syntactically valid entries per [DSL specification](../../../DSL.md).
- Keep expressions explicit about wire selectors (`R`, `G`, `RG`) where needed.

5. Build `wires:` section.
- Define named networks by color.
- Connect only needed ports.
- Keep wiring minimal and unambiguous.

6. Build `tests:` section.
- Generate a broad correctness-focused test set, not only a happy path.
- Include edge/boundary tests when behavior has thresholds or indexing.
- Prefer temporal assertions (`assert window`, `whenever`, `rising_edge`, `event`) for behavior and latency checks.
- Encode latency as a contract window, not a single fragile tick:
  - earliest-arrival guard: `assert window [+0, +(min-1)]: never <condition>` when `min > 0`
  - latest-arrival guard: `assert window [+min, +max]: sometimes <condition>`
  - hold/stability guard: `assert window [+start, +end]: always <condition>`
- For single-tick temporal checks, prefer `assert at +T:` (or `assert at T:` for absolute) instead of `assert window [T, T]:`.
- For immediate anchor-tick checks (`+0` with `always`), prefer `assert: <condition>` for readability.
- Use exact bag checks (`exactly(...)`) when the full network/connector contents are part of the contract (for example no extra leaked signals).
- For empty-bag checks, prefer `nothing on <target>` over `exactly() on <target>` for readability.
- Keep one or two precise single-tick checks only where the timing itself is an external contract.
- Include at least one stability/hold test when behavior should persist over multiple ticks.
- For known upticking/internal counters that can run for long periods, include a practical overflow check (seed near max or force a near-wrap state) and prevent wrap-induced regressions (for example false timeout clears).
- Apply overflow hardening where growth is structurally expected (timers/counters), but do not add blanket overflow checks to every unrelated input path.
- Use `apply signal` for network stimuli.
- Use `set constant combinator ... signals:` for staged fixture changes.
- Account for N -> N+1 combinator output delay when selecting temporal window bounds.
- Include output-pollution tests in all circuit designs: simulate unknown external signals applied on public/output-facing networks and verify internal state networks are not corrupted.

6a. Signal back-propagation hardening workflow (required for every new circuit design).
- Design and run input- and output-pollution tests to determine if there is harmful cross-talk between public I/O wires and internal state.
- Only if those tests indicate harmful pollution risk, add identity buffer combinators before the impacted public inputs and outputs.
- Identity buffer pattern: arithmetic combinator with `each + 0 -> each`.
- Naming convention: name pollution-prevention identity buffers with `_CLEAN` suffix (for example `OUT_CLEAN`)
- Place the identity buffer between the internal-state network and the externally exposed output pin.
- After adding the identity buffer, keep or extend the pollution tests so they explicitly prove internal-state isolation.

7. Self-audit before finalizing.
- Check IDs referenced by wires/tests exist.
- Check network names referenced by tests exist.
- Ensure every assertion is behavior-driven (not just structure-driven).
- Ensure the test suite would fail if core behavior is wrong.

8. Agent reasoning simulation loop (CLI tool).
- Use the CLI `probe-dsl` command first for compact agent-oriented compile + simulate iterations:
  - `node dist/src/cli.js probe-dsl --dsl <path> --ticks <n>`
  - Add `--inputs <path>` when targeted external input injection is needed.
  - Add `--include-blueprint` when you need to inspect compiled entity/wire output while reasoning.
- Use the CLI `measure-latency` command for channel latency measurement and updates in `Channels:` comments:
  - `node dist/src/cli.js measure-latency --dsl <path> --input-pin <id> --input-wire <red|green> --output-pin <id> --output-wire <red|green> --input-signal-key <signal-key> --watch-signal-key <signal-key> --value <n> --tick <t> --ticks <n>`
  - Use `--pulse` for one-tick stimuli and `--baseline-inputs <path>` for required gating/default inputs.
  - Use `--expected <n>` when latency should be measured to a specific output value rather than first change.
- Use `node dist/src/cli.js simulate-dsl ... --pretty` only when expanded human-readable output is needed.

9. Persist artifacts with canonical paths.
- Write the design file to `circuits/<name>.circuit-dsl`.
- Compile so outputs land at `circuits/<name>.blueprint.json` and `circuits/<name>.blueprint.txt`.
- Prefer `node dist/src/cli.js emit-dsl --dsl <path>` for compact agent-oriented compile output that includes a blueprint string.
- For edits to an existing circuit DSL, treat recompiling and committing refreshed blueprint artifacts as required, not optional.

## Decision Rules

- If behavior is pure arithmetic with no branch: prefer one arithmetic combinator.
- If behavior depends on thresholds/comparators: include decider.
- Decider output semantics:
  - Use `every = input [R|G|RG]` when the intent is to forward all incoming signals from a selected wire set.
  - Do not use `each = input ...` unless the decider condition semantics are explicitly each-based on the LHS.
- If ranking/indexing/counting/filtering/quality behavior is requested: selector.
- For circuits with internal state or feedback that may connect to unknown external circuitry:
  - Always include output-pollution tests.
  - Add identity output buffers only when those tests indicate harmful pollution risk.
- If request is ambiguous about tick timing:
  - Default to bounded temporal windows around first observable output, not exact-tick-only assertions.
  - Note timing assumption.

## Temporal Testing Guidance

- Temporal tests should preserve externally visible semantics while allowing internal rewiring/refactoring.
- Prefer asserting on public channels (`input`/`output`/public networks) and contract state, not incidental intermediate nets unless those nets are part of the declared contract.
- For latches/stateful circuits, include all of:
  - capture/open behavior
  - hold behavior while gate/control is inactive
  - re-open/re-latch behavior
  - pollution isolation (public/output injection does not corrupt internal state)
- For bag-shaped outputs, prefer `exactly(...)` over a list of scalar `assert signal` checks to prevent unintentional extra signals from passing.
- For empty bag expectations in temporal tests, prefer `nothing on <target>`.
- For single-tick bag checks, combine readability forms: `assert at +T: always nothing on <target>` or `assert at +T: always exactly(...) on <target>`.
- For immediate bag checks at anchor tick, prefer `assert: nothing on <target>` or `assert: exactly(...) on <target>`.
- If user asks for unsupported simulator selector operations:
  - Do not generate unsupported selector operations.
  - Choose an alternative supported design using arithmetic/decider/constant/pole (or supported selector ops only).

## Output Format

Return exactly:
1. Brief assumptions list (only if needed)
2. Complete DSL in one fenced block
3. Short test coverage summary (what each test validates)

Prefer concise, executable DSL over prose.

## Quality Checklist

A result is complete only if all are true:
- DSL has `combinators`, `wires`, and `tests` sections.
- No unresolved IDs or networks.
- Tick timing is consistent with simulator semantics.
- Tests cover core behavior, timing behavior, and at least one non-trivial edge case.
- Signal names/types are consistent end-to-end.
- Combinator count is minimal for the requested behavior.

## Semantics Notes

Use these verified simulator semantics to avoid re-researching common behavior:

- Tick model:
  - Constants publish on tick N.
  - Arithmetic, decider, and selector read tick N inputs and publish on tick N+1.
  - Combinator outputs are broadcast identically to both red and green output connectors.

- Constant combinator:
  - Emits its configured non-zero signals every tick while enabled.
  - Behaves as a source only; no input-side logic.

- Arithmetic combinator:
  - Computes one expression from selected input networks (R, G, or both).
  - Uses per-signal iteration when either operand uses each or output is each; iteration key set is the union of operand signal keys.
  - When output is a single signal (not each) but evaluation is in each mode, it applies the operation per signal and sums those per-signal results into the one output signal.
  - Otherwise computes one scalar result for one output signal.

- Decider combinator:
  - If the first condition operand is each, decider runs in each mode (per-signal evaluation).
  - In each mode, conditions run over the union of first/second selected-network signal keys; mixed non-each conditions act as per-iteration gates.
  - In non-each mode, condition is evaluated once (global pass/fail).
  - In each mode: wildcard output everything/every is illegal; wildcard outputs are each (emit per matching signal) or anything/any (emit once for first matching signal).
  - In non-each mode, the use of "every = input" will forward all signals from selected networks.
  - If non-each mode, the "each" wildcard is illegal on the RHS.

- Special signal modes (applies to arithmetic/decider expressions):
  - each: per-signal mode.
  - any or anything: condition passes if at least one signal satisfies comparator.
  - every or everything: condition passes only if all present signals satisfy comparator, and fails on empty input.
  - all concept in this DSL maps to every/everything semantics.

- Integer math and overflow:
  - Signal values are int32; network merges and arithmetic are int32-wrapped.
  - +, -, * use 32-bit wraparound.
  - / and % return 0 on divide-by-zero; division truncates toward zero.
  - ^ returns 0 for negative exponent; exponent is capped to 31.
  - Bit shifts mask shift amount with 31; bitwise ops are 32-bit signed.

- Selector combinator modes:
  - select: sorts non-zero candidate signals by value (descending when select_max=true, ascending when false), excludes index signal from candidates, and emits exactly one selected signal by zero-based index.
  - count: outputs configured count_signal with the number of non-zero input signals.
  - quality-filter: passes through signals matching quality_filter condition (or passes all if filter is unset).
  - quality-transfer: chooses a quality (from source signal or static source) and emits destination signal tagged with that quality; value is summed from matching source name+quality (or 1 when no source signal is configured).
  - Unsupported selector operations compile but simulator emits no output for them.

- Output pollution hardening:
  - If internal state is directly exposed on public output wires, add an identity buffer (each + 0 -> each) before OUT and keep pollution tests.
