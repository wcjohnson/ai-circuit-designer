import { deflateSync, inflateSync } from 'node:zlib';

export const BLUEPRINT_STRING_VERSION = '0';
export const WIRE_COLORS = ['red', 'green'] as const;

export type BlueprintString = `${typeof BLUEPRINT_STRING_VERSION}${string}`;
export type WireColor = typeof WIRE_COLORS[number];
export type SignalName = string;
export type SignalMap = Record<SignalName, number>;
export type SignalIDType = 'item' | 'fluid' | 'virtual' | 'recipe' | 'entity' | 'space-location' | 'asteroid-chunk' | 'quality' | string;
export type ComparatorString = '<' | '>' | '=' | '==' | '!=' | '<=' | '>=' | '≤' | '≥' | '≠' | string;

export interface Position {
  x: number;
  y: number;
}

export interface SignalID {
  type?: SignalIDType;
  name?: SignalName;
  quality?: string;
}

export interface CircuitNetworkSelection {
  red?: boolean;
  green?: boolean;
}

export const WIRE_CONNECTOR_ID = {
  circuitRed: 1,
  circuitGreen: 2,
  combinatorInputRed: 3,
  combinatorInputGreen: 4,
  combinatorOutputRed: 5,
  combinatorOutputGreen: 6,
  poleCopper: 7,
  powerSwitchLeftCopper: 8,
  powerSwitchRightCopper: 9
} as const;

export type WireConnectorId = typeof WIRE_CONNECTOR_ID[keyof typeof WIRE_CONNECTOR_ID];

export type BlueprintWire = [
  sourceEntityNumber: number,
  sourceWireConnectorId: WireConnectorId,
  targetEntityNumber: number,
  targetWireConnectorId: WireConnectorId
];

export type Tags = Record<string, unknown>;

export interface BaseBlueprintEntity {
  entity_number: number;
  name: string;
  position: Position;
  direction?: number;
  mirror?: boolean;
  quality?: string;
  items?: unknown[];
  tags?: Tags;
  wires?: BlueprintWire[];
  control_behavior?: unknown;
}

export type PowerPoleName = 'small-electric-pole' | 'medium-electric-pole' | 'big-electric-pole' | 'substation';

export interface PowerPoleEntity extends BaseBlueprintEntity {
  name: PowerPoleName;
}

export interface BlueprintLogisticFilter {
  index: number;
  type?: SignalIDType;
  name?: string;
  quality?: string;
  comparator?: ComparatorString;
  count: number;
  max_count?: number;
  minimum_delivery_count?: number;
  import_from?: string;
}

export interface ConstantSection {
  index: number;
  filters?: BlueprintLogisticFilter[];
  group?: string;
  multiplier?: number;
  active?: boolean;
}

export interface LogisticSections {
  sections?: ConstantSection[];
  trash_not_requested?: boolean;
}

export interface ConstantControlBehavior {
  sections: LogisticSections;
  is_on?: boolean;
}

export interface ConstantCombinatorEntity extends BaseBlueprintEntity {
  name: 'constant-combinator';
  player_description?: string;
  control_behavior?: ConstantControlBehavior;
}

export interface ArithmeticConditions {
  first_signal?: SignalID;
  first_signal_networks?: CircuitNetworkSelection;
  first_constant?: number;
  second_signal?: SignalID;
  second_signal_networks?: CircuitNetworkSelection;
  second_constant?: number;
  constant?: number;
  operation?: '+' | '-' | '*' | '/' | '%' | '^' | '<<' | '>>' | 'AND' | 'OR' | 'XOR' | string;
  output_signal?: SignalID;
}

export interface ArithmeticControlBehavior {
  arithmetic_conditions?: ArithmeticConditions;
}

export interface ArithmeticCombinatorEntity extends BaseBlueprintEntity {
  name: 'arithmetic-combinator';
  player_description?: string;
  control_behavior?: ArithmeticControlBehavior;
}

export interface DeciderCondition {
  first_signal?: SignalID;
  first_signal_networks?: CircuitNetworkSelection;
  second_signal?: SignalID;
  second_signal_networks?: CircuitNetworkSelection;
  constant?: number;
  comparator?: ComparatorString;
  compare_type?: 'and' | 'or';
}

export interface DeciderOutputSpec {
  signal: SignalID;
  copy_count_from_input?: boolean;
  constant?: number;
  networks?: CircuitNetworkSelection;
}

export interface DeciderConditions {
  conditions: DeciderCondition[];
  outputs: DeciderOutputSpec[];
}

export interface DeciderControlBehavior {
  decider_conditions?: DeciderConditions;
}

export interface DeciderCombinatorEntity extends BaseBlueprintEntity {
  name: 'decider-combinator';
  player_description?: string;
  control_behavior?: DeciderControlBehavior;
}

export interface QualityConditionObject {
  quality?: string;
  comparator?: ComparatorString;
}

export type QualityCondition = string | QualityConditionObject;

export interface SignalIDBase {
  type?: SignalIDType;
  name?: string;
}

export type SelectorCombinatorParameterOperation =
  | 'select'
  | 'count'
  | 'random'
  | 'quality-transfer'
  | 'rocket-capacity'
  | 'stack-size'
  | 'quality-filter';

export interface SelectorCombinatorParameters {
  operation?: SelectorCombinatorParameterOperation;
  select_max?: boolean;
  index_signal?: SignalID;
  index_constant?: number;
  count_signal?: SignalID;
  random_update_interval?: number;
  quality_filter?: QualityCondition;
  select_quality_from_signal?: boolean;
  quality_source_static?: string;
  quality_source_signal?: SignalIDBase;
  quality_destination_signal?: SignalID;
}

export interface SelectorCombinatorEntity extends BaseBlueprintEntity {
  name: 'selector-combinator';
  player_description?: string;
  control_behavior?: SelectorCombinatorParameters;
}

export type CombinatorEntity =
  | ConstantCombinatorEntity
  | ArithmeticCombinatorEntity
  | DeciderCombinatorEntity
  | SelectorCombinatorEntity;

export type SupportedBlueprintEntity = CombinatorEntity | PowerPoleEntity;
export interface UnknownBlueprintEntity extends BaseBlueprintEntity {
  [key: string]: unknown;
}

export type BlueprintEntity = SupportedBlueprintEntity | UnknownBlueprintEntity;

export interface FactorioBlueprint {
  item?: 'blueprint' | string;
  label?: string;
  version?: number;
  entities: BlueprintEntity[];
  wires?: BlueprintWire[];
  [key: string]: unknown;
}

export interface BlueprintWrapper {
  blueprint: FactorioBlueprint;
}

export interface BlueprintBookWrapper {
  blueprint_book: {
    blueprints?: Array<BlueprintWrapper | Record<string, unknown>>;
    [key: string]: unknown;
  };
}

export type BlueprintDocument = FactorioBlueprint | BlueprintWrapper | BlueprintBookWrapper;
export type BlueprintInput = string | BlueprintDocument;

export interface WriteBlueprintJsonOptions {
  pretty?: boolean | number;
}

export function isBlueprintString(input: string): input is BlueprintString {
  return input.trim().startsWith(BLUEPRINT_STRING_VERSION) && !input.trim().startsWith('{');
}

export function readBlueprint(input: BlueprintInput): FactorioBlueprint {
  if (typeof input !== 'string') {
    return normalizeBlueprintDocument(input);
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Blueprint input is empty.');
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return readBlueprintJson(trimmed);
  }
  return readBlueprintString(trimmed);
}

export function readBlueprintJson(json: string): FactorioBlueprint {
  return normalizeBlueprintDocument(JSON.parse(json) as unknown);
}

export function readBlueprintString(blueprintString: string): FactorioBlueprint {
  const trimmed = blueprintString.trim();
  if (!trimmed.startsWith(BLUEPRINT_STRING_VERSION)) {
    throw new Error(`Unsupported blueprint string version '${trimmed[0] ?? ''}'.`);
  }

  const decoded = Buffer.from(trimmed.slice(1), 'base64');
  const json = inflateSync(decoded).toString('utf8');
  return readBlueprintJson(json);
}

export function writeBlueprintJson(input: FactorioBlueprint | BlueprintWrapper, options: WriteBlueprintJsonOptions = {}): string {
  const wrapper = wrapBlueprint(input);
  const spaces = options.pretty === true ? 2 : options.pretty || 0;
  return JSON.stringify(wrapper, null, spaces);
}

export function writeBlueprintString(input: FactorioBlueprint | BlueprintWrapper): BlueprintString {
  const json = writeBlueprintJson(input);
  const compressed = deflateSync(Buffer.from(json, 'utf8')).toString('base64');
  return `${BLUEPRINT_STRING_VERSION}${compressed}`;
}

export function wrapBlueprint(input: FactorioBlueprint | BlueprintWrapper): BlueprintWrapper {
  if (isRecord(input) && isRecord(input.blueprint)) {
    return { blueprint: normalizeBlueprintDocument(input) };
  }
  return { blueprint: normalizeBlueprintDocument(input) };
}

export function createBlueprint(entities: SupportedBlueprintEntity[], options: Omit<FactorioBlueprint, 'entities'> = {}): FactorioBlueprint {
  return {
    item: 'blueprint',
    ...options,
    entities
  };
}

export function normalizeBlueprintDocument(data: unknown): FactorioBlueprint {
  if (!isRecord(data)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }

  if (isRecord(data.blueprint)) {
    return normalizeBlueprintDocument(data.blueprint);
  }

  if (isRecord(data.blueprint_book)) {
    const blueprints = data.blueprint_book.blueprints;
    if (Array.isArray(blueprints)) {
      const firstBlueprint = blueprints.find((entry) => isRecord(entry) && isRecord(entry.blueprint));
      if (firstBlueprint) {
        return normalizeBlueprintDocument(firstBlueprint);
      }
    }
    throw new Error('Blueprint book does not contain a blueprint.');
  }

  if (!Array.isArray(data.entities)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }

  validateBlueprint(data);

  const normalized = { ...data } as Record<string, unknown>;
  const mergedWires = mergeBlueprintWires(normalized);
  if (mergedWires.length > 0 || 'wires' in normalized) {
    normalized.wires = mergedWires;
  }

  return normalized as unknown as FactorioBlueprint;
}

function validateBlueprint(blueprint: Record<string, unknown>): void {
  const entities = blueprint.entities;
  if (!Array.isArray(entities)) {
    throw new Error('Expected a blueprint object with an entities array.');
  }

  const entityNumbers = new Set<number>();
  entities.forEach((entity, index) => {
    if (!isRecord(entity)) {
      throw new Error(`Invalid Factorio 2.0 blueprint entity at index ${index}: expected an object.`);
    }
    validateBlueprintEntity(entity, index, entityNumbers);
  });

  entities.forEach((entity, index) => {
    validateBlueprintEntityWires(entity as Record<string, unknown>, index, entityNumbers);
  });

  validateBlueprintGlobalWires(blueprint, entityNumbers);
}

function validateBlueprintEntity(entity: Record<string, unknown>, index: number, entityNumbers: Set<number>): void {
  if ('connections' in entity) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity at index ${index}: use wires, not legacy connections.`);
  }

  if (!isUint32(entity.entity_number)) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity at index ${index}: entity_number must be a uint32.`);
  }
  if (entityNumbers.has(entity.entity_number)) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity at index ${index}: duplicate entity_number ${entity.entity_number}.`);
  }
  entityNumbers.add(entity.entity_number);

  if (typeof entity.name !== 'string' || entity.name.length === 0) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity ${entity.entity_number}: name must be a non-empty string.`);
  }
  if (!isPosition(entity.position)) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity ${entity.entity_number}: position must contain numeric x and y values.`);
  }
}

function validateBlueprintEntityWires(entity: Record<string, unknown>, index: number, entityNumbers: ReadonlySet<number>): void {
  const wires = entity.wires;
  if (wires === undefined) {
    return;
  }
  if (!Array.isArray(wires)) {
    throw new Error(`Invalid Factorio 2.0 blueprint entity at index ${index}: wires must be an array.`);
  }

  wires.forEach((wire, wireIndex) => {
    if (!isBlueprintWire(wire)) {
      throw new Error(`Invalid Factorio 2.0 blueprint entity ${entity.entity_number} wire ${wireIndex}: expected [source_entity_number, source_wire_connector_id, target_entity_number, target_wire_connector_id].`);
    }
    const [sourceEntity, , targetEntity] = wire;
    if (!entityNumbers.has(sourceEntity) || !entityNumbers.has(targetEntity)) {
      throw new Error(`Invalid Factorio 2.0 blueprint entity ${entity.entity_number} wire ${wireIndex}: source and target entity numbers must exist in the blueprint.`);
    }
  });
}

function validateBlueprintGlobalWires(blueprint: Record<string, unknown>, entityNumbers: ReadonlySet<number>): void {
  const wires = blueprint.wires;
  if (wires === undefined) {
    return;
  }
  if (!Array.isArray(wires)) {
    throw new Error('Invalid Factorio 2.0 blueprint: wires must be an array when provided.');
  }

  wires.forEach((wire, wireIndex) => {
    if (!isBlueprintWire(wire)) {
      throw new Error(`Invalid Factorio 2.0 blueprint wire ${wireIndex}: expected [source_entity_number, source_wire_connector_id, target_entity_number, target_wire_connector_id].`);
    }
    const [sourceEntity, , targetEntity] = wire;
    if (!entityNumbers.has(sourceEntity) || !entityNumbers.has(targetEntity)) {
      throw new Error(`Invalid Factorio 2.0 blueprint wire ${wireIndex}: source and target entity numbers must exist in the blueprint.`);
    }
  });
}

function mergeBlueprintWires(blueprint: Record<string, unknown>): BlueprintWire[] {
  const merged: BlueprintWire[] = [];
  const seen = new Set<string>();

  const addWire = (wire: unknown): void => {
    if (!isBlueprintWire(wire)) {
      return;
    }
    const key = wire.join(',');
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push([wire[0], wire[1], wire[2], wire[3]]);
  };

  const blueprintWires = blueprint.wires;
  if (Array.isArray(blueprintWires)) {
    blueprintWires.forEach(addWire);
  }

  const entities = blueprint.entities;
  if (Array.isArray(entities)) {
    entities.forEach((entity) => {
      if (!isRecord(entity) || !Array.isArray(entity.wires)) {
        return;
      }
      entity.wires.forEach(addWire);
    });
  }

  return merged;
}

function isBlueprintWire(value: unknown): value is BlueprintWire {
  if (!Array.isArray(value) || value.length !== 4) {
    return false;
  }
  const [sourceEntity, sourceConnector, targetEntity, targetConnector] = value;
  return isUint32(sourceEntity)
    && isWireConnectorId(sourceConnector)
    && isUint32(targetEntity)
    && isWireConnectorId(targetConnector);
}

function isWireConnectorId(value: unknown): value is WireConnectorId {
  return Object.values(WIRE_CONNECTOR_ID).includes(value as WireConnectorId);
}

function isPosition(value: unknown): value is Position {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number';
}

function isUint32(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xFFFFFFFF;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
