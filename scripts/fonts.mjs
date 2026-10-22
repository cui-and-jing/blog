#!/usr/bin/env node
/**
 * 中文字体子集化
 *
 * 站里的正文只有中文，系统字体在 Windows 上会落到宋体（点阵感强、小字发虚），
 * macOS 落到宋体 SC，两端观感差很远。这里把一款开源宋体按「站内真正出现过的字」
 * 裁成 woff2，体积从 11MB 压到 300KB 以内。
 *
 * 源字体不进仓库（11MB），放在 .fonts/，见 README。
 * 产物（public/fonts/*.woff2、src/styles/fonts.css、src/data/font-charset.json）要提交。
 *
 * 用法：
 *   node scripts/fonts.mjs           生成子集
 *   node scripts/fonts.mjs --check   只校验内容有没有用到子集外的字（CI 用，不需要源字体）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(root, 'src');
const SOURCE_FONT = path.join(root, '.fonts', 'NotoSerifSC-Regular.otf');
const OUT_DIR = path.join(root, 'public', 'fonts');
const CSS_OUT = path.join(SRC, 'styles', 'fonts.css');
const CHARSET_OUT = path.join(SRC, 'data', 'font-charset.json');
const FILES_OUT = path.join(SRC, 'data', 'font-files.json');

const FAMILY = 'Prose Serif';

/* 和 astro.config.mjs 用同一个来源，换部署路径时字体 URL 不会指错地方 */
const BASE = (process.env.BLOG_BASE ?? '/blog').replace(/\/$/, '');

/**
 * 切片按 unicode 区间来分，浏览器会自己做匹配：页面上没有某片里的字，就不下载那一片。
 * 用「实际用到才下」而不是「全都下」，列表页、关于页因此只付几百字节的代价。
 */
const SLICES = [
  { name: 'latin', test: (cp) => (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) },
  { name: 'punct', test: (cp) => (cp >= 0x2000 && cp <= 0x206f) || (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) },
  { name: 'han', test: (cp) => (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff) },
];

/* unicode-range 要写成连续区间，浏览器才能在没有该字时跳过整片。
   区间比实际字集宽一点无所谓：缺字会自动回退到系统字体，不会显示成豆腐块。 */
const RANGES = {
  latin: 'U+0020-00FF',
  punct: 'U+2000-206F, U+3000-303F, U+FF00-FFEF',
  han: 'U+3400-4DBF, U+4E00-9FFF',
};

/** 排版上一定会用到、但可能暂时没出现在内容里的字符，先垫上，省得每加一篇就要重跑 */
const ENSURE = '·—…“”‘’「」『』《》〈〉（）【】、，。；：？！～×÷%‰°→←↑↓●○◆■□★☆✓';

function collectFiles(dir) {
  const out = [];
  /* 这两个是脚本自己的产物，扫进来会让字符集只增不减（删文章后旧字还留着） */
  const skip = new Set(['font-charset.json', 'font-files.json']);
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

function readCharset() {
  if (!fs.existsSync(CHARSET_OUT)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHARSET_OUT, 'utf8'));
  } catch {
    return null;
  }
}

/* ---------------- --check：CI 里跑，确认没有用到子集外的字 ---------------- */

function check() {
  const chars = collectChars();
  const saved = readCharset();

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

  /* 先清空再生成：文件名带内容指纹，不清的话每改一次字就多留三份旧文件，
     而且 public/fonts 是提交进仓库的，垃圾会一直跟着走 */
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const faces = [];
  const stats = {};

  for (const slice of SLICES) {
    const list = buckets[slice.name];
    if (!list.length) continue;

    const subset = await subsetFont(source, list.join(''), { targetFormat: 'woff2' });
    const hash = crypto.createHash('sha256').update(subset).digest('hex').slice(0, 8);
    /* 文件名带指纹：子集变了就是新 URL，不会被 GitHub Pages 的缓存按旧文件返回 */
    const file = `prose-serif-${slice.name}.${hash}.woff2`;
    fs.writeFileSync(path.join(OUT_DIR, file), subset);

    stats[slice.name] = { chars: list.length, bytes: subset.length, hash, file };
    faces.push({ file, range: RANGES[slice.name], hash });
    console.log(`  ${file.padEnd(34)} ${String(list.length).padStart(5)} 字  ${(subset.length / 1024).toFixed(0)}KB`);
  }

  /* 字体名带指纹：改了子集浏览器一定会重新下载，不会拿旧缓存显示缺字 */
  const version = crypto
    .createHash('sha256')
    .update(faces.map((face) => face.hash).join(''))
    .digest('hex')
    .slice(0, 6);
  const family = `${FAMILY} ${version}`;

  const css = `/* 由 scripts/fonts.mjs 生成，不要手改。重新生成：npm run fonts */
/* 子集版本 ${version} · ${chars.size} 个字符 */
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

  /* 汉字片是首屏的主力，值得在 <head> 里 preload；
     路径带指纹，所以要单独落一份给布局层读 */
  fs.writeFileSync(
    FILES_OUT,
    `${JSON.stringify(
      Object.fromEntries(Object.entries(stats).map(([name, item]) => [name, `fonts/${item.file}`])),
      null,
      2
    )}\n`
  );

  /* 备份旧文件，方便看这次新增了哪些字 */
  const previous = readCharset();
  const added = previous?.chars ? [...chars].filter((ch) => !previous.chars.includes(ch)) : [];

  fs.writeFileSync(
    CHARSET_OUT,
    `${JSON.stringify(
      {
        generated: new Date().toISOString().slice(0, 10),
        version,
        total: chars.size,
        slices: stats,
        chars: sortChars(chars).join(''),
      },
      null,
      2
    )}\n`
  );

  const totalBytes = Object.values(stats).reduce((sum, item) => sum + item.bytes, 0);
  console.log(`\n✓ ${chars.size} 个字符 → 共 ${(totalBytes / 1024).toFixed(0)}KB（${Object.keys(stats).join(' + ')}）`);
  if (added.length) console.log(`  本次新增 ${added.length} 字：${added.join('')}`);
}

const isCheck = process.argv.includes('--check');
if (isCheck) check();
else await build();
