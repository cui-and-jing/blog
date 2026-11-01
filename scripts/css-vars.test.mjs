/**
 * Detect CSS custom-property references with no fallback and no declaration.
 * Declarations may live in stylesheets or in Astro/component inline style bindings.
 *
 * Fallback-bearing var(--name, value) calls are valid without a declaration.
 * This is a static contract, not a substitute for browser computed-style checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function withoutComments(value) {
  return value.replace(/\/\*[\s\S]*?\*\//g, '');
}

function unresolved(stylesheets, declarations = []) {
  const sources = [...stylesheets.map(({ text }) => withoutComments(text)), ...declarations];
  const defined = new Set(
    sources.flatMap((source) => [...source.matchAll(/(--[a-zA-Z][\w-]*)\s*:/g)].map((m) => m[1])),
  );
  return stylesheets.flatMap(({ file, text }) =>
    [...withoutComments(text).matchAll(/var\(\s*(--[\w-]+)\s*\)/g)]
      .filter((m) => !defined.has(m[1]))
      .map((m) => `${file}: ${m[1]}`),
  );
}

// Regression fixtures: missing no-fallback variables fail; CSS/inline declarations
// and explicit var() fallbacks are accepted; comments cannot trigger failures.
assert.deepEqual(unresolved([{ file: 'bad.css', text: '.x{box-shadow:var(--missing)}' }]), [
  'bad.css: --missing',
]);
assert.deepEqual(unresolved([{ file: 'ok.css', text: ':root{--shadow:0 1px 2px #000}.x{box-shadow:var(--shadow)}' }]), []);
assert.deepEqual(unresolved([{ file: 'ok.css', text: '.x{color:var(--dynamic)}' }], ['<span style="--dynamic:red">']), []);
assert.deepEqual(unresolved([{ file: 'ok.css', text: '.x{color:var(--optional, red)}' }]), []);
assert.deepEqual(unresolved([{ file: 'ok.css', text: '/* color: var(--ignored); */ .x{color:red}' }]), []);

const paths = walk('src');
const stylesheets = paths.filter((file) => file.endsWith('.css')).map((file) => ({
  file,
  text: fs.readFileSync(file, 'utf8'),
}));
const markup = paths
  .filter((file) => /\.(astro|ts|js|mjs)$/.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'));
const missing = unresolved(stylesheets, markup);
if (missing.length) {
  console.error('Unresolved CSS variables without fallback:\n' + missing.join('\n'));
  process.exit(1);
}
console.log(`✓ ${stylesheets.length} CSS files: all no-fallback var() references have CSS or template declarations`);
