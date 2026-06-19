#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, parse as parsePath } from 'node:path';
import { stdin as inputStream } from 'node:process';
import { inflateSync } from 'node:zlib';
import { simulateBlueprint } from './simulator.js';
import type { ExternalInput, SimulationResult, TickOutput } from './simulator.js';
import { compileDsl, runDslTests } from './dsl.js';
import { writeBlueprintJson, writeBlueprintString } from './blueprint.js';

interface IdenticalTickSentinel {
  tick: number;
  throughTick?: number;
  sentinel: 'identical-with-last-tick';
  identicalToPrevious: true;
}

type CompactedTick = TickOutput | IdenticalTickSentinel;

type CompactedTickFrame =
  | { kind: 'tick'; tick: TickOutput }
  | { kind: 'identical'; tick: number; throughTick: number };

type Command = 'simulate' | 'simulate-dsl' | 'compile' | 'test' | 'dump';

interface BaseCliOptions {
  json: boolean;
  pretty: boolean;
  help: boolean;
}

interface SimulateOptions extends BaseCliOptions {
  command: 'simulate';
  inputPath?: string;
  blueprint?: string;
  inputsPath?: string;
  ticks: number;
}

interface CompileOptions extends BaseCliOptions {
  command: 'compile';
  dslPath?: string;
  includeBlueprintString: boolean;
  outputBlueprintJsonPath?: string;
  outputBlueprintStringPath?: string;
}

interface SimulateDslOptions extends BaseCliOptions {
  command: 'simulate-dsl';
  dslPath?: string;
  inputsPath?: string;
  ticks: number;
  includeBlueprint: boolean;
}

interface TestOptions extends BaseCliOptions {
  command: 'test';
  dslPath?: string;
  testName?: string;
}

interface DumpOptions extends BaseCliOptions {
  command: 'dump';
  inputPath?: string;
  blueprint?: string;
}

type CliOptions = SimulateOptions | SimulateDslOptions | CompileOptions | TestOptions | DumpOptions;

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.command === 'simulate') {
    const blueprintInput = await readBlueprintInput(options);
    const externalInputs = options.inputsPath
      ? JSON.parse(await readFile(options.inputsPath, 'utf8')) as ExternalInput[]
      : [];
    const result = simulateBlueprint(blueprintInput, {
      ticks: options.ticks,
      inputs: externalInputs
    });

    if (options.json) {
      printJson(compactSimulationResultForJson(result), options.pretty);
    } else {
      process.stdout.write(renderSimulationTable(result));
      process.stdout.write('\n');
    }
    process.exit(0);
  }

  if (options.command === 'dump') {
    const blueprintInput = await readBlueprintInput(options);
    const blueprintJson = decodeBlueprintInputToJson(blueprintInput);
    printJson(blueprintJson, options.pretty);
    process.exit(0);
  }

  if (options.command === 'simulate-dsl') {
    const dslSource = await readDslSource(options.dslPath);
    const compiled = compileDsl(dslSource, { sourcePath: options.dslPath });
    const externalInputs = options.inputsPath
      ? JSON.parse(await readFile(options.inputsPath, 'utf8')) as ExternalInput[]
      : [];

    const simulation = simulateBlueprint(compiled.blueprint, {
      ticks: options.ticks,
      inputs: externalInputs
    });

    const result: Record<string, unknown> = {
      simulation,
      networks: compiled.networks,
      entities: compiled.entities
    };
    if (options.includeBlueprint) {
      result.blueprint = compiled.blueprint;
    }

    if (options.json) {
      printJson({
        ...result,
        simulation: compactSimulationResultForJson(simulation)
      }, options.pretty);
    } else {
      process.stdout.write(renderSimulationTable(simulation));
      process.stdout.write('\n');
    }
    process.exit(0);
  }

  const dslSource = await readDslSource(options.dslPath);
  if (options.command === 'compile') {
    const defaultOutputPaths = getDefaultCompileOutputPaths(options.dslPath);
    const outputBlueprintJsonPath = options.outputBlueprintJsonPath ?? defaultOutputPaths?.jsonPath;
    const outputBlueprintStringPath = options.outputBlueprintStringPath ?? defaultOutputPaths?.stringPath;
    const includeBlueprintString = options.includeBlueprintString || Boolean(options.outputBlueprintStringPath);
    const result = compileDsl(dslSource, {
      includeBlueprintString: includeBlueprintString || Boolean(outputBlueprintStringPath),
      sourcePath: options.dslPath
    });

    if (outputBlueprintJsonPath) {
      const blueprintJson = writeBlueprintJson(result.blueprint, { pretty: options.pretty });
      await writeFile(outputBlueprintJsonPath, blueprintJson, 'utf8');
    }

    if (outputBlueprintStringPath) {
      const blueprintString = result.blueprintString ?? writeBlueprintString(result.blueprint);
      await writeFile(outputBlueprintStringPath, blueprintString, 'utf8');
    }

    printJson(result, options.pretty);
    process.exit(0);
  }

  const result = runDslTests(dslSource, {
    testName: options.testName,
    sourcePath: options.dslPath
  });

  if (options.json) {
    printJson(compactDslTestResultForJson(result), options.pretty);
  } else {
    process.stdout.write(renderDslTestTables(result));
    process.stdout.write('\n');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  const knownCommands: Command[] = ['simulate', 'simulate-dsl', 'compile', 'test', 'dump'];
  const commandIndex = args.findIndex((arg) => knownCommands.includes(arg.toLowerCase() as Command));
  const command = (commandIndex >= 0 ? args[commandIndex].toLowerCase() : 'simulate') as Command;
  const commandArgs = commandIndex >= 0
    ? [...args.slice(0, commandIndex), ...args.slice(commandIndex + 1)]
    : args;

  if (command === 'simulate') {
    return parseSimulateArgs(commandArgs);
  }
  if (command === 'simulate-dsl') {
    return parseSimulateDslArgs(commandArgs);
  }
  if (command === 'compile') {
    return parseCompileArgs(commandArgs);
  }
  if (command === 'dump') {
    return parseDumpArgs(commandArgs);
  }
  return parseTestArgs(commandArgs);
}

function parseSimulateArgs(args: string[]): SimulateOptions {
  const options: SimulateOptions = {
    command: 'simulate',
    ticks: 3,
    json: false,
    pretty: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--input':
      case '-i':
        options.inputPath = readValue(args, ++index, arg);
        break;
      case '--blueprint':
      case '-b':
        options.blueprint = readValue(args, ++index, arg);
        break;
      case '--inputs':
        options.inputsPath = readValue(args, ++index, arg);
        break;
      case '--ticks':
      case '-t':
        options.ticks = Number(readValue(args, ++index, arg));
        if (!Number.isInteger(options.ticks) || options.ticks < 1) {
          throw new Error('--ticks must be a positive integer.');
        }
        break;
      case '--json':
        options.json = true;
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (options.inputPath && options.blueprint) {
    throw new Error('Use either --input or --blueprint, not both.');
  }

  return options;
}

function parseCompileArgs(args: string[]): CompileOptions {
  const options: CompileOptions = {
    command: 'compile',
    json: false,
    pretty: false,
    help: false,
    includeBlueprintString: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--dsl':
      case '-d':
        options.dslPath = readValue(args, ++index, arg);
        break;
      case '--with-blueprint-string':
        options.includeBlueprintString = true;
        break;
      case '--out-blueprint-json':
      case '--out-json':
        options.outputBlueprintJsonPath = readValue(args, ++index, arg);
        break;
      case '--out-blueprint-string':
      case '--out-string':
        options.outputBlueprintStringPath = readValue(args, ++index, arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return options;
}

function parseSimulateDslArgs(args: string[]): SimulateDslOptions {
  const options: SimulateDslOptions = {
    command: 'simulate-dsl',
    ticks: 3,
    json: false,
    pretty: false,
    help: false,
    includeBlueprint: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--dsl':
      case '-d':
        options.dslPath = readValue(args, ++index, arg);
        break;
      case '--inputs':
        options.inputsPath = readValue(args, ++index, arg);
        break;
      case '--ticks':
      case '-t':
        options.ticks = Number(readValue(args, ++index, arg));
        if (!Number.isInteger(options.ticks) || options.ticks < 1) {
          throw new Error('--ticks must be a positive integer.');
        }
        break;
      case '--include-blueprint':
        options.includeBlueprint = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return options;
}

function parseTestArgs(args: string[]): TestOptions {
  const options: TestOptions = {
    command: 'test',
    json: false,
    pretty: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--dsl':
      case '-d':
        options.dslPath = readValue(args, ++index, arg);
        break;
      case '--test':
        options.testName = readValue(args, ++index, arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  return options;
}

function parseDumpArgs(args: string[]): DumpOptions {
  const options: DumpOptions = {
    command: 'dump',
    json: false,
    pretty: false,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--input':
      case '-i':
        options.inputPath = readValue(args, ++index, arg);
        break;
      case '--blueprint':
      case '-b':
        options.blueprint = readValue(args, ++index, arg);
        break;
      case '--json':
        options.json = true;
        break;
      case '--pretty':
        options.pretty = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument '${arg}'.`);
    }
  }

  if (options.inputPath && options.blueprint) {
    throw new Error('Use either --input or --blueprint, not both.');
  }

  return options;
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function readBlueprintInput(options: Pick<SimulateOptions, 'inputPath' | 'blueprint'>): Promise<string> {
  if (options.blueprint) {
    return options.blueprint;
  }
  if (options.inputPath) {
    return readFile(options.inputPath, 'utf8');
  }
  return readStdin();
}

async function readDslSource(path?: string): Promise<string> {
  if (path) {
    return readFile(path, 'utf8');
  }
  return readStdin();
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of inputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function printJson(value: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0));
  process.stdout.write('\n');
}

function decodeBlueprintInputToJson(input: string): unknown {
  const text = input.trim();
  if (!text) {
    throw new Error('Blueprint input is empty.');
  }

  if (text.startsWith('0')) {
    const encoded = text.slice(1);
    const inflated = inflateSync(Buffer.from(encoded, 'base64')).toString('utf8');
    return JSON.parse(inflated) as unknown;
  }

  return JSON.parse(text) as unknown;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: factorio-circuit-sim <command> [options]',
      '',
      'Commands:',
      '  simulate       Simulate a Factorio blueprint (default command).',
      '  simulate-dsl   Compile DSL and simulate in one step (agent-friendly).',
      '  compile        Compile DSL into blueprint JSON (+ optional tests metadata).',
      '  test           Compile DSL and execute DSL tests.',
      '  dump           Parse and print blueprint JSON.',
      '',
      'simulate options:',
      '  -i, --input <path>       Read blueprint JSON/string from file',
      '  -b, --blueprint <value>  Read blueprint from CLI argument',
      '      --inputs <path>      Read external input signals JSON',
      '  -t, --ticks <count>      Number of ticks to simulate (default 3)',
      '',
      'simulate-dsl options:',
      '  -d, --dsl <path>          Read DSL source file (or stdin when omitted)',
      '      --inputs <path>       Read external input signals JSON',
      '  -t, --ticks <count>       Number of ticks to simulate (default 3)',
      '      --include-blueprint   Include compiled blueprint in output',
      '',
      'compile options:',
      '  -d, --dsl <path>             Read DSL source file (or stdin when omitted)',
      '      --with-blueprint-string  Include encoded blueprint string in output',
      '      --out-json <path>        Write compiled blueprint JSON to a file',
      '      --out-string <path>      Write compiled blueprint string to a file',
      '                               Default for <name>.circuit-dsl: <name>.blueprint.json/.txt',
      '',
      'test options:',
      '  -d, --dsl <path>       Read DSL source file (or stdin when omitted)',
      '      --test <name>      Run only a single DSL test by name',
      '',
      'dump options:',
      '  -i, --input <path>       Read blueprint JSON/string from file',
      '  -b, --blueprint <value>  Read blueprint string from CLI argument',
      '',
      'global options:',
      '      --json             Output raw JSON (suppresses TUI tables)',
      '      --pretty           Pretty-print JSON output',
      '  -h, --help             Show this help'
    ].join('\n')
  );
}

function getDefaultCompileOutputPaths(dslPath: string | undefined): { jsonPath: string; stringPath: string } | undefined {
  if (!dslPath) {
    return undefined;
  }

  const path = dslPath.trim();
  if (!path.endsWith('.circuit-dsl')) {
    return undefined;
  }

  const parsed = parsePath(path);
  const stem = parsed.base.slice(0, -'.circuit-dsl'.length);
  if (!stem) {
    return undefined;
  }

  return {
    jsonPath: join(dirname(path), `${stem}.blueprint.json`),
    stringPath: join(dirname(path), `${stem}.blueprint.txt`)
  };
}

function renderDslTestTables(result: ReturnType<typeof runDslTests>): string {
  const sections: string[] = [];
  sections.push(`DSL tests: ${result.passed ? 'PASS' : 'FAIL'}`);

  for (const test of result.tests) {
    sections.push('');
    sections.push(`Test: ${test.name} (${test.passed ? 'PASS' : 'FAIL'})`);
    if (!test.passed) {
      sections.push(renderTickNetworkTable(test.simulation.ticks));
    }

    const failedAssertions = test.assertions.filter((assertion: { passed: boolean }) => !assertion.passed);
    if (failedAssertions.length > 0) {
      sections.push('Failed assertions:');
      for (const assertion of failedAssertions) {
        sections.push(`- tick ${assertion.tick}: ${assertion.description} (expected=${assertion.expected}, actual=${assertion.actual})`);
      }
    }
  }

  return sections.join('\n');
}

function compactDslTestResultForJson(result: ReturnType<typeof runDslTests>): unknown {
  return {
    passed: result.passed,
    tests: result.tests.map((test) => {
      if (!test.passed) {
        return {
          ...test,
          simulation: compactSimulationResultForJson(test.simulation)
        };
      }
      return {
        name: test.name,
        passed: test.passed
      };
    })
  };
}

function renderSimulationTable(result: SimulationResult): string {
  return renderTickNetworkTable(result.ticks);
}

function renderTickNetworkTable(ticks: TickOutput[]): string {
  const MAX_TABLE_ROWS = 10;
  const MAX_TABLE_COLUMNS = 10;
  const networkIds: string[] = [];
  const seenNetworkIds = new Set<string>();
  for (const tick of ticks) {
    for (const network of tick.networks) {
      if (!seenNetworkIds.has(network.id)) {
        seenNetworkIds.add(network.id);
        networkIds.push(network.id);
      }
    }
  }

  const allHeaders = ['tick', ...networkIds];
  const headers = allHeaders.slice(0, MAX_TABLE_COLUMNS);
  const compacted = compactTicks(ticks);
  const rows = compacted.slice(0, MAX_TABLE_ROWS).map((entry) => {
    if (isIdenticalTickSentinel(entry)) {
      const row: string[] = [formatSentinelTickRange(entry)];
      const visibleNetworkCount = Math.max(0, MAX_TABLE_COLUMNS - 1);
      if (visibleNetworkCount > 0) {
        row.push('identical with last tick');
        for (let index = 1; index < visibleNetworkCount; index += 1) {
          row.push('-');
        }
      }
      return row;
    }

    const row: string[] = [String(entry.tick)];
    for (const networkId of networkIds.slice(0, Math.max(0, MAX_TABLE_COLUMNS - 1))) {
      const network = entry.networks.find((candidate) => candidate.id === networkId);
      row.push(formatSignalMap(network?.signals));
    }
    return row;
  });

  const omittedRows = Math.max(0, compacted.length - rows.length);
  const omittedColumns = Math.max(0, allHeaders.length - headers.length);
  const table = renderAsciiTable(headers, rows);

  if (omittedRows === 0 && omittedColumns === 0) {
    return table;
  }

  return `${table}\n(omitted ${omittedRows} rows and ${omittedColumns} columns)`;
}

function compactSimulationResultForJson(result: SimulationResult): { ticks: CompactedTick[]; ignoredEntities: SimulationResult['ignoredEntities'] } {
  return {
    ...result,
    ticks: compactTicks(result.ticks)
  };
}

function compactTicks(ticks: TickOutput[]): CompactedTick[] {
  return compactTickFrames(ticks).map((frame) => {
    if (frame.kind === 'tick') {
      return frame.tick;
    }
    return frame.tick === frame.throughTick
      ? { tick: frame.tick, sentinel: 'identical-with-last-tick', identicalToPrevious: true }
      : { tick: frame.tick, throughTick: frame.throughTick, sentinel: 'identical-with-last-tick', identicalToPrevious: true };
  });
}

function compactTickFrames(ticks: TickOutput[]): CompactedTickFrame[] {
  if (ticks.length === 0) {
    return [];
  }

  const frames: CompactedTickFrame[] = [{ kind: 'tick', tick: ticks[0] }];
  let identicalRunStart: number | undefined;
  let identicalRunEnd: number | undefined;

  for (let index = 1; index < ticks.length; index += 1) {
    const previous = ticks[index - 1];
    const current = ticks[index];
    if (haveEquivalentNetworkSignals(previous, current)) {
      if (identicalRunStart === undefined) {
        identicalRunStart = current.tick;
      }
      identicalRunEnd = current.tick;
      continue;
    }

    if (identicalRunStart !== undefined && identicalRunEnd !== undefined) {
      frames.push({ kind: 'identical', tick: identicalRunStart, throughTick: identicalRunEnd });
      identicalRunStart = undefined;
      identicalRunEnd = undefined;
    }

    frames.push({ kind: 'tick', tick: current });
  }

  if (identicalRunStart !== undefined && identicalRunEnd !== undefined) {
    frames.push({ kind: 'identical', tick: identicalRunStart, throughTick: identicalRunEnd });
  }

  return frames;
}

function haveEquivalentNetworkSignals(left: TickOutput, right: TickOutput): boolean {
  return buildTickNetworkSignalSignature(left) === buildTickNetworkSignalSignature(right);
}

function buildTickNetworkSignalSignature(tick: TickOutput): string {
  const sortedNetworks = [...tick.networks].sort((left, right) => left.id.localeCompare(right.id));
  return sortedNetworks
    .map((network) => {
      const sortedSignals = Object.entries(network.signals)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}:${value}`)
        .join(',');
      return `${network.id}[${sortedSignals}]`;
    })
    .join('|');
}

function isIdenticalTickSentinel(value: CompactedTick): value is IdenticalTickSentinel {
  return 'identicalToPrevious' in value;
}

function formatSentinelTickRange(entry: IdenticalTickSentinel): string {
  return entry.throughTick !== undefined ? `${entry.tick}-${entry.throughTick}` : String(entry.tick);
}

function formatSignalMap(signals: Record<string, number> | undefined): string {
  if (!signals) {
    return '-';
  }
  const entries = Object.entries(signals)
    .filter(([, value]) => value !== 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return '-';
  }
  return entries.map(([name, value]) => `${name}=${value}`).join(', ');
}

function renderAsciiTable(headers: string[], rows: string[][]): string {
  const columnWidths = headers.map((header, index) => {
    const rowMax = rows.reduce((max, row) => Math.max(max, (row[index] ?? '').length), 0);
    return Math.max(header.length, rowMax);
  });

  const horizontal = `+${columnWidths.map((width) => '-'.repeat(width + 2)).join('+')}+`;
  const formatRow = (cells: string[]) => `| ${cells.map((cell, index) => (cell ?? '').padEnd(columnWidths[index])).join(' | ')} |`;

  const lines: string[] = [horizontal, formatRow(headers), horizontal];
  for (const row of rows) {
    lines.push(formatRow(row));
  }
  lines.push(horizontal);
  return lines.join('\n');
}
