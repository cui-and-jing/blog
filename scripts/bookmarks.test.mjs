/** Exercise the shipped bookmark store, including readable but unwritable storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../src/lib/bookmarks.ts', import.meta.url), 'utf8');
const code = transformSync(source, { loader: 'ts', format: 'cjs' }).code;

function store(initial = null, options = {}) {
  const state = { value: initial, denyRead: false, denyWrite: false, ...options };
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module,
    localStorage: {
      getItem() {
        if (state.denyRead) throw Error('Read disabled');
        return state.value;
      },
      setItem(_key, value) {
        if (state.denyWrite) throw Error('Quota exceeded');
        state.value = value;
      },
    },
  });
  return {
    state,
    read: (refresh = false) => Array.from(module.exports.readBookmarks(refresh)),
    write: (values) => module.exports.writeBookmarks(values),
  };
}

for (const [name, raw] of [
  ['existing saved article', '["old"]'],
  ['empty saved list', '[]'],
  ['missing key', null],
  ['malformed JSON', '{'],
  ['wrong stored shape', 'false'],
]) {
  test(`Failed writes preserve pending additions and removals over ${name}`, () => {
    const saved = store(raw, { denyWrite: true });
    saved.write(['new']);
    assert.deepEqual(saved.read(), ['new']);
    assert.deepEqual(saved.read(), ['new'], 'Repeated render retains pending state');
    saved.write([]);
    assert.deepEqual(saved.read(), [], 'Removing the last bookmark must not revive old storage');
    assert.equal(saved.state.value, raw, 'Failed writes do not mutate persisted data');
  });
}

test('Fully disabled storage still supports repeated changes for this page', () => {
  const saved = store(null, { denyRead: true, denyWrite: true });
  assert.deepEqual(saved.read(), []);
  saved.write(['first']);
  saved.write([...saved.read(), 'second']);
  assert.deepEqual(saved.read(), ['first', 'second']);
  saved.write([]);
  assert.deepEqual(saved.read(), []);
});

test('A later successful write persists the current session and releases the fallback', () => {
  const saved = store('["old"]', { denyWrite: true });
  saved.write(['new']);
  saved.state.denyWrite = false;
  saved.write([...saved.read(), 'later']);
  assert.equal(saved.state.value, '["new","later"]');
  saved.state.value = null;
  assert.deepEqual(saved.read(), [], 'Removed storage must not resurrect a successful write');
});

for (const [name, raw, expected] of [
  ['new selection', '["other"]', ['other']],
  ['empty list', '[]', []],
  ['removed key or cleared storage', null, []],
  ['corrupt value', '{', []],
]) {
  test(`Cross-tab refresh replaces pending changes with ${name}`, () => {
    const saved = store('["old"]', { denyWrite: true });
    saved.write(['pending']);
    saved.state.value = raw;
    assert.deepEqual(saved.read(), ['pending'], 'Ordinary rendering keeps local changes');
    assert.deepEqual(saved.read(true), expected, 'Explicit external refresh takes precedence');
    assert.deepEqual(saved.read(), expected);
  });
}

test('Unrelated renders preserve an empty pending selection', () => {
  const saved = store('["old"]', { denyWrite: true });
  saved.write([]);
  for (let i = 0; i < 3; i++) assert.deepEqual(saved.read(), []);
});

test('Reload only restores actually persisted data', () => {
  const saved = store('["old"]', { denyWrite: true });
  saved.write(['pending']);
  assert.deepEqual(store(saved.state.value).read(), ['old']);
});

test('Both persisted and pending values are deduplicated, validated and bounded', () => {
  const invalid = ['', 1, null, {}, 'x'.repeat(300), 'first', 'first'];
  const values = [...invalid, ...Array.from({ length: 520 }, (_, i) => `post-${i}`)];
  const expected = ['first', ...Array.from({ length: 499 }, (_, i) => `post-${i}`)];
  const persisted = store(JSON.stringify(values));
  assert.deepEqual(persisted.read(), expected);
  persisted.state.denyWrite = true;
  persisted.write(values);
  assert.deepEqual(persisted.read(), expected);
});

test('Valid stored selection remains readable when only writes are blocked', () => {
  assert.deepEqual(store('["old"]', { denyWrite: true }).read(), ['old']);
});
