/** Exercise the actual first-paint and deferred settings code without a browser. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';

const source = fs.readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
const head = source.match(/<script is:inline>([\s\S]*?)<\/script>/)?.[1];
assert.ok(head, 'First-paint settings script is present');
const start = source.indexOf('      type Settings =');
const end = source.indexOf('      /* ---------- 设置面板、快捷键面板与导航抽屉', start);
assert.ok(start >= 0 && end > start, 'Deferred settings section is present');
const deferred = transformSync(source.slice(start, end), { loader: 'ts', format: 'esm' }).code;
const choices = [...source.matchAll(/<button\b[^>]*data-setting="([^"]+)"[^>]*data-value="([^"]+)"/g)]
  .map(([, setting, value]) => ({ setting, value }));
assert.equal(choices.length, 11, 'All four actual settings groups are represented');
const defaults = { theme: 'auto', font: 'serif', size: 'normal', leading: 'normal' };

function boot(values = {}, { denyRead = false, denyWrite = false, dark = false } = {}) {
  const saved = new Map(Object.entries(values));
  const dataset = {};
  const meta = { content: '', setAttribute(_name, value) { this.content = value; } };
  const buttons = choices.map((choice) => ({
    dataset: choice,
    pressed: false,
    setAttribute(_name, value) { this.pressed = value === 'true'; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 40, height: 40 }; },
    closest() { return this; },
  }));
  const listeners = {};
  const darkQuery = { matches: dark, addEventListener(_type, callback) { this.change = callback; } };
  const document = {
    documentElement: { dataset },
    getElementById(id) { return id === 'theme-color' ? meta : null; },
    querySelectorAll(selector) {
      const key = selector.match(/data-setting="([^"]+)"/)?.[1];
      return key ? buttons.filter((button) => button.dataset.setting === key) : buttons;
    },
    querySelector() { return null; },
    addEventListener(type, callback) { listeners[type] = callback; },
  };
  const context = vm.createContext({
    document,
    root: document.documentElement,
    reduceMotion: { matches: true },
    window: { matchMedia: (query) => query.includes('color-scheme') ? darkQuery : { matches: true } },
    localStorage: {
      getItem(key) { if (denyRead) throw Error('Storage disabled'); return saved.get(key) ?? null; },
      setItem(key, value) { if (denyWrite) throw Error('Quota exceeded'); saved.set(key, value); },
      removeItem(key) { if (denyWrite) throw Error('Storage disabled'); saved.delete(key); },
    },
    addEventListener(type, callback) { listeners[type] = callback; },
  });
  vm.runInContext(head, context);
  const firstPaint = { ...dataset };
  vm.runInContext(deferred, context);
  return {
    dataset, firstPaint, saved, meta, darkQuery,
    state() {
      return {
        theme: dataset.themeChoice,
        font: dataset.font ?? 'serif',
        size: dataset.reading ?? 'normal',
        leading: dataset.leading ?? 'normal',
      };
    },
    assertSelected(expected) {
      for (const key of Object.keys(defaults)) {
        const selected = buttons.filter((button) => button.dataset.setting === key && button.pressed);
        assert.deepEqual(selected.map((button) => button.dataset.value), [expected[key]], key);
      }
    },
    change(newValue, key = 'settings') {
      if (key === null) saved.clear();
      else if (newValue === null) saved.delete(key);
      else saved.set(key, newValue);
      listeners.storage({ key, newValue });
    },
    click(key, value) {
      listeners.click({ target: buttons.find((button) => button.dataset.setting === key && button.dataset.value === value) });
    },
  };
}

for (const stored of ['{broken', 'null', 'false', '42', '"dark"', '[]', '["dark"]',
  JSON.stringify({ theme: 'sepia', font: {}, size: ['large'], leading: false })]) {
  test('Invalid settings recover defaults: ' + stored, () => {
    const page = boot({ settings: stored });
    assert.deepEqual(page.state(), defaults);
    assert.deepEqual(page.dataset, page.firstPaint, 'Boot does not change the first-paint choices');
    page.assertSelected(defaults);
    page.click('size', 'large');
    assert.equal(page.state().size, 'large', 'Recovered controls are still usable');
    assert.equal(JSON.parse(page.saved.get('settings')).size, 'large');
  });
}

test('Valid fields survive invalid neighbors and unsupported fields', () => {
  const page = boot({ settings: JSON.stringify({ theme: 'dark', font: null, size: 'small', leading: 1, extra: 'ignored' }) });
  const expected = { ...defaults, theme: 'dark', size: 'small' };
  assert.deepEqual(page.state(), expected);
  page.assertSelected(expected);
  assert.equal(page.meta.content, '#131311');
});

for (const denyWrite of [false, true]) {
  for (const stored of [undefined, '{broken', '[]']) {
    test(`Legacy migration preserves choices (writes denied=${denyWrite}, stored=${stored})`, () => {
      const values = { theme: 'dark', reading: 'large' };
      if (stored !== undefined) values.settings = stored;
      const page = boot(values, { denyWrite });
      const expected = { ...defaults, theme: 'dark', size: 'large' };
      assert.deepEqual(page.state(), expected);
      assert.deepEqual(page.dataset, page.firstPaint, 'Deferred boot preserves the migrated first paint');
      page.assertSelected(expected);
      if (denyWrite) {
        assert.equal(page.saved.get('theme'), 'dark', 'Failed migration retains the old key');
        assert.equal(page.saved.get('reading'), 'large');
      } else {
        assert.equal(page.saved.has('theme'), false);
        assert.equal(page.saved.has('reading'), false);
        assert.equal(JSON.parse(page.saved.get('settings')).theme, 'dark');
      }
    });
  }
}

test('Saved settings take precedence over legacy values', () => {
  const page = boot({ settings: '{"theme":"light","size":"small","font":"kai"}', theme: 'dark', reading: 'large' }, { denyWrite: true });
  const expected = { ...defaults, theme: 'light', size: 'small', font: 'kai' };
  assert.deepEqual(page.state(), expected);
  page.assertSelected(expected);
});

test('Unavailable storage still allows in-page preferences', () => {
  const page = boot({}, { denyRead: true, denyWrite: true, dark: true });
  assert.deepEqual(page.state(), defaults);
  assert.equal(page.dataset.theme, 'dark');
  page.click('font', 'sans');
  assert.equal(page.state().font, 'sans');
  page.assertSelected({ ...defaults, font: 'sans' });
});

test('Cross-tab events validate values, reset on clear, and ignore unrelated keys', () => {
  const page = boot();
  page.change('{"theme":"dark","font":"kai","size":null,"leading":"loose"}');
  const expected = { theme: 'dark', font: 'kai', size: 'normal', leading: 'loose' };
  assert.deepEqual(page.state(), expected);
  page.assertSelected(expected);
  page.change(null, 'other-key');
  assert.deepEqual(page.state(), expected);
  for (const stored of ['null', '[]', '{broken', '{"theme":false,"font":{},"size":0,"leading":[]}']) {
    page.change(stored);
    assert.deepEqual(page.state(), defaults);
    page.assertSelected(defaults);
  }
  page.change('{"theme":"dark"}');
  page.change(null, null);
  assert.deepEqual(page.state(), defaults);
  page.assertSelected(defaults);
});

test('System theme changes apply only to the auto choice', () => {
  const page = boot();
  page.darkQuery.matches = true;
  page.darkQuery.change();
  assert.equal(page.dataset.theme, 'dark');
  assert.equal(page.meta.content, '#131311');
  page.click('theme', 'light');
  page.darkQuery.change();
  assert.equal(page.dataset.theme, 'light');
  assert.equal(page.meta.content, '#f2f0e9');
});
