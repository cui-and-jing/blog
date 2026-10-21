/**
 * 一键把 Giscus 的 repoId / categoryId 写进 src/data/comments.json。
 *
 * 前提（各点一次即可）：
 *   1. 仓库 Settings → General → Features 勾上 Discussions
 *   2. https://github.com/apps/giscus 安装到该仓库
 *
 * 用法：
 *   npm run comments:setup                 # 用 comments.json 里的 repo
 *   npm run comments:setup -- --list       # 只列出仓库里的讨论分类
 *   npm run comments:setup -- --category "General"
 *   npm run comments:setup -- --repo-id R_xxx --category-id DIC_xxx
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const file = path.resolve(import.meta.dirname, '../src/data/comments.json');
const current = JSON.parse(await fs.readFile(file, 'utf8'));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const repo = flag('repo', current.repo);
const wantedCategory = flag('category', current.category || 'Announcements');

const die = (message, hint) => {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`\n${hint}\n`);
  process.exit(1);
};

/* ---------- 手动指定：跳过网络请求 ---------- */
const manualRepoId = flag('repo-id');
const manualCategoryId = flag('category-id');

if (manualRepoId && manualCategoryId) {
  await save({
    repo,
    repoId: manualRepoId,
    category: wantedCategory,
    categoryId: manualCategoryId,
  });
  process.exit(0);
}

/* ---------- 从 giscus 的公开接口取分类 ---------- */
console.log(`→ 查询 ${repo} 的讨论分类…`);

const endpoint = `https://giscus.app/api/discussions/categories?repo=${encodeURIComponent(repo)}&locale=zh-CN`;
let response;
try {
  response = await fetch(endpoint, { headers: { accept: 'application/json' } });
} catch (error) {
  die(`请求 giscus 失败：${error.message}`, '检查一下网络，或挂个代理再试。');
}

const body = await response.text();
let data;
try {
  data = JSON.parse(body);
} catch {
  die('giscus 返回的不是 JSON。', body.slice(0, 300));
}

if (!response.ok) {
  const reason = data?.error ?? body.slice(0, 200);
  if (/not installed/i.test(reason)) {
    die(
      'giscus 还没有安装到这个仓库。',
      [
        '按顺序做两步：',
        `  1. 开启 Discussions：https://github.com/${repo}/settings`,
        '     （Settings → General → Features → 勾选 Discussions）',
        '  2. 安装 App：https://github.com/apps/giscus → Install → 只勾选该仓库',
        '',
        '完成后重新运行 npm run comments:setup。',
      ].join('\n')
    );
  }
  die(`giscus 返回 ${response.status}：${reason}`);
}

/* ---------- 兼容不同版本返回结构 ---------- */
const pick = (object, keys) => keys.map((key) => object?.[key]).find(Boolean);

const deepFindId = (node, pattern, depth = 0) => {
  if (depth > 4 || node == null) return null;
  if (typeof node === 'string') return pattern.test(node) ? node : null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepFindId(item, pattern, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    if (key === 'categories') continue;
    const found = deepFindId(value, pattern, depth + 1);
    if (found) return found;
  }
  return null;
};

const repoId =
  pick(data, ['repoId', 'repositoryId']) ??
  data?.repo?.id ??
  data?.repository?.id ??
  deepFindId(data, /^R_/);

const categories =
  data?.categories ??
  data?.discussions?.categories ??
  (Array.isArray(data) ? data : null) ??
  Object.values(data ?? {}).find(
    (value) => Array.isArray(value) && value.some((item) => String(item?.id ?? '').startsWith('DIC_'))
  );

if (!Array.isArray(categories) || categories.length === 0) {
  console.error('✗ 没解析出分类列表，原始返回如下：');
  console.error(JSON.stringify(data, null, 2).slice(0, 1200));
  console.error('\n可以手动指定：npm run comments:setup -- --repo-id R_xxx --category-id DIC_xxx');
  process.exit(1);
}

if (has('list')) {
  console.log(`\n${repo} 的讨论分类：\n`);
  for (const item of categories) {
    console.log(`  ${item.name.padEnd(18)} ${item.id}${item.isAnswerable ? '  (问答)' : ''}`);
  }
  console.log(`\n当前选择：${wantedCategory}\n`);
  process.exit(0);
}

const chosen =
  categories.find((item) => String(item.name).toLowerCase() === wantedCategory.toLowerCase()) ??
  categories.find((item) => String(item.name).toLowerCase() === 'announcements') ??
  categories[0];

if (!chosen?.id || !repoId) {
  die('没拿到 repoId 或 categoryId。', JSON.stringify(data, null, 2).slice(0, 800));
}

if (String(chosen.name).toLowerCase() !== wantedCategory.toLowerCase()) {
  console.log(`! 没有找到「${wantedCategory}」，改用「${chosen.name}」`);
}

await save({
  repo,
  repoId,
  category: chosen.name,
  categoryId: chosen.id,
});

/* ---------- 写回配置 ---------- */
async function save(next) {
  const payload = {
    repo: next.repo,
    repoId: next.repoId,
    category: next.category,
    categoryId: next.categoryId,
  };
  await fs.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log('\n✓ 已写入 src/data/comments.json');
  console.log(`  repo      ${payload.repo}`);
  console.log(`  repoId    ${payload.repoId}`);
  console.log(`  category  ${payload.category}`);
  console.log(`  categoryId ${payload.categoryId}`);
  console.log('\n下一步：npm run build，评论区就会出现在每篇文章末尾。\n');
}
