/**
 * 内容体检：在构建之前把「能被人眼看出来、但构建不会报错」的问题挑出来。
 *
 * 用法：npm run lint:content
 *   --strict  警告也当失败（CI 不用，留给发布前自查）
 *
 * 检查的是文章本身，不是页面：frontmatter、标题层级、图片、链接、
 * 以及分享封面是否跟得上标题改动。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const postsDir = path.join(root, 'src/content/posts');
const notesDir = path.join(root, 'src/content/notes');
const publicDir = path.join(root, 'public');
const ogDir = path.join(publicDir, 'og');
const manifestFile = path.join(ogDir, 'manifest.json');
const strict = process.argv.includes('--strict');

const problems = [];
const add = (level, file, line, message) => problems.push({ level, file, line, message });

/* ---------- 工具 ---------- */

/** 把代码块替换成等量空行，保证后续行号不错位 */
function maskCode(body) {
  const lines = body.split('\n');
  let inside = false;
  return lines
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inside = !inside;
        return '';
      }
      return inside ? '' : line;
    })
    .join('\n');
}

/** 与文章页一致的 slug 推导：相对路径去掉扩展名，斜杠换横线 */
const ogSlugOf = (slug) => slug.replace(/\//g, '-');

const ogHash = (post) =>
  crypto
    .createHash('sha1')
    .update(
      [post.title, post.description, post.date.toISOString().slice(0, 10), post.category, post.tags.join(',')].join('|')
    )
    .digest('hex')
    .slice(0, 12);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function normalizePath(p) {
  let value = p;
  try {
    value = decodeURIComponent(p);
  } catch {}
  if (value.startsWith('/blog/')) value = value.slice('/blog'.length);
  else if (value === '/blog') value = '/';
  return value;
}

/* ---------- 读文章 ---------- */

const posts = [];
for (const file of walk(postsDir)) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    add('error', rel, 1, '缺少 frontmatter（文件必须以 --- 开头）');
    continue;
  }
  let data = {};
  try {
    data = parseYaml(match[1]) ?? {};
  } catch (err) {
    add('error', rel, 1, `frontmatter 不是合法 YAML：${err.message}`);
    continue;
  }
  const body = raw.slice(match[0].length);
  posts.push({
    file: rel,
    slug: path.relative(postsDir, file).replace(/\.mdx?$/, '').split(path.sep).join('/'),
    data,
    body,
    title: String(data.title ?? ''),
    description: String(data.description ?? ''),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    category: data.category ? String(data.category) : '',
    date: data.date instanceof Date ? data.date : new Date(String(data.date)),
    draft: data.draft === true,
    cover: data.cover ? String(data.cover) : '',
  });
}

/* ---------- 站点已有路由（供内链校验） ---------- */

const staticRoutes = [
  '/',
  '/posts/',
  '/notes/',
  '/notes.xml',
  '/archive/',
  '/tags/',
  '/about/',
  '/games/',
  '/games/beanrush/',
  '/search/',
  '/styleguide/',
  '/rss.xml',
];
const routes = new Set(staticRoutes);
const tagSet = new Set();
const categorySet = new Set();
for (const post of posts) {
  if (post.draft) continue;
  routes.add(`/posts/${post.slug}/`);
  for (const tag of post.tags) {
    tagSet.add(tag);
    routes.add(`/tags/${tag}/`);
  }
  if (post.category) {
    categorySet.add(post.category);
    routes.add(`/category/${post.category}/`);
  }
}
/* 含中文的路径在正文里可能写成百分号编码，两种都收 */
for (const route of [...routes]) {
  const encoded = route
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(seg) : seg))
    .join('/');
  routes.add(encoded);
}

const isRoute = (href) => {
  const clean = normalizePath(href).split('?')[0].split('#')[0];
  if (!clean) return true;
  if (routes.has(clean)) return true;
  const withSlash = clean.endsWith('/') ? clean : `${clean}/`;
  return routes.has(withSlash);
};

/* ---------- 逐篇检查 ---------- */

let manifest = {};
if (fs.existsSync(manifestFile)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch {
    add('warn', path.relative(root, manifestFile), 1, 'manifest.json 解析失败，重新跑一次 npm run og');
  }
}

for (const post of posts) {
  const { file, body } = post;

  /* frontmatter */
  if (!post.title.trim()) add('error', file, 1, '缺少 title');
  if (post.title.length > 46) add('warn', file, 1, `标题 ${post.title.length} 字，分享封面上可能被截断（建议 ≤46）`);
  if (Number.isNaN(post.date.valueOf())) add('error', file, 1, 'date 缺失或不是合法日期');
  else if (post.date.valueOf() > Date.now()) add('warn', file, 1, `发布日期在未来（${post.date.toISOString().slice(0, 10)}）`);

  if (!post.description) add('error', file, 1, '缺少 description，列表页与搜索结果会没有摘要');
  else if (post.description.length < 20) add('warn', file, 1, `摘要只有 ${post.description.length} 字，建议 40–110 字`);
  else if (post.description.length > 120) add('error', file, 1, `摘要 ${post.description.length} 字，超过 120 会被截断`);

  if (!post.tags.length) add('warn', file, 1, '没有标签，相关文章推荐会退化成只按分类匹配');
  if (!post.category) add('warn', file, 1, '没有分类，首页分类块与归档会缺一项');

  /* 封面与分享图 */
  if (post.cover && !/^https?:/.test(post.cover)) {
    const coverFile = path.join(publicDir, post.cover.replace(/^\//, ''));
    if (!fs.existsSync(coverFile)) add('error', file, 1, `cover 指向的文件不存在：public${post.cover}`);
  }
  if (!post.draft && !post.cover) {
    const ogName = ogSlugOf(post.slug);
    const ogFile = path.join(ogDir, `${ogName}.png`);
    if (!fs.existsSync(ogFile)) {
      add('error', file, 1, `缺少分享封面 public/og/${ogName}.png，跑一次 npm run og`);
    } else if (manifest[ogName] && manifest[ogName] !== ogHash(post)) {
      add('warn', file, 1, '标题/摘要改过但分享封面没重生成，跑一次 npm run og');
    } else if (!manifest[ogName]) {
      add('warn', file, 1, '分享封面没有版本记录，跑一次 npm run og 让 manifest 补上');
    }
  }

  /* 正文：先遮掉代码块（保留行数，行号可以直接对上） */
  const masked = maskCode(body);
  const maskedLines = masked.split('\n');

  /* 标题层级 */
  let prevDepth = 1;
  maskedLines.forEach((line, i) => {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (!m) return;
    const depth = m[1].length;
    const where = i + 1;
    if (depth === 1) {
      add('error', file, where, '正文不要用一级标题（页面标题已经是 h1）');
    } else if (depth > prevDepth + 1) {
      add('error', file, where, `标题从 h${prevDepth} 跳到 h${depth}，中间缺一级`);
    } else if (!m[2].trim()) {
      add('error', file, where, '空标题');
    }
    prevDepth = depth;
  });

  /* 图片：Markdown 与 HTML 两种写法 */
  const markdownImage = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = markdownImage.exec(masked))) {
    const [full, alt, src] = m;
    const where = masked.slice(0, m.index).split('\n').length;
    if (!alt.trim()) add('error', file, where, `图片缺少替代文字：${src}`);
    checkAsset(src, file, where);
  }

  const htmlImage = /<img\b[^>]*>/gi;
  while ((m = htmlImage.exec(masked))) {
    const tag = m[0];
    const where = masked.slice(0, m.index).split('\n').length;
    if (!/\balt\s*=/.test(tag)) add('error', file, where, 'img 标签缺少 alt');
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1];
    if (!src) add('error', file, where, 'img 标签缺少 src');
    else checkAsset(src, file, where);
    if (!/\bwidth\s*=/.test(tag) && !/\bheight\s*=/.test(tag)) {
      add('warn', file, where, 'img 没有写宽高，加载时正文可能跳动');
    }
  }

  const figure = /<Figure\b[^>]*>/g;
  while ((m = figure.exec(masked))) {
    const tag = m[0];
    const where = masked.slice(0, m.index).split('\n').length;
    for (const attr of ['src', 'alt', 'width', 'height']) {
      if (!new RegExp(`\\b${attr}\\s*=`).test(tag)) add('error', file, where, `<Figure> 缺少 ${attr}`);
    }
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/)?.[1];
    if (src) checkAsset(src, file, where);
  }

  /* 代码块语言 */
  let inside = false;
  body.split('\n').forEach((line, i) => {
    const fence = line.match(/^\s*```(.*)$/);
    if (!fence) return;
    const info = fence[1].trim();
    if (!inside) {
      if (!info) add('warn', file, i + 1, '代码块没写语言，高亮和语言标签都不会生效');
      inside = true;
    } else {
      inside = false;
    }
  });

  /* 链接 */
  const markdownLink = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = markdownLink.exec(masked))) {
    const [, text, href] = m;
    const where = masked.slice(0, m.index).split('\n').length;
    if (!text.trim()) add('error', file, where, `链接没有文字：${href}`);
    else if (/^(点击?这里|这里|this|here)$/i.test(text.trim())) {
      add('warn', file, where, `链接文字「${text}」对读屏用户没有信息，换成描述性文字`);
    }
    if (href.startsWith('/')) {
      if (!isRoute(href)) add('error', file, where, `内链指向的页面不存在：${href}`);
    }
  }

  const htmlLink = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((m = htmlLink.exec(masked))) {
    const href = m[1];
    const where = masked.slice(0, m.index).split('\n').length;
    if (href.startsWith('/') && !isRoute(href)) {
      add('error', file, where, `内链指向的页面不存在：${href}`);
    }
  }

  /* ---------- 中文排版 ---------- */
  /* 只提醒、不拦构建：排版偏好因人而异，但混排不一致通常是手滑 */
  {
    const proseLines = [];
    let insideFence = false;
    body.split('\n').forEach((line, index) => {
      if (/^\s*```/.test(line)) {
        insideFence = !insideFence;
        return;
      }
      if (insideFence) return;
      /* 行内代码、链接地址、HTML 标签、裸链接都不参与排版检查 */
      const text = line
        .replace(/`[^`]*`/g, ' ')
        .replace(/\]\([^)]*\)/g, '] ')
        .replace(/<[^>]*>/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ');
      proseLines.push({ text, raw: line, no: index + 1 });
    });

    const emit = (hits, describe, limit = 3) => {
      for (const hit of hits.slice(0, limit)) add('warn', file, hit.no, describe(hit));
      if (hits.length > limit) {
        add('warn', file, hits[limit].no, `…另外还有 ${hits.length - limit} 处同类问题`);
      }
    };

    /* 中英文之间没空格 */
    const spacing = [];
    for (const line of proseLines) {
      if (/^\s*[|>]/.test(line.raw)) continue;
      const hit = line.text.match(/[\u4e00-\u9fa5][A-Za-z0-9]|[A-Za-z0-9][\u4e00-\u9fa5]/);
      if (hit) spacing.push({ no: line.no, sample: hit[0] });
    }
    emit(spacing, (hit) => `中文与英文/数字之间缺空格：「${hit.sample}」`);

    /* 中文句子里混了半角标点 */
    const punct = [];
    for (const line of proseLines) {
      const hit = line.text.match(/[\u4e00-\u9fa5][,.:;?!]|[,.:;?!][\u4e00-\u9fa5]/);
      if (hit) punct.push({ no: line.no, sample: hit[0] });
    }
    emit(punct, (hit) => `半角标点混在中文里：「${hit.sample}」，中文用全角`);

    /* 重复标点 */
    const repeated = [];
    for (const line of proseLines) {
      const hit = line.text.match(/[，。！？；：、]{2,}/);
      if (hit) repeated.push({ no: line.no, sample: hit[0] });
    }
    emit(repeated, (hit) => `重复标点：「${hit.sample}」`);

    /* 超长段落 */
    const longLines = proseLines
      .filter((line) => line.text.trim().length > 420 && !/^\s*[|<\-#>]/.test(line.raw))
      .map((line) => ({ no: line.no, sample: line.text.trim().length }));
    emit(longLines, (hit) => `这一段 ${hit.sample} 字，读起来会喘不过气，建议拆成两三段`, 2);

    /* 行尾空格（\r 不算：Windows 换行会误伤整篇） */
    const trailing = proseLines
      .filter((line) => /[ \t]+$/.test(line.raw) && line.raw.trim())
      .map((line) => ({ no: line.no }));
    emit(trailing, () => '行尾有多余空格');

    /* 连续三个以上空行 */
    let blanks = 0;
    body.split('\n').forEach((line, index) => {
      if (!line.trim()) {
        blanks += 1;
        if (blanks === 3) add('warn', file, index + 1, '连续空了 3 行以上，正文会被拉出很大的空洞');
      } else {
        blanks = 0;
      }
    });

    /* 标题末尾带标点 */
    maskedLines.forEach((line, index) => {
      if (/^#{2,6}\s+.*[。，、；：]$/.test(line)) {
        add('warn', file, index + 1, '标题末尾不用句号或逗号');
      }
    });
  }

  /* 篇幅 */
  const plain = masked
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\s+/g, '');
  if (plain.length < 300 && !post.draft) {
    add('warn', file, 1, `正文约 ${plain.length} 字，偏短；如果是有意为之可以忽略`);
  }
}

function checkAsset(src, file, line) {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return;
  if (src.startsWith('/')) {
    const target = path.join(publicDir, src.replace(/^\//, '').split('?')[0]);
    if (!fs.existsSync(target)) add('error', file, line, `图片不存在：public${src.split('?')[0]}`);
    return;
  }
  if (/^(\.\/|\.\.\/)/.test(src)) {
    const target = path.resolve(path.dirname(path.join(root, file)), src.split('?')[0]);
    if (!fs.existsSync(target)) add('error', file, line, `相对路径图片不存在：${src}`);
  }
}

/* ---------- 短笔记 ---------- */

const notes = [];
for (const file of fs.existsSync(notesDir) ? walk(notesDir) : []) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    add('error', rel, 1, '缺少 frontmatter（文件必须以 --- 开头）');
    continue;
  }
  let data = {};
  try {
    data = parseYaml(match[1]) ?? {};
  } catch (err) {
    add('error', rel, 1, `frontmatter 不是合法 YAML：${err.message}`);
    continue;
  }
  notes.push({
    file: rel,
    body: raw.slice(match[0].length),
    tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    date: data.date instanceof Date ? data.date : new Date(String(data.date)),
    draft: data.draft === true,
  });
}

for (const note of notes) {
  const { file, body } = note;

  if (Number.isNaN(note.date.valueOf())) add('error', file, 1, 'date 缺失或不是合法日期');
  else if (note.date.valueOf() > Date.now() + 86400000) {
    add('warn', file, 1, `日期在未来（${note.date.toISOString().slice(0, 10)}）`);
  }

  const masked = maskCode(body);
  const plain = masked
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|=\-]+/g, ' ')
    .replace(/\s+/g, '')
    .trim();

  if (!plain) {
    add('error', file, 1, '正文是空的');
    continue;
  }

  /* 笔记可以长一点，但超过这个量级就该拆成文章了，别让时间流变成杂文集 */
  if (plain.length > 900) {
    add('warn', file, 1, `这条 ${plain.length} 字，已经是一篇短文的体量；考虑改成 /posts/ 里的文章`);
  }

  const markdownImage = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = markdownImage.exec(masked))) {
    const [, alt, src] = m;
    const where = masked.slice(0, m.index).split('\n').length;
    if (!alt.trim()) add('error', file, where, `图片缺少替代文字：${src}`);
    checkAsset(src, file, where);
  }

  const markdownLink = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  while ((m = markdownLink.exec(masked))) {
    const [, text, href] = m;
    const where = masked.slice(0, m.index).split('\n').length;
    if (!text.trim()) add('error', file, where, `链接没有文字：${href}`);
    if (href.startsWith('/') && !isRoute(href)) {
      add('error', file, where, `内链指向的页面不存在：${href}`);
    }
  }
}

/* ---------- 全局检查 ---------- */

const seenTitle = new Map();
for (const post of posts) {
  if (!post.title) continue;
  if (seenTitle.has(post.title)) {
    add('warn', post.file, 1, `标题与 ${seenTitle.get(post.title)} 重复`);
  } else {
    seenTitle.set(post.title, post.file);
  }
}

const orphanOg = fs.existsSync(ogDir)
  ? fs
      .readdirSync(ogDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.replace(/\.png$/, ''))
      .filter((name) => !posts.some((p) => !p.draft && !p.cover && ogSlugOf(p.slug) === name))
  : [];
for (const name of orphanOg) {
  add('warn', `public/og/${name}.png`, 1, '这张分享封面没有对应的文章了，可以删掉（跑一次 npm run og 不会自动清理）');
}

/* ---------- 输出 ---------- */

const errors = problems.filter((p) => p.level === 'error');
const warns = problems.filter((p) => p.level === 'warn');

const byFile = new Map();
for (const p of problems) {
  if (!byFile.has(p.file)) byFile.set(p.file, []);
  byFile.get(p.file).push(p);
}

const label = (level) => (level === 'error' ? 'ERROR' : 'WARN ');
for (const [file, list] of [...byFile.entries()].sort()) {
  console.log(`\n${file}`);
  for (const p of list.sort((a, b) => a.line - b.line)) {
    console.log(`  ${label(p.level)} ${String(p.line).padStart(4)}  ${p.message}`);
  }
}

const summary = `${posts.length} 篇文章、${notes.length} 条笔记，${errors.length} 个错误，${warns.length} 个提醒`;
console.log(`\n${errors.length ? 'FAIL' : 'OK'}  ${summary}`);

if (errors.length || (strict && warns.length)) process.exit(1);
