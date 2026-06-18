import { WIRE_CONNECTOR_ID, createBlueprint, writeBlueprintString } from './blueprint.js';
import type {
  ArithmeticCombinatorEntity,
  BlueprintLogisticFilter,
  BlueprintWire,
  ComparatorString,
  ConstantCombinatorEntity,
  DeciderCombinatorEntity,
  DeciderCondition,
  DeciderOutputSpec,
  FactorioBlueprint,
  SelectorCombinatorEntity,
  SelectorCombinatorParameterOperation,
  SelectorCombinatorParameters,
  SignalID,
  SignalMap,
  WireColor
} from './blueprint.js';
import { simulateBlueprint } from './simulator.js';
import type { ExternalInput, SimulationResult } from './simulator.js';

export interface DslCompileOptions {
  includeBlueprintString?: boolean;
}

export interface DslRunTestOptions {
  testName?: string;
}

export interface DslCompiledNetwork {
  id: string;
  color: WireColor;
  representativePoint: {
    entityNumber: number;
    connectorId: number;
  };
}

export interface DslCompiledDocument {
  blueprint: FactorioBlueprint;
  blueprintString?: string;
  tests: DslTestDefinition[];
  networks: DslCompiledNetwork[];
  entities: Record<string, number>;
}

export interface DslAssertionResult {
  tick: number;
  description: string;
  expected: number;
  actual: number;
  passed: boolean;
}

export interface DslTestResult {
  name: string;
  passed: boolean;
  assertions: DslAssertionResult[];
  simulation: SimulationResult;
}

export interface DslTestRunResult {
  passed: boolean;
  tests: DslTestResult[];
}

type CombinatorKind = 'constant' | 'arithmetic' | 'decider' | 'selector' | 'pole';
type PortDirection = 'in' | 'out';

type DeciderOutputValue =
  | { kind: 'input'; networks?: { red?: boolean; green?: boolean } }
  | { kind: 'constant'; value: number };

interface SourceLine {
  line: number;
  indent: number;
  text: string;
}

interface ParsedSignalCount {
  signal: SignalID;
  count: number;
}

interface ParsedSignalRead {
  signal: SignalID;
  networks?: { red?: boolean; green?: boolean };
}

interface ParsedArithmetic {
  first: ParsedSignalRead;
  operation: string;
  secondSignal?: ParsedSignalRead;
  secondConstant?: number;
  output: SignalID;
}

interface ParsedDeciderOutput {
  signal: SignalID;
  value: DeciderOutputValue;
}

interface ParsedDeciderCondition {
  compareType?: 'and' | 'or';
  first: ParsedSignalRead;
  comparator: ComparatorString;
  secondSignal?: ParsedSignalRead;
  secondConstant?: number;
}

interface ParsedSelectorSettings {
  operation?: SelectorCombinatorParameterOperation;
  select_max?: boolean;
  index_signal?: SignalID;
  index_constant?: number;
  count_signal?: SignalID;
  random_update_interval?: number;
  quality_filter?: string | { quality?: string; comparator?: ComparatorString };
  select_quality_from_signal?: boolean;
  quality_source_static?: string;
  quality_source_signal?: { type?: string; name?: string };
  quality_destination_signal?: SignalID;
}

interface ParsedCombinator {
  id: string;
  kind: CombinatorKind;
  poleName?: string;
  constants: ParsedSignalCount[];
  arithmetic?: ParsedArithmetic;
  deciderConditions: ParsedDeciderCondition[];
  deciderOutputs: ParsedDeciderOutput[];
  selectorSettings: ParsedSelectorSettings;
}

interface ParsedWireEdge {
  fromId: string;
  fromPort: PortDirection;
  toId: string;
  toPort: PortDirection;
}

interface ParsedWireNetwork {
  id: string;
  color: WireColor;
  edges: ParsedWireEdge[];
}

interface DslApplySignalAction {
  kind: 'apply-signal';
  tick: number;
  signal: SignalID;
  value: number;
  networkId: string;
}

interface DslAssertNetworkSignalAction {
  kind: 'assert-network-signal';
  tick: number;
  signal: SignalID;
  value: number;
  networkId: string;
}

interface DslAssertCombinatorSignalAction {
  kind: 'assert-combinator-signal';
  tick: number;
  signal: SignalID;
  value: number;
  combinatorId: string;
  side: 'input' | 'output';
}

interface DslSetConstantSignalsAction {
  kind: 'set-constant-signals';
  tick: number;
  combinatorId: string;
  signals: ParsedSignalCount[];
}

type DslTestAction =
  | DslApplySignalAction
  | DslAssertNetworkSignalAction
  | DslAssertCombinatorSignalAction
  | DslSetConstantSignalsAction;

export interface DslTestDefinition {
  name: string;
  actions: DslTestAction[];
}

interface ParsedDslDocument {
  combinators: ParsedCombinator[];
  wireNetworks: ParsedWireNetwork[];
  tests: DslTestDefinition[];
}

export function compileDsl(source: string, options: DslCompileOptions = {}): DslCompiledDocument {
  const parsed = parseDsl(source);
  const { blueprint, compiledNetworks, entityNumberById } = compileBlueprint(parsed);

  return {
    blueprint,
    blueprintString: options.includeBlueprintString ? writeBlueprintString(blueprint) : undefined,
    tests: parsed.tests,
    networks: compiledNetworks,
    entities: Object.fromEntries(entityNumberById.entries())
  };
}

export function runDslTests(sourceOrCompiled: string | DslCompiledDocument, options: DslRunTestOptions = {}): DslTestRunResult {
  const compiled = typeof sourceOrCompiled === 'string' ? compileDsl(sourceOrCompiled) : sourceOrCompiled;
  const testsToRun = options.testName
    ? compiled.tests.filter((test) => test.name === options.testName)
    : compiled.tests;

  if (options.testName && testsToRun.length === 0) {
    throw new Error(`Unknown test '${options.testName}'.`);
  }

  const entityNumberById = new Map(Object.entries(compiled.entities).map(([id, value]) => [id, Number(value)]));
  const networkById = new Map(compiled.networks.map((network) => [network.id, network]));
  const baselineConstantSignals = readConstantSignalsByEntity(compiled.blueprint);

  const results: DslTestResult[] = testsToRun.map((test) => {
    const maxTick = test.actions.reduce((current, action) => Math.max(current, action.tick), 0);
    const externalInputs = buildExternalInputsForTest(test, maxTick, networkById, entityNumberById, baselineConstantSignals);
    const simulation = simulateBlueprint(compiled.blueprint, {
      ticks: maxTick + 1,
      inputs: externalInputs
    });

    const assertions = evaluateAssertions(test, simulation, networkById, entityNumberById);
    return {
      name: test.name,
      passed: assertions.every((assertion) => assertion.passed),
      assertions,
      simulation
    };
  });

  return {
    passed: results.every((result) => result.passed),
    tests: results
  };
}

function parseDsl(source: string): ParsedDslDocument {
  const lines = lexDsl(source);
  const sections = new Map<string, SourceLine[]>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== 0) {
      throw new Error(`Line ${line.line}: top-level section header must have no indentation.`);
    }

    const sectionMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*:$/.exec(line.text);
    if (!sectionMatch) {
      throw new Error(`Line ${line.line}: expected top-level section header like 'combinators:'.`);
    }

    const sectionName = sectionMatch[1].toLowerCase();
    const [nextIndex, block] = readIndentedBlock(lines, index + 1, line.indent);
    sections.set(sectionName, block);
    index = nextIndex;
  }

  return {
    combinators: parseCombinators(sections.get('combinators') ?? []),
    wireNetworks: parseWireNetworks(sections.get('wires') ?? []),
    tests: parseTests(sections.get('tests') ?? [])
  };
}

function parseCombinators(lines: SourceLine[]): ParsedCombinator[] {
  if (lines.length === 0) {
    return [];
  }

  const baseIndent = lines[0].indent;
  const combinators: ParsedCombinator[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== baseIndent) {
      throw new Error(`Line ${line.line}: combinator definition indentation is invalid.`);
    }

    const declarationMatch = /^(.+?)\s*:\s*(.+)$/.exec(line.text);
    if (!declarationMatch) {
      throw new Error(`Line ${line.line}: expected combinator declaration '<id>: <kind>'.`);
    }

    const rawId = declarationMatch[1].trim();
    const typeSpec = declarationMatch[2].trim();
    const combinator = createCombinatorDeclaration(rawId, typeSpec, line.line);

    const [nextIndex, body] = readIndentedBlock(lines, index + 1, baseIndent);
    parseCombinatorBody(combinator, body);
    combinators.push(combinator);
    index = nextIndex;
  }

  return combinators;
}

function createCombinatorDeclaration(id: string, typeSpec: string, line: number): ParsedCombinator {
  const normalized = typeSpec.toLowerCase();
  let kind: CombinatorKind;
  let poleName: string | undefined;

  if (normalized === 'constant') {
    kind = 'constant';
  } else if (normalized === 'arithmetic') {
    kind = 'arithmetic';
  } else if (normalized === 'decider') {
    kind = 'decider';
  } else if (normalized === 'selector') {
    kind = 'selector';
  } else if (normalized.startsWith('pole ')) {
    kind = 'pole';
    poleName = typeSpec.slice('pole '.length).trim();
    if (!poleName) {
      throw new Error(`Line ${line}: pole declaration must include a pole entity name.`);
    }
  } else {
    throw new Error(`Line ${line}: unsupported combinator kind '${typeSpec}'.`);
  }

  return {
    id,
    kind,
    poleName,
    constants: [],
    arithmetic: undefined,
    deciderConditions: [],
    deciderOutputs: [],
    selectorSettings: {}
  };
}

function parseCombinatorBody(combinator: ParsedCombinator, body: SourceLine[]): void {
  if (body.length === 0) {
    return;
  }

  const baseIndent = body[0].indent;

  if (combinator.kind === 'constant') {
    for (const line of body) {
      if (line.indent !== baseIndent) {
        throw new Error(`Line ${line.line}: constant combinator signal indentation is invalid.`);
      }
      combinator.constants.push(parseSignalAssignment(line.text, line.line));
    }
    return;
  }

  if (combinator.kind === 'arithmetic') {
    if (body.length !== 1 || body[0]?.indent !== baseIndent) {
      const errLine = body[1] ?? body[0];
      throw new Error(`Line ${errLine?.line ?? 0}: arithmetic combinator expects a single expression line.`);
    }
    combinator.arithmetic = parseArithmeticExpression(body[0].text, body[0].line);
    return;
  }

  if (combinator.kind === 'decider') {
    let index = 0;
    while (index < body.length) {
      const line = body[index];
      if (line.indent !== baseIndent) {
        throw new Error(`Line ${line.line}: decider subsection indentation is invalid.`);
      }

      const header = line.text.toLowerCase();
      if (header !== 'conditions:' && header !== 'outputs:') {
        throw new Error(`Line ${line.line}: decider body expects 'conditions:' or 'outputs:' subsections.`);
      }

      const [nextIndex, block] = readIndentedBlock(body, index + 1, baseIndent);
      const sectionIndent = block[0]?.indent;
      if (sectionIndent === undefined) {
        throw new Error(`Line ${line.line}: decider subsection must contain at least one line.`);
      }

      for (const entry of block) {
        if (entry.indent !== sectionIndent) {
          throw new Error(`Line ${entry.line}: inconsistent indentation in decider subsection.`);
        }
      }

      if (header === 'conditions:') {
        combinator.deciderConditions.push(...block.map((entry) => parseDeciderCondition(entry.text, entry.line)));
      } else {
        combinator.deciderOutputs.push(...block.map((entry) => parseDeciderOutput(entry.text, entry.line)));
      }

      index = nextIndex;
    }

    return;
  }

  if (combinator.kind === 'selector') {
    for (const line of body) {
      if (line.indent !== baseIndent) {
        throw new Error(`Line ${line.line}: selector parameter indentation is invalid.`);
      }
      parseSelectorParameterLine(combinator.selectorSettings, line.text, line.line);
    }
  }
}

function parseWireNetworks(lines: SourceLine[]): ParsedWireNetwork[] {
  if (lines.length === 0) {
    return [];
  }

  const baseIndent = lines[0].indent;
  const networks: ParsedWireNetwork[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== baseIndent) {
      throw new Error(`Line ${line.line}: wire network indentation is invalid.`);
    }

    const headerMatch = /^network\s+(.+?)\s*:\s*(red|green)$/i.exec(line.text);
    if (!headerMatch) {
      throw new Error(`Line ${line.line}: expected wire network header 'network <id>: <red|green>'.`);
    }

    const id = headerMatch[1].trim();
    const color = headerMatch[2].toLowerCase() as WireColor;
    const [nextIndex, block] = readIndentedBlock(lines, index + 1, baseIndent);
    const edgeIndent = block[0]?.indent;
    if (edgeIndent === undefined) {
      throw new Error(`Line ${line.line}: wire network '${id}' must have at least one wire edge.`);
    }

    const edges = block.map((entry) => {
      if (entry.indent !== edgeIndent) {
        throw new Error(`Line ${entry.line}: inconsistent indentation in wire network '${id}'.`);
      }
      return parseWireEdge(entry.text, entry.line);
    });

    networks.push({ id, color, edges });
    index = nextIndex;
  }

  return networks;
}

function parseWireEdge(text: string, line: number): ParsedWireEdge {
  const edgeMatch = /^(.+?)\s+(in|out)\s*->\s*(.+?)\s+(in|out)$/i.exec(text);
  if (!edgeMatch) {
    throw new Error(`Line ${line}: expected wire edge '<from> <in|out> -> <to> <in|out>'.`);
  }

  return {
    fromId: edgeMatch[1].trim(),
    fromPort: edgeMatch[2].toLowerCase() as PortDirection,
    toId: edgeMatch[3].trim(),
    toPort: edgeMatch[4].toLowerCase() as PortDirection
  };
}

function parseTests(lines: SourceLine[]): DslTestDefinition[] {
  if (lines.length === 0) {
    return [];
  }

  const baseIndent = lines[0].indent;
  const tests: DslTestDefinition[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== baseIndent) {
      throw new Error(`Line ${line.line}: test declaration indentation is invalid.`);
    }

    const testHeaderMatch = /^(.+?)\s*:$/.exec(line.text);
    if (!testHeaderMatch) {
      throw new Error(`Line ${line.line}: expected test header '<name>:'.`);
    }

    const testName = testHeaderMatch[1].trim();
    const [nextIndex, testBody] = readIndentedBlock(lines, index + 1, baseIndent);
    const actions = parseTestActions(testBody, testName);
    tests.push({ name: testName, actions });
    index = nextIndex;
  }

  return tests;
}

function parseTestActions(lines: SourceLine[], testName: string): DslTestAction[] {
  if (lines.length === 0) {
    return [];
  }

  const tickIndent = lines[0].indent;
  const actions: DslTestAction[] = [];
  let index = 0;

  while (index < lines.length) {
    const tickHeader = lines[index];
    if (tickHeader.indent !== tickIndent) {
      throw new Error(`Line ${tickHeader.line}: tick header indentation is invalid in test '${testName}'.`);
    }

    const tickMatch = /^tick\s+(\d+)\s*:$/.exec(tickHeader.text.toLowerCase());
    if (!tickMatch) {
      throw new Error(`Line ${tickHeader.line}: expected tick header 'tick <n>:'.`);
    }

    const tick = Number(tickMatch[1]);
    const [nextIndex, block] = readIndentedBlock(lines, index + 1, tickIndent);
    if (block.length === 0) {
      throw new Error(`Line ${tickHeader.line}: tick ${tick} in test '${testName}' has no actions.`);
    }

    const actionIndent = block[0].indent;
    let blockIndex = 0;
    while (blockIndex < block.length) {
      const line = block[blockIndex];
      if (line.indent !== actionIndent) {
        throw new Error(`Line ${line.line}: invalid action indentation in test '${testName}'.`);
      }

      const setHeader = /^set\s+constant\s+combinator\s+(.+?)\s+signals\s*:\s*$/i.exec(line.text);
      if (setHeader) {
        const [afterSet, setBlock] = readIndentedBlock(block, blockIndex + 1, actionIndent);
        if (setBlock.length === 0) {
          throw new Error(`Line ${line.line}: set constant action requires one or more signal assignments.`);
        }

        const setIndent = setBlock[0].indent;
        const signals = setBlock.map((entry) => {
          if (entry.indent !== setIndent) {
            throw new Error(`Line ${entry.line}: set constant action indentation is invalid.`);
          }
          return parseSignalAssignment(entry.text, entry.line);
        });

        actions.push({
          kind: 'set-constant-signals',
          tick,
          combinatorId: setHeader[1].trim(),
          signals
        });

        blockIndex = afterSet;
        continue;
      }

      actions.push(parseSingleTickAction(line.text, line.line, tick));
      blockIndex += 1;
    }

    index = nextIndex;
  }

  return actions;
}

function parseSingleTickAction(text: string, line: number, tick: number): DslTestAction {
  const applyMatch = /^apply\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+to\s+network\s+(.+)$/i.exec(text);
  if (applyMatch) {
    return {
      kind: 'apply-signal',
      tick,
      signal: parseSignalToken(applyMatch[1], line),
      value: Number(applyMatch[2]),
      networkId: applyMatch[3].trim()
    };
  }

  const assertNetworkMatch = /^assert\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+on\s+network\s+(.+)$/i.exec(text);
  if (assertNetworkMatch) {
    return {
      kind: 'assert-network-signal',
      tick,
      signal: parseSignalToken(assertNetworkMatch[1], line),
      value: Number(assertNetworkMatch[2]),
      networkId: assertNetworkMatch[3].trim()
    };
  }

  const assertCombinatorMatch = /^assert\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+on\s+(input|output)\s+of\s+(.+)$/i.exec(text);
  if (assertCombinatorMatch) {
    return {
      kind: 'assert-combinator-signal',
      tick,
      signal: parseSignalToken(assertCombinatorMatch[1], line),
      value: Number(assertCombinatorMatch[2]),
      side: assertCombinatorMatch[3].toLowerCase() as 'input' | 'output',
      combinatorId: assertCombinatorMatch[4].trim()
    };
  }

  throw new Error(`Line ${line}: unknown test action '${text}'.`);
}

function compileBlueprint(parsed: ParsedDslDocument): {
  blueprint: FactorioBlueprint;
  compiledNetworks: DslCompiledNetwork[];
  entityNumberById: Map<string, number>;
} {
  const combinatorIds = new Set<string>();
  for (const combinator of parsed.combinators) {
    if (combinatorIds.has(combinator.id)) {
      throw new Error(`Duplicate combinator id '${combinator.id}'.`);
    }
    combinatorIds.add(combinator.id);
  }

  const entities = [] as FactorioBlueprint['entities'];
  const entityNumberById = new Map<string, number>();
  const kindById = new Map<string, CombinatorKind>();
  const usedEntityNumbers = new Set<number>();

  let fallbackEntityNumber = 1;
  for (const combinator of parsed.combinators) {
    const desired = parseNumericEntityNumber(combinator.id);
    const entityNumber = desired !== undefined && !usedEntityNumbers.has(desired)
      ? desired
      : nextAvailableEntityNumber(usedEntityNumbers, fallbackEntityNumber);

    fallbackEntityNumber = Math.max(fallbackEntityNumber, entityNumber + 1);
    usedEntityNumbers.add(entityNumber);
    entityNumberById.set(combinator.id, entityNumber);
    kindById.set(combinator.id, combinator.kind);

    entities.push(buildEntity(combinator, entityNumber, entities.length));
  }

  const wiresByEntity = new Map<number, BlueprintWire[]>();
  const compiledNetworks: DslCompiledNetwork[] = [];

  for (const network of parsed.wireNetworks) {
    if (network.edges.length === 0) {
      continue;
    }

    const firstEdge = network.edges[0];
    const firstEntity = resolveCombinatorReference(firstEdge.fromId, entityNumberById);
    const firstKind = resolveCombinatorKind(firstEdge.fromId, kindById);
    compiledNetworks.push({
      id: network.id,
      color: network.color,
      representativePoint: {
        entityNumber: firstEntity,
        connectorId: connectorPointId(firstKind, firstEdge.fromPort)
      }
    });

    for (const edge of network.edges) {
      const sourceEntityNumber = resolveCombinatorReference(edge.fromId, entityNumberById);
      const targetEntityNumber = resolveCombinatorReference(edge.toId, entityNumberById);
      const sourceKind = resolveCombinatorKind(edge.fromId, kindById);
      const targetKind = resolveCombinatorKind(edge.toId, kindById);

      const wire = makeBlueprintWire(
        network.color,
        sourceEntityNumber,
        sourceKind,
        edge.fromPort,
        targetEntityNumber,
        targetKind,
        edge.toPort
      );

      if (!wiresByEntity.has(sourceEntityNumber)) {
        wiresByEntity.set(sourceEntityNumber, []);
      }
      wiresByEntity.get(sourceEntityNumber)?.push(wire);
    }
  }

  for (const entity of entities) {
    const wires = wiresByEntity.get(entity.entity_number);
    if (wires && wires.length > 0) {
      entity.wires = wires;
    }
  }

  return {
    blueprint: createBlueprint(entities as any),
    compiledNetworks,
    entityNumberById
  };
}

function buildEntity(combinator: ParsedCombinator, entityNumber: number, index: number) {
  const base = {
    entity_number: entityNumber,
    position: { x: index * 2, y: 0 }
  };

  if (combinator.kind === 'constant') {
    const filters: BlueprintLogisticFilter[] = combinator.constants.map((entry, filterIndex) => ({
      index: filterIndex + 1,
      type: entry.signal.type,
      name: entry.signal.name,
      quality: entry.signal.quality,
      count: entry.count
    }));

    const entity: ConstantCombinatorEntity = {
      ...base,
      name: 'constant-combinator',
      control_behavior: {
        sections: {
          sections: [{
            index: 1,
            filters
          }]
        }
      }
    };
    return entity;
  }

  if (combinator.kind === 'arithmetic') {
    if (!combinator.arithmetic) {
      throw new Error(`Arithmetic combinator '${combinator.id}' is missing an expression.`);
    }

    const entity: ArithmeticCombinatorEntity = {
      ...base,
      name: 'arithmetic-combinator',
      control_behavior: {
        arithmetic_conditions: {
          first_signal: combinator.arithmetic.first.signal,
          first_signal_networks: combinator.arithmetic.first.networks,
          operation: combinator.arithmetic.operation,
          second_signal: combinator.arithmetic.secondSignal?.signal,
          second_signal_networks: combinator.arithmetic.secondSignal?.networks,
          second_constant: combinator.arithmetic.secondConstant,
          output_signal: combinator.arithmetic.output
        }
      }
    };
    return entity;
  }

  if (combinator.kind === 'decider') {
    const conditions: DeciderCondition[] = combinator.deciderConditions.map((condition) => ({
      first_signal: condition.first.signal,
      first_signal_networks: condition.first.networks,
      second_signal: condition.secondSignal?.signal,
      second_signal_networks: condition.secondSignal?.networks,
      constant: condition.secondConstant,
      comparator: condition.comparator,
      compare_type: condition.compareType
    }));

    const outputs: DeciderOutputSpec[] = combinator.deciderOutputs.map((output) => ({
      signal: output.signal,
      copy_count_from_input: output.value.kind === 'input',
      constant: output.value.kind === 'constant' ? output.value.value : undefined,
      networks: output.value.kind === 'input' ? output.value.networks : undefined
    }));

    const entity: DeciderCombinatorEntity = {
      ...base,
      name: 'decider-combinator',
      control_behavior: {
        decider_conditions: {
          conditions,
          outputs
        }
      }
    };
    return entity;
  }

  if (combinator.kind === 'selector') {
    const entity: SelectorCombinatorEntity = {
      ...base,
      name: 'selector-combinator',
      control_behavior: combinator.selectorSettings as SelectorCombinatorParameters
    };
    return entity;
  }

  return {
    ...base,
    name: combinator.poleName ?? 'medium-electric-pole'
  };
}

function readConstantSignalsByEntity(blueprint: FactorioBlueprint): Map<number, SignalMap> {
  const signalsByEntity = new Map<number, SignalMap>();
  for (const entity of blueprint.entities) {
    if (entity.name !== 'constant-combinator') {
      continue;
    }

    const signals: SignalMap = {};
    const sections = (entity.control_behavior as any)?.sections?.sections;
    if (Array.isArray(sections)) {
      for (const section of sections) {
        const filters = section?.filters;
        if (!Array.isArray(filters)) {
          continue;
        }

        for (const filter of filters) {
          const key = signalKey({ type: filter?.type, name: filter?.name, quality: filter?.quality });
          if (!key) {
            continue;
          }
          signals[key] = Number(filter?.count ?? 0);
        }
      }
    }

    signalsByEntity.set(entity.entity_number, signals);
  }
  return signalsByEntity;
}

function buildExternalInputsForTest(
  test: DslTestDefinition,
  maxTick: number,
  networkById: Map<string, DslCompiledNetwork>,
  entityNumberById: Map<string, number>,
  baselineSignals: Map<number, SignalMap>
): ExternalInput[] {
  const actionsByTick = new Map<number, DslTestAction[]>();
  for (const action of test.actions) {
    if (!actionsByTick.has(action.tick)) {
      actionsByTick.set(action.tick, []);
    }
    actionsByTick.get(action.tick)?.push(action);
  }

  const overrideSignals = new Map<number, SignalMap>();
  const inputs: ExternalInput[] = [];

  for (let tick = 0; tick <= maxTick; tick += 1) {
    const actions = actionsByTick.get(tick) ?? [];

    for (const action of actions) {
      if (action.kind === 'apply-signal') {
        const network = networkById.get(action.networkId);
        if (!network) {
          throw new Error(`Test '${test.name}' references unknown network '${action.networkId}'.`);
        }

        const key = signalKey(action.signal);
        if (!key) {
          throw new Error(`Test '${test.name}' tick ${tick} apply action has invalid signal.`);
        }

        inputs.push({
          tick,
          entityId: network.representativePoint.entityNumber,
          connectorId: network.representativePoint.connectorId,
          wire: network.color,
          signals: { [key]: action.value }
        });
      } else if (action.kind === 'set-constant-signals') {
        const entityNumber = resolveCombinatorReference(action.combinatorId, entityNumberById);
        const nextSignals: SignalMap = {};
        for (const entry of action.signals) {
          const key = signalKey(entry.signal);
          if (!key) {
            throw new Error(`Test '${test.name}' tick ${tick} set constant action has invalid signal.`);
          }
          nextSignals[key] = entry.count;
        }
        overrideSignals.set(entityNumber, nextSignals);
      }
    }

    for (const [entityNumber, signals] of overrideSignals) {
      const baseline = baselineSignals.get(entityNumber) ?? {};
      const delta = subtractSignalMaps(signals, baseline);
      if (Object.keys(delta).length === 0) {
        continue;
      }

      inputs.push({ tick, entityId: entityNumber, connectorId: 1, wire: 'red', signals: delta });
      inputs.push({ tick, entityId: entityNumber, connectorId: 1, wire: 'green', signals: delta });
    }
  }

  return inputs;
}

function evaluateAssertions(
  test: DslTestDefinition,
  simulation: SimulationResult,
  networkById: Map<string, DslCompiledNetwork>,
  entityNumberById: Map<string, number>
): DslAssertionResult[] {
  const assertions: DslAssertionResult[] = [];

  for (const action of test.actions) {
    if (action.kind !== 'assert-network-signal' && action.kind !== 'assert-combinator-signal') {
      continue;
    }

    const key = signalKey(action.signal);
    if (!key) {
      throw new Error(`Test '${test.name}' tick ${action.tick} assertion has invalid signal.`);
    }

    const tickFrame = simulation.ticks[action.tick];
    if (!tickFrame) {
      assertions.push({
        tick: action.tick,
        description: describeAssertion(action),
        expected: action.value,
        actual: 0,
        passed: false
      });
      continue;
    }

    if (action.kind === 'assert-network-signal') {
      const network = networkById.get(action.networkId);
      if (!network) {
        throw new Error(`Test '${test.name}' references unknown network '${action.networkId}'.`);
      }

      const actual = readSignalOnNetwork(tickFrame, network, key);
      assertions.push({
        tick: action.tick,
        description: describeAssertion(action),
        expected: action.value,
        actual,
        passed: actual === action.value
      });
      continue;
    }

    const entityNumber = resolveCombinatorReference(action.combinatorId, entityNumberById);
    const connectorId = action.side === 'input' ? 1 : 2;
    const actual = readSignalOnConnector(tickFrame, entityNumber, connectorId, key, action.side);
    assertions.push({
      tick: action.tick,
      description: describeAssertion(action),
      expected: action.value,
      actual,
      passed: actual === action.value
    });
  }

  return assertions;
}

function readSignalOnNetwork(tickFrame: SimulationResult['ticks'][number], network: DslCompiledNetwork, signal: string): number {
  const frameNetwork = tickFrame.networks.find((candidate) => (
    candidate.wire === network.color
    && candidate.points.some((point) => (
      point.entityId === network.representativePoint.entityNumber
      && point.connectorId === network.representativePoint.connectorId
    ))
  ));

  return Number(frameNetwork?.signals[signal] ?? 0);
}

function readSignalOnConnector(
  tickFrame: SimulationResult['ticks'][number],
  entityNumber: number,
  connectorId: number,
  signal: string,
  side: 'input' | 'output'
): number {
  const values: number[] = [];
  for (const network of tickFrame.networks) {
    if (network.points.some((point) => point.entityId === entityNumber && point.connectorId === connectorId)) {
      values.push(Number(network.signals[signal] ?? 0));
    }
  }

  if (values.length === 0) {
    return 0;
  }

  if (side === 'input') {
    return values.reduce((sum, value) => sum + value, 0);
  }

  return values.reduce((chosen, value) => (Math.abs(value) > Math.abs(chosen) ? value : chosen), 0);
}

function describeAssertion(action: DslAssertNetworkSignalAction | DslAssertCombinatorSignalAction): string {
  if (action.kind === 'assert-network-signal') {
    return `assert signal ${signalKey(action.signal) ?? '<invalid>'} = ${action.value} on network ${action.networkId}`;
  }
  return `assert signal ${signalKey(action.signal) ?? '<invalid>'} = ${action.value} on ${action.side} of ${action.combinatorId}`;
}

function parseSignalAssignment(text: string, line: number): ParsedSignalCount {
  const match = /^(.+?)\s*=\s*(-?\d+)$/.exec(text);
  if (!match) {
    throw new Error(`Line ${line}: expected signal assignment '<signal> = <integer>'.`);
  }
  return {
    signal: parseSignalToken(match[1], line),
    count: Number(match[2])
  };
}

function parseArithmeticExpression(text: string, line: number): ParsedArithmetic {
  const match = /^(.+?)\s+(<<|>>|AND|OR|XOR|\+|-|\*|\/|%|\^)\s+(.+?)\s*->\s*(.+)$/i.exec(text);
  if (!match) {
    throw new Error(`Line ${line}: expected arithmetic expression '<signal [R|G|RG]> <op> <signal [R|G|RG] | constant> -> <signal>'.`);
  }

  const first = parseSignalRead(match[1], line);
  const operation = match[2].toUpperCase();
  const right = match[3].trim();
  const output = parseSignalToken(match[4], line);

  if (!output.name) {
    throw new Error(`Line ${line}: arithmetic output signal must have a name.`);
  }

  if (/^-?\d+$/.test(right)) {
    return {
      first,
      operation,
      secondConstant: Number(right),
      output
    };
  }

  return {
    first,
    operation,
    secondSignal: parseSignalRead(right, line),
    output
  };
}

function parseDeciderCondition(text: string, line: number): ParsedDeciderCondition {
  const match = /^((AND|OR)\s+)?(.+?)\s*(<=|>=|==|!=|=|<|>|≤|≥|≠)\s*(.+)$/i.exec(text);
  if (!match) {
    throw new Error(`Line ${line}: expected decider condition '[AND|OR] <signal [R|G|RG]> <comparator> <signal [R|G|RG] | constant>'.`);
  }

  const compareTypeToken = match[2]?.toLowerCase();
  const first = parseSignalRead(match[3], line);
  const comparator = match[4] as ComparatorString;
  const right = match[5].trim();

  if (/^-?\d+$/.test(right)) {
    return {
      compareType: compareTypeToken as 'and' | 'or' | undefined,
      first,
      comparator,
      secondConstant: Number(right)
    };
  }

  return {
    compareType: compareTypeToken as 'and' | 'or' | undefined,
    first,
    comparator,
    secondSignal: parseSignalRead(right, line)
  };
}

function parseDeciderOutput(text: string, line: number): ParsedDeciderOutput {
  const inputMatch = /^(.+?)\s*=\s*input(?:\s+(R|G|RG))?$/i.exec(text);
  if (inputMatch) {
    return {
      signal: parseSignalToken(inputMatch[1], line),
      value: {
        kind: 'input',
        networks: parseWireSelector(inputMatch[2]?.toUpperCase())
      }
    };
  }

  const constantMatch = /^(.+?)\s*=\s*(-?\d+)$/.exec(text);
  if (constantMatch) {
    return {
      signal: parseSignalToken(constantMatch[1], line),
      value: {
        kind: 'constant',
        value: Number(constantMatch[2])
      }
    };
  }

  throw new Error(`Line ${line}: expected decider output '<signal> = input [R|G|RG]' or '<signal> = <integer>'.`);
}

function parseSelectorParameterLine(settings: ParsedSelectorSettings, text: string, line: number): void {
  const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.+)$/.exec(text);
  if (!match) {
    throw new Error(`Line ${line}: selector parameter must be '<key>: <value>'.`);
  }

  const key = match[1].toLowerCase();
  const value = match[2].trim();

  switch (key) {
    case 'operation':
      settings.operation = value.toLowerCase() as SelectorCombinatorParameterOperation;
      return;
    case 'select_max':
      settings.select_max = parseBoolean(value, line);
      return;
    case 'index_constant':
      settings.index_constant = parseInteger(value, line, key);
      return;
    case 'index_signal':
      settings.index_signal = parseSignalToken(value, line);
      return;
    case 'count_signal':
      settings.count_signal = parseSignalToken(value, line);
      return;
    case 'random_update_interval':
      settings.random_update_interval = parseInteger(value, line, key);
      return;
    case 'quality_filter':
      settings.quality_filter = parseQualityCondition(value);
      return;
    case 'select_quality_from_signal':
      settings.select_quality_from_signal = parseBoolean(value, line);
      return;
    case 'quality_source_static':
      settings.quality_source_static = unquote(value);
      return;
    case 'quality_source_signal':
      settings.quality_source_signal = toSignalIdBase(parseSignalToken(value, line));
      return;
    case 'quality_destination_signal':
      settings.quality_destination_signal = parseSignalToken(value, line);
      return;
    default:
      throw new Error(`Line ${line}: unsupported selector parameter '${key}'.`);
  }
}

function parseQualityCondition(value: string): string | { quality?: string; comparator?: ComparatorString } {
  const unquoted = unquote(value);
  const objectMatch = /^(.+?)\s*(<=|>=|==|!=|=|<|>|≤|≥|≠)\s*(.+)$/.exec(unquoted);
  if (!objectMatch) {
    return unquoted;
  }

  return {
    quality: unquote(objectMatch[1].trim()),
    comparator: objectMatch[2] as ComparatorString
  };
}

function parseSignalRead(text: string, line: number): ParsedSignalRead {
  const match = /^(.*?)(?:\s+(R|G|RG))?$/i.exec(text.trim());
  if (!match) {
    throw new Error(`Line ${line}: invalid signal expression '${text}'.`);
  }

  return {
    signal: parseSignalToken(match[1], line),
    networks: parseWireSelector(match[2]?.toUpperCase())
  };
}

function parseWireSelector(selector: string | undefined): { red?: boolean; green?: boolean } | undefined {
  if (!selector || selector === 'RG') {
    return undefined;
  }
  if (selector === 'R') {
    return { red: true, green: false };
  }
  if (selector === 'G') {
    return { red: false, green: true };
  }
  throw new Error(`Unsupported wire selector '${selector}'.`);
}

function parseSignalToken(token: string, line: number): SignalID {
  const raw = unquote(token.trim());
  if (!raw) {
    throw new Error(`Line ${line}: signal token cannot be empty.`);
  }

  const keyword = raw.toLowerCase();
  if (keyword === 'each') {
    return { type: 'virtual', name: 'signal-each' };
  }
  if (keyword === 'any' || keyword === 'anything') {
    return { type: 'virtual', name: 'signal-anything' };
  }
  if (keyword === 'every' || keyword === 'everything') {
    return { type: 'virtual', name: 'signal-everything' };
  }

  let type: string | undefined;
  let nameAndQuality = raw;

  const typeSeparator = raw.indexOf(':');
  if (typeSeparator > 0) {
    type = raw.slice(0, typeSeparator).trim();
    nameAndQuality = raw.slice(typeSeparator + 1).trim();
  }

  const qualitySeparator = nameAndQuality.lastIndexOf('@');
  let name = nameAndQuality;
  let quality: string | undefined;
  if (qualitySeparator > 0 && qualitySeparator < nameAndQuality.length - 1) {
    name = nameAndQuality.slice(0, qualitySeparator);
    quality = nameAndQuality.slice(qualitySeparator + 1);
  }

  if (!name) {
    throw new Error(`Line ${line}: signal name cannot be empty.`);
  }

  return {
    type: (type || 'virtual') as SignalID['type'],
    name,
    quality
  };
}

function lexDsl(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const normalized = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  normalized.split('\n').forEach((rawLine, index) => {
    const commentRemoved = rawLine.replace(/\s+#.*$/, '');
    if (!commentRemoved.trim()) {
      return;
    }

    const indentText = /^\s*/.exec(commentRemoved)?.[0] ?? '';
    lines.push({
      line: index + 1,
      indent: countIndent(indentText),
      text: commentRemoved.trim()
    });
  });

  return lines;
}

function countIndent(indent: string): number {
  let count = 0;
  for (const char of indent) {
    if (char === '\t') {
      count += 2;
    } else if (char === ' ') {
      count += 1;
    }
  }
  return count;
}

function readIndentedBlock(lines: SourceLine[], startIndex: number, parentIndent: number): [number, SourceLine[]] {
  const block: SourceLine[] = [];
  let index = startIndex;
  while (index < lines.length && lines[index] && lines[index]!.indent > parentIndent) {
    block.push(lines[index]!);
    index += 1;
  }
  return [index, block];
}

function parseBoolean(value: string, line: number): boolean {
  const normalized = value.toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  throw new Error(`Line ${line}: expected boolean literal true/false, received '${value}'.`);
}

function parseInteger(value: string, line: number, field: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Line ${line}: selector field '${field}' must be an integer.`);
  }
  return Number(value);
}

function unquote(value: string): string {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function parseNumericEntityNumber(id: string): number | undefined {
  if (!/^\d+$/.test(id.trim())) {
    return undefined;
  }

  const value = Number(id.trim());
  if (!Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
}

function nextAvailableEntityNumber(used: Set<number>, start: number): number {
  let value = start;
  while (used.has(value)) {
    value += 1;
  }
  return value;
}

function resolveCombinatorReference(id: string, entityNumberById: Map<string, number>): number {
  const resolved = entityNumberById.get(id);
  if (resolved !== undefined) {
    return resolved;
  }

  throw new Error(`Unknown combinator reference '${id}'.`);
}

function resolveCombinatorKind(id: string, kindById: Map<string, CombinatorKind>): CombinatorKind {
  const kind = kindById.get(id);
  if (!kind) {
    throw new Error(`Unknown combinator reference '${id}'.`);
  }
  return kind;
}

function makeBlueprintWire(
  color: WireColor,
  sourceEntity: number,
  sourceKind: CombinatorKind,
  sourcePort: PortDirection,
  targetEntity: number,
  targetKind: CombinatorKind,
  targetPort: PortDirection
): BlueprintWire {
  return [
    sourceEntity,
    wireConnectorId(sourceKind, sourcePort, color),
    targetEntity,
    wireConnectorId(targetKind, targetPort, color)
  ];
}

function wireConnectorId(kind: CombinatorKind, port: PortDirection, color: WireColor) {
  const twoSided = kind === 'arithmetic' || kind === 'decider' || kind === 'selector';
  if (!twoSided) {
    return color === 'red' ? WIRE_CONNECTOR_ID.circuitRed : WIRE_CONNECTOR_ID.circuitGreen;
  }

  if (port === 'in') {
    return color === 'red' ? WIRE_CONNECTOR_ID.combinatorInputRed : WIRE_CONNECTOR_ID.combinatorInputGreen;
  }

  return color === 'red' ? WIRE_CONNECTOR_ID.combinatorOutputRed : WIRE_CONNECTOR_ID.combinatorOutputGreen;
}

function connectorPointId(kind: CombinatorKind, port: PortDirection): number {
  const twoSided = kind === 'arithmetic' || kind === 'decider' || kind === 'selector';
  if (!twoSided) {
    return 1;
  }
  return port === 'in' ? 1 : 2;
}

function toSignalIdBase(signal: SignalID): { type?: string; name?: string } {
  return {
    type: signal.type,
    name: signal.name
  };
}

function signalKey(signal: SignalID | undefined): string | undefined {
  if (!signal?.name) {
    return undefined;
  }
  return signal.quality ? `${signal.name}@${signal.quality}` : signal.name;
}

function subtractSignalMaps(target: SignalMap, baseline: SignalMap): SignalMap {
  const keys = new Set([...Object.keys(target), ...Object.keys(baseline)]);
  const result: SignalMap = {};

  for (const key of keys) {
    const delta = Number(target[key] ?? 0) - Number(baseline[key] ?? 0);
    if (delta !== 0) {
      result[key] = delta;
    }
  }

  return result;
}
