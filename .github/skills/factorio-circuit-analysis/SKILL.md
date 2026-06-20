---
name: factorio-circuit-analysis
description: 'Analyze how a Factorio circuit behaves by reading circuit DSL or blueprint input and validating behavior with simulator probes.'
argument-hint: 'Describe the circuit input (DSL path/text or blueprint path/string) and what behavior question to answer'
user-invocable: true
---

# Factorio Circuit Analysis

Analyze existing circuits and answer behavior questions using evidence from the simulator.

Primary reference: [DSL specification](../../../DSL.md)

## When To Use

Use this skill when the user asks for analysis or explanation of circuit behavior, for example:
- "How does this circuit work?"
- "What happens if signal X is held high?"
- "Why is this output delayed by one tick?"
- "Can this combinator be removed safely?"
- "Explain this blueprint string"

Do not use this skill to author new circuits from scratch unless the request is primarily behavior analysis.

## Accepted Inputs

Accept any of the following:
- A circuit DSL file path under `circuits/`
- Inline DSL text
- A blueprint JSON file path
- A compressed blueprint string

If the user provides only a high-level question and no artifact, locate likely target files first and confirm assumptions in the answer.

## Core Workflow

1. Identify the artifact to analyze.
- Prefer the exact file/string provided by the user.
- For DSL files, inspect `combinators:`, `wires:`, `tests:` and channel comments.

2. Build a signal-flow hypothesis.
- Trace major data paths, state loops, and gating logic.
- Note expected timing under N -> N+1 combinator semantics.

3. Probe with simulator evidence.
- For DSL: use `simulate-dsl`.
- For blueprint JSON/string: use `simulate`.
- Run targeted scenarios that directly test the user's question.
- Use `--json --pretty` when you need exact per-tick values.

4. Validate or falsify hypothesis.
- Compare expected and observed tick behavior.
- If mismatch appears, refine and re-run probe.

5. Answer the question directly.
- Lead with the behavior conclusion.
- Support with concise evidence: key signals, key ticks, and path-level explanation.
- Mention uncertainty only when unavoidable.

## Probe Patterns

Use these patterns frequently:
- Hold test: keep one signal continuously applied to detect level vs edge behavior.
- Pulse test: apply on a single tick to reveal edge-triggered logic.
- Step response: change one input while others are constant and observe next several ticks.
- Pollution test: inject unknown signals on public I/O networks to detect back-propagation side effects.
- Boundary test: probe around thresholds, zero crossings, and selector indices.

## CLI Commands

Use agent-oriented commands first so output stays concise and machine-friendly.

Preferred commands for analysis:

```bash
node dist/src/cli.js probe-dsl --dsl <path> --ticks <n>
```

```bash
node dist/src/cli.js simulate --input <blueprint.json> --ticks <n> --agent
```

```bash
node dist/src/cli.js simulate --blueprint "0..." --ticks <n> --agent
```

For targeted external stimulation:

```bash
node dist/src/cli.js probe-dsl --dsl <path> --inputs <inputs.json> --ticks <n>
```

For the occasional detailed human-readable inspection, fall back to `simulate-dsl` without `--agent`.

## Analysis Quality Bar

A complete analysis should:
- Identify the relevant signal path(s) and state feedback loops.
- State timing in ticks where it matters.
- Distinguish "what logic says" from "what simulation confirms".
- Include at least one simulator-backed observation for non-trivial claims.
- Explicitly call out if behavior depends on held input vs pulse input.

## Output Format

Return in this order:
1. Direct answer (1-3 sentences)
2. Why (path-level explanation)
3. Evidence (tick-level observations)
4. Optional: follow-up probe suggestion if additional confidence is useful

Keep outputs concise and evidence-driven.
