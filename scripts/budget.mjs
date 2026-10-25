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
/* 字体的口径见下面的「单页最坏」——目录总量已经不是任何一次访问的成本了 */

/* 字体分片后，「目录里所有 woff2 加起来」不再等于任何一次访问的成本：
   每页只下 公共片 + 自己那一小片。要盯的是「最坏的那一页」。
   游戏页自成一档，和图片、HTML 预算一样不计入。 */
const charset = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/font-charset.json'), 'utf8'));
const pageMap = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/data/font-pages.json'), 'utf8'));
const fontPath = (name) => (name.startsWith('fonts/') ? name : `fonts/${name}`);
const sizeOf = (rel) => files.find((file) => file.rel === rel)?.size ?? 0;
const fixedFont =
  sizeOf(fontPath(charset.slices.latin.file)) + sizeOf(fontPath(charset.slices.punct.file)) + sizeOf(pageMap.shared.file);
const pageFonts = Object.entries(pageMap.pages)
  .filter(([route]) => !route.startsWith('/games/'))
  .map(([route, entry]) => ({ route, bytes: fixedFont + (entry.file ? sizeOf(fontPath(entry.file)) : 0) }))
  .sort((a, b) => b.bytes - a.bytes);
const worstFont = pageFonts[0] ?? { route: '—', bytes: fixedFont };

const sum = (list, key) => list.reduce((total, file) => total + file[key], 0);

/* ---------- 预算 ---------- */

const rows = [
  {
    name: 'CSS',
    current: sum(css, 'size'),
    /* 90 → 96（第六轮：订阅页 + 笔记独立页）→ 100（第七轮：作者页 + 许可页 + 署名）
       → 104（第八轮：设置面板 + 中文排版规则）→ 108（第十一轮：游戏网格 + 封面 + 说明区）。
       门槛是防失控的，不是压到极限——104 已经被新章节贴住，留 4KB 余量比为了几十字节
       把规则拆成更省字节但更难读的写法划算。gzip 那一条才是真正要盯的：20.2/21 */
    max: 108 * KB,
    gzip: sum(css, 'gzip'),
    gzipMax: 21 * KB,
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
  {
    name: '字体（单页最坏）',
    current: worstFont.bytes,
    /* 分片前是「整片汉字 232KB + 拉丁 52KB + 标点 5KB」，每页都付这个数。
       现在每页 = 公共片 105KB + 拉丁 + 标点 + 自己的增量片（20–80 字）。
       220 是红线：真涨上去说明公共片没起作用（阈值调低了），或者某篇在大量生造字。 */
    max: 220 * KB,
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

if (pageFonts.length) {
  console.log('\n  字体最坏的三页（固定成本 + 该页增量片）：');
  for (const page of pageFonts.slice(0, 3)) {
    console.log(`    ${kb(page.bytes).padStart(6)} KB  ${page.route}`);
  }
  console.log(`      固定成本 ${kb(fixedFont)} KB：拉丁 + 标点 + 公共片，每页都付`);
}

const game = sum(files.filter(isGame), 'size');
const og = sum(files.filter(isOg), 'size');
console.log(`\n  不计入预算：游戏 ${kb(game)} KB、分享封面 ${kb(og)} KB`);

console.log(`\n${failed ? 'FAIL' : 'OK'}  体积预算${failed ? '被突破，先看看上面哪一项涨了' : '内'}\n`);
if (failed) process.exit(1);
