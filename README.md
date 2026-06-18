# AI Circuit Designer

A Node.js CLI tool suite for developing Factorio 2.0 circuit networks composed of arithmetic, decider, selector, and constant combinators.

The first tool in the suite is a Factorio circuit network simulator. It reads a Factorio blueprint in JSON form or as a compressed Factorio blueprint string, keeps only combinators and power poles, and simulates circuit-network signals over ticks.

## Features

- Accepts blueprint JSON files, blueprint strings, or stdin.
- Simulates red and green wire networks independently.
- Sums all producers of the same signal name on a network.
- Broadcasts constant combinator outputs to both red and green networks.
- Treats power poles as circuit-network connectors only.
- Implements constant, arithmetic, and decider combinators.
- Implements selector combinator select-signal behavior.
- Applies the Factorio timing model: combinator output for tick `N + 1` is computed from input signals on tick `N`.
- Allows optional external test input signals connected to specific entity connectors and wire colors.
- Emits JSON output containing each network's signals per tick.

## Install

```bash
npm install
npm run build
```

This project has no runtime dependencies. TypeScript is used at build time and emits JavaScript plus declaration files into `dist/`.

## CLI Usage

```bash
node dist/src/cli.js --input examples/constant.json --ticks 3
```

You can also pass a compressed blueprint string directly:

```bash
node dist/src/cli.js --blueprint "0..." --ticks 5
```

Or pipe JSON through stdin:

```bash
type examples/constant.json | node dist/src/cli.js --ticks 3
```

PowerShell examples can use `Get-Content`:

```powershell
Get-Content examples/constant.json -Raw | node dist/src/cli.js --ticks 3
```

## External Test Inputs

Use `--inputs` to attach additional signals to one or more entity connectors. This is useful for testing combinators without adding extra constant combinators to a blueprint.

```bash
node dist/src/cli.js --input examples/arithmetic-input.json --inputs examples/test-inputs.json --ticks 4
```

During local development you can also use:

```bash
npm run simulate -- --input examples/constant.json --ticks 3
```

## Library API

The simulator exports TypeScript types and declarations from `dist/src/simulator.d.ts` after `npm run build`.

```ts
import { simulateBlueprint } from 'ai-circuit-designer';
import type { FactorioBlueprint, SimulationResult } from 'ai-circuit-designer';

const result: SimulationResult = simulateBlueprint(blueprint as FactorioBlueprint, { ticks: 3 });
```

Input files use this shape:

```json
[
  {
    "entityId": 1,
    "connectorId": 1,
    "wire": "red",
    "signals": { "signal-A": 7 }
  }
]
```

`connectorId` follows Factorio circuit connector ids: combinator input is `1`, combinator output is `2`, and constant combinators and power poles use `1`.

## Output

The simulator prints JSON with a `ticks` array. Each tick contains every red and green network and its signals after that tick's combinator outputs have been published.

```json
{
  "ticks": [
    {
      "tick": 0,
      "networks": [
        { "id": "red:1", "wire": "red", "signals": { "signal-A": 5 } }
      ]
    }
  ]
}
```

## Test Fixtures

Simple example blueprints live in `examples/`:

- `constant.json` publishes one signal from a constant combinator.
- `summed-constants.json` shows two constants producing `signal-A = 1` on one red network, resulting in `signal-A = 2`.
- `constant-arithmetic.json` sends a constant into an arithmetic combinator.
- `decider.json` demonstrates a basic comparison gate.
- `selector.json` demonstrates supported select-signal behavior.

Run the test suite with:

```bash
npm test
```
