/** Post-build contract: performance traces must use real generated pages. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROUTES } from './lib/perf-routes.mjs';

const output = path.join(process.cwd(), 'dist');
assert.ok(fs.existsSync(output), 'dist missing: run npm run build first');
assert.ok(ROUTES.some((route) => route.type === 'game'), 'No game fixture in performance profile');
assert.equal(new Set(ROUTES.map((route) => route.path)).size, ROUTES.length, 'Duplicate perf routes');

for (const route of ROUTES) {
  assert.match(route.path, /^\\/(?:[^?#]+\\/)?$/, `Invalid route: ${route.path}`);
  assert.ok(route.name && route.type, `Missing route metadata: ${route.path}`);
  const file = path.join(output, route.path === '/' ? 'index.html' : route.path.slice(1) + 'index.html');
  assert.ok(fs.existsSync(file), `Performance route ${route.path} missing built page: ${file}`);
  console.log(`  ✓ ${route.path}`);
}
console.log(`OK  ${ROUTES.length} performance routes resolve to built pages`);
