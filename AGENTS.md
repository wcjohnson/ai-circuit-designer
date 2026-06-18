# Repository Guide

This repository contains a Node.js CLI tool suite for developing and testing Factorio 2.0 circuit networks built from arithmetic, decider, selector, and constant combinators.

## Project Goals

- Provide local command-line tools for inspecting and simulating Factorio circuit blueprints.
- Model Factorio circuit-network tick behavior closely enough to support automated circuit tests.
- Keep tools scriptable: accept JSON files, blueprint strings, stdin, and machine-readable output.

## Current Tooling

The first CLI tool is a circuit network simulator. It accepts a Factorio blueprint as either JSON or a compressed blueprint string. It discards unsupported entities except power poles, then simulates red and green circuit networks over discrete ticks.

Core simulation assumptions:

- Red and green wires form separate networks.
- All connected points on a same-color wire share the same signal set for a tick, and same-named signals from multiple producers are summed.
- Power poles only connect circuit networks and do not produce or consume signals.
- Constant combinators publish their configured signals every tick to both red and green networks.
- Arithmetic, decider, and supported selector combinators read tick `N` inputs and publish tick `N+1` outputs.
- Combinator outputs are broadcast identically to both red and green output connectors.
- Selector support is currently limited to the select-signal behavior.

## Development Notes

- Use plain Node.js APIs where practical; avoid dependencies unless they remove meaningful complexity.
- Keep CLI output stable and JSON-friendly so examples can become regression tests.
- Prefer small fixture blueprints in `examples/` and focused tests in `test/`.
- Do not add Factorio-specific behavior by guessing silently. When the blueprint schema is ambiguous, document the supported shape and add tests for it.
