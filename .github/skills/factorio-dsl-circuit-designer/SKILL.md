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

Output includes:
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

2. Choose combinator strategy.
- Prefer the minimum possible total combinator count that satisfies behavior.
- Use `constant` for fixtures/default values.
- Use `arithmetic` for transforms and scaling.
- Use `decider` for branching/gating.
- Use `selector` only when operation semantics are required.
- Use `pole` only to route or join networks.

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
- Include timing tests that verify expected values at relevant ticks (including delayed-output behavior).
- Include at least one stability/hold test when behavior should persist over multiple ticks.
- Use `apply signal` for network stimuli.
- Use `set constant combinator ... signals:` for staged fixture changes.
- Assert at the correct tick accounting for N -> N+1 combinator output delay.
- Include output-pollution tests in all circuit designs: simulate unknown external signals applied on public/output-facing networks and verify internal state networks are not corrupted.

6a. Output back-propagation hardening workflow (required for every new circuit design).
- First, design and run output-pollution tests to determine whether external/public-wire back-propagation can corrupt internal state.
- Only if those tests indicate harmful pollution risk, add identity buffer combinators before public outputs.
- Identity buffer pattern: arithmetic combinator with `each + 0 -> each`.
- Place the identity buffer between internal-state/output-generation network and externally exposed output network.
- After adding the identity buffer, keep or extend the pollution tests so they explicitly prove internal-state isolation.

7. Self-audit before finalizing.
- Check IDs referenced by wires/tests exist.
- Check network names referenced by tests exist.
- Ensure every assertion is behavior-driven (not just structure-driven).
- Ensure the test suite would fail if core behavior is wrong.

8. Agent reasoning simulation loop (CLI tool).
- Use the CLI `simulate-dsl` command to compile + simulate quickly during design/debug iterations:
  - `node dist/src/cli.js simulate-dsl --dsl <path> --ticks <n> --pretty`
  - Add `--inputs <path>` when targeted external input injection is needed.
  - Add `--include-blueprint` when you need to inspect compiled entity/wire output while reasoning.
- Prefer `simulate-dsl` for rapid behavior checks before or alongside `test` assertions.

9. Persist artifacts with canonical paths.
- Write the design file to `circuits/<name>.circuit-dsl`.
- Compile so outputs land at `circuits/<name>.blueprint.json` and `circuits/<name>.blueprint.txt`.

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
  - Default assertions to first tick where outputs are observable.
  - Note timing assumption.
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
