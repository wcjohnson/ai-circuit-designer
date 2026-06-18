#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { stdin as inputStream } from 'node:process';
import { inflateSync } from 'node:zlib';
import { simulateBlueprint } from './simulator.js';
import type { ExternalInput } from './simulator.js';
import { compileDsl, runDslTests } from './dsl.js';
import { writeBlueprintJson, writeBlueprintString } from './blueprint.js';

type Command = 'simulate' | 'compile' | 'test' | 'dump';

interface BaseCliOptions {
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

type CliOptions = SimulateOptions | CompileOptions | TestOptions | DumpOptions;

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

    printJson(result, options.pretty);
    process.exit(0);
  }

  if (options.command === 'dump') {
    const blueprintInput = await readBlueprintInput(options);
    const blueprintJson = decodeBlueprintInputToJson(blueprintInput);
    printJson(blueprintJson, options.pretty);
    process.exit(0);
  }

  const dslSource = await readDslSource(options.dslPath);
  if (options.command === 'compile') {
    const includeBlueprintString = options.includeBlueprintString || Boolean(options.outputBlueprintStringPath);
    const result = compileDsl(dslSource, {
      includeBlueprintString
    });

    if (options.outputBlueprintJsonPath) {
      const blueprintJson = writeBlueprintJson(result.blueprint, { pretty: options.pretty });
      await writeFile(options.outputBlueprintJsonPath, blueprintJson, 'utf8');
    }

    if (options.outputBlueprintStringPath) {
      const blueprintString = result.blueprintString ?? writeBlueprintString(result.blueprint);
      await writeFile(options.outputBlueprintStringPath, blueprintString, 'utf8');
    }

    printJson(result, options.pretty);
    process.exit(0);
  }

  const result = runDslTests(dslSource, {
    testName: options.testName
  });
  printJson(result, options.pretty);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(args: string[]): CliOptions {
  const first = args[0]?.toLowerCase();
  const hasExplicitCommand = first === 'simulate' || first === 'compile' || first === 'test' || first === 'dump';
  const command = (hasExplicitCommand ? first : 'simulate') as Command;
  const commandArgs = hasExplicitCommand ? args.slice(1) : args;

  if (command === 'simulate') {
    return parseSimulateArgs(commandArgs);
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
      'compile options:',
      '  -d, --dsl <path>             Read DSL source file (or stdin when omitted)',
      '      --with-blueprint-string  Include encoded blueprint string in output',
      '      --out-json <path>        Write compiled blueprint JSON to a file',
      '      --out-string <path>      Write compiled blueprint string to a file',
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
      '      --pretty           Pretty-print JSON output',
      '  -h, --help             Show this help'
    ].join('\n')
  );
}
