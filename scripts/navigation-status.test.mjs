import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertSuccessfulNavigation } from './lib/navigation-status.mjs';

const response = (status) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
});

for (const status of [200, 204, 206, 299]) {
  const navigation = response(status);
  assert.equal(assertSuccessfulNavigation(navigation, '/search/', 'Visual regression route'), navigation);
}
for (const status of [301, 302, 404, 500, 503]) {
  assert.throws(
    () => assertSuccessfulNavigation(response(status), '/search/', 'Visual regression route'),
    new RegExp(`Visual regression route /search/: HTTP ${status}`),
  );
}
assert.throws(
  () => assertSuccessfulNavigation(null, '/search/', 'Visual regression route'),
  /Visual regression route \/search\/: HTTP no response/,
);
assert.throws(
  () => assertSuccessfulNavigation(undefined, '/games/', 'Performance route'),
  /Performance route \/games\/: HTTP no response/,
);

// Guard both consumers against accidentally reverting to unchecked navigation.
for (const file of ['scripts/visual-regression.mjs', 'scripts/perf.mjs']) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(source, /assertSuccessfulNavigation\(/, `${file} must check HTTP status`);
}
console.log('OK  browser navigation HTTP status contract');
