// The production image runs `pnpm prune --prod`, so every package the server loads at runtime (imports, dynamic
// imports and require.resolve'd font files) must be a runtime dependency, not a devDependency.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.ts') ? [join(d, n)] : []));
const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]!);

describe('runtime dependencies', () => {
  it('every package used by server/ and core/ survives a production prune', () => {
    const used = new Set<string>();
    for (const f of [...walk('server'), ...walk('core'), 'scripts/fetch-datasets.ts']) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:from\s+|import\()\s*'([^'.][^']*)'/g)) if (!m[1]!.startsWith('node:')) used.add(packageOf(m[1]!));
      for (const m of src.matchAll(/fontPath\('([^']+)'/g)) used.add(`@fontsource/${m[1]}`);
    }
    expect(used.size).toBeGreaterThan(5);
    const missing = [...used].filter((p) => !(p in pkg.dependencies));
    expect(missing).toEqual([]);
  });
});
