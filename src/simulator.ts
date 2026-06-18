import { inflateSync } from 'node:zlib';

export type WireColor = 'red' | 'green';
export type SignalName = string;
export type SignalMap = Record<SignalName, number>;

export interface SignalRef {
  type?: string;
  name: SignalName;
}

export interface ConnectionTarget {
  entity_id?: number;
  entityId?: number;
  circuit_id?: number;
  circuitId?: number;
  connector_id?: number;
  connectorId?: number;
}

export interface BlueprintEntity {
  entity_number?: number;
  entityId?: number;
  id?: number;
  name: string;
  connections?: Record<string, Partial<Record<WireColor, ConnectionTarget[]>>>;
  control_behavior?: Record<string, unknown>;
  [key: string]: unknown;
}

export type BlueprintWire = [
  firstEntity: number,
  firstConnector: number,
  secondEntity: number,
  secondConnector: number,
  wire: WireColor | 1 | 2
];

export interface FactorioBlueprint {
  entities: BlueprintEntity[];
  wires?: BlueprintWire[];
  [key: string]: unknown;
}

export interface BlueprintWrapper {
  blueprint: FactorioBlueprint;
}

export interface ExternalInput {
  entityId?: number;
  entity_id?: number;
  connectorId?: number;
  connector_id?: number;
  circuitId?: number;
  circuit_id?: number;
  wire: WireColor;
  signals: SignalMap;
}

interface NormalizedExternalInput {
  entityId: number;
  connectorId: number;
  wire: WireColor;
  signals: ReadonlySignalBag;
}

export interface SimulateOptions {
  ticks?: number;
  inputs?: ExternalInput[] | string;
}

export interface IgnoredEntity {
  entityId: number;
  name: string;
}

export interface NetworkPointOutput {
  entityId: number;
  connectorId: number;
  entityName: string;
}

export interface NetworkOutput {
  id: string;
  wire: WireColor;
  points: NetworkPointOutput[];
  signals: SignalMap;
}

export interface TickOutput {
  tick: number;
  networks: NetworkOutput[];
}

export interface SimulationResult {
  ticks: TickOutput[];
  ignoredEntities: IgnoredEntity[];
}

export type BlueprintInput = string | FactorioBlueprint | BlueprintWrapper;
type SignalBag = Map<SignalName, number>;
type ReadonlySignalBag = ReadonlyMap<SignalName, number>;
type EntityMap = Map<number, BlueprintEntity>;
type NumericInput = number | string | undefined | null;

type Operand =
  | { kind: 'constant'; value: number }
  | { kind: 'signal'; signal: SignalName }
  | { kind: 'each' }
  | { kind: 'anything' }
  | { kind: 'every' };

interface NetworkPoint {
  key: string;
  entityId: number;
  connectorId: number;
  entityName: string;
}

interface NetworkModel {
  id: string;
  wire: WireColor;
  points: NetworkPoint[];
}

interface SimulationModel {
  entities: EntityMap;
  networks: NetworkModel[];
  pointToNetwork: Map<string, string>;
  constants: BlueprintEntity[];
  combinators: BlueprintEntity[];
  externalInputs: NormalizedExternalInput[];
  ignoredEntities: IgnoredEntity[];
}

interface ConstantFilter {
  signal?: SignalRef | string;
  count?: number;
}

interface ConstantSection {
  filters?: ConstantFilter[];
}

interface ArithmeticConditions {
  first_signal?: SignalRef | string;
  first_constant?: number;
  second_signal?: SignalRef | string;
  second_constant?: number;
  constant?: number;
  operation?: string;
  output_signal?: SignalRef | string;
}

interface DeciderCondition {
  first_signal?: SignalRef | string;
  first_constant?: number;
  second_signal?: SignalRef | string;
  second_constant?: number;
  constant?: number;
  comparator?: string;
  compare_type?: string;
}

interface DeciderOutputSpec {
  signal?: SignalRef | string;
  output_signal?: SignalRef | string;
  copy_count_from_input?: boolean;
}

interface DeciderConditions extends DeciderCondition {
  conditions?: DeciderCondition[];
  outputs?: DeciderOutputSpec[];
  output_signal?: SignalRef | string;
  copy_count_from_input?: boolean;
}

interface SelectorConditions {
  operation?: string;
  select_operation?: string;
  mode?: string;
  index?: number;
  select_signal_index?: number;
  constant?: number;
  sort?: string;
  sort_mode?: string;
}

const WIRE_COLORS = ['red', 'green'] as const;
const SUPPORTED_COMBINATORS = new Set<string>([
  'constant-combinator',
  'arithmetic-combinator',
  'decider-combinator',
  'selector-combinator'
]);

export function parseBlueprint(input: string): FactorioBlueprint {
  if (typeof input !== 'string') {
    throw new TypeError('Blueprint input must be a string.');
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Blueprint input is empty.');
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return normalizeBlueprint(JSON.parse(trimmed) as unknown);
  }

  const version = trimmed[0];
  if (version !== '0') {
    throw new Error(`Unsupported blueprint string version '${version}'.`);
  }

  const decoded = Buffer.from(trimmed.slice(1), 'base64');
  const json = inflateSync(decoded).toString('utf8');
  return normalizeBlueprint(JSON.parse(json) as unknown);
}

export function simulateBlueprint(input: BlueprintInput, options: SimulateOptions = {}): SimulationResult {
  const blueprint = typeof input === 'string' ? parseBlueprint(input) : normalizeBlueprint(input);
  const ticks = Number.isInteger(options.ticks) ? options.ticks as number : 3;
  const externalInputs = normalizeExternalInputs(options.inputs ?? []);
  const model = buildModel(blueprint, externalInputs);
  const frames: TickOutput[] = [];
  let combinatorOutputs = new Map<number, SignalBag>();

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

function normalizeBlueprint(data: unknown): FactorioBlueprint {
  if (!isRecord(data)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }

  const maybeBlueprint = isRecord(data.blueprint) ? data.blueprint : data;
  if (!Array.isArray(maybeBlueprint.entities)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }

  return maybeBlueprint as unknown as FactorioBlueprint;
}

function normalizeExternalInputs(inputs: ExternalInput[] | string): NormalizedExternalInput[] {
  if (typeof inputs === 'string') {
    return normalizeExternalInputs(JSON.parse(inputs) as ExternalInput[]);
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

function buildModel(blueprint: FactorioBlueprint, externalInputs: NormalizedExternalInput[]): SimulationModel {
  const entities: EntityMap = new Map();
  const ignoredEntities: IgnoredEntity[] = [];

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
  const pointToNetwork = new Map<string, string>();
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

function isSupportedEntity(entity: BlueprintEntity): boolean {
  const name = entity.name ?? '';
  return SUPPORTED_COMBINATORS.has(name) || isPowerPole(name);
}

function isPowerPole(name: string): boolean {
  return name.endsWith('electric-pole') || name === 'substation';
}

function connectorIdsFor(entity: BlueprintEntity): number[] {
  if (entity.name === 'arithmetic-combinator' || entity.name === 'decider-combinator' || entity.name === 'selector-combinator') {
    return [1, 2];
  }
  return [1];
}

function connectEntityConnections(entities: EntityMap, dsu: DisjointSet): void {
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

function connectBlueprintWires(blueprint: FactorioBlueprint, entities: EntityMap, dsu: DisjointSet): void {
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

function unionWire(
  entities: EntityMap,
  dsu: DisjointSet,
  firstEntity: NumericInput,
  firstConnector: NumericInput,
  secondEntity: NumericInput,
  secondConnector: NumericInput,
  wire: WireColor
): void {
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

function normalizeWireColor(wire: unknown): WireColor | undefined {
  if (wire === 'red' || wire === 1) {
    return 'red';
  }
  if (wire === 'green' || wire === 2) {
    return 'green';
  }
  return undefined;
}

function assignNetworks(entities: EntityMap, dsu: DisjointSet): NetworkModel[] {
  const groupsByWire = new Map<WireColor, Map<string, NetworkPoint[]>>(WIRE_COLORS.map((wire) => [wire, new Map<string, NetworkPoint[]>()]));

  for (const entity of entities.values()) {
    const entityId = entityIdOf(entity);
    for (const connectorId of connectorIdsFor(entity)) {
      for (const wire of WIRE_COLORS) {
        const key = pointKey(entityId, connectorId, wire);
        const root = dsu.find(key);
        const groups = groupsByWire.get(wire);
        if (!groups) {
          continue;
        }
        if (!groups.has(root)) {
          groups.set(root, []);
        }
        groups.get(root)?.push({
          key,
          entityId,
          connectorId,
          entityName: entity.name
        });
      }
    }
  }

  const networks: NetworkModel[] = [];
  for (const wire of WIRE_COLORS) {
    const groups = [...(groupsByWire.get(wire)?.values() ?? [])]
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

function buildNetworkSignals(model: SimulationModel, combinatorOutputs: ReadonlyMap<number, ReadonlySignalBag>): Map<string, SignalBag> {
  const networkSignals = new Map<string, SignalBag>(model.networks.map((network) => [network.id, new Map<SignalName, number>()]));

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

function computeNextCombinatorOutputs(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>): Map<number, SignalBag> {
  const outputs = new Map<number, SignalBag>();
  for (const entity of model.combinators) {
    const input = readCombinatorInput(model, networkSignals, entityIdOf(entity));
    let signals: SignalBag = new Map();
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

function readCombinatorInput(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>, entityId: number): SignalBag {
  const signals: SignalBag = new Map();
  for (const wire of WIRE_COLORS) {
    const networkId = model.pointToNetwork.get(pointKey(entityId, 1, wire));
    addSignalMaps(signals, networkId ? networkSignals.get(networkId) ?? new Map() : new Map());
  }
  return signals;
}

function readConstantSignals(entity: BlueprintEntity): SignalBag {
  const signals: SignalBag = new Map();
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

function collectConstantFilters(behavior: Record<string, unknown>): ConstantFilter[] {
  const filters: ConstantFilter[] = [];
  if (Array.isArray(behavior.filters)) {
    filters.push(...(behavior.filters as ConstantFilter[]));
  }
  const sections = behavior.sections;
  if (isRecord(sections) && Array.isArray(sections.sections)) {
    for (const section of sections.sections as ConstantSection[]) {
      if (Array.isArray(section.filters)) {
        filters.push(...section.filters);
      }
    }
  }
  return filters;
}

function evaluateArithmetic(entity: BlueprintEntity, input: ReadonlySignalBag): SignalBag {
  const behavior = entity.control_behavior ?? {};
  const config = (behavior.arithmetic_conditions ?? behavior.arithmeticCondition ?? {}) as ArithmeticConditions;
  const first = operandFrom(config.first_signal, config.first_constant);
  const second = operandFrom(config.second_signal, config.second_constant ?? config.constant);
  const operation = String(config.operation ?? '+').toUpperCase();
  const output = signalName(config.output_signal) ?? 'signal-each';
  const outputSignals: SignalBag = new Map();

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

function evaluateDecider(entity: BlueprintEntity, input: ReadonlySignalBag): SignalBag {
  const behavior = entity.control_behavior ?? {};
  const config = (behavior.decider_conditions ?? behavior.deciderCondition ?? behavior.conditions ?? {}) as DeciderConditions;
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

function evaluateEachDecider(
  input: ReadonlySignalBag,
  first: Operand,
  second: Operand,
  comparator: string,
  outputs: DeciderOutputSpec[]
): SignalBag {
  const result: SignalBag = new Map();
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

function evaluateCondition(first: Operand, second: Operand, comparator: string, input: ReadonlySignalBag): boolean {
  if (first.kind === 'anything') {
    return [...input.keys()].some((signal) => compareValues(getSignal(input, signal), comparator, operandValue(second, input, signal)));
  }
  if (first.kind === 'every') {
    const signals = [...input.keys()];
    return signals.length > 0 && signals.every((signal) => compareValues(getSignal(input, signal), comparator, operandValue(second, input, signal)));
  }
  return compareValues(operandValue(first, input), comparator, operandValue(second, input));
}

function emitDeciderOutputs(input: ReadonlySignalBag, outputs: DeciderOutputSpec[]): SignalBag {
  const result: SignalBag = new Map();
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

function evaluateSelector(entity: BlueprintEntity, input: ReadonlySignalBag): SignalBag {
  const behavior = entity.control_behavior ?? {};
  const config = (behavior.selector_conditions ?? behavior.selectorCondition ?? {}) as SelectorConditions;
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

function compareSelectorSignals(left: [SignalName, number], right: [SignalName, number], sortMode: string): number {
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

function operandFrom(signal: SignalRef | string | undefined, constant: number | undefined): Operand {
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

function operandValue(operand: Operand, signals: ReadonlySignalBag, eachSignal?: SignalName): number {
  if (operand.kind === 'constant') {
    return operand.value;
  }
  if (operand.kind === 'each') {
    return eachSignal ? getSignal(signals, eachSignal) : 0;
  }
  if (operand.kind === 'signal') {
    return getSignal(signals, operand.signal);
  }
  return 0;
}

function applyArithmetic(operation: string, left: number, right: number): number {
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

function normalizeComparator(comparator: string): string {
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

function compareValues(left: number, comparator: string, right: number): boolean {
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

function addSignalsToPoint(
  model: SimulationModel,
  networkSignals: Map<string, SignalBag>,
  entityId: number,
  connectorId: number,
  wire: WireColor,
  signals: ReadonlySignalBag
): void {
  const networkId = model.pointToNetwork.get(pointKey(entityId, connectorId, wire));
  if (!networkId) {
    return;
  }
  const target = networkSignals.get(networkId);
  if (target) {
    addSignalMaps(target, signals);
  }
}

function addSignalMaps(target: SignalBag, source: ReadonlySignalBag): void {
  for (const [signal, value] of source) {
    addSignal(target, signal, value);
  }
}

function addSignal(target: SignalBag, signal: SignalName, value: number): void {
  const next = toInt32((target.get(signal) ?? 0) + value);
  if (next === 0) {
    target.delete(signal);
  } else {
    target.set(signal, next);
  }
}

function getSignal(signals: ReadonlySignalBag, signal: SignalName): number {
  return signals.get(signal) ?? 0;
}

function normalizeSignalMap(signals: SignalMap | ReadonlySignalBag): SignalBag {
  const result: SignalBag = new Map();
  if (signals instanceof Map) {
    addSignalMaps(result, signals);
    return result;
  }
  for (const [signal, value] of Object.entries(signals)) {
    addSignal(result, signal, Number(value));
  }
  return result;
}

function signalName(signal: SignalRef | string | undefined): SignalName | undefined {
  if (!signal) {
    return undefined;
  }
  if (typeof signal === 'string') {
    return signal;
  }
  return signal.name;
}

function formatNetworks(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>): NetworkOutput[] {
  return model.networks.map((network) => ({
    id: network.id,
    wire: network.wire,
    points: network.points.map(({ entityId, connectorId, entityName }) => ({ entityId, connectorId, entityName })),
    signals: Object.fromEntries([...(networkSignals.get(network.id) ?? new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)))
  }));
}

function comparePoints(left: NetworkPoint | undefined, right: NetworkPoint | undefined): number {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  return left.entityId - right.entityId || left.connectorId - right.connectorId || left.entityName.localeCompare(right.entityName);
}

function entityIdOf(entity: BlueprintEntity): number {
  return Number(entity.entity_number ?? entity.entityId ?? entity.id);
}

function pointKey(entityId: number, connectorId: number, wire: WireColor): string {
  return `${entityId}:${connectorId}:${wire}`;
}

function toInt32(value: number): number {
  return Number(BigInt.asIntN(32, BigInt(Math.trunc(Number(value) || 0))));
}

function wrapInt32(value: bigint): number {
  return Number(BigInt.asIntN(32, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

class DisjointSet {
  readonly #parents = new Map<string, string>();

  add(value: string): void {
    if (!this.#parents.has(value)) {
      this.#parents.set(value, value);
    }
  }

  find(value: string): string {
    this.add(value);
    const parent = this.#parents.get(value);
    if (!parent || parent === value) {
      return value;
    }
    const root = this.find(parent);
    this.#parents.set(value, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.#parents.set(rightRoot, leftRoot);
    }
  }
}
