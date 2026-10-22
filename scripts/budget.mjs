/**
 * 体积预算：构建产物超过上限就让 CI 红。
 *
 *   npm run budget
 *
 * 只约束「主站」——独立游戏页（dist/games）与分享封面（dist/og）是单独的内容，
 * 进不了首屏，算进来只会让预算失去意义。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const dist = path.join(process.cwd(), 'dist');
if (!fs.existsSync(dist)) {
  console.error('还没有 dist，先跑 npm run build。');
  process.exit(1);
}

/* ---------- 收集 ---------- */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(dist).map((file) => {
  const rel = path.relative(dist, file).split(path.sep).join('/');
  const buffer = fs.readFileSync(file);
  return {
    rel,
    ext: path.extname(file).toLowerCase(),
    size: buffer.length,
    gzip: zlib.gzipSync(buffer, { level: 9 }).length,
  };
});

const KB = 1024;
const kb = (bytes) => (bytes / KB).toFixed(1);
const isGame = (file) => file.rel.startsWith('games/');
const isOg = (file) => file.rel.startsWith('og/');

const css = files.filter((f) => f.ext === '.css');
const js = files.filter((f) => f.ext === '.js');
const html = files.filter((f) => f.ext === '.html' && !isGame(f));
const images = files.filter(
  (f) => /\.(avif|webp|png|jpe?g|gif|svg)$/.test(f.ext) && !isGame(f) && !isOg(f)
);

const sum = (list, key) => list.reduce((total, file) => total + file[key], 0);

/* ---------- 预算 ---------- */

const rows = [
  {
    name: 'CSS',
    current: sum(css, 'size'),
    max: 90 * KB,
    gzip: sum(css, 'gzip'),
    gzipMax: 18 * KB,
  },
  {
    name: 'JS',
    current: sum(js, 'size'),
    max: 32 * KB,
    gzip: sum(js, 'gzip'),
    gzipMax: 12 * KB,
  },
  {
    name: '单页 HTML（最大）',
    current: Math.max(0, ...html.map((f) => f.size)),
    max: 80 * KB,
    gzip: Math.max(0, ...html.map((f) => f.gzip)),
    gzipMax: 20 * KB,
  },
  {
    name: '图片（主站）',
    current: sum(images, 'size'),
    max: 600 * KB,
    gzip: null,
    gzipMax: null,
  },
];

let failed = false;
console.log('');
for (const row of rows) {
  const over = row.current > row.max || (row.gzip !== null && row.gzip > row.gzipMax);
  if (over) failed = true;
  const gz =
    row.gzip === null ? '' : `   gzip ${kb(row.gzip)} / ${kb(row.gzipMax)} KB`;
  const ratio = Math.round((row.current / row.max) * 100);
  console.log(`  ${over ? '✗' : '✓'} ${row.name.padEnd(16, ' ')} ${kb(row.current).padStart(6)} / ${kb(row.max)} KB  (${String(ratio).padStart(3)}%)${gz}`);
}

/* ---------- 明细 ---------- */

if (css.length) {
  console.log('\n  CSS：');
  for (const file of css.sort((a, b) => b.size - a.size)) {
    console.log(`    ${kb(file.size).padStart(6)} KB  ${file.rel}`);
  }
}
if (js.length) {
  console.log('\n  JS：');
  for (const file of js.sort((a, b) => b.size - a.size)) {
    console.log(`    ${kb(file.size).padStart(6)} KB  ${file.rel}`);
  }
}
if (html.length) {
  console.log('\n  最大的三个页面：');
  for (const file of html.sort((a, b) => b.size - a.size).slice(0, 3)) {
    console.log(`    ${kb(file.size).padStart(6)} KB  ${file.rel}`);
  }
}

const game = sum(files.filter(isGame), 'size');
const og = sum(files.filter(isOg), 'size');
console.log(`\n  不计入预算：游戏 ${kb(game)} KB、分享封面 ${kb(og)} KB`);

console.log(`\n${failed ? 'FAIL' : 'OK'}  体积预算${failed ? '被突破，先看看上面哪一项涨了' : '内'}\n`);
if (failed) process.exit(1);
