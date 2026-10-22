/**
 * 新建一篇文章。
 *
 *   npm run new                         交互式问几个问题
 *   npm run new -- "标题"                直接给标题，其余走默认
 *   npm run new -- "标题" --slug my-post --series 从笔记到发布 --category 技术 --tags Astro,写作
 *
 * 默认写 draft: true——草稿只在本机 dev 可见，构建时不会发布。
 * 想直接发布加 --publish。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const postsDir = path.join(root, 'src/content/posts');

/* ---------- 参数 ---------- */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const positional = argv.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

/* ---------- 现有文章：用于算系列序号、避免 slug 撞车 ---------- */

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.mdx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const existing = fs.existsSync(postsDir)
  ? walk(postsDir).map((file) => {
      const raw = fs.readFileSync(file, 'utf8');
      const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      let data = {};
      try {
        data = match ? parseYaml(match[1]) ?? {} : {};
      } catch {}
      return {
        slug: path.relative(postsDir, file).replace(/\.mdx?$/, '').split(path.sep).join('/'),
        series: data.series ? String(data.series) : '',
        order: Number(data.seriesOrder) || 0,
      };
    })
  : [];

/* ---------- 交互式补全 ---------- */

const rl = process.stdin.isTTY ? readline.createInterface({ input: stdin, output: stdout }) : null;
const ask = async (question, fallback = '') => {
  if (!rl) return fallback;
  const answer = (await rl.question(`${question}${fallback ? `（${fallback}）` : ''}: `)).trim();
  return answer || fallback;
};

let title = value('title') ?? positional[0] ?? '';
if (!title && rl) title = await ask('文章标题');

if (!title) {
  console.error('缺少标题。用法：npm run new -- "标题"');
  process.exit(1);
}
if (rl) rl.close();

/* ---------- slug ---------- */

const slugify = (input) =>
  input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

let slug = value('slug') ?? '';
if (!slug) {
  const derived = slugify(title);
  /* 中文标题经 slugify 会剩下一串汉字或空串；空串说明标题基本是中文，得让作者自己起一个 */
  if (/^[\p{Script=Han}\p{P}\s-]+$/u.test(derived) || !derived) {
    console.error('标题是中文，无法自动生成英文 slug。请补一个：npm run new -- "' + title + '" --slug my-post');
    process.exit(1);
  }
  slug = derived;
}

if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
  console.error(`slug 只能用字母、数字、短横线，当前是「${slug}」。用 --slug 指定一个，例如 --slug my-post`);
  process.exit(1);
}

const target = path.join(postsDir, `${slug}.mdx`);
if (fs.existsSync(target)) {
  console.error(`已经有一篇 ${path.relative(root, target)} 了，换个 slug 或直接去编辑它。`);
  process.exit(1);
}

/* ---------- 系列序号 ---------- */

const series = value('series') ?? '';
let seriesOrder = Number(value('order')) || 0;
if (series && !seriesOrder) {
  const used = existing.filter((post) => post.series === series).map((post) => post.order);
  seriesOrder = Math.max(0, ...used) + 1;
}

const category = value('category') ?? '';
/* 署名是必填字段（schema 没有默认值），这里给 cui 只是省一次输入；
   Jing 写的记得加 --author jing，否则文章会被标成另一个人写的 */
const author = value('author') ?? 'cui';
if (!['cui', 'jing'].includes(author)) {
  console.error(`--author 只能是 cui 或 jing，当前是「${author}」`);
  process.exit(1);
}
const tags = (value('tags') ?? '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);
const draft = !has('publish');

/* ---------- 正文模板 ---------- */

const yamlString = (text) => JSON.stringify(text);
const frontmatter = [
  '---',
  `title: ${yamlString(title)}`,
  `author: ${author}`,
  `date: ${today}`,
  'description: 一句话说清这篇要回答什么问题，会出现在列表页、搜索结果和分享卡片上',
  `tags:${tags.length ? '' : ' []'}`,
  ...tags.map((tag) => `  - ${yamlString(tag)}`),
  `category: ${category ? yamlString(category) : "''"}`,
  ...(series ? [`series: ${yamlString(series)}`, `seriesOrder: ${seriesOrder}`] : []),
  `draft: ${draft}`,
  '---',
].join('\n');

const body = `

开头两三句，交代为什么写这篇、写给谁看。

## 第一节

正文。需要强调的地方可以用 Callout：

<Callout type="tip" title="提示">
  Callout、KeyPoints、Steps、Figure 这些组件已经全站注册，直接在 .mdx 里写标签就行，不用 import。
</Callout>

## 第二节

正文。

## 收尾

留一句能带走的话。
`;

fs.mkdirSync(postsDir, { recursive: true });
fs.writeFileSync(target, `${frontmatter}${body}`, 'utf8');

/* ---------- 收尾提示 ---------- */

console.log(`\n✔ 已创建 ${path.relative(root, target)}`);
console.log(`  作者：${author}${author === 'cui' ? '（默认；Jing 写的加 --author jing）' : ''}`);
if (series) console.log(`  系列「${series}」第 ${seriesOrder} 篇`);
if (draft) console.log('  状态：草稿（本机 dev 可见，构建不会发布）');

console.log('\n下一步：');
console.log('  npm run dev        本地预览，草稿会带提示条');
console.log('  npm run image -- <图片路径> --post ' + slug + '   把配图收进来');
console.log('  npm run preflight  发布前一次跑完所有检查');
if (draft) console.log('  发布时把 frontmatter 里的 draft 改成 false');
