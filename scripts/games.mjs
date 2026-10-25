/**
 * 构建后处理：把 dist/games 下的单文件游戏压到最小。
 *
 *   npm run build              astro build 之后自动跑
 *   npm run games              单独跑（要已有 dist）
 *   npm run vendor:three       只看 three 的裁剪结果，不碰 dist
 *
 * 两件事：
 *   1. 把内联的 three.js 源码整段换成「只含用到导出的」压缩构建（见 lib/three-vendor.mjs）
 *   2. 其余 <script> 原地压缩
 *
 * 为什么不在源码里压：public/games/*.html 是这游戏的源码形态——三万行、能读、能改。
 * 压缩属于发布环节，放在 dist 上做，源码保持原样。也因此这里每次都从 public 重新推导，
 * 而不是读 dist：跑两遍结果一样，不会越压越小或把已压过的再压一次。
 *
 * 为什么不压 <style>：整页 CSS 只有 19KB gzip，压完省不到 5KB，
 * 而 `content: "…"` 里的引号和转义是这类脚本最容易压坏的地方。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import esbuild from 'esbuild';
import { buildThreeBundle, THREE_REVISION } from './lib/three-vendor.mjs';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'public', 'games');
const DIST_DIR = path.join(ROOT, 'dist', 'games');

const onlyVendor = process.argv.includes('--vendor-only');

if (!onlyVendor && !fs.existsSync(DIST_DIR)) {
  console.error('还没有 dist/games，先跑一次 npm run build。');
  process.exit(1);
}

const gz = (text) => zlib.gzipSync(Buffer.from(text), { level: 6 }).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);

/** 认哪一段是内联的 three.js：它同时带 MIT 头和 `window.THREE=` 收尾 */
const isThreeBlock = (code) => /three\.js authors/i.test(code) && /window\.THREE\s*=/.test(code);

/**
 * 压缩单个脚本块。
 *
 * 注意 `</script`：字符串里出现这七个字符会把 HTML 提前闭合，页面直接白屏。
 * esbuild 通常会转义，但这是“通常”——自己再兜一层，`<\/script` 在 JS 字符串里等值。
 */
async function minifyScript(code) {
  const result = await esbuild.transform(code, {
    loader: 'js',
    minify: true,
    target: 'es2020',
    legalComments: 'none',
  });
  return result.code.replace(/<\/script/gi, '<\\/script');
}

const bundle = await buildThreeBundle();

if (onlyVendor) {
  console.log(`three.js r${THREE_REVISION}`);
  console.log(`导出 ${bundle.names.length} 个：${bundle.names.join(', ')}`);
  console.log(`产物 ${kb(bundle.bytes)}KB / gzip ${kb(bundle.gzip)}KB（未压缩源码约 1541KB）`);
  process.exit(0);
}

const rows = [];
const problems = [];

for (const name of fs.readdirSync(SRC_DIR).filter((file) => file.endsWith('.html'))) {
  const source = fs.readFileSync(path.join(SRC_DIR, name), 'utf8');
  const distFile = path.join(DIST_DIR, name);

  if (!fs.existsSync(distFile)) {
    problems.push(`${name} 在 dist 里不存在`);
    continue;
  }

  const parts = [];
  let cursor = 0;
  let threeReplaced = 0;
  let scripts = 0;

  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [whole, attrs, body] = match;
    if (/src\s*=/.test(attrs) || !body.trim()) continue;

    const replacement = isThreeBlock(body) ? bundle.code : await minifyScript(body);
    if (isThreeBlock(body)) threeReplaced += 1;
    else scripts += 1;

    parts.push(source.slice(cursor, match.index));
    parts.push(whole.replace(body, () => replacement));
    cursor = match.index + whole.length;
  }
  parts.push(source.slice(cursor));

  const output = parts.join('');
  fs.writeFileSync(distFile, output);

  rows.push({
    name,
    before: Buffer.byteLength(source),
    after: Buffer.byteLength(output),
    beforeGz: gz(source),
    afterGz: gz(output),
    threeReplaced,
    scripts,
  });
}

const pad = (text, width) => {
  const shown = [...text].reduce((sum, ch) => sum + (/[\u2e80-\uffff]/.test(ch) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(0, width - shown));
};

console.log('\n  游戏页压缩（gzip 按第 6 级，与 Pages 实际响应头一致）');
console.log('  文件                    原始      压缩后     原始gz    压缩后gz');
for (const row of rows) {
  const cut = row.beforeGz > 0 ? (100 - (row.afterGz / row.beforeGz) * 100).toFixed(0) : '0';
  console.log(
    `  ${pad(row.name, 22)}${kb(row.before).padStart(7)}KB ${kb(row.after).padStart(8)}KB ` +
      `${kb(row.beforeGz).padStart(8)}KB ${kb(row.afterGz).padStart(8)}KB  -${cut}%`
  );
}

if (problems.length) {
  console.error('\n✗ 游戏页压缩失败：');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `\n  three.js r${THREE_REVISION} 裁剪后只导出 ${bundle.names.length} 个名字：` +
    `${kb(bundle.bytes)}KB / gzip ${kb(bundle.gzip)}KB`
);
console.log(`  这些名字来自：${bundle.names.join(', ')}`);
