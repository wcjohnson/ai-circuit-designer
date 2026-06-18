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
