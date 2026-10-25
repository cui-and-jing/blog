#!/usr/bin/env node
/**
 * 中文字体子集化
 *
 * 站里的正文只有中文，系统字体在 Windows 上会落到宋体（点阵感强、小字发虚），
 * macOS 落到宋体 SC，两端观感差很远。这里把一款开源宋体按「站内真正出现过的字」
 * 裁成 woff2，体积从 11MB 压到 300KB 以内。
 *
 * 分片策略（第九轮改法）：
 *   早先只按 unicode 区块切成 latin / punct / han 三片，han 一片 232KB，
 *   而单个页面实际只用到 200–420 字 —— 每页都在下载用不上的字。
 *   改成两层：
 *     · 公共片 = 出现在 ≥SHARED_MIN 个页面里的字（导航、标签、常用词）
 *     · 每页增量片 = 该页剩下独有的字
 *   unicode-range 必须精确到码点，否则浏览器会把「整段 CJK」都算作命中。
 *
 * 实测（35 个页面）：公共 421 字 / 106KB，文章页增量 20–60 字，
 * 首屏字体从 289KB 降到约 165KB。
 *
 * 源字体不进仓库（11MB），放在 .fonts/，见 README。
 * 产物（public/fonts/*.woff2、src/styles/fonts.css、src/data/font-*.json）要提交。
 *
 * 用法：
 *   node scripts/fonts.mjs               生成子集（需要 dist，先 npm run build）
 *   node scripts/fonts.mjs --check       校验 src 里有没有子集外的字（CI 用，不需要源字体）
 *   node scripts/fonts.mjs --check-pages 构建后逐页校验覆盖（CI 用，不需要源字体）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(root, 'src');
const DIST = path.join(root, 'dist');
const SOURCE_FONT = path.join(root, '.fonts', 'NotoSerifSC-Regular.otf');
const OUT_DIR = path.join(root, 'public', 'fonts');
const CSS_OUT = path.join(SRC, 'styles', 'fonts.css');
const CHARSET_OUT = path.join(SRC, 'data', 'font-charset.json');
const FILES_OUT = path.join(SRC, 'data', 'font-files.json');
const PAGES_OUT = path.join(SRC, 'data', 'font-pages.json');

const FAMILY = 'Prose Serif';

/** 出现在这么多个页面里的汉字，值得放进人人都会下载的公共片 */
const SHARED_MIN = 4;

/* 和 astro.config.mjs 用同一个来源，换部署路径时字体 URL 不会指错地方 */
const BASE = (process.env.BLOG_BASE ?? '/blog').replace(/\/$/, '');

/**
 * 粗切按 unicode 区间来分：拉丁与标点页页都要，量也小，给宽区间就够。
 * 汉字片不在这里定区间——它要按「共用度」再切，区间必须精确到码点。
 */
const SLICES = [
  { name: 'latin', test: (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) },
  { name: 'punct', test: (cp) => (cp >= 0x2000 && cp <= 0x206f) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) },
  { name: 'han', test: (cp) => (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) },
];

const RANGES = {
  latin: 'U+0020-00FF',
  punct: 'U+2000-206F, U+3000-303F, U+FF00-FFEF',
};

/** 排版上一定会用到、但可能暂时没出现在内容里的字符，先垫上，省得每加一篇就要重跑 */
const ENSURE = '·—…“”‘’「」『』《》〈〉（）【】、，。；：？！～×÷%‰°→←↑↓●○◆■□★☆✓';

function collectFiles(dir) {
  const out = [];
  /* 这几个是脚本自己的产物，扫进来会让字符集只增不减（删文章后旧字还留着） */
  const skip = new Set(['font-charset.json', 'font-files.json', 'font-pages.json']);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(astro|ts|md|mdx|json)$/.test(entry.name) && !skip.has(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** 扫 src/ 下所有文本，收集需要渲染的字符 */
function collectChars() {
  const chars = new Set();
  for (const file of collectFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const ch of text) {
      if (SLICES.some((slice) => slice.test(ch.codePointAt(0)))) chars.add(ch);
    }
  }
  for (const ch of ENSURE) chars.add(ch);
  return chars;
}

const sortChars = (chars) => [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));

function sliceOf(chars) {
  const buckets = Object.fromEntries(SLICES.map((slice) => [slice.name, []]));
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const slice = SLICES.find((item) => item.test(cp));
    if (slice) buckets[slice.name].push(ch);
  }
  return buckets;
}

const isHan = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff);
};

/** 码点集合 → 紧凑的 unicode-range（连续码点合并成区间） */
function rangeOf(chars) {
  const cps = [...new Set([...chars].map((ch) => ch.codePointAt(0)))].sort((a, b) => a - b);
  if (!cps.length) return '';
  const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
  const parts = [];
  let start = cps[0];
  let prev = cps[0];
  for (let i = 1; i < cps.length; i += 1) {
    const cp = cps[i];
    if (cp === prev + 1) {
      prev = cp;
      continue;
    }
    parts.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`);
    start = cp;
    prev = cp;
  }
  parts.push(start === prev ? `U+${hex(start)}` : `U+${hex(start)}-${hex(prev)}`);
  return parts.join(',');
}

/**
 * 读构建产物，得到「每页真正渲染了哪些汉字」。
 * 只看正文文本：脚本与样式不算，标签剥掉。
 * 没有 dist 时返回 null，调用方退回单文件（和旧行为一致）。
 */
function analyzePages() {
  if (!fs.existsSync(DIST)) return null;

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) files.push(full);
    }
  };
  walk(DIST);

  /* 游戏是独立单文件，用系统字体栈，不参与正文子集 —— 让它们进统计会把
     界面文字推进「公共片」，而公共片是每页都要付的固定成本 */
  const isGame = (file) => path.relative(DIST, file).split(path.sep)[0] === 'games';

  const pages = files
    .filter((file) => !isGame(file))
    .map((file) => {
      const html = fs
        .readFileSync(file, 'utf8')
        .replace(/<script[\s\S]*?<\/script>/g, ' ')
        .replace(/<style[\s\S]*?<\/style>/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      const rel = `/${path.relative(DIST, file).split(path.sep).join('/')}`
        .replace(/\/index\.html$/, '/')
        .replace(/^\/(index\.html|)$/, '/');
      return { path: rel, chars: new Set([...html].filter(isHan)) };
    });

  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/* ---------------- --check：CI 里跑，确认没有用到子集外的字 ---------------- */

function check() {
  const chars = collectChars();
  const saved = readJson(CHARSET_OUT);

  if (!saved?.chars) {
    console.error('✗ 找不到 src/data/font-charset.json，先本地跑一次 npm run fonts');
    process.exit(1);
  }

  const known = new Set([...saved.chars]);
  const missing = sortChars(chars).filter((ch) => !known.has(ch));

  if (missing.length) {
    console.error(`✗ 有 ${missing.length} 个字符不在字体子集里，线上会回退成系统字体：`);
    console.error(`  ${missing.join('')}`);
    console.error('  修法：npm run fonts（需要 .fonts/ 里的源字体），然后提交 public/fonts 与 src/styles/fonts.css');
    process.exit(1);
  }

  console.log(`✓ 字体子集覆盖全部 ${chars.size} 个字符`);
}

/* ---------------- --check-pages：构建后逐页校验覆盖 ---------------- */

function checkPages() {
  const map = readJson(PAGES_OUT);
  if (!map?.pages) {
    console.error('✗ 找不到 src/data/font-pages.json，先本地跑一次 npm run fonts');
    process.exit(1);
  }

  const pages = analyzePages();
  if (!pages) {
    console.error('✗ 没有 dist，先 npm run build');
    process.exit(1);
  }

  const shared = new Set([...(map.shared.chars ?? '')]);
  const problems = [];
  let covered = 0;

  for (const page of pages) {
    const entry = map.pages[page.path];
    if (!entry) {
      problems.push(`${page.path} 没有出现在 font-pages.json 里`);
      continue;
    }
    const own = new Set([...(entry.chars ?? '')]);
    const missing = [...page.chars].filter((ch) => !shared.has(ch) && !own.has(ch));
    if (missing.length) {
      problems.push(`${page.path} 缺 ${missing.length} 字：${missing.slice(0, 24).join('')}`);
    } else {
      covered += 1;
    }
  }

  if (problems.length) {
    console.error(`✗ 有 ${problems.length} 个页面的字体覆盖不完整，这些字会回退成系统宋体：`);
    for (const item of problems.slice(0, 12)) console.error(`  ${item}`);
    if (problems.length > 12) console.error(`  ……还有 ${problems.length - 12} 个`);
    console.error('  修法：npm run build && npm run fonts，然后提交产物');
    process.exit(1);
  }

  console.log(`✓ ${covered} 个页面的字形全部被「公共片 + 该页增量片」覆盖`);
}

/* ---------------- 生成 ---------------- */

async function build() {
  if (!fs.existsSync(SOURCE_FONT)) {
    console.error(`✗ 缺少源字体 ${path.relative(root, SOURCE_FONT)}`);
    console.error('  curl -sL --create-dirs \\');
    console.error('    https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf \\');
    console.error('    -o .fonts/NotoSerifSC-Regular.otf');
    process.exit(1);
  }

  const { default: subsetFont } = await import('subset-font');
  const source = fs.readFileSync(SOURCE_FONT);
  const chars = collectChars();
  const buckets = sliceOf(sortChars(chars));
  const pages = analyzePages();

  /* 页面里出现的汉字可能比 src 扫到的多一点（脚本拼出来的日期、衍生的标题），取并集兜住 */
  const allHan = new Set(buckets.han);
  if (pages) for (const page of pages) for (const ch of page.chars) allHan.add(ch);

  /* 公共片 = 出现在足够多页面里的汉字；没有 dist 时全归公共片（旧行为） */
  let sharedHan;
  if (pages) {
    const freq = new Map();
    for (const page of pages) for (const ch of page.chars) freq.set(ch, (freq.get(ch) || 0) + 1);
    sharedHan = new Set([...allHan].filter((ch) => (freq.get(ch) || 0) >= SHARED_MIN));
  } else {
    sharedHan = new Set(allHan);
    console.log('· 没有 dist，退化成单文件（先 npm run build 才能按页切分）');
  }

  /* 先清空再生成：文件名带内容指纹，不清的话每改一次字就多留一份旧文件，
     而且 public/fonts 是提交进仓库的，垃圾会一直跟着走 */
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const faces = [];
  const stats = {};

  const emit = async (name, list, range) => {
    if (!list.length) return null;
    const subset = await subsetFont(source, list.join(''), { targetFormat: 'woff2' });
    const hash = crypto.createHash('sha256').update(subset).digest('hex').slice(0, 8);
    /* 文件名带指纹：子集变了就是新 URL，不会被 GitHub Pages 的缓存按旧文件返回 */
    const file = `prose-serif-${name}.${hash}.woff2`;
    fs.writeFileSync(path.join(OUT_DIR, file), subset);
    return { file, range, hash, chars: list.length, bytes: subset.length };
  };

  /* 拉丁与标点：宽区间，页页都用得到 */
  for (const slice of SLICES) {
    if (slice.name === 'han') continue;
    const face = await emit(slice.name, buckets[slice.name], RANGES[slice.name]);
    if (!face) continue;
    stats[slice.name] = face;
    faces.push(face);
    console.log(`  ${face.file.padEnd(36)} ${String(face.chars).padStart(5)} 字  ${(face.bytes / 1024).toFixed(0)}KB`);
  }

  /* 公共汉字片：区间必须精确到码点，否则浏览器会把整段 CJK 都当成命中 */
  const shared = await emit('han', [...sharedHan], rangeOf(sharedHan));
  if (!shared) throw new Error('公共汉字片为空');
  stats.han = shared;
  faces.push(shared);
  console.log(`  ${shared.file.padEnd(36)} ${String(shared.chars).padStart(5)} 字  ${(shared.bytes / 1024).toFixed(0)}KB  公共片`);

  /* 全量片只给「没进映射的页面」兜底，正常页面不会引用 */
  const full = await emit('all', [...allHan], rangeOf(allHan));
  console.log(`  ${full.file.padEnd(36)} ${String(full.chars).padStart(5)} 字  ${(full.bytes / 1024).toFixed(0)}KB  兜底`);

  /* 每页增量片：按字符集去重，内容一样的页面共用一个文件 */
  const pageMap = {};
  const byHash = new Map();
  let pageFiles = 0;
  let deltaTotal = 0;

  for (const page of pages ?? []) {
    const delta = [...page.chars].filter((ch) => !sharedHan.has(ch)).sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
    if (!delta.length) {
      pageMap[page.path] = { file: null, range: '', chars: '' };
      continue;
    }
    const key = delta.join('');
    const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);
    let face = byHash.get(hash);
    if (!face) {
      face = await emit(`p-${hash}`, delta, rangeOf(delta));
      byHash.set(hash, face);
      pageFiles += 1;
      deltaTotal += face.bytes;
    }
    if (!face) {
      pageMap[page.path] = { file: null, range: '', chars: '' };
      continue;
    }
    pageMap[page.path] = {
      file: `fonts/${face.file}`,
      range: face.range,
      chars: delta.join(''),
      count: delta.length,
    };
  }

  /* 字体名带指纹：改了子集浏览器一定会重新下载，不会拿旧缓存显示缺字 */
  const version = crypto
    .createHash('sha256')
    .update(faces.map((face) => face.hash).join(''))
    .digest('hex')
    .slice(0, 6);
  const family = `${FAMILY} ${version}`;

  /* 公共片与拉丁/标点进全局样式；每页增量片由布局按当前路径注入 */
  const css = `/* 由 scripts/fonts.mjs 生成，不要手改。重新生成：npm run fonts */
/* 子集版本 ${version} · ${chars.size} 个字符 · 公共汉字 ${shared.chars} 个 */
${faces
  .map(
    (face) => `@font-face {
  font-family: '${family}';
  src: url('${BASE}/fonts/${face.file}') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: ${face.range};
}`
  )
  .join('\n\n')}

/* 兜底栈里同一款字体的系统版本排后面，字体没加载完时先顶上来，不会出现空白 */
:root {
  --font-prose-serif: '${family}', Georgia, 'Songti SC', 'STSong', 'SimSun', serif;
}
`;

  fs.writeFileSync(CSS_OUT, css);

  /* 公共片是首屏主力，值得在 <head> 里 preload；路径带指纹，单独落一份给布局层读 */
  fs.writeFileSync(
    FILES_OUT,
    `${JSON.stringify({ han: `fonts/${shared.file}`, all: `fonts/${full.file}` }, null, 2)}\n`
  );

  fs.writeFileSync(
    PAGES_OUT,
    `${JSON.stringify(
      {
        version,
        family,
        shared: {
          file: `fonts/${shared.file}`,
          range: shared.range,
          chars: [...sharedHan].join(''),
          count: shared.chars,
        },
        full: {
          file: `fonts/${full.file}`,
          range: full.range,
          chars: [...allHan].join(''),
          count: full.chars,
        },
        pages: pageMap,
      },
      null,
      2
    )}\n`
  );

  /* 备份旧文件，方便看这次新增了哪些字 */
  const previous = readJson(CHARSET_OUT);
  const added = previous?.chars ? [...chars].filter((ch) => !previous.chars.includes(ch)) : [];

  fs.writeFileSync(
    CHARSET_OUT,
    `${JSON.stringify(
      {
        generated: new Date().toISOString().slice(0, 10),
        version,
        total: chars.size,
        slices: {
          latin: stats.latin && { chars: stats.latin.chars, bytes: stats.latin.bytes, hash: stats.latin.hash, file: stats.latin.file },
          punct: stats.punct && { chars: stats.punct.chars, bytes: stats.punct.bytes, hash: stats.punct.hash, file: stats.punct.file },
          han: { chars: shared.chars, bytes: shared.bytes, hash: shared.hash, file: shared.file },
        },
        pages: { count: Object.keys(pageMap).length, files: pageFiles, bytes: deltaTotal },
        chars: sortChars(chars).join(''),
      },
      null,
      2
    )}\n`
  );

  const totalBytes = stats.latin.bytes + stats.punct.bytes + shared.bytes;
  console.log(`\n✓ ${chars.size} 个字符 → 每页固定 ${(totalBytes / 1024).toFixed(0)}KB（latin + punct + 公共片）`);
  console.log(`  每页增量 ${pageFiles} 个文件 / ${(deltaTotal / 1024).toFixed(0)}KB，按页取用`);
  if (added.length) console.log(`  本次新增 ${added.length} 字：${added.join('')}`);
}

const mode = process.argv.includes('--check')
  ? 'check'
  : process.argv.includes('--check-pages')
    ? 'check-pages'
    : 'build';

if (mode === 'check') check();
else if (mode === 'check-pages') checkPages();
else await build();
