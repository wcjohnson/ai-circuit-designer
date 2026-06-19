import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compileDsl } from '../src/dsl.js';
import { writeBlueprintJson, writeBlueprintString } from '../src/blueprint.js';

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

test('all circuit DSL files are synchronized with compiled blueprint artifacts', () => {
  const repoRoot = process.cwd();
  const circuitsDir = join(repoRoot, 'circuits');
  const circuitsDirStats = statSync(circuitsDir, { throwIfNoEntry: false });

  assert.ok(circuitsDirStats?.isDirectory(), 'Expected a circuits/ directory in the repository root.');

  const dslPaths = findCircuitDslFiles(circuitsDir);
  assert.ok(dslPaths.length > 0, 'Expected at least one circuit DSL file under circuits/.');

  for (const dslPath of dslPaths) {
    const dslSource = readFileSync(dslPath, 'utf8');
    const compiled = compileDsl(dslSource, { includeBlueprintString: true, sourcePath: dslPath });

    let artifactBasePath = dslPath;
    if (artifactBasePath.endsWith('.circuit-dsl')) {
      artifactBasePath = artifactBasePath.slice(0, -'.circuit-dsl'.length);
    } else if (artifactBasePath.endsWith('.circuit_dsl')) {
      artifactBasePath = artifactBasePath.slice(0, -'.circuit_dsl'.length);
    }

    const jsonPath = `${artifactBasePath}.blueprint.json`;
    const txtPath = `${artifactBasePath}.blueprint.txt`;

    const expectedJson = writeBlueprintJson(compiled.blueprint);
    const expectedTxt = compiled.blueprintString ?? writeBlueprintString(compiled.blueprint);

    const actualJson = readFileSync(jsonPath, 'utf8');
    const actualTxt = readFileSync(txtPath, 'utf8');

    assert.equal(
      actualJson,
      expectedJson,
      `Artifact mismatch for ${relative(repoRoot, jsonPath)}. Run: node dist/src/cli.js compile --dsl ${relative(repoRoot, dslPath)}`
    );

    assert.equal(
      actualTxt,
      expectedTxt,
      `Artifact mismatch for ${relative(repoRoot, txtPath)}. Run: node dist/src/cli.js compile --dsl ${relative(repoRoot, dslPath)}`
    );
  }
});
