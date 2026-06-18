import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateBlueprint } from '../src/simulator.js';
import type { ExternalInput, FactorioBlueprint, SignalMap, SimulationResult, WireColor } from '../src/simulator.js';

const root = process.cwd();

async function loadExample(name: string): Promise<FactorioBlueprint> {
  return JSON.parse(await readFile(join(root, 'examples', name), 'utf8')) as FactorioBlueprint;
}

function signalsOn(result: SimulationResult, tick: number, wire: WireColor, entityId: number, connectorId: number): SignalMap {
  const network = result.ticks[tick]?.networks.find((candidate) => (
    candidate.wire === wire
    && candidate.points.some((point) => point.entityId === entityId && point.connectorId === connectorId)
  ));
  assert.ok(network, `Expected ${wire} network for entity ${entityId} connector ${connectorId}`);
  return network.signals;
}

test('constant combinators broadcast identical signals to red and green networks', async () => {
  const blueprint = await loadExample('constant.json');
  const result = simulateBlueprint(blueprint, { ticks: 1 });

  assert.deepEqual(signalsOn(result, 0, 'red', 1, 1), { 'signal-A': 5 });
  assert.deepEqual(signalsOn(result, 0, 'green', 1, 1), { 'signal-A': 5 });
});

test('signals with the same name are summed on a network', async () => {
  const blueprint = await loadExample('summed-constants.json');
  const result = simulateBlueprint(blueprint, { ticks: 1 });

  assert.deepEqual(signalsOn(result, 0, 'red', 1, 1), { 'signal-A': 2 });
});

test('arithmetic combinator outputs on the tick after reading input', async () => {
  const blueprint = await loadExample('constant-arithmetic.json');
  const result = simulateBlueprint(blueprint, { ticks: 2 });

  assert.deepEqual(signalsOn(result, 0, 'red', 2, 2), {});
  assert.deepEqual(signalsOn(result, 1, 'red', 2, 2), { 'signal-B': 6 });
  assert.deepEqual(signalsOn(result, 1, 'green', 2, 2), { 'signal-B': 6 });
});

test('decider combinator emits configured output when condition passes', async () => {
  const blueprint = await loadExample('decider.json');
  const result = simulateBlueprint(blueprint, { ticks: 2 });

  assert.deepEqual(signalsOn(result, 1, 'red', 2, 2), { 'signal-C': 1 });
});

test('decider combinator honors condition and output network selections', () => {
  const result = simulateBlueprint({
    item: 'blueprint',
    entities: [
      {
        entity_number: 1,
        name: 'decider-combinator',
        position: { x: 0, y: 0 },
        control_behavior: {
          decider_conditions: {
            conditions: [
              {
                first_signal: { type: 'virtual', name: 'signal-A' },
                first_signal_networks: { red: true, green: false },
                comparator: '>',
                constant: 5
              }
            ],
            outputs: [
              {
                signal: { type: 'virtual', name: 'signal-B' },
                copy_count_from_input: true,
                networks: { red: false, green: true }
              }
            ]
          }
        }
      }
    ]
  }, {
    ticks: 2,
    inputs: [
      { entityId: 1, connectorId: 1, wire: 'red', signals: { 'signal-A': 8, 'signal-B': 100 } },
      { entityId: 1, connectorId: 1, wire: 'green', signals: { 'signal-A': 1, 'signal-B': 3 } }
    ]
  });

  assert.deepEqual(signalsOn(result, 1, 'red', 1, 2), { 'signal-B': 3 });
});

test('selector combinator select-signal emits the selected signal', async () => {
  const blueprint = await loadExample('selector.json');
  const result = simulateBlueprint(blueprint, { ticks: 2 });

  assert.deepEqual(signalsOn(result, 1, 'red', 2, 2), { 'signal-B': 9 });
});

test('external test inputs can drive combinator input connectors', async () => {
  const blueprint = await loadExample('arithmetic-input.json');
  const inputs = JSON.parse(await readFile(join(root, 'examples', 'test-inputs.json'), 'utf8')) as ExternalInput[];
  const result = simulateBlueprint(blueprint, { ticks: 2, inputs });

  assert.deepEqual(signalsOn(result, 1, 'red', 1, 2), { 'signal-B': 17 });
});

test('arithmetic combinator honors operand circuit network selections', () => {
  const result = simulateBlueprint({
    item: 'blueprint',
    entities: [
      {
        entity_number: 1,
        name: 'arithmetic-combinator',
        position: { x: 0, y: 0 },
        control_behavior: {
          arithmetic_conditions: {
            first_signal: { type: 'virtual', name: 'signal-A' },
            first_signal_networks: { red: true, green: false },
            operation: '+',
            second_signal: { type: 'virtual', name: 'signal-B' },
            second_signal_networks: { red: false, green: true },
            output_signal: { type: 'virtual', name: 'signal-C' }
          }
        }
      }
    ]
  }, {
    ticks: 2,
    inputs: [
      { entityId: 1, connectorId: 1, wire: 'red', signals: { 'signal-A': 2, 'signal-B': 100 } },
      { entityId: 1, connectorId: 1, wire: 'green', signals: { 'signal-A': 50, 'signal-B': 3 } }
    ]
  });

  assert.deepEqual(signalsOn(result, 1, 'red', 1, 2), { 'signal-C': 5 });
});
