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
- Provides TUI tables for simulation-oriented commands by default.
- Supports `--json` global flag to emit raw JSON instead of TUI output.

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

Compile + simulate DSL in one step:

```bash
node dist/src/cli.js simulate-dsl --dsl work/latch/multi-signal-latch.dsl --ticks 5
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

The simulator and blueprint I/O library export TypeScript types and declarations after `npm run build`.

```ts
import { simulateBlueprint } from 'ai-circuit-designer';
import type { FactorioBlueprint, SimulationResult } from 'ai-circuit-designer';

const result: SimulationResult = simulateBlueprint(blueprint as FactorioBlueprint, { ticks: 3 });
```

Blueprint JSON and compressed Factorio blueprint strings can be read and written through the blueprint subpath:

```ts
import {
  createBlueprint,
  readBlueprint,
  WIRE_CONNECTOR_ID,
  writeBlueprintJson,
  writeBlueprintString
} from 'ai-circuit-designer/blueprint';
import type { ConstantCombinatorEntity, PowerPoleEntity } from 'ai-circuit-designer/blueprint';

const constant: ConstantCombinatorEntity = {
  entity_number: 1,
  name: 'constant-combinator',
  position: { x: 0, y: 0 },
  control_behavior: {
    filters: [
      { index: 1, signal: { type: 'virtual', name: 'signal-A' }, count: 1 }
    ]
  },
  wires: [[1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.circuitRed]]
};

const pole: PowerPoleEntity = {
  entity_number: 2,
  name: 'small-electric-pole',
  position: { x: 1, y: 0 }
};

const blueprint = createBlueprint([constant, pole], { label: 'typed blueprint' });
const blueprintString = writeBlueprintString(blueprint);
const sameBlueprint = readBlueprint(blueprintString);
const json = writeBlueprintJson(sameBlueprint, { pretty: true });
```

The blueprint library currently types combinators, entity-level Factorio 2.0 `wires` tuple arrays, tags, and power poles. Other entity kinds are intentionally left as generic blueprint entities and are passed through unmodified during read/write cycles. Legacy 1.x-style `connections` objects and top-level blueprint `wires` arrays are rejected.

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

Simulation-oriented commands (`simulate`, `simulate-dsl`, and `test`) print a TUI table by default:
- Rows: tick numbers
- Columns: network ids
- Cells: signals on that network at that tick

Use `--json` to suppress the table and print raw JSON instead.

Example JSON output (`--json`) has a `ticks` array. Each tick contains every red and green network and its signals after that tick's combinator outputs have been published.

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
