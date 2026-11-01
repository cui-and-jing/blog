/** Fail-closed contract for the first-visit transfer profiler, without a browser dependency. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WIRE_ROUTES, assertNavigationOk } from './lib/wire-routes.mjs';

const output = path.join(process.cwd(), 'dist');
assert.ok(fs.existsSync(output), 'dist missing: run npm run build first');
assert.ok(WIRE_ROUTES.some(({ path }) => path.startsWith('/games/')), 'No game route in first-visit budget');
assert.equal(new Set(WIRE_ROUTES.map(({ path }) => path)).size, WIRE_ROUTES.length, 'Duplicate wire-budget routes');
for (const route of WIRE_ROUTES) {
  assert.match(route.path, /^\\/(?:[^?#]*\\/)?$/, `Invalid transfer-budget route: ${route.path}`);
  assert.ok(route.label && Number.isFinite(route.limit) && route.limit > 0, `Missing transfer budget: ${route.path}`);
  const emitted = path.join(output, route.path === '/' ? 'index.html' : route.path.slice(1) + 'index.html');
  assert.ok(fs.existsSync(emitted), `Transfer-budget route ${route.path} missing built page: ${emitted}`);
  console.log(`  ✓ ${route.path} (max ${route.limit} KiB)`);
}
const response = (status) => ({ ok: () => status >= 200 && status < 300, status: () => status });
assert.doesNotThrow(() => assertNavigationOk(response(200), '/'));
assert.doesNotThrow(() => assertNavigationOk(response(204), '/'));
for (const status of [301, 404, 500, 503]) {
  assert.throws(() => assertNavigationOk(response(status), '/missing/'), new RegExp(`HTTP ${status} at /missing/`));
}
assert.throws(() => assertNavigationOk(null, '/missing/'), /HTTP no response at \\/missing\\//);
console.log(`OK  ${WIRE_ROUTES.length} transfer-budget routes exist; non-2xx and missing responses fail closed`);
