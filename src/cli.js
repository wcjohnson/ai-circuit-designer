#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { stdin as inputStream } from 'node:process';
import { simulateBlueprint } from './simulator.js';

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const blueprintInput = await readBlueprintInput(options);
  const externalInputs = options.inputsPath
    ? JSON.parse(await readFile(options.inputsPath, 'utf8'))
    : [];
  const result = simulateBlueprint(blueprintInput, {
    ticks: options.ticks,
    inputs: externalInputs
  });

  process.stdout.write(JSON.stringify(result, null, options.pretty ? 2 : 0));
  process.stdout.write('\n');
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

function parseArgs(args) {
  const options = {
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

function readValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

async function readBlueprintInput(options) {
  if (options.blueprint) {
    return options.blueprint;
  }
  if (options.inputPath) {
    return readFile(options.inputPath, 'utf8');
  }
  return readStdin();
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of inputStream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function printHelp() {
  process.stdout.write(`Usage: factorio-circuit-sim [options]\n\nOptions:\n  -i, --input <path>       Read blueprint JSON or string from a file\n  -b, --blueprint <value>  Read blueprint from an argument\n      --inputs <path>      Read external test input signals from JSON\n  -t, --ticks <count>      Number of ticks to simulate, default 3\n      --pretty             Pretty-print JSON output\n  -h, --help               Show this help\n\nIf --input and --blueprint are omitted, stdin is used.\n`);
}
