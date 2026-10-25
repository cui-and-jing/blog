/**
 * 生成「只包含本站游戏用到的导出」的 three 构建。
 *
 * 为什么不用 three 的官方构建：r185 起官方不再提供压缩版，`build/three.module.js`
 * 是未压缩源码——1541KB、34186 行、平均行长 46 字符。原样内联进游戏页，它一个人
 * 就占了整页传输的 54%。而游戏实际只用到三十来个类，剩下的 Loader、Audio、
 * 后期处理全是用不上的。
 *
 *   npm run vendor:three        生成并打印体积
 *
 * 产物不落进仓库：构建时现算，谁也不用担心它和游戏代码走偏。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import esbuild from 'esbuild';
import * as THREE from 'three';

const ROOT = process.cwd();
const GAMES_DIR = path.join(ROOT, 'public', 'games');

export const THREE_REVISION = THREE.REVISION;

const exportNames = new Set(Object.keys(THREE));

/**
 * 把游戏源码里「可能用到 three」的名字全部捞出来。
 *
 * 三条规则，每条都对应一次真实的踩坑：
 *
 *   1. `<任意标识符>.<大写名>`——不限定 `THREE.`。这游戏的 3D 部分是这么写的：
 *      `const THREE=window.THREE`，但视图层用的是别名 `T.OrthographicCamera(...)`。
 *      只扫 `THREE.` 会漏掉整个相机类，表现是公园能进、一开竞技场就白屏。
 *   2. 参数位或方括号里的字符串字面量——几何体是这么造的：
 *      `geo('BoxGeometry', 1, 2, 3)` → `new THREE[type](...)`。类名以字符串形态存在，
 *      静态扫 `.X` 完全看不见。
 *   3. 反过来的漏网之鱼不在这里猜——`scripts/games-smoke.mjs` 会在运行时给 window.THREE
 *      套一层 Proxy，真访问到不存在的成员就把名字打出来。
 *
 * 宽口径的代价只是多带几个用不上的类（实测 36 → 39 个），可以接受；
 * 窄口径的代价是某个竞技场白屏，不能接受。
 */
export function collectThreeNames(html) {
  const game = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (whole, body) =>
    /three\.js authors/i.test(body) ? '' : whole
  );

  const names = new Set();

  for (const match of game.matchAll(/\b[A-Za-z_$][\w$]*\s*\.\s*([A-Z][A-Za-z0-9_]{2,40})\b/g)) {
    if (exportNames.has(match[1])) names.add(match[1]);
  }

  for (const match of game.matchAll(/[,([]\s*['"]([A-Z][A-Za-z0-9_]{2,40})['"]\s*[,\])]/g)) {
    if (exportNames.has(match[1])) names.add(match[1]);
  }

  /* 明写 THREE.X 却对不上导出表的，是拼错了或者版本不符，不该静默忽略 */
  const unknown = new Set();
  for (const match of game.matchAll(/\bTHREE\s*\.\s*([A-Za-z_$][\w$]*)/g)) {
    if (!exportNames.has(match[1])) unknown.add(match[1]);
  }

  return { names: [...names].sort(), unknown: [...unknown].sort() };
}

/** 读出游戏源码里内联的 three 版本，用来和 node_modules 对齐 */
export function inlineThreeRevision(source) {
  const match = source.match(/REVISION\s*[:=]\s*["'](\d+)["']/);
  return match ? match[1] : null;
}

const LICENSE = (() => {
  const file = path.join(ROOT, 'node_modules', 'three', 'LICENSE');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() : 'three.js — MIT License';
  return `/*!\n${text.split('\n').map((line) => ` * ${line}`).join('\n')}\n *\n * 本文件由 scripts/games.mjs 生成：只导出本仓库游戏实际用到的 API。\n * 不要手改，改 npm run vendor:three 的参数。\n */`;
})();

/**
 * 打成一个 IIFE，挂到全局 THREE 上。
 * 用 esbuild 而不是「先把源码拼起来再压」：只有走 ESM 的打包器才知道哪些导出没人用。
 */
export async function bundleThree(names) {
  const entry = `export { ${names.join(', ')} } from 'three';`;
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, sourcefile: 'three-entry.js', loader: 'js' },
    bundle: true,
    format: 'iife',
    globalName: 'THREE',
    minify: true,
    /* es2022：three r185 用到类字段，降到 es2020 会被转译，反而多出一层包装 */
    target: 'es2022',
    legalComments: 'none',
    write: false,
    logLevel: 'warning',
  });

  const code = result.outputFiles[0].text;
  return {
    code: `${LICENSE}\n${code}`,
    bytes: Buffer.byteLength(code),
    gzip: zlib.gzipSync(code, { level: 6 }).length,
  };
}

/** 把 public/games 下所有游戏读进来，算出需要的导出并打包一次 */
export async function buildThreeBundle() {
  const files = fs
    .readdirSync(GAMES_DIR)
    .filter((name) => name.endsWith('.html'))
    .map((name) => ({ name, text: fs.readFileSync(path.join(GAMES_DIR, name), 'utf8') }))
    .filter((file) => file.text.includes('THREE'));

  if (!files.length) throw new Error('public/games 下没有找到用 three.js 的游戏');

  const inlined = new Set();
  const names = new Set();
  const unknown = new Set();
  for (const file of files) {
    const revision = inlineThreeRevision(file.text);
    if (revision) inlined.add(revision);
    const found = collectThreeNames(file.text);
    for (const name of found.names) names.add(name);
    for (const name of found.unknown) unknown.add(name);
  }

  if (unknown.size) {
    throw new Error(
      `游戏代码里出现了 three 没有的导出：${[...unknown].sort().join(', ')}。\n` +
        `先确认拼写，或它是不是 three 新版本才有的名字。`
    );
  }

  /* 版本对不上就停：拿 r185 的包去喂一份 r170 的游戏源码，缺的类不会报错，只会白屏 */
  const stale = [...inlined].filter((revision) => revision !== THREE_REVISION);
  if (stale.length) {
    throw new Error(
      `游戏里内联的 three.js 是 r${stale.join('/r')}，node_modules 里是 r${THREE_REVISION}。\n` +
        `先把 public/games 里的游戏源码更新到同一版本，或安装对应的 three。`
    );
  }

  const bundle = await bundleThree([...names].sort());
  return { ...bundle, names: [...names].sort(), files: files.map((file) => file.name) };
}
