import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { runDslTests } from '../src/dsl.js';

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

test('npm test executes all DSL-defined tests from all circuit DSL files', () => {
  const repoRoot = process.cwd();
  const circuitsDir = join(repoRoot, 'circuits');
  const circuitsDirStats = statSync(circuitsDir, { throwIfNoEntry: false });

  assert.ok(circuitsDirStats?.isDirectory(), 'Expected a circuits/ directory in the repository root.');

  const dslPaths = findCircuitDslFiles(circuitsDir);
  assert.ok(dslPaths.length > 0, 'Expected at least one circuit DSL file under circuits/.');

  for (const dslPath of dslPaths) {
    const dslSource = readFileSync(dslPath, 'utf8');
    const result = runDslTests(dslSource, { sourcePath: dslPath });

    assert.equal(
      result.passed,
      true,
      `DSL tests failed for ${relative(repoRoot, dslPath)}. Failures: ${result.tests.filter((t) => !t.passed).map((t) => t.name).join(', ')}`
    );
  }
});
