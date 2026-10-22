/**
 * 新建一条短笔记。
 *
 *   npm run note -- "想到的一句话"
 *   npm run note -- "带标签的一条" --tags 写作,方法
 *   npm run note -- "先存着" --draft
 *
 * 笔记没有标题和摘要，标题由正文第一句推导，所以这里只写正文。
 * 文件名带时分（YYYY-MM-DD-HHmm），同一天写多条也不会撞车，锚点顺序即时间顺序。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const root = process.cwd();
const notesDir = path.join(root, 'src/content/notes');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const positional = argv.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const stamp = `${day}-${pad(now.getHours())}${pad(now.getMinutes())}`;

/* ---------- 正文 ---------- */

let text = (value('text') ?? positional.join(' ')).trim();

if (!text && process.stdin.isTTY) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  text = (await rl.question('写点什么（一行就够）: ')).trim();
  rl.close();
}

if (!text) {
  console.error('缺少正文。用法：npm run note -- "想到的一句话"');
  process.exit(1);
}

const tags = (value('tags') ?? '')
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

/* ---------- 落文件 ---------- */

fs.mkdirSync(notesDir, { recursive: true });

let id = stamp;
let target = path.join(notesDir, `${id}.md`);
let bump = 2;
while (fs.existsSync(target)) {
  id = `${stamp}-${bump}`;
  target = path.join(notesDir, `${id}.md`);
  bump += 1;
}

const frontmatter = [
  '---',
  `date: ${day}`,
  `tags:${tags.length ? '' : ' []'}`,
  ...tags.map((tag) => `  - ${JSON.stringify(tag)}`),
  `draft: ${has('draft')}`,
  '---',
].join('\n');

fs.writeFileSync(target, `${frontmatter}\n\n${text}\n`, 'utf8');

const anchor = `n-${id.replace(/[^\w-]+/g, '-')}`;

console.log(`\n✔ 已创建 ${path.relative(root, target)}`);
console.log(`  锚点：/notes/#${anchor}`);
if (has('draft')) console.log('  状态：草稿（本机 dev 可见，构建不会发布）');

console.log('\n下一步：');
console.log('  npm run dev      本地预览，笔记在 /notes/');
console.log('  发布前跑一次 npm run preflight');
