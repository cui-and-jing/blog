/**
 * 图片收件箱：把一张图收进 src/assets，顺手给出可以直接粘贴的 <Figure> 片段。
 *
 *   npm run image -- ./桌面/截图.png --post hello-astro
 *   npm run image -- ./shot.png --post hello-astro --name hero --max 1600
 *
 * 只负责「归位 + 必要时缩边 + 读尺寸」，不预转格式：
 * 真正的 AVIF/WebP 与多档 srcset 由构建时的 <Picture> 生成，提前转一遍只是重复劳动。
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const assetsDir = path.join(root, 'src/assets/posts');

const argv = process.argv.slice(2);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};
const positional = argv.filter((arg, i) => !arg.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--')));

const source = positional[0];
if (!source) {
  console.error('用法：npm run image -- <图片路径> --post <文章 slug> [--name 文件名] [--max 1600]');
  process.exit(1);
}

const sourcePath = path.resolve(root, source.replace(/^~(?=$|\/)/, process.env.HOME ?? ''));
if (!fs.existsSync(sourcePath)) {
  console.error(`找不到文件：${sourcePath}`);
  process.exit(1);
}

const EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif']);
const ext = path.extname(sourcePath).toLowerCase();
if (!EXT.has(ext)) {
  console.error(`不支持的格式 ${ext || '(无扩展名)'}。用 png / jpg / webp / avif / gif。`);
  process.exit(1);
}

/* ---------- 归到哪篇文章 ---------- */

const postsDir = path.join(root, 'src/content/posts');
const posts = fs.existsSync(postsDir)
  ? fs
      .readdirSync(postsDir)
      .filter((file) => /\.mdx?$/.test(file))
      .map((file) => file.replace(/\.mdx?$/, ''))
  : [];

let post = value('post') ?? '';
if (post && !posts.includes(post)) {
  console.error(`没有找到文章 ${post}。现有：${posts.join(', ') || '（还没有文章）'}`);
  process.exit(1);
}
if (!post) {
  post = '_shared';
  console.log(`没指定 --post，先放进公共目录 ${post}。`);
}

/* ---------- 文件名 ---------- */

const slugifyName = (input) =>
  input
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s._-]/gu, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const baseName = value('name') || slugifyName(path.basename(sourcePath, ext)) || 'image';
const maxWidth = Number(value('max')) || 1600;

const destDir = path.join(assetsDir, post);
fs.mkdirSync(destDir, { recursive: true });

let fileName = `${baseName}${ext}`;
let counter = 2;
while (fs.existsSync(path.join(destDir, fileName))) {
  fileName = `${baseName}-${counter}${ext}`;
  counter += 1;
}
const destPath = path.join(destDir, fileName);

/* ---------- 读取 / 缩边 ---------- */

const before = fs.statSync(sourcePath).size;
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  /* sharp 是 Astro 的间接依赖，理论上一定在；真缺了也不影响归位 */
}

let meta = null;
let sourceWidth = 0;
if (sharp && ext !== '.gif') {
  try {
    const srcMeta = await sharp(sourcePath).metadata();
    sourceWidth = srcMeta.width ?? 0;
    if (sourceWidth > maxWidth) {
      await sharp(sourcePath).resize({ width: maxWidth, withoutEnlargement: true }).toFile(destPath);
      meta = await sharp(destPath).metadata();
    } else {
      fs.copyFileSync(sourcePath, destPath);
    }
  } catch (err) {
    console.warn(`sharp 处理失败（${err.message}），按原样复制。`);
    fs.copyFileSync(sourcePath, destPath);
  }
} else {
  fs.copyFileSync(sourcePath, destPath);
}

if (!meta) {
  try {
    meta = await sharp(destPath).metadata();
  } catch {}
}

const after = fs.statSync(destPath).size;
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/* ---------- 结果 ---------- */

const relFromPost = path.posix.join('../../assets/posts', post, fileName);
const varName = 'img' + (baseName.replace(/[^a-zA-Z0-9]/g, '').replace(/^./, (c) => c.toUpperCase()) || 'Figure');

console.log(`\n✔ ${path.relative(root, destPath)}`);
if (meta?.width) {
  const resized = sourceWidth > meta.width;
  console.log(`  ${meta.width}×${meta.height}${resized ? `（已从 ${sourceWidth}px 缩到 ${maxWidth}px 宽）` : ''}`);
}
console.log(`  ${kb(before)}${after !== before ? ` → ${kb(after)}` : ''}`);

if (after > 2 * 1024 * 1024) {
  console.log('  ⚠ 超过 2MB，加载会明显变慢，建议先压一下再放进来。');
}

console.log('\n在文章里这样写：\n');
console.log(`import ${varName} from '${relFromPost}';`);
console.log('');
console.log(`<Figure`);
console.log(`  src={${varName}}`);
console.log(`  alt="一句话描述图里发生了什么"`);
console.log(`  caption="图注，不需要就删掉这一行"`);
console.log(`/>`);
console.log('\n（import 要写在 frontmatter 的 --- 之后，不能写在里面。）');
