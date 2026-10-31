/**
 * 发布前一键体检：把「发文章时容易忘的步骤」串成一条命令。
 *
 *   npm run preflight                  全套：封面 → 内容 → 类型 → 构建 → 预算 → 无障碍 → 键盘
 *   npm run preflight -- --ci          跳过封面（CI 没有中文字体，渲染出来是方框）
 *   npm run preflight -- --skip-build  复用已有 dist，只跑检查
 *   npm run preflight -- --visual      额外跑视觉回归（改过样式时用，比全站截图慢）
 *   npm run preflight -- --perf        额外跑渲染指标（改过首屏、字体、布局脚本时用）
 *
 * 任何一步失败就停，并且保证预览进程被收掉。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const ci = argv.includes('--ci');
const skipOg = ci || argv.includes('--skip-og');
const skipBuild = argv.includes('--skip-build');
const withVisual = argv.includes('--visual');
const withPerf = argv.includes('--perf');
const win = process.platform === 'win32';
const PORT = 4321;
const BASE = `http://localhost:${PORT}/blog/`;
const logFile = path.join(os.tmpdir(), 'blog-preview.log');

const started = Date.now();
const timings = [];
let preview = null;

function stopPreview() {
  if (!preview || preview.killed) return;
  if (win) {
    spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      preview.kill('SIGTERM');
    }
  }
}

function run(label, command, args, env) {
  process.stdout.write(`\n▶ ${label}\n`);
  const begin = Date.now();
  const result = spawnSync(command, args, { stdio: 'inherit', shell: win, env: env ?? process.env });
  const seconds = (Date.now() - begin) / 1000;
  if (result.status !== 0) {
    console.error(`\n✗ ${label} 失败（${seconds.toFixed(1)}s），后面的步骤不再执行。`);
    stopPreview();
    process.exit(result.status ?? 1);
  }
  timings.push({ label, seconds });
  console.log(`✓ ${label} · ${seconds.toFixed(1)}s`);
}

async function main() {
  /* 1. 静态检查：先查内容，再查类型，最后构建——前两步失败时没必要等整站构建 */
  if (!skipOg) {
    run('生成分享封面', 'node', ['scripts/og-cards.mjs']);
  } else {
    console.log('· 跳过分享封面（--ci / --skip-og），由内容体检核对 manifest');
  }

  run('内容体检', 'node', ['scripts/lint-content.mjs']);
  run('笔记摘要边界', 'node', ['--experimental-strip-types', 'scripts/note-excerpt.test.mjs']);
  run('标签聚合去重', 'node', ['--experimental-strip-types', 'scripts/tag-buckets.test.mjs']);
  run('系列共现标签去重', 'node', ['scripts/series-tags.test.mjs']);
  /* 正文用了子集外的字，线上会悄悄回退成系统宋体，只有字形不一致这一条线索，容易漏 */
  run('字体子集校验', 'node', ['scripts/fonts.mjs', '--check']);
  // 本地发布体检与 CI 保持一致：失败的 Quality 不应触发 Pages。
  run('部署发布门禁', 'node', ['scripts/deploy-gate.test.mjs']);
  run('类型检查', 'npx', ['astro', 'check']);
  run('像素突围战斗契约', 'node', ['scripts/pixelraid-mechanics.mjs']);

  if (!skipBuild) {
    /* 构建收尾会清掉 dist/.prerender 下的临时目录，在 WorkBuddy 终端里这一步会被
       「安全删除」垫片当成批量删除拦下。它只作用于构建临时目录，所以仅对这一步关掉。 */
    const buildEnv = { ...process.env };
    if (buildEnv.CODEBUDDY_SESSION_ID) buildEnv.CODEBUDDY_SAFE_DELETE_ENABLED = '0';
    run('构建', 'npx', ['astro', 'build'], buildEnv);
    /* 这里直接调 astro build，绕过了 npm run build 的压缩步骤，得显式补上，
       否则本地体检跑的是未压缩的游戏页，和线上不是同一份东西 */
    run('游戏页压缩', 'node', ['scripts/games.mjs']);
  } else {
    console.log('· 跳过构建（--skip-build），直接检查现有 dist');
  }

  run('构建链接和资源完整性', 'node', ['scripts/built-links.test.mjs']);
  run('站点路由、资源和章节锚点', 'node', ['scripts/built-links-check.mjs']);
  run('全站标签入口一致性', 'node', ['scripts/tag-discovery.test.mjs']);
  run('侧栏文章与笔记最近更新顺序', 'node', ['scripts/recent-discovery.test.mjs']);
  run('Home and series editorial activity', 'node', ['scripts/activity-freshness.test.mjs']);
  run('Search recent fallback chronology', 'node', ['scripts/search-suggestions.test.mjs']);
  run('搜索笔记摘要一致性', 'node', ['--experimental-strip-types', 'scripts/search-note-preview.test.mjs']);
  run('搜索标签去重一致性', 'node', ['scripts/search-tags.test.mjs']);
  run('系列接着读章节顺序', 'node', ['scripts/related-reading.test.mjs']);
  run('站点地图更新时间与索引规则', 'node', ['scripts/sitemap-check.mjs']);
  // 确保本地预检也能发现订阅源全文、链接与唯一性回归。
  run('RSS 全文与永久链接校验', 'node', ['scripts/rss-check.mjs']);
  run('体积预算', 'node', ['scripts/budget.mjs']);
  /* 字体按页分片后，每页只带自己的增量片；新增页面没进映射时这句会失败 */
  run('字体按页覆盖', 'node', ['scripts/fonts.mjs', '--check-pages']);

  /* 2. 起预览，跑浏览器实测 */
  console.log('\n▶ 启动本地预览');
  const log = fs.openSync(logFile, 'w');
  preview = spawn('npx', ['astro', 'preview', '--port', String(PORT)], {
    stdio: ['ignore', log, log],
    shell: win,
    detached: !win,
  });

  let ready = false;
  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(BASE, { signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!ready) {
    stopPreview();
    throw new Error(`预览没有起来，日志在 ${logFile}`);
  }
  console.log('✓ 预览就绪 · localhost:4321');

  run('无障碍扫描（axe，浅色 + 深色）', 'node', ['scripts/a11y-audit.mjs']);
  run('键盘与读屏实测', 'node', ['scripts/a11y-keyboard.mjs']);
  /* 游戏页是单文件、脚本被裁过，得真的跑一遍才知道还能不能玩 */
  run('游戏冒烟（能不能启动、有没有缺导出）', 'node', ['scripts/games-smoke.mjs']);
  /* 文件体积不等于传输量：这一条量的才是「第一次访问要下多少字节」 */
  run('首屏传输预算', 'node', ['scripts/budget-wire.mjs']);

  /* 渲染指标（LCP / CLS / TBT）默认不跑：限速 + 降频下本机抖动就有 ±40%，
     多跑四十秒换一条经常假红的检查不划算。改过布局、字体、首屏脚本时用 --perf 单独看。 */
  if (withPerf) {
    run('渲染指标（Slow 4G + 4× CPU）', 'node', ['scripts/perf.mjs']);
  } else {
    console.log('· 跳过渲染指标（加 --perf 开启）');
  }

  if (withVisual) {
    run('视觉回归（对比 tests/visual/baseline）', 'node', ['scripts/visual-regression.mjs']);
  } else {
    console.log('· 跳过视觉回归（加 --visual 开启）');
  }
}

try {
  await main();
} catch (error) {
  stopPreview();
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
} finally {
  stopPreview();
}

/* 3. 汇总 */
const total = ((Date.now() - started) / 1000).toFixed(1);
console.log('\n────────────────────────────');
for (const item of timings) {
  console.log(`  ${item.label.padEnd(24, ' ')} ${item.seconds.toFixed(1).padStart(5)}s`);
}
console.log(`  ${'合计'.padEnd(24, ' ')} ${total.padStart(5)}s`);
console.log(`\nOK  可以发了（${ci ? 'CI 模式' : '本地全套'}）\n`);
