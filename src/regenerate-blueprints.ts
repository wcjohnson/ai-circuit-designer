import { readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compileDsl } from './dsl.js';
import { writeBlueprintJson, writeBlueprintString } from './blueprint.js';

function findCircuitDslFiles(rootDir: string): string[] {
  const discovered: string[] = [];

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (entry.isFile() && (entry.name.endsWith('.circuit-dsl') || entry.name.endsWith('.circuit_dsl'))) {
        discovered.push(fullPath);
      }
    }
  };

  walk(rootDir);
  discovered.sort();
  return discovered;
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const circuitsDir = join(repoRoot, 'circuits');
  const dslPaths = findCircuitDslFiles(circuitsDir);

  if (dslPaths.length === 0) {
    throw new Error('No circuit DSL files found under circuits/.');
  }

  for (const dslPath of dslPaths) {
    const dslSource = readFileSync(dslPath, 'utf8');
    const compiled = compileDsl(dslSource, { includeBlueprintString: true, sourcePath: dslPath });

    let outputBase = dslPath;
    if (outputBase.endsWith('.circuit-dsl')) {
      outputBase = outputBase.slice(0, -'.circuit-dsl'.length);
    } else if (outputBase.endsWith('.circuit_dsl')) {
      outputBase = outputBase.slice(0, -'.circuit_dsl'.length);
    }

    const jsonPath = `${outputBase}.blueprint.json`;
    const txtPath = `${outputBase}.blueprint.txt`;

    await writeFile(jsonPath, writeBlueprintJson(compiled.blueprint), 'utf8');
    await writeFile(txtPath, compiled.blueprintString ?? writeBlueprintString(compiled.blueprint), 'utf8');

    process.stdout.write(`Updated ${jsonPath} and ${txtPath}\n`);
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
