import { inflateSync } from 'node:zlib';

const WIRE_COLORS = ['red', 'green'];
const SUPPORTED_COMBINATORS = new Set([
  'constant-combinator',
  'arithmetic-combinator',
  'decider-combinator',
  'selector-combinator'
]);

export function parseBlueprint(input) {
  if (typeof input !== 'string') {
    throw new TypeError('Blueprint input must be a string.');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Blueprint input is empty.');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return normalizeBlueprint(JSON.parse(trimmed));
  }

  const version = trimmed[0];
  if (version !== '0') {
    throw new Error(`Unsupported blueprint string version '${version}'.`);
  }

  const decoded = Buffer.from(trimmed.slice(1), 'base64');
  const json = inflateSync(decoded).toString('utf8');
  return normalizeBlueprint(JSON.parse(json));
}

export function simulateBlueprint(input, options = {}) {
  const blueprint = typeof input === 'string' ? parseBlueprint(input) : normalizeBlueprint(input);
  const ticks = Number.isInteger(options.ticks) ? options.ticks : 3;
  const externalInputs = normalizeExternalInputs(options.inputs ?? []);
  const model = buildModel(blueprint, externalInputs);
  const frames = [];
  let combinatorOutputs = new Map();

  for (let tick = 0; tick < ticks; tick += 1) {
    const networkSignals = buildNetworkSignals(model, combinatorOutputs);
    frames.push({
      tick,
      networks: formatNetworks(model, networkSignals)
    });
    combinatorOutputs = computeNextCombinatorOutputs(model, networkSignals);
  }

  return {
    ticks: frames,
    ignoredEntities: model.ignoredEntities
  };
}

function normalizeBlueprint(data) {
  const blueprint = data?.blueprint ?? data;
  if (!blueprint || !Array.isArray(blueprint.entities)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }
  return blueprint;
}

function normalizeExternalInputs(inputs) {
  if (typeof inputs === 'string') {
    return normalizeExternalInputs(JSON.parse(inputs));
  }
  if (!Array.isArray(inputs)) {
    throw new Error('External inputs must be an array.');
  }

  return inputs.map((input, index) => {
    const entityId = Number(input.entityId ?? input.entity_id);
    const connectorId = Number(input.connectorId ?? input.connector_id ?? input.circuitId ?? input.circuit_id ?? 1);
    const wire = input.wire;
    if (!Number.isInteger(entityId) || !Number.isInteger(connectorId)) {
      throw new Error(`External input ${index} must specify entityId and connectorId.`);
    }
    if (!WIRE_COLORS.includes(wire)) {
      throw new Error(`External input ${index} must specify wire as red or green.`);
    }
    return {
      entityId,
      connectorId,
      wire,
      signals: normalizeSignalMap(input.signals ?? {})
    };
  });
}

function buildModel(blueprint, externalInputs) {
  const entities = new Map();
  const ignoredEntities = [];

  for (const entity of blueprint.entities) {
    const entityId = Number(entity.entity_number ?? entity.entityId ?? entity.id);
    if (!Number.isInteger(entityId)) {
      continue;
    }
    if (isSupportedEntity(entity)) {
      entities.set(entityId, entity);
    } else {
      ignoredEntities.push({ entityId, name: entity.name ?? 'unknown' });
    }
  }

  const dsu = new DisjointSet();
  for (const entity of entities.values()) {
    for (const connectorId of connectorIdsFor(entity)) {
      for (const wire of WIRE_COLORS) {
        dsu.add(pointKey(entityIdOf(entity), connectorId, wire));
      }
    }
  }

  connectEntityConnections(entities, dsu);
  connectBlueprintWires(blueprint, entities, dsu);

  const networks = assignNetworks(entities, dsu);
  const pointToNetwork = new Map();
  for (const network of networks) {
    for (const point of network.points) {
      pointToNetwork.set(point.key, network.id);
    }
  }

  const constants = [...entities.values()].filter((entity) => entity.name === 'constant-combinator');
  const combinators = [...entities.values()].filter((entity) => entity.name !== 'constant-combinator' && entity.name.endsWith('-combinator'));

  return {
    entities,
    networks,
    pointToNetwork,
    constants,
    combinators,
    externalInputs,
    ignoredEntities
  };
}

function isSupportedEntity(entity) {
  const name = entity.name ?? '';
  return SUPPORTED_COMBINATORS.has(name) || isPowerPole(name);
}

function isPowerPole(name) {
  return name.endsWith('electric-pole') || name === 'substation';
}

function connectorIdsFor(entity) {
  if (entity.name === 'arithmetic-combinator' || entity.name === 'decider-combinator' || entity.name === 'selector-combinator') {
    return [1, 2];
  }
  return [1];
}

function connectEntityConnections(entities, dsu) {
  for (const entity of entities.values()) {
    const connections = entity.connections ?? {};
    for (const [connectorIdText, connectorConnections] of Object.entries(connections)) {
      const connectorId = Number(connectorIdText);
      if (!Number.isInteger(connectorId)) {
        continue;
      }

      for (const wire of WIRE_COLORS) {
        const targets = connectorConnections?.[wire] ?? [];
        for (const target of targets) {
          unionWire(
            entities,
            dsu,
            entityIdOf(entity),
            connectorId,
            target.entity_id ?? target.entityId,
            target.circuit_id ?? target.circuitId ?? target.connector_id ?? target.connectorId ?? 1,
            wire
          );
        }
      }
    }
  }
}

function connectBlueprintWires(blueprint, entities, dsu) {
  if (!Array.isArray(blueprint.wires)) {
    return;
  }

  for (const wireSpec of blueprint.wires) {
    if (!Array.isArray(wireSpec) || wireSpec.length < 5) {
      continue;
    }

    const [firstEntity, firstConnector, secondEntity, secondConnector, wireOrColor] = wireSpec;
    const wire = normalizeWireColor(wireOrColor);
    if (!wire) {
      continue;
    }
    unionWire(entities, dsu, firstEntity, firstConnector, secondEntity, secondConnector, wire);
  }
}

function unionWire(entities, dsu, firstEntity, firstConnector, secondEntity, secondConnector, wire) {
  const firstId = Number(firstEntity);
  const secondId = Number(secondEntity);
  const firstConnectorId = Number(firstConnector);
  const secondConnectorId = Number(secondConnector);
  if (!entities.has(firstId) || !entities.has(secondId) || !Number.isInteger(firstConnectorId) || !Number.isInteger(secondConnectorId)) {
    return;
  }
  dsu.union(
    pointKey(firstId, firstConnectorId, wire),
    pointKey(secondId, secondConnectorId, wire)
  );
}

function normalizeWireColor(wire) {
  if (wire === 'red' || wire === 1) {
    return 'red';
  }
  if (wire === 'green' || wire === 2) {
    return 'green';
  }
  return undefined;
}

function assignNetworks(entities, dsu) {
  const groupsByWire = new Map(WIRE_COLORS.map((wire) => [wire, new Map()]));

  for (const entity of entities.values()) {
    const entityId = entityIdOf(entity);
    for (const connectorId of connectorIdsFor(entity)) {
      for (const wire of WIRE_COLORS) {
        const key = pointKey(entityId, connectorId, wire);
        const root = dsu.find(key);
        const groups = groupsByWire.get(wire);
        if (!groups.has(root)) {
          groups.set(root, []);
        }
        groups.get(root).push({
          key,
          entityId,
          connectorId,
          entityName: entity.name
        });
      }
    }
  }

  const networks = [];
  for (const wire of WIRE_COLORS) {
    const groups = [...groupsByWire.get(wire).values()]
      .map((points) => points.sort(comparePoints))
      .sort((left, right) => comparePoints(left[0], right[0]));

    groups.forEach((points, index) => {
      networks.push({
        id: `${wire}:${index + 1}`,
        wire,
        points
      });
    });
  }

  return networks;
}

function buildNetworkSignals(model, combinatorOutputs) {
  const networkSignals = new Map(model.networks.map((network) => [network.id, new Map()]));

  for (const entity of model.constants) {
    const signals = readConstantSignals(entity);
    for (const wire of WIRE_COLORS) {
      addSignalsToPoint(model, networkSignals, entityIdOf(entity), 1, wire, signals);
    }
  }

  for (const input of model.externalInputs) {
    addSignalsToPoint(model, networkSignals, input.entityId, input.connectorId, input.wire, input.signals);
  }

  for (const [entityId, signals] of combinatorOutputs) {
    for (const wire of WIRE_COLORS) {
      addSignalsToPoint(model, networkSignals, entityId, 2, wire, signals);
    }
  }

  return networkSignals;
}

function computeNextCombinatorOutputs(model, networkSignals) {
  const outputs = new Map();
  for (const entity of model.combinators) {
    const input = readCombinatorInput(model, networkSignals, entityIdOf(entity));
    let signals = new Map();
    if (entity.name === 'arithmetic-combinator') {
      signals = evaluateArithmetic(entity, input);
    } else if (entity.name === 'decider-combinator') {
      signals = evaluateDecider(entity, input);
    } else if (entity.name === 'selector-combinator') {
      signals = evaluateSelector(entity, input);
    }
    outputs.set(entityIdOf(entity), signals);
  }
  return outputs;
}

function readCombinatorInput(model, networkSignals, entityId) {
  const signals = new Map();
  for (const wire of WIRE_COLORS) {
    const networkId = model.pointToNetwork.get(pointKey(entityId, 1, wire));
    addSignalMaps(signals, networkSignals.get(networkId) ?? new Map());
  }
  return signals;
}

function readConstantSignals(entity) {
  const signals = new Map();
  const behavior = entity.control_behavior ?? {};
  for (const filter of collectConstantFilters(behavior)) {
    const signal = signalName(filter.signal);
    const count = Number(filter.count ?? 0);
    if (signal && count !== 0) {
      addSignal(signals, signal, count);
    }
  }
  return signals;
}

function collectConstantFilters(behavior) {
  const filters = [];
  if (Array.isArray(behavior.filters)) {
    filters.push(...behavior.filters);
  }
  if (Array.isArray(behavior.sections?.sections)) {
    for (const section of behavior.sections.sections) {
      if (Array.isArray(section.filters)) {
        filters.push(...section.filters);
      }
    }
  }
  return filters;
}

function evaluateArithmetic(entity, input) {
  const config = entity.control_behavior?.arithmetic_conditions ?? entity.control_behavior?.arithmeticCondition ?? {};
  const first = operandFrom(config.first_signal, config.first_constant);
  const second = operandFrom(config.second_signal, config.second_constant ?? config.constant);
  const operation = String(config.operation ?? '+').toUpperCase();
  const output = signalName(config.output_signal) ?? 'signal-each';
  const outputSignals = new Map();

  if (first.kind === 'each' || second.kind === 'each' || output === 'signal-each') {
    for (const signal of [...input.keys()].sort()) {
      const result = applyArithmetic(operation, operandValue(first, input, signal), operandValue(second, input, signal));
      if (result !== 0) {
        addSignal(outputSignals, output === 'signal-each' ? signal : output, result);
      }
    }
    return outputSignals;
  }

  const result = applyArithmetic(operation, operandValue(first, input), operandValue(second, input));
  if (result !== 0) {
    outputSignals.set(output, result);
  }
  return outputSignals;
}

function evaluateDecider(entity, input) {
  const behavior = entity.control_behavior ?? {};
  const config = behavior.decider_conditions ?? behavior.deciderCondition ?? behavior.conditions ?? {};
  const conditions = Array.isArray(config.conditions) ? config.conditions : [config];
  const outputs = Array.isArray(config.outputs) ? config.outputs : [{
    signal: config.output_signal,
    copy_count_from_input: config.copy_count_from_input
  }];
  const firstCondition = conditions.find(Boolean) ?? {};
  const first = operandFrom(firstCondition.first_signal, firstCondition.first_constant);
  const second = operandFrom(firstCondition.second_signal, firstCondition.second_constant ?? firstCondition.constant);
  const comparator = normalizeComparator(firstCondition.comparator ?? firstCondition.compare_type ?? '>');

  if (first.kind === 'each') {
    return evaluateEachDecider(input, first, second, comparator, outputs);
  }

  const passed = evaluateCondition(first, second, comparator, input);
  if (!passed) {
    return new Map();
  }
  return emitDeciderOutputs(input, outputs);
}

function evaluateEachDecider(input, first, second, comparator, outputs) {
  const result = new Map();
  for (const signal of [...input.keys()].sort()) {
    if (!compareValues(operandValue(first, input, signal), comparator, operandValue(second, input, signal))) {
      continue;
    }
    for (const output of outputs) {
      const outputSignal = signalName(output.signal ?? output.output_signal) ?? 'signal-each';
      const value = output.copy_count_from_input === false ? 1 : getSignal(input, signal);
      addSignal(result, outputSignal === 'signal-each' ? signal : outputSignal, value);
    }
  }
  return result;
}

function evaluateCondition(first, second, comparator, input) {
  if (first.kind === 'anything') {
    return [...input.keys()].some((signal) => compareValues(getSignal(input, signal), comparator, operandValue(second, input, signal)));
  }
  if (first.kind === 'every') {
    const signals = [...input.keys()];
    return signals.length > 0 && signals.every((signal) => compareValues(getSignal(input, signal), comparator, operandValue(second, input, signal)));
  }
  return compareValues(operandValue(first, input), comparator, operandValue(second, input));
}

function emitDeciderOutputs(input, outputs) {
  const result = new Map();
  for (const output of outputs) {
    const outputSignal = signalName(output.signal ?? output.output_signal);
    if (!outputSignal) {
      continue;
    }
    if (outputSignal === 'signal-each') {
      addSignalMaps(result, input);
      continue;
    }
    const value = output.copy_count_from_input ? getSignal(input, outputSignal) : 1;
    if (value !== 0) {
      addSignal(result, outputSignal, value);
    }
  }
  return result;
}

function evaluateSelector(entity, input) {
  const behavior = entity.control_behavior ?? {};
  const config = behavior.selector_conditions ?? behavior.selectorCondition ?? {};
  const operation = String(config.operation ?? config.select_operation ?? config.mode ?? 'select').toLowerCase();
  if (!operation.includes('select')) {
    return new Map();
  }

  const index = Math.max(1, Number(config.index ?? config.select_signal_index ?? config.constant ?? 1));
  const sortMode = String(config.sort ?? config.sort_mode ?? 'count-desc').toLowerCase();
  const candidates = [...input.entries()].filter(([, value]) => value !== 0);
  candidates.sort((left, right) => compareSelectorSignals(left, right, sortMode));
  const selected = candidates[index - 1];
  return selected ? new Map([selected]) : new Map();
}

function compareSelectorSignals(left, right, sortMode) {
  const [leftSignal, leftValue] = left;
  const [rightSignal, rightValue] = right;
  if (sortMode === 'count-asc' || sortMode === 'ascending') {
    return leftValue - rightValue || leftSignal.localeCompare(rightSignal);
  }
  if (sortMode === 'name-asc' || sortMode === 'signal-asc') {
    return leftSignal.localeCompare(rightSignal);
  }
  if (sortMode === 'name-desc' || sortMode === 'signal-desc') {
    return rightSignal.localeCompare(leftSignal);
  }
  return rightValue - leftValue || leftSignal.localeCompare(rightSignal);
}

function operandFrom(signal, constant) {
  const name = signalName(signal);
  if (name === 'signal-each') {
    return { kind: 'each' };
  }
  if (name === 'signal-anything') {
    return { kind: 'anything' };
  }
  if (name === 'signal-everything' || name === 'signal-every') {
    return { kind: 'every' };
  }
  if (name) {
    return { kind: 'signal', signal: name };
  }
  return { kind: 'constant', value: Number(constant ?? 0) };
}

function operandValue(operand, signals, eachSignal = undefined) {
  if (operand.kind === 'constant') {
    return operand.value;
  }
  if (operand.kind === 'each') {
    return getSignal(signals, eachSignal);
  }
  return getSignal(signals, operand.signal);
}

function applyArithmetic(operation, left, right) {
  const leftInt = toInt32(left);
  const rightInt = toInt32(right);
  switch (operation) {
    case '+':
      return wrapInt32(BigInt(leftInt) + BigInt(rightInt));
    case '-':
      return wrapInt32(BigInt(leftInt) - BigInt(rightInt));
    case '*':
      return wrapInt32(BigInt(leftInt) * BigInt(rightInt));
    case '/':
      return rightInt === 0 ? 0 : toInt32(Math.trunc(leftInt / rightInt));
    case '%':
      return rightInt === 0 ? 0 : toInt32(leftInt % rightInt);
    case '^':
      return rightInt < 0 ? 0 : toInt32(leftInt ** Math.min(rightInt, 31));
    case '<<':
      return toInt32(leftInt << (rightInt & 31));
    case '>>':
      return toInt32(leftInt >> (rightInt & 31));
    case 'AND':
      return toInt32(leftInt & rightInt);
    case 'OR':
      return toInt32(leftInt | rightInt);
    case 'XOR':
      return toInt32(leftInt ^ rightInt);
    default:
      throw new Error(`Unsupported arithmetic operation '${operation}'.`);
  }
}

function normalizeComparator(comparator) {
  if (comparator === '=') {
    return '==';
  }
  if (comparator === '\u2260') {
    return '!=';
  }
  if (comparator === '\u2264') {
    return '<=';
  }
  if (comparator === '\u2265') {
    return '>=';
  }
  return String(comparator);
}

function compareValues(left, comparator, right) {
  switch (comparator) {
    case '<':
      return left < right;
    case '>':
      return left > right;
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '<=':
      return left <= right;
    case '>=':
      return left >= right;
    default:
      throw new Error(`Unsupported decider comparator '${comparator}'.`);
  }
}

function addSignalsToPoint(model, networkSignals, entityId, connectorId, wire, signals) {
  const networkId = model.pointToNetwork.get(pointKey(entityId, connectorId, wire));
  if (!networkId) {
    return;
  }
  addSignalMaps(networkSignals.get(networkId), signals);
}

function addSignalMaps(target, source) {
  for (const [signal, value] of source) {
    addSignal(target, signal, value);
  }
}

function addSignal(target, signal, value) {
  const next = toInt32((target.get(signal) ?? 0) + value);
  if (next === 0) {
    target.delete(signal);
  } else {
    target.set(signal, next);
  }
}

function getSignal(signals, signal) {
  return signals.get(signal) ?? 0;
}

function normalizeSignalMap(signals) {
  const result = new Map();
  if (signals instanceof Map) {
    addSignalMaps(result, signals);
    return result;
  }
  for (const [signal, value] of Object.entries(signals)) {
    addSignal(result, signal, Number(value));
  }
  return result;
}

function signalName(signal) {
  if (!signal) {
    return undefined;
  }
  if (typeof signal === 'string') {
    return signal;
  }
  return signal.name;
}

function formatNetworks(model, networkSignals) {
  return model.networks.map((network) => ({
    id: network.id,
    wire: network.wire,
    points: network.points.map(({ entityId, connectorId, entityName }) => ({ entityId, connectorId, entityName })),
    signals: Object.fromEntries([...networkSignals.get(network.id).entries()].sort(([left], [right]) => left.localeCompare(right)))
  }));
}

function comparePoints(left, right) {
  return left.entityId - right.entityId || left.connectorId - right.connectorId || left.entityName.localeCompare(right.entityName);
}

function entityIdOf(entity) {
  return Number(entity.entity_number ?? entity.entityId ?? entity.id);
}

function pointKey(entityId, connectorId, wire) {
  return `${entityId}:${connectorId}:${wire}`;
}

function toInt32(value) {
  return Number(BigInt.asIntN(32, BigInt(Math.trunc(Number(value) || 0))));
}

function wrapInt32(value) {
  return Number(BigInt.asIntN(32, value));
}

class DisjointSet {
  #parents = new Map();

  add(value) {
    if (!this.#parents.has(value)) {
      this.#parents.set(value, value);
    }
  }

  find(value) {
    this.add(value);
    const parent = this.#parents.get(value);
    if (parent === value) {
      return value;
    }
    const root = this.find(parent);
    this.#parents.set(value, root);
    return root;
  }

  union(left, right) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.#parents.set(rightRoot, leftRoot);
    }
  }
}
