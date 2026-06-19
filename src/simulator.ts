import { WIRE_COLORS, WIRE_CONNECTOR_ID, readBlueprint } from './blueprint.js';
import type {
  BlueprintEntity,
  BlueprintInput,
  BlueprintWire,
  CircuitNetworkSelection,
  ComparatorString,
  FactorioBlueprint,
  QualityCondition,
  SelectorCombinatorParameters,
  SignalID,
  SignalMap,
  SignalName,
  WireColor,
  WireConnectorId
} from './blueprint.js';

export {
  createBlueprint,
  isBlueprintString,
  normalizeBlueprintDocument,
  readBlueprint as parseBlueprint,
  readBlueprint,
  readBlueprintJson,
  readBlueprintString,
  WIRE_CONNECTOR_ID,
  wrapBlueprint,
  writeBlueprintJson,
  writeBlueprintString
} from './blueprint.js';

export type {
  ArithmeticCombinatorEntity,
  ArithmeticConditions,
  BlueprintEntity,
  BlueprintInput,
  BlueprintString,
  BlueprintWire,
  BlueprintWrapper,
  CircuitNetworkSelection,
  CombinatorEntity,
  ConstantCombinatorEntity,
  BlueprintLogisticFilter,
  DeciderCombinatorEntity,
  DeciderCondition,
  DeciderOutputSpec,
  FactorioBlueprint,
  PowerPoleEntity,
  PowerPoleName,
  SelectorCombinatorEntity,
  SelectorCombinatorParameters,
  SignalID,
  SignalMap,
  SignalName,
  SupportedBlueprintEntity,
  Tags,
  UnknownBlueprintEntity,
  WireConnectorId,
  WireColor
} from './blueprint.js';

export interface ExternalInput {
  entityId?: number;
  connectorId?: number;
  wire: WireColor;
  signals: SignalMap;
  tick?: number;
}

interface NormalizedExternalInput {
  entityId: number;
  connectorId: number;
  wire: WireColor;
  signals: ReadonlySignalBag;
  tick?: number;
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

export interface SimulatorState {
  readonly tick: number;
  readonly ignoredEntities: readonly IgnoredEntity[];
  step(): TickOutput;
  run(ticks: number): TickOutput[];
}

type SignalBag = Map<SignalName, number>;
type ReadonlySignalBag = ReadonlyMap<SignalName, number>;
type EntityMap = Map<number, BlueprintEntity>;
type NumericInput = number | string | undefined | null;

interface CombinatorWireInputs {
  red: SignalBag;
  green: SignalBag;
  combined: SignalBag;
}

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

interface BlueprintLogisticFilter {
  type?: string;
  name?: string;
  quality?: string;
  count?: number;
}

interface ConstantSection {
  filters?: BlueprintLogisticFilter[];
}

interface LogisticSections {
  sections?: ConstantSection[];
}

interface ArithmeticConditions {
  first_signal?: SignalID;
  first_signal_networks?: CircuitNetworkSelection;
  first_constant?: number;
  second_signal?: SignalID;
  second_signal_networks?: CircuitNetworkSelection;
  second_constant?: number;
  constant?: number;
  operation?: string;
  output_signal?: SignalID;
}

interface DeciderCondition {
  first_signal?: SignalID;
  first_signal_networks?: CircuitNetworkSelection;
  second_signal?: SignalID;
  second_signal_networks?: CircuitNetworkSelection;
  constant?: number;
  comparator?: string;
  compare_type?: 'and' | 'or';
}

interface DeciderOutputSpec {
  signal: SignalID;
  copy_count_from_input?: boolean;
  constant?: number;
  networks?: CircuitNetworkSelection;
}

interface DeciderConditions {
  conditions?: DeciderCondition[];
  outputs?: DeciderOutputSpec[];
}

const SUPPORTED_COMBINATORS = new Set<string>([
  'constant-combinator',
  'arithmetic-combinator',
  'decider-combinator',
  'selector-combinator'
]);

export function simulateBlueprint(input: BlueprintInput, options: SimulateOptions = {}): SimulationResult {
  const ticks = Number.isInteger(options.ticks) ? options.ticks as number : 3;
  const state = createSimulationState(input, { inputs: options.inputs });
  const frames = state.run(ticks);

  return {
    ticks: frames,
    ignoredEntities: [...state.ignoredEntities]
  };
}

export function createSimulationState(
  input: BlueprintInput,
  options: Pick<SimulateOptions, 'inputs'> = {}
): SimulatorState {
  const blueprint = readBlueprint(input);
  const externalInputs = normalizeExternalInputs(options.inputs ?? []);
  const model = buildModel(blueprint, externalInputs);
  return new BlueprintSimulatorState(model);
}

class BlueprintSimulatorState implements SimulatorState {
  #tick = 0;
  #combinatorOutputs: Map<number, SignalBag> = new Map<number, SignalBag>();
  readonly #model: SimulationModel;

  constructor(model: SimulationModel) {
    this.#model = model;
  }

  get tick(): number {
    return this.#tick;
  }

  get ignoredEntities(): readonly IgnoredEntity[] {
    return this.#model.ignoredEntities;
  }

  step(): TickOutput {
    const networkSignals = buildNetworkSignals(this.#model, this.#combinatorOutputs, this.#tick);
    const frame: TickOutput = {
      tick: this.#tick,
      networks: formatNetworks(this.#model, networkSignals)
    };
    this.#combinatorOutputs = computeNextCombinatorOutputs(this.#model, networkSignals);
    this.#tick += 1;
    return frame;
  }

  run(ticks: number): TickOutput[] {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error('ticks must be a non-negative integer.');
    }

    const frames: TickOutput[] = [];
    for (let index = 0; index < ticks; index += 1) {
      frames.push(this.step());
    }
    return frames;
  }
}

function normalizeExternalInputs(inputs: ExternalInput[] | string): NormalizedExternalInput[] {
  if (typeof inputs === 'string') {
    return normalizeExternalInputs(JSON.parse(inputs) as ExternalInput[]);
  }
  if (!Array.isArray(inputs)) {
    throw new Error('External inputs must be an array.');
  }

  return inputs.map((input, index) => {
    const entityId = Number(input.entityId);
    const connectorId = Number(input.connectorId ?? 1);
    const wire = input.wire;
    if (!Number.isInteger(entityId) || !Number.isInteger(connectorId)) {
      throw new Error(`External input ${index} must specify entityId and connectorId.`);
    }
    if (!WIRE_COLORS.includes(wire)) {
      throw new Error(`External input ${index} must specify wire as red or green.`);
    }
    const tick = input.tick;
    if (tick !== undefined && (!Number.isInteger(tick) || tick < 0)) {
      throw new Error(`External input ${index} tick must be a non-negative integer when provided.`);
    }
    return {
      entityId,
      connectorId,
      wire,
      signals: normalizeSignalMap(input.signals ?? {}),
      tick
    };
  });
}

function buildModel(blueprint: FactorioBlueprint, externalInputs: NormalizedExternalInput[]): SimulationModel {
  const entities: EntityMap = new Map();
  const ignoredEntities: IgnoredEntity[] = [];

  for (const entity of blueprint.entities) {
    const entityId = Number(entity.entity_number);
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

  connectBlueprintWires(entities, blueprint.wires ?? [], dsu);

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

function connectBlueprintWires(entities: EntityMap, wires: ReadonlyArray<BlueprintWire>, dsu: DisjointSet): void {
  for (const wireSpec of wires) {
    if (!wireSpec) {
      continue;
    }
    const [sourceEntity, sourceWireConnector, targetEntity, targetWireConnector] = wireSpec;
    const sourcePoint = wireConnectorPoint(sourceWireConnector);
    const targetPoint = wireConnectorPoint(targetWireConnector);
    if (!sourcePoint || !targetPoint || sourcePoint.wire !== targetPoint.wire) {
      continue;
    }
    unionWire(
      entities,
      dsu,
      sourceEntity,
      sourcePoint.connectorId,
      targetEntity,
      targetPoint.connectorId,
      sourcePoint.wire
    );
  }
}

function wireConnectorPoint(wireConnectorId: WireConnectorId): { wire: WireColor; connectorId: number } | undefined {
  switch (wireConnectorId) {
    case WIRE_CONNECTOR_ID.circuitRed:
      return { wire: 'red', connectorId: 1 };
    case WIRE_CONNECTOR_ID.circuitGreen:
      return { wire: 'green', connectorId: 1 };
    case WIRE_CONNECTOR_ID.combinatorInputRed:
      return { wire: 'red', connectorId: 1 };
    case WIRE_CONNECTOR_ID.combinatorInputGreen:
      return { wire: 'green', connectorId: 1 };
    case WIRE_CONNECTOR_ID.combinatorOutputRed:
      return { wire: 'red', connectorId: 2 };
    case WIRE_CONNECTOR_ID.combinatorOutputGreen:
      return { wire: 'green', connectorId: 2 };
    default:
      return undefined;
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

function buildNetworkSignals(model: SimulationModel, combinatorOutputs: ReadonlyMap<number, ReadonlySignalBag>, tick: number): Map<string, SignalBag> {
  const networkSignals = new Map<string, SignalBag>(model.networks.map((network) => [network.id, new Map<SignalName, number>()]));

  for (const entity of model.constants) {
    const signals = readConstantSignals(entity);
    for (const wire of WIRE_COLORS) {
      addSignalsToPoint(model, networkSignals, entityIdOf(entity), 1, wire, signals);
    }
  }

  for (const input of model.externalInputs) {
    if (input.tick !== undefined && input.tick !== tick) {
      continue;
    }
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
    const wireInputs = readCombinatorWireInputs(model, networkSignals, entityIdOf(entity));
    const input = wireInputs.combined;
    let signals: SignalBag = new Map();
    if (entity.name === 'arithmetic-combinator') {
      signals = evaluateArithmetic(entity, wireInputs);
    } else if (entity.name === 'decider-combinator') {
      signals = evaluateDecider(entity, wireInputs);
    } else if (entity.name === 'selector-combinator') {
      signals = evaluateSelector(entity, input);
    }
    outputs.set(entityIdOf(entity), signals);
  }
  return outputs;
}

function readCombinatorInput(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>, entityId: number): SignalBag {
  return readCombinatorWireInputs(model, networkSignals, entityId).combined;
}

function readCombinatorWireInputs(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>, entityId: number): CombinatorWireInputs {
  const red = readCombinatorWireInput(model, networkSignals, entityId, 'red');
  const green = readCombinatorWireInput(model, networkSignals, entityId, 'green');
  const signals: SignalBag = new Map();
  addSignalMaps(signals, red);
  addSignalMaps(signals, green);
  return { red, green, combined: signals };
}

function readCombinatorWireInput(model: SimulationModel, networkSignals: ReadonlyMap<string, ReadonlySignalBag>, entityId: number, wire: WireColor): SignalBag {
  const signals: SignalBag = new Map();
  const networkId = model.pointToNetwork.get(pointKey(entityId, 1, wire));
  addSignalMaps(signals, networkId ? networkSignals.get(networkId) ?? new Map() : new Map());
  return signals;
}

function readConstantSignals(entity: BlueprintEntity): SignalBag {
  const signals: SignalBag = new Map();
  const behavior = (entity.control_behavior ?? {}) as Record<string, unknown>;
  if (behavior.is_on === false) {
    return signals;
  }
  for (const filter of collectConstantFilters(behavior)) {
    const signal = signalName({ type: filter.type, name: filter.name, quality: filter.quality });
    const count = Number(filter.count ?? 0);
    if (signal && count !== 0) {
      addSignal(signals, signal, count);
    }
  }
  return signals;
}

function collectConstantFilters(behavior: Record<string, unknown>): BlueprintLogisticFilter[] {
  const filters: BlueprintLogisticFilter[] = [];
  const sections = behavior.sections;
  if (isRecord(sections) && Array.isArray((sections as LogisticSections).sections)) {
    for (const section of (sections as LogisticSections).sections ?? []) {
      if (Array.isArray(section.filters)) {
        filters.push(...section.filters);
      }
    }
  }
  return filters;
}

function evaluateArithmetic(entity: BlueprintEntity, inputs: CombinatorWireInputs): SignalBag {
  const behavior = (entity.control_behavior ?? {}) as Record<string, unknown>;
  const config = (behavior.arithmetic_conditions ?? {}) as ArithmeticConditions;
  const first = operandFrom(config.first_signal, config.first_constant);
  const second = operandFrom(config.second_signal, config.second_constant ?? config.constant);
  const firstInput = selectCircuitNetworks(inputs, config.first_signal_networks);
  const secondInput = selectCircuitNetworks(inputs, config.second_signal_networks);
  const operation = String(config.operation ?? '+').toUpperCase();
  const output = signalName(config.output_signal) ?? 'signal-each';
  const outputSignals: SignalBag = new Map();

  if (first.kind === 'each' || second.kind === 'each' || output === 'signal-each') {
    const signalNames = new Set([...firstInput.keys(), ...secondInput.keys()]);
    for (const signal of [...signalNames].sort()) {
      const result = applyArithmetic(operation, operandValue(first, firstInput, signal), operandValue(second, secondInput, signal));
      if (result !== 0) {
        addSignal(outputSignals, output === 'signal-each' ? signal : output, result);
      }
    }
    return outputSignals;
  }

  const result = applyArithmetic(operation, operandValue(first, firstInput), operandValue(second, secondInput));
  if (result !== 0) {
    outputSignals.set(output, result);
  }
  return outputSignals;
}

function selectCircuitNetworks(inputs: CombinatorWireInputs, selection: CircuitNetworkSelection | undefined): ReadonlySignalBag {
  const useRed = selection?.red ?? true;
  const useGreen = selection?.green ?? true;
  if (useRed && useGreen) {
    return inputs.combined;
  }
  if (useRed) {
    return inputs.red;
  }
  if (useGreen) {
    return inputs.green;
  }
  return new Map();
}

function evaluateDecider(entity: BlueprintEntity, inputs: CombinatorWireInputs): SignalBag {
  const behavior = (entity.control_behavior ?? {}) as Record<string, unknown>;
  const config = (behavior.decider_conditions ?? {}) as DeciderConditions;
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  const outputs = Array.isArray(config.outputs) ? config.outputs : [];
  const firstCondition = conditions[0];
  if (!firstCondition || outputs.length === 0) {
    return new Map();
  }
  if (operandFrom(firstCondition.first_signal, undefined).kind === 'each') {
    return evaluateEachDecider(inputs, conditions, outputs);
  }

  const passed = evaluateDeciderConditions(conditions, inputs);
  if (!passed) {
    return new Map();
  }
  return emitDeciderOutputs(inputs, outputs);
}

function evaluateDeciderConditions(conditions: DeciderCondition[], inputs: CombinatorWireInputs, eachSignal?: SignalName): boolean {
  let result = false;
  conditions.forEach((condition, index) => {
    const conditionResult = evaluateDeciderCondition(condition, inputs, eachSignal);
    if (index === 0) {
      result = conditionResult;
      return;
    }
    result = condition.compare_type === 'and'
      ? result && conditionResult
      : result || conditionResult;
  });
  return result;
}

function evaluateDeciderCondition(condition: DeciderCondition, inputs: CombinatorWireInputs, eachSignal?: SignalName): boolean {
  const first = operandFrom(condition.first_signal, undefined);
  const second = operandFrom(condition.second_signal, condition.constant);
  const comparator = normalizeComparator(condition.comparator ?? '<');
  const firstInput = selectCircuitNetworks(inputs, condition.first_signal_networks);
  const secondInput = selectCircuitNetworks(inputs, condition.second_signal_networks);
  return evaluateCondition(first, second, comparator, firstInput, secondInput, eachSignal);
}

function evaluateEachDecider(
  inputs: CombinatorWireInputs,
  conditions: DeciderCondition[],
  outputs: DeciderOutputSpec[]
): SignalBag {
  const result: SignalBag = new Map();
  const signalNames = new Set<SignalName>();
  for (const condition of conditions) {
    for (const signal of selectCircuitNetworks(inputs, condition.first_signal_networks).keys()) {
      signalNames.add(signal);
    }
    for (const signal of selectCircuitNetworks(inputs, condition.second_signal_networks).keys()) {
      signalNames.add(signal);
    }
  }
  for (const signal of [...signalNames].sort()) {
    if (!evaluateDeciderConditions(conditions, inputs, signal)) {
      continue;
    }
    for (const output of outputs) {
      const outputSignal = signalName(output.signal) ?? 'signal-each';
      const value = output.copy_count_from_input === false ? output.constant ?? 1 : getSignal(selectCircuitNetworks(inputs, output.networks), signal);
      addSignal(result, isEachLikeOutputSignal(outputSignal) ? signal : outputSignal, value);
    }
  }
  return result;
}

function evaluateCondition(first: Operand, second: Operand, comparator: string, firstInput: ReadonlySignalBag, secondInput: ReadonlySignalBag, eachSignal?: SignalName): boolean {
  if (first.kind === 'anything') {
    return [...firstInput.keys()].some((signal) => compareValues(getSignal(firstInput, signal), comparator, operandValue(second, secondInput, signal)));
  }
  if (first.kind === 'every') {
    const signals = [...firstInput.keys()];
    return signals.length > 0 && signals.every((signal) => compareValues(getSignal(firstInput, signal), comparator, operandValue(second, secondInput, signal)));
  }
  return compareValues(operandValue(first, firstInput, eachSignal), comparator, operandValue(second, secondInput, eachSignal));
}

function emitDeciderOutputs(inputs: CombinatorWireInputs, outputs: DeciderOutputSpec[]): SignalBag {
  const result: SignalBag = new Map();
  for (const output of outputs) {
    const outputSignal = signalName(output.signal);
    if (!outputSignal) {
      continue;
    }
    if (isEverythingOutputSignal(outputSignal)) {
      addSignalMaps(result, selectCircuitNetworks(inputs, output.networks));
      continue;
    }
    if (isEachOutputSignal(outputSignal)) {
      // In non-each deciders, `each` output is not valid and should not emit pass-through signals.
      continue;
    }
    const value = output.copy_count_from_input === false
      ? output.constant ?? 1
      : getSignal(selectCircuitNetworks(inputs, output.networks), outputSignal);
    if (value !== 0) {
      addSignal(result, outputSignal, value);
    }
  }
  return result;
}

function isEachOutputSignal(signal: string): boolean {
  return signal === 'signal-each';
}

function isEverythingOutputSignal(signal: string): boolean {
  return signal === 'signal-everything' || signal === 'signal-every';
}

function isEachLikeOutputSignal(signal: string): boolean {
  return isEachOutputSignal(signal) || isEverythingOutputSignal(signal);
}

function evaluateSelector(entity: BlueprintEntity, input: ReadonlySignalBag): SignalBag {
  const config = (entity.control_behavior ?? {}) as SelectorCombinatorParameters;
  const operation = config.operation ?? 'select';

  if (operation === 'select') {
    return evaluateSelectorSelect(config, input);
  }
  if (operation === 'count') {
    return evaluateSelectorCount(config, input);
  }
  if (operation === 'quality-filter') {
    return evaluateSelectorQualityFilter(config, input);
  }
  if (operation === 'quality-transfer') {
    return evaluateSelectorQualityTransfer(config, input);
  }

  // Unsupported selector operations are intentionally ignored by the simulator.
  return new Map();
}

function evaluateSelectorSelect(config: SelectorCombinatorParameters, input: ReadonlySignalBag): SignalBag {
  const indexSignal = signalName(config.index_signal);
  const candidates = [...input.entries()].filter(([signal, value]) => (
    value !== 0 && !isSelectorIndexSignal(signal, indexSignal)
  ));
  const selectMax = config.select_max ?? true;
  candidates.sort((left, right) => compareSelectorSignals(left, right, selectMax));

  const index = Math.max(0, toInt32(resolveSelectorIndex(input, indexSignal, Number(config.index_constant ?? 0))));
  const selected = candidates[index];
  return selected ? new Map([selected]) : new Map();
}

function resolveSelectorIndex(input: ReadonlySignalBag, indexSignal: SignalName | undefined, indexConstant: number): number {
  if (!indexSignal) {
    return indexConstant;
  }

  const exact = input.get(indexSignal);
  if (exact !== undefined) {
    return exact;
  }

  const parsedIndexSignal = parseSignalKey(indexSignal);
  if (!parsedIndexSignal.quality) {
    return sumSignalValuesByName(input, parsedIndexSignal.name);
  }

  return 0;
}

function isSelectorIndexSignal(candidateSignal: SignalName, indexSignal: SignalName | undefined): boolean {
  if (!indexSignal) {
    return false;
  }
  if (candidateSignal === indexSignal) {
    return true;
  }

  const parsedIndexSignal = parseSignalKey(indexSignal);
  if (parsedIndexSignal.quality) {
    return false;
  }

  return parseSignalKey(candidateSignal).name === parsedIndexSignal.name;
}

function sumSignalValuesByName(input: ReadonlySignalBag, signalNameBase: string): number {
  let total = 0;
  for (const [signal, value] of input.entries()) {
    if (parseSignalKey(signal).name === signalNameBase) {
      total += value;
    }
  }
  return total;
}

function evaluateSelectorCount(config: SelectorCombinatorParameters, input: ReadonlySignalBag): SignalBag {
  const outputSignal = signalName(config.count_signal);
  if (!outputSignal) {
    return new Map();
  }

  const count = [...input.values()].filter((value) => value !== 0).length;
  return count === 0 ? new Map() : new Map([[outputSignal, count]]);
}

function evaluateSelectorQualityFilter(config: SelectorCombinatorParameters, input: ReadonlySignalBag): SignalBag {
  const condition = normalizeQualityCondition(config.quality_filter);
  if (!condition) {
    return new Map(input);
  }

  const result: SignalBag = new Map();
  for (const [signal, value] of input.entries()) {
    const quality = parseSignalKey(signal).quality;
    if (qualityMatchesCondition(quality, condition.quality, condition.comparator)) {
      result.set(signal, value);
    }
  }
  return result;
}

function evaluateSelectorQualityTransfer(config: SelectorCombinatorParameters, input: ReadonlySignalBag): SignalBag {
  const destination = config.quality_destination_signal;
  if (!destination?.name) {
    return new Map();
  }

  const selectedQuality = selectTransferQuality(config, input);
  if (!selectedQuality) {
    return new Map();
  }

  const destinationKey = makeSignalKey(destination.name, selectedQuality);
  const sourceBaseName = config.quality_source_signal?.name;
  const transferredValue = sourceBaseName
    ? sumSignalValuesByNameAndQuality(input, sourceBaseName, selectedQuality)
    : 1;
  if (transferredValue === 0) {
    return new Map();
  }
  return new Map([[destinationKey, transferredValue]]);
}

function compareSelectorSignals(left: [SignalName, number], right: [SignalName, number], selectMax: boolean): number {
  const [leftSignal, leftValue] = left;
  const [rightSignal, rightValue] = right;
  if (!selectMax) {
    return leftValue - rightValue || leftSignal.localeCompare(rightSignal);
  }
  return rightValue - leftValue || leftSignal.localeCompare(rightSignal);
}

function normalizeQualityCondition(input: QualityCondition | undefined): { quality?: string; comparator: ComparatorString } | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (typeof input === 'string') {
    return { quality: input, comparator: '==' };
  }
  return {
    quality: input.quality,
    comparator: input.comparator ?? '=='
  };
}

function qualityMatchesCondition(candidate: string | undefined, expected: string | undefined, comparator: ComparatorString): boolean {
  if (!expected) {
    return true;
  }

  const candidateRank = qualityRank(candidate);
  const expectedRank = qualityRank(expected);
  if (candidateRank === undefined || expectedRank === undefined) {
    return normalizeComparator(comparator) === '==' ? candidate === expected : false;
  }
  return compareValues(candidateRank, normalizeComparator(comparator), expectedRank);
}

function selectTransferQuality(config: SelectorCombinatorParameters, input: ReadonlySignalBag): string | undefined {
  if (config.select_quality_from_signal) {
    const sourceName = config.quality_source_signal?.name;
    if (!sourceName) {
      return undefined;
    }

    let selected: { quality: string; value: number } | undefined;
    for (const [signal, value] of input.entries()) {
      const parsed = parseSignalKey(signal);
      if (parsed.name !== sourceName || !parsed.quality) {
        continue;
      }
      if (!selected || Math.abs(value) > Math.abs(selected.value)) {
        selected = { quality: parsed.quality, value };
      }
    }
    return selected?.quality;
  }
  return config.quality_source_static;
}

function sumSignalValuesByNameAndQuality(input: ReadonlySignalBag, name: string, quality: string): number {
  let total = 0;
  for (const [signal, value] of input.entries()) {
    const parsed = parseSignalKey(signal);
    if (parsed.name === name && parsed.quality === quality) {
      total += value;
    }
  }
  return toInt32(total);
}

function qualityRank(quality: string | undefined): number | undefined {
  if (!quality) {
    return undefined;
  }
  const levels = ['normal', 'uncommon', 'rare', 'epic', 'legendary'];
  const index = levels.indexOf(quality);
  return index === -1 ? undefined : index;
}

function operandFrom(signal: SignalID | undefined, constant: number | undefined): Operand {
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

function signalName(signal: SignalID | undefined): SignalName | undefined {
  if (!signal) {
    return undefined;
  }
  if (!signal.name) {
    return undefined;
  }
  return makeSignalKey(signal.name, signal.quality);
}

function makeSignalKey(name: string, quality: string | undefined): SignalName {
  return quality ? `${name}@${quality}` : name;
}

function parseSignalKey(signal: SignalName): { name: string; quality?: string } {
  const separatorIndex = signal.lastIndexOf('@');
  if (separatorIndex <= 0 || separatorIndex >= signal.length - 1) {
    return { name: signal };
  }
  return {
    name: signal.slice(0, separatorIndex),
    quality: signal.slice(separatorIndex + 1)
  };
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
  return Number(entity.entity_number);
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
