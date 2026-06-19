import { WIRE_CONNECTOR_ID, createBlueprint, writeBlueprintString } from './blueprint.js';
import { readFileSync } from 'node:fs';
import { dirname, join, parse as parsePath } from 'node:path';
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
import { createSimulationState } from './simulator.js';
import type { ExternalInput, SimulationResult } from './simulator.js';

export interface DslCompileOptions {
  includeBlueprintString?: boolean;
  sourcePath?: string;
}

export interface DslRunTestOptions {
  testName?: string;
  sourcePath?: string;
}

export interface DslCompiledNetwork {
  id: string;
  color: WireColor;
  representativePoint: {
    entityNumber: number;
    connectorId: number;
  };
  points: Array<{
    entityNumber: number;
    connectorId: number;
  }>;
}

export interface DslCompiledDocument {
  blueprint: FactorioBlueprint;
  blueprintString?: string;
  tests: DslTestDefinition[];
  networks: DslCompiledNetwork[];
  entities: Record<string, number>;
  io?: Record<string, 'input' | 'output'>;
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

type CombinatorKind = 'constant' | 'arithmetic' | 'decider' | 'selector' | 'pole' | 'input' | 'output' | 'circuit';
type PortDirection = 'in' | 'out';

interface ParsedWireEndpoint {
  combinatorId: string;
  port: PortDirection;
  subIoId?: string;
}

interface ParsedCircuitInfo {
  name: string;
  description?: string;
  imports?: string[];
}

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
  circuitName?: string;
  constants: ParsedSignalCount[];
  arithmetic?: ParsedArithmetic;
  deciderConditions: ParsedDeciderCondition[];
  deciderOutputs: ParsedDeciderOutput[];
  selectorSettings: ParsedSelectorSettings;
}

interface ParsedWireEdge {
  from: ParsedWireEndpoint;
  to: ParsedWireEndpoint;
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

interface DslApplySignalContinuousAction {
  kind: 'apply-signal-continuous';
  tick: number;
  signal: SignalID;
  value: number;
  networkId: string;
}

interface DslApplyIoSignalAction {
  kind: 'apply-io-signal';
  tick: number;
  signal: SignalID;
  value: number;
  side: 'input' | 'output';
  combinatorId: string;
  wire: WireColor;
}

interface DslApplyIoSignalContinuousAction {
  kind: 'apply-io-signal-continuous';
  tick: number;
  signal: SignalID;
  value: number;
  side: 'input' | 'output';
  combinatorId: string;
  wire: WireColor;
}

interface DslAssertNetworkSignalAction {
  kind: 'assert-network-signal';
  tick: number;
  signal: SignalID;
  value: number;
  networkId: string;
}

interface DslAssertIoSignalAction {
  kind: 'assert-io-signal';
  tick: number;
  signal: SignalID;
  value: number;
  side: 'input' | 'output';
  combinatorId: string;
  wire: WireColor;
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
  | DslApplySignalContinuousAction
  | DslApplyIoSignalAction
  | DslApplyIoSignalContinuousAction
  | DslAssertNetworkSignalAction
  | DslAssertIoSignalAction
  | DslAssertCombinatorSignalAction
  | DslSetConstantSignalsAction;

export interface DslTestDefinition {
  name: string;
  actions: DslTestAction[];
}

interface ParsedDslDocument {
  circuit?: ParsedCircuitInfo;
  sourcePath?: string;
  combinators: ParsedCombinator[];
  wireNetworks: ParsedWireNetwork[];
  tests: DslTestDefinition[];
}

export function compileDsl(source: string, options: DslCompileOptions = {}): DslCompiledDocument {
  const parsed = parseDsl(source, options.sourcePath);
  if (parsed.circuit && !options.sourcePath) {
    throw new Error('Circuit DSL with a circuit section must be loaded from a file path.');
  }
  validateCircuitNameMatchesFile(parsed);
  const registry = loadImportRegistry(parsed);
  const expanded = expandParsedDocument(parsed, registry);
  const { blueprint, compiledNetworks, entityNumberById } = compileBlueprint(expanded);
  const io = Object.fromEntries(
    expanded.combinators
      .filter((combinator) => combinator.kind === 'input' || combinator.kind === 'output')
      .map((combinator) => [combinator.id, combinator.kind])
  ) as Record<string, 'input' | 'output'>;

  return {
    blueprint,
    blueprintString: options.includeBlueprintString ? writeBlueprintString(blueprint) : undefined,
    tests: expanded.tests,
    networks: compiledNetworks,
    entities: Object.fromEntries(entityNumberById.entries()),
    io
  };
}

export function runDslTests(sourceOrCompiled: string | DslCompiledDocument, options: DslRunTestOptions = {}): DslTestRunResult {
  const compiled = typeof sourceOrCompiled === 'string'
    ? compileDsl(sourceOrCompiled, { sourcePath: options.sourcePath })
    : sourceOrCompiled;
  const testsToRun = options.testName
    ? compiled.tests.filter((test) => test.name === options.testName)
    : compiled.tests;

  if (options.testName && testsToRun.length === 0) {
    throw new Error(`Unknown test '${options.testName}'.`);
  }

  const entityNumberById = new Map(Object.entries(compiled.entities).map(([id, value]) => [id, Number(value)]));
  const networkById = new Map(compiled.networks.map((network) => [network.id, network]));
  const ioDirectionById = new Map(Object.entries(compiled.io ?? {}));
  const baselineConstantSignals = readConstantSignalsByEntity(compiled.blueprint);

  const results: DslTestResult[] = testsToRun.map((test) => {
    const maxTick = test.actions.reduce((current, action) => Math.max(current, action.tick), 0);
    const externalInputs = buildExternalInputsForTest(
      test,
      maxTick,
      networkById,
      entityNumberById,
      ioDirectionById,
      baselineConstantSignals
    );
    const state = createSimulationState(compiled.blueprint, { inputs: externalInputs });
    const ticks: SimulationResult['ticks'] = [];
    for (let tick = 0; tick <= maxTick; tick += 1) {
      ticks.push(state.step());
    }
    const simulation: SimulationResult = {
      ticks,
      ignoredEntities: [...state.ignoredEntities]
    };

    const assertions = evaluateAssertions(test, simulation, networkById, entityNumberById, ioDirectionById);
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

function parseDsl(source: string, sourcePath?: string): ParsedDslDocument {
  const lines = lexDsl(source);
  const sections = new Map<string, { header: SourceLine; value?: string; block: SourceLine[] }>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent !== 0) {
      throw new Error(`Line ${line.line}: top-level section header must have no indentation.`);
    }

    const sectionMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.text);
    if (!sectionMatch) {
      throw new Error(`Line ${line.line}: expected top-level section header like 'combinators:'.`);
    }

    const sectionName = sectionMatch[1].toLowerCase();
    const sectionValue = sectionMatch[2]?.trim() || undefined;
    const [nextIndex, block] = readIndentedBlock(lines, index + 1, line.indent);
    sections.set(sectionName, { header: line, value: sectionValue, block });
    index = nextIndex;
  }

  return {
    sourcePath,
    circuit: parseCircuitSection(sections.get('circuit')),
    combinators: parseCombinators(sections.get('combinators')?.block ?? []),
    wireNetworks: parseWireNetworks(sections.get('wires')?.block ?? []),
    tests: parseTests(sections.get('tests')?.block ?? [])
  };
}

function parseCircuitSection(section: { header: SourceLine; value?: string; block: SourceLine[] } | undefined): ParsedCircuitInfo | undefined {
  if (!section) {
    return undefined;
  }

  const name = section.value?.trim();
  if (!name) {
    throw new Error(`Line ${section.header.line}: circuit section must include a circuit name: 'circuit: <name>'.`);
  }

  const info: ParsedCircuitInfo = { name };
  if (section.block.length === 0) {
    return info;
  }

  const baseIndent = section.block[0].indent;
  for (const line of section.block) {
    if (line.indent !== baseIndent) {
      throw new Error(`Line ${line.line}: invalid indentation in circuit section.`);
    }

    const kvMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.text);
    if (!kvMatch) {
      throw new Error(`Line ${line.line}: expected circuit metadata '<key>: <value>'.`);
    }

    const key = kvMatch[1].toLowerCase();
    const value = kvMatch[2].trim();
    if (key === 'description') {
      info.description = value;
      continue;
    }
    if (key === 'imports') {
      const imports = value ? value.split(/\s+/).filter(Boolean) : [];
      if (imports.length > 0) {
        info.imports = imports;
      }
      continue;
    }

    throw new Error(`Line ${line.line}: unsupported circuit metadata key '${kvMatch[1]}'.`);
  }

  return info;
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
  } else if (normalized.startsWith('input ')) {
    kind = 'input';
    poleName = typeSpec.slice('input '.length).trim();
    if (!poleName) {
      throw new Error(`Line ${line}: input declaration must include a pole entity name.`);
    }
  } else if (normalized.startsWith('output ')) {
    kind = 'output';
    poleName = typeSpec.slice('output '.length).trim();
    if (!poleName) {
      throw new Error(`Line ${line}: output declaration must include a pole entity name.`);
    }
  } else if (normalized.startsWith('circuit ')) {
    kind = 'circuit';
    poleName = undefined;
  } else {
    throw new Error(`Line ${line}: unsupported combinator kind '${typeSpec}'.`);
  }

  return {
    id,
    kind,
    poleName,
    circuitName: kind === 'circuit' ? typeSpec.slice('circuit '.length).trim() : undefined,
    constants: [],
    arithmetic: undefined,
    deciderConditions: [],
    deciderOutputs: [],
    selectorSettings: {}
  };
}

function parseCombinatorBody(combinator: ParsedCombinator, body: SourceLine[]): void {
  if (combinator.kind === 'circuit') {
    if (body.length > 0) {
      throw new Error(`Line ${body[0].line}: circuit combinator does not accept a body.`);
    }
    return;
  }

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
  const edgeMatch = /^(.+?)\s*->\s*(.+)$/.exec(text);
  if (!edgeMatch) {
    throw new Error(`Line ${line}: expected wire edge '<from> -> <to>'.`);
  }

  return {
    from: parseWireEndpoint(edgeMatch[1].trim(), line, 'from'),
    to: parseWireEndpoint(edgeMatch[2].trim(), line, 'to')
  };
}

function parseWireEndpoint(text: string, line: number, side: 'from' | 'to'): ParsedWireEndpoint {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`Line ${line}: wire ${side} endpoint must be '<id> <in|out>' or '<subcircuit-id> <io-id>'.`);
  }

  const second = parts[1];
  if (second === 'in' || second === 'out') {
    return {
      combinatorId: parts[0],
      port: second as PortDirection
    };
  }

  return {
    combinatorId: parts[0],
    subIoId: parts[1],
    port: side === 'from' ? 'out' : 'in'
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
  const applyIoContinuousMatch = /^apply\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+to\s+(input|output)\s+(.+?)\s+(red|green)\s+continuously$/i.exec(text);
  if (applyIoContinuousMatch) {
    return {
      kind: 'apply-io-signal-continuous',
      tick,
      signal: parseSignalToken(applyIoContinuousMatch[1], line),
      value: Number(applyIoContinuousMatch[2]),
      side: applyIoContinuousMatch[3].toLowerCase() as 'input' | 'output',
      combinatorId: applyIoContinuousMatch[4].trim(),
      wire: applyIoContinuousMatch[5].toLowerCase() as WireColor
    };
  }

  const applyContinuousMatch = /^apply\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+to\s+network\s+(.+?)\s+continuously$/i.exec(text);
  if (applyContinuousMatch) {
    return {
      kind: 'apply-signal-continuous',
      tick,
      signal: parseSignalToken(applyContinuousMatch[1], line),
      value: Number(applyContinuousMatch[2]),
      networkId: applyContinuousMatch[3].trim()
    };
  }

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

  const applyIoMatch = /^apply\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+to\s+(input|output)\s+(.+?)\s+(red|green)$/i.exec(text);
  if (applyIoMatch) {
    return {
      kind: 'apply-io-signal',
      tick,
      signal: parseSignalToken(applyIoMatch[1], line),
      value: Number(applyIoMatch[2]),
      side: applyIoMatch[3].toLowerCase() as 'input' | 'output',
      combinatorId: applyIoMatch[4].trim(),
      wire: applyIoMatch[5].toLowerCase() as WireColor
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

  const assertIoMatch = /^assert\s+signal\s+(.+?)\s*=\s*(-?\d+)\s+on\s+(input|output)\s+(.+?)\s+(red|green)$/i.exec(text);
  if (assertIoMatch) {
    return {
      kind: 'assert-io-signal',
      tick,
      signal: parseSignalToken(assertIoMatch[1], line),
      value: Number(assertIoMatch[2]),
      side: assertIoMatch[3].toLowerCase() as 'input' | 'output',
      combinatorId: assertIoMatch[4].trim(),
      wire: assertIoMatch[5].toLowerCase() as WireColor
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
    const firstEntity = resolveCombinatorReference(firstEdge.from.combinatorId, entityNumberById);
    const firstKind = resolveCombinatorKind(firstEdge.from.combinatorId, kindById);
    const points = new Map<string, { entityNumber: number; connectorId: number }>();
    const addPoint = (entityNumber: number, connectorId: number) => {
      points.set(`${entityNumber}:${connectorId}`, { entityNumber, connectorId });
    };

    addPoint(firstEntity, connectorPointId(firstKind, firstEdge.from.port));
    compiledNetworks.push({
      id: network.id,
      color: network.color,
      representativePoint: {
        entityNumber: firstEntity,
        connectorId: connectorPointId(firstKind, firstEdge.from.port)
      },
      points: []
    });

    for (const edge of network.edges) {
      const sourceEntityNumber = resolveCombinatorReference(edge.from.combinatorId, entityNumberById);
      const targetEntityNumber = resolveCombinatorReference(edge.to.combinatorId, entityNumberById);
      const sourceKind = resolveCombinatorKind(edge.from.combinatorId, kindById);
      const targetKind = resolveCombinatorKind(edge.to.combinatorId, kindById);
      const sourceConnectorId = connectorPointId(sourceKind, edge.from.port);
      const targetConnectorId = connectorPointId(targetKind, edge.to.port);

      addPoint(sourceEntityNumber, sourceConnectorId);
      addPoint(targetEntityNumber, targetConnectorId);

      const wire = makeBlueprintWire(
        network.color,
        sourceEntityNumber,
        sourceKind,
        edge.from.port,
        targetEntityNumber,
        targetKind,
        edge.to.port
      );

      if (!wiresByEntity.has(sourceEntityNumber)) {
        wiresByEntity.set(sourceEntityNumber, []);
      }
      wiresByEntity.get(sourceEntityNumber)?.push(wire);
    }

    const compiledNetwork = compiledNetworks[compiledNetworks.length - 1];
    if (compiledNetwork) {
      compiledNetwork.points = Array.from(points.values());
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
    const filters: BlueprintLogisticFilter[] = combinator.constants.map((entry, filterIndex) => {
      const filter: BlueprintLogisticFilter = {
        index: filterIndex + 1,
        type: entry.signal.type,
        name: entry.signal.name,
        count: entry.count
      };

      if (entry.signal.quality) {
        filter.quality = entry.signal.quality;
      }

      return filter;
    });

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
  ioDirectionById: Map<string, 'input' | 'output'>,
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
  const continuousSignals = new Map<string, { network: DslCompiledNetwork; signalKey: string; value: number }>();
  const inputs: ExternalInput[] = [];

  for (let tick = 0; tick <= maxTick; tick += 1) {
    const actions = actionsByTick.get(tick) ?? [];

    for (const action of actions) {
      if (
        action.kind === 'apply-signal'
        || action.kind === 'apply-signal-continuous'
        || action.kind === 'apply-io-signal'
        || action.kind === 'apply-io-signal-continuous'
      ) {
        let network: DslCompiledNetwork | undefined;
        if (action.kind === 'apply-signal' || action.kind === 'apply-signal-continuous') {
          network = networkById.get(action.networkId);
          if (!network) {
            throw new Error(`Test '${test.name}' references unknown network '${action.networkId}'.`);
          }
        } else {
          network = resolveIoNetworkTarget(
            test.name,
            action.tick,
            action.side,
            action.combinatorId,
            action.wire,
            networkById,
            entityNumberById,
            ioDirectionById
          );
        }

        const key = signalKey(action.signal);
        if (!key) {
          throw new Error(`Test '${test.name}' tick ${tick} apply action has invalid signal.`);
        }

        if (action.kind === 'apply-signal' || action.kind === 'apply-io-signal') {
          inputs.push({
            tick,
            entityId: network.representativePoint.entityNumber,
            connectorId: network.representativePoint.connectorId,
            wire: network.color,
            signals: { [key]: action.value }
          });
        } else {
          const continuousKey = `${network.id}|${key}`;
          if (action.value === 0) {
            continuousSignals.delete(continuousKey);
          } else {
            continuousSignals.set(continuousKey, {
              network,
              signalKey: key,
              value: action.value
            });
          }
        }
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

    for (const continuous of continuousSignals.values()) {
      inputs.push({
        tick,
        entityId: continuous.network.representativePoint.entityNumber,
        connectorId: continuous.network.representativePoint.connectorId,
        wire: continuous.network.color,
        signals: { [continuous.signalKey]: continuous.value }
      });
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
  entityNumberById: Map<string, number>,
  ioDirectionById: Map<string, 'input' | 'output'>
): DslAssertionResult[] {
  const assertions: DslAssertionResult[] = [];

  for (const action of test.actions) {
    if (
      action.kind !== 'assert-network-signal'
      && action.kind !== 'assert-io-signal'
      && action.kind !== 'assert-combinator-signal'
    ) {
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

    if (action.kind === 'assert-network-signal' || action.kind === 'assert-io-signal') {
      let network: DslCompiledNetwork | undefined;
      if (action.kind === 'assert-network-signal') {
        network = networkById.get(action.networkId);
        if (!network) {
          throw new Error(`Test '${test.name}' references unknown network '${action.networkId}'.`);
        }
      } else {
        network = resolveIoNetworkTarget(
          test.name,
          action.tick,
          action.side,
          action.combinatorId,
          action.wire,
          networkById,
          entityNumberById,
          ioDirectionById
        );
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

function describeAssertion(action: DslAssertNetworkSignalAction | DslAssertIoSignalAction | DslAssertCombinatorSignalAction): string {
  if (action.kind === 'assert-network-signal') {
    return `assert signal ${signalKey(action.signal) ?? '<invalid>'} = ${action.value} on network ${action.networkId}`;
  }
  if (action.kind === 'assert-io-signal') {
    return `assert signal ${signalKey(action.signal) ?? '<invalid>'} = ${action.value} on ${action.side} ${action.combinatorId} ${action.wire}`;
  }
  return `assert signal ${signalKey(action.signal) ?? '<invalid>'} = ${action.value} on ${action.side} of ${action.combinatorId}`;
}

function resolveIoNetworkTarget(
  testName: string,
  tick: number,
  side: 'input' | 'output',
  combinatorId: string,
  wire: WireColor,
  networkById: Map<string, DslCompiledNetwork>,
  entityNumberById: Map<string, number>,
  ioDirectionById: Map<string, 'input' | 'output'>
): DslCompiledNetwork {
  const direction = ioDirectionById.get(combinatorId);
  if (!direction) {
    throw new Error(`Test '${testName}' tick ${tick} references unknown named ${side} '${combinatorId}'.`);
  }
  if (direction !== side) {
    throw new Error(`Test '${testName}' tick ${tick} references ${side} '${combinatorId}', but it is declared as ${direction}.`);
  }

  const entityNumber = resolveCombinatorReference(combinatorId, entityNumberById);
  const matches = Array.from(networkById.values()).filter((network) => (
    network.color === wire
    &&
    network.points.some((point) => point.entityNumber === entityNumber)
  ));

  if (matches.length === 0) {
    throw new Error(`Test '${testName}' tick ${tick} named ${side} '${combinatorId}' is not connected to any ${wire} network.`);
  }

  if (matches.length > 1) {
    const ids = matches.map((network) => network.id).join(', ');
    throw new Error(`Test '${testName}' tick ${tick} named ${side} '${combinatorId}' is connected to multiple ${wire} networks (${ids}); target an explicit network instead.`);
  }

  return matches[0];
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

  if (/^[A-Z0-9]$/.test(raw)) {
    return { type: 'virtual', name: `signal-${raw}` };
  }

  const itemMatch = /^item\(([^,()\s][^,()]*)\s*(?:,\s*([^)]+?)\s*)?\)$/.exec(raw);
  if (itemMatch) {
    const itemName = itemMatch[1].trim();
    const quality = itemMatch[2]?.trim();
    if (!itemName) {
      throw new Error(`Line ${line}: item signal name cannot be empty.`);
    }

    if (quality === '') {
      throw new Error(`Line ${line}: item signal quality cannot be empty.`);
    }

    return {
      type: 'item',
      name: itemName,
      quality: quality && quality !== 'normal' ? quality : undefined
    };
  }

  throw new Error(
    `Line ${line}: unsupported signal token '${raw}'. Use one-character virtual signals A-Z/0-9 or item(name[,quality]).`
  );
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

function validateCircuitNameMatchesFile(parsed: ParsedDslDocument): void {
  if (!parsed.circuit || !parsed.sourcePath) {
    return;
  }

  const parsedPath = parsePath(parsed.sourcePath);
  const base = parsedPath.base;
  let expected: string | undefined;
  if (base.endsWith('.circuit-dsl')) {
    expected = base.slice(0, -'.circuit-dsl'.length);
  } else if (base.endsWith('.circuit_dsl')) {
    expected = base.slice(0, -'.circuit_dsl'.length);
  }

  if (!expected) {
    return;
  }

  if (parsed.circuit.name !== expected) {
    throw new Error(`Circuit name '${parsed.circuit.name}' must match filename stem '${expected}'.`);
  }
}

function loadImportRegistry(root: ParsedDslDocument): Map<string, ParsedDslDocument> {
  const registry = new Map<string, ParsedDslDocument>();
  const rootDir = root.sourcePath ? dirname(root.sourcePath) : undefined;
  const stack = new Set<string>();

  const ensureLoaded = (name: string): ParsedDslDocument => {
    if (registry.has(name)) {
      return registry.get(name)!;
    }
    if (!rootDir) {
      throw new Error(`Cannot resolve import '${name}' without a source file path.`);
    }
    if (stack.has(name)) {
      throw new Error(`Circular circuit import detected at '${name}'.`);
    }
    stack.add(name);

    const candidates = [
      join(rootDir, `${name}.circuit-dsl`),
      join(rootDir, `${name}.circuit_dsl`)
    ];

    let loadedPath: string | undefined;
    let loadedSource: string | undefined;
    for (const candidate of candidates) {
      try {
        loadedSource = readFileSync(candidate, 'utf8');
        loadedPath = candidate;
        break;
      } catch {
        // try next candidate
      }
    }

    if (!loadedPath || loadedSource === undefined) {
      throw new Error(`Imported circuit '${name}' not found in ${rootDir}.`);
    }

    const parsed = parseDsl(loadedSource, loadedPath);
    validateCircuitNameMatchesFile(parsed);
    registry.set(name, parsed);
    for (const child of parsed.circuit?.imports ?? []) {
      ensureLoaded(child);
    }

    stack.delete(name);
    return parsed;
  };

  for (const importName of root.circuit?.imports ?? []) {
    ensureLoaded(importName);
  }

  return registry;
}

function expandParsedDocument(root: ParsedDslDocument, registry: Map<string, ParsedDslDocument>): ParsedDslDocument {
  const expanded = inlineCircuit(root, '', registry, root.circuit?.imports ?? []);
  return {
    ...root,
    combinators: expanded.combinators,
    wireNetworks: expanded.wireNetworks,
    tests: root.tests
  };
}

function inlineCircuit(
  doc: ParsedDslDocument,
  prefix: string,
  registry: Map<string, ParsedDslDocument>,
  allowedImports: string[]
): { combinators: ParsedCombinator[]; wireNetworks: ParsedWireNetwork[]; ioMap: Map<string, string> } {
  const combinators: ParsedCombinator[] = [];
  const wireNetworks: ParsedWireNetwork[] = [];
  const ioMap = new Map<string, string>();
  const subIoByInstance = new Map<string, Map<string, string>>();

  for (const combinator of doc.combinators) {
    if (combinator.kind === 'circuit') {
      const importName = combinator.circuitName;
      if (!importName) {
        throw new Error(`Circuit combinator '${combinator.id}' is missing an import name.`);
      }
      if (!allowedImports.includes(importName)) {
        throw new Error(`Circuit combinator '${combinator.id}' references '${importName}' which is not listed in imports.`);
      }
      const imported = registry.get(importName);
      if (!imported) {
        throw new Error(`Imported circuit '${importName}' not found.`);
      }

      const sub = inlineCircuit(imported, `${prefix}${combinator.id}::`, registry, imported.circuit?.imports ?? []);
      combinators.push(...sub.combinators);
      wireNetworks.push(...sub.wireNetworks);
      subIoByInstance.set(combinator.id, sub.ioMap);
      continue;
    }

    const expandedId = `${prefix}${combinator.id}`;
    const expandedCombinator: ParsedCombinator = {
      ...combinator,
      id: expandedId
    };
    combinators.push(expandedCombinator);
    if (combinator.kind === 'input' || combinator.kind === 'output') {
      ioMap.set(combinator.id, expandedId);
    }
  }

  for (const network of doc.wireNetworks) {
    const expandedEdges: ParsedWireEdge[] = network.edges.map((edge) => ({
      from: resolveExpandedEndpoint(edge.from, prefix, subIoByInstance),
      to: resolveExpandedEndpoint(edge.to, prefix, subIoByInstance)
    }));

    wireNetworks.push({
      id: prefix ? `${prefix}${network.id}` : network.id,
      color: network.color,
      edges: expandedEdges
    });
  }

  return { combinators, wireNetworks, ioMap };
}

function resolveExpandedEndpoint(
  endpoint: ParsedWireEndpoint,
  prefix: string,
  subIoByInstance: Map<string, Map<string, string>>
): ParsedWireEndpoint {
  if (endpoint.subIoId) {
    const instanceMap = subIoByInstance.get(endpoint.combinatorId);
    if (!instanceMap) {
      throw new Error(`Unknown subcircuit instance '${endpoint.combinatorId}' in wire endpoint.`);
    }
    const resolved = instanceMap.get(endpoint.subIoId);
    if (!resolved) {
      throw new Error(`Unknown subcircuit endpoint '${endpoint.subIoId}' on '${endpoint.combinatorId}'.`);
    }
    return {
      combinatorId: resolved,
      port: endpoint.port
    };
  }

  return {
    combinatorId: `${prefix}${endpoint.combinatorId}`,
    port: endpoint.port
  };
}
