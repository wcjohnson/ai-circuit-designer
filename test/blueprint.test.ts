import { inflateSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBlueprint,
  readBlueprint,
  readBlueprintJson,
  readBlueprintString,
  WIRE_CONNECTOR_ID,
  writeBlueprintJson,
  writeBlueprintString
} from '../src/blueprint.js';
import { simulateBlueprint } from '../src/simulator.js';
import type {
  ArithmeticCombinatorEntity,
  ArithmeticControlBehavior,
  BlueprintWire,
  ConstantCombinatorEntity,
  DeciderControlBehavior,
  FactorioBlueprint,
  PowerPoleEntity,
  SelectorCombinatorParameters,
  SelectorCombinatorEntity
} from '../src/blueprint.js';

const validWire: BlueprintWire = [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed];
void validWire;

// Factorio wires are tuple arrays.
// @ts-expect-error BlueprintWire is exactly four numeric tuple members.
const invalidWire: BlueprintWire = [1, 1, 2, 3, 1];
void invalidWire;

const invalidLegacyConnectionEntity: ConstantCombinatorEntity = {
  entity_number: 1,
  name: 'constant-combinator',
  position: { x: 0, y: 0 },
  // @ts-expect-error Factorio 2.0 BlueprintEntity uses wires, not connections.
  connections: {}
};
void invalidLegacyConnectionEntity;

const validArithmeticControlBehavior: ArithmeticControlBehavior = {
  arithmetic_conditions: {
    first_signal: { type: 'virtual', name: 'signal-A' },
    first_signal_networks: { red: true, green: false },
    operation: '+',
    second_signal: { type: 'virtual', name: 'signal-B' },
    second_signal_networks: { red: false, green: true },
    output_signal: { type: 'virtual', name: 'signal-C' }
  }
};
void validArithmeticControlBehavior;

const invalidArithmeticControlBehavior: ArithmeticControlBehavior = {
  // @ts-expect-error Factorio 2.0 uses arithmetic_conditions, not arithmeticCondition.
  arithmeticCondition: {}
};
void invalidArithmeticControlBehavior;

const validDeciderControlBehavior: DeciderControlBehavior = {
  decider_conditions: {
    conditions: [
      {
        first_signal: { type: 'virtual', name: 'signal-A' },
        first_signal_networks: { red: true, green: false },
        comparator: '>',
        second_signal: { type: 'virtual', name: 'signal-B' },
        second_signal_networks: { red: false, green: true },
        compare_type: 'and'
      }
    ],
    outputs: [
      {
        signal: { type: 'virtual', name: 'signal-C' },
        copy_count_from_input: false,
        constant: 1,
        networks: { red: false, green: true }
      }
    ]
  }
};
void validDeciderControlBehavior;

const invalidDeciderAliasControlBehavior: DeciderControlBehavior = {
  // @ts-expect-error Factorio 2.0 uses decider_conditions, not deciderCondition.
  deciderCondition: {}
};
void invalidDeciderAliasControlBehavior;

const invalidDeciderTopLevelConditions: DeciderControlBehavior = {
  // @ts-expect-error Decider parameters are nested under decider_conditions.
  conditions: {}
};
void invalidDeciderTopLevelConditions;

const invalidDeciderCompareType: DeciderControlBehavior = {
  decider_conditions: {
    conditions: [
      {
        first_signal: { type: 'virtual', name: 'signal-A' },
        // @ts-expect-error compare_type is only "and" or "or".
        compare_type: 'xor'
      }
    ],
    outputs: [{ signal: { type: 'virtual', name: 'signal-C' } }]
  }
};
void invalidDeciderCompareType;

const invalidDeciderOutputAlias: DeciderControlBehavior = {
  decider_conditions: {
    conditions: [{ first_signal: { type: 'virtual', name: 'signal-A' } }],
    outputs: [
      {
        signal: { type: 'virtual', name: 'signal-C' },
        // @ts-expect-error Decider outputs use signal, not output_signal.
        output_signal: { type: 'virtual', name: 'signal-D' }
      }
    ]
  }
};
void invalidDeciderOutputAlias;

const validSelectorControlBehavior: SelectorCombinatorParameters = {
  operation: 'quality-transfer',
  select_quality_from_signal: true,
  quality_source_signal: { type: 'item', name: 'iron-plate' },
  quality_destination_signal: { type: 'item', name: 'copper-plate' }
};
void validSelectorControlBehavior;

const invalidSelectorConditionsAlias: SelectorCombinatorParameters = {
  // @ts-expect-error Selector combinator uses a single parameter object, not selector_conditions.
  selector_conditions: {}
};
void invalidSelectorConditionsAlias;

const invalidConstantControlBehaviorLegacyFilters: ConstantCombinatorEntity = {
  entity_number: 99,
  name: 'constant-combinator',
  position: { x: 0, y: 0 },
  control_behavior: {
    // @ts-expect-error Factorio 2.0 constant combinators use sections, not top-level filters.
    filters: []
  }
};
void invalidConstantControlBehaviorLegacyFilters;

function generatedNetworkBlueprint(): FactorioBlueprint {
  const constant: ConstantCombinatorEntity = {
    entity_number: 1,
    name: 'constant-combinator',
    position: { x: 0, y: 0 },
    control_behavior: {
      sections: {
        sections: [
          {
            index: 1,
            filters: [
              { index: 1, type: 'virtual', name: 'signal-A', count: 2 }
            ]
          }
        ]
      }
    }
  };

  const pole: PowerPoleEntity = {
    entity_number: 2,
    name: 'small-electric-pole',
    position: { x: 1, y: 0 }
  };

  const arithmetic: ArithmeticCombinatorEntity = {
    entity_number: 3,
    name: 'arithmetic-combinator',
    position: { x: 2, y: 0 },
    control_behavior: {
      arithmetic_conditions: {
        first_signal: { type: 'virtual', name: 'signal-A' },
        operation: '+',
        second_constant: 5,
        output_signal: { type: 'virtual', name: 'signal-B' }
      }
    }
  };

  return createBlueprint([constant, pole, arithmetic], {
    label: 'generated typed network',
    version: 562949954142208,
    wires: [
      [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.circuitRed],
      [2, WIRE_CONNECTOR_ID.circuitRed, 3, WIRE_CONNECTOR_ID.combinatorInputRed]
    ]
  });
}

test('reads blueprint JSON wrappers and raw blueprint objects', () => {
  const blueprint = generatedNetworkBlueprint();
  const normalized = readBlueprint(blueprint);
  const wrappedJson = writeBlueprintJson(blueprint, { pretty: true });

  assert.deepEqual(readBlueprintJson(wrappedJson), normalized);
  assert.deepEqual(readBlueprint(blueprint), normalized);
  assert.equal(JSON.parse(wrappedJson).blueprint.label, 'generated typed network');
});

test('writes and reads Factorio version-0 compressed blueprint strings', () => {
  const blueprint = generatedNetworkBlueprint();
  const normalized = readBlueprint(blueprint);
  const blueprintString = writeBlueprintString(blueprint);

  assert.match(blueprintString, /^0[A-Za-z0-9+/=]+$/);
  assert.deepEqual(readBlueprintString(blueprintString), normalized);

  const inflatedJson = inflateSync(Buffer.from(blueprintString.slice(1), 'base64')).toString('utf8');
  assert.deepEqual(JSON.parse(inflatedJson), { blueprint: normalized });
});

test('generated compressed blueprint strings can be imported by the simulator', () => {
  const blueprintString = writeBlueprintString(generatedNetworkBlueprint());
  const result = simulateBlueprint(blueprintString, { ticks: 2 });
  const arithmeticOutput = result.ticks[1]?.networks.find((network) => (
    network.wire === 'red'
    && network.points.some((point) => point.entityId === 3 && point.connectorId === 2)
  ));

  assert.deepEqual(arithmeticOutput?.signals, { 'signal-B': 7 });
  assert.deepEqual(result.ignoredEntities, []);
});

test('global wire arrays round-trip through JSON and compressed strings', () => {
  const constant: ConstantCombinatorEntity = {
    entity_number: 1,
    name: 'constant-combinator',
    position: { x: 0, y: 0 },
    control_behavior: {
      sections: {
        sections: [
          {
            index: 1,
            filters: [
              { index: 1, type: 'virtual', name: 'signal-A', count: 4 }
            ]
          }
        ]
      }
    }
  };
  const selector: SelectorCombinatorEntity = {
    entity_number: 2,
    name: 'selector-combinator',
    position: { x: 2, y: 0 },
    control_behavior: {
      operation: 'select',
      select_max: true,
      index_constant: 0
    }
  };
  const blueprint = createBlueprint([constant, selector], {
    label: 'global wires',
    wires: [[1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed]]
  });
  const normalized = readBlueprint(blueprint);

  const blueprintString = writeBlueprintString(blueprint);

  assert.deepEqual(readBlueprintString(blueprintString).wires, [[1, 1, 2, 1]]);
  assert.deepEqual(readBlueprint(writeBlueprintJson(blueprint)), normalized);
});

test('rejects legacy 1.x connection fields', () => {
  assert.throws(() => readBlueprint({
    item: 'blueprint',
    entities: [
      {
        entity_number: 1,
        name: 'constant-combinator',
        position: { x: 0, y: 0 },
        connections: {}
      }
    ]
  }), /legacy connections/);
});

test('accepts global blueprint wires and dedupes them', () => {
  const normalized = readBlueprint({
    item: 'blueprint',
    entities: [
      {
        entity_number: 1,
        name: 'constant-combinator',
        position: { x: 0, y: 0 }
      },
      { entity_number: 2, name: 'arithmetic-combinator', position: { x: 1, y: 0 } }
    ],
    wires: [
      [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
      [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
      [1, WIRE_CONNECTOR_ID.circuitGreen, 2, WIRE_CONNECTOR_ID.combinatorInputGreen]
    ]
  });

  assert.equal('wires' in normalized.entities[0], false);
  assert.equal('wires' in normalized.entities[1], false);
});

test('normalizes mixed entity wires into top-level wires only', () => {
  const normalized = readBlueprint({
    item: 'blueprint',
    entities: [
      {
        entity_number: 1,
        name: 'constant-combinator',
        position: { x: 0, y: 0 },
        wires: [
          [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
          [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed]
        ]
      },
      {
        entity_number: 2,
        name: 'arithmetic-combinator',
        position: { x: 1, y: 0 }
      }
    ],
    wires: [
      [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
      [1, WIRE_CONNECTOR_ID.circuitGreen, 2, WIRE_CONNECTOR_ID.combinatorInputGreen]
    ]
  });

  assert.deepEqual(normalized.wires, [
    [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
    [1, WIRE_CONNECTOR_ID.circuitGreen, 2, WIRE_CONNECTOR_ID.combinatorInputGreen]
  ]);
  assert.equal('wires' in normalized.entities[0], false);
  assert.equal('wires' in normalized.entities[1], false);

  assert.deepEqual(normalized.wires, [
    [1, WIRE_CONNECTOR_ID.circuitRed, 2, WIRE_CONNECTOR_ID.combinatorInputRed],
    [1, WIRE_CONNECTOR_ID.circuitGreen, 2, WIRE_CONNECTOR_ID.combinatorInputGreen]
  ]);
});

test('passes through unanalysed valid 2.0 entity data unmodified', () => {
  const blueprint = {
    item: 'blueprint',
    label: 'pass-through fixture',
    icons: [
      { index: 1, signal: { type: 'item', name: 'transport-belt' } }
    ],
    entities: [
      {
        entity_number: 1,
        name: 'assembling-machine-2',
        position: { x: 0.5, y: -1.25 },
        direction: 4,
        tags: { purpose: 'keep me', nested: { value: 42 } },
        recipe: 'electronic-circuit',
        recipe_quality: 'normal',
        request_filters: {
          sections: [
            { index: 1, filters: [{ index: 1, name: 'iron-plate', count: 2 }] }
          ]
        }
      }
    ],
    version: 562949954142208
  } satisfies FactorioBlueprint;

  const readThenWrite = JSON.parse(writeBlueprintJson(readBlueprint(blueprint)));
  assert.deepEqual(readThenWrite, { blueprint });

  const writeThenRead = readBlueprint(writeBlueprintJson(blueprint));
  assert.deepEqual(writeThenRead, blueprint);
});
