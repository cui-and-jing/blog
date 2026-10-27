/**
 * 游戏冒烟：压缩之后，游戏还跑不跑得起来。
 *
 *   node scripts/games-smoke.mjs
 *   node scripts/games-smoke.mjs --base http://localhost:4321/blog
 *
 * 为什么需要这个：`scripts/games.mjs` 会把内联的 three.js 换成「只含用到导出的」裁剪版。
 * 裁剪的依据是静态扫描，而静态扫描一定会漏——这游戏就漏过一次：
 * 视图层用的是别名 `T.OrthographicCamera(...)`，只扫 `THREE.` 看不见它，
 * 表现是公园能进、一开竞技场就白屏，而且构建是绿的。
 *
 * 所以这里做两层：
 *   1. 行为断言：能就绪、画面不是空白、没有报错
 *   2. 运行时守卫：给 window.THREE 套 Proxy，真访问到不存在的成员就把名字记下来，
 *      报错时直接告诉你是缺了哪个类
 *
 * 需要本地先 `npm run build` 并起 `npx astro preview`。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { launchBrowser } from './lib/browser.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = getArg('--base', 'http://localhost:4321/blog').replace(/\/$/, '');
const SRC_DIR = path.join(process.cwd(), 'public', 'games');

/** 裁剪过 three 的游戏，才需要跑竞技场那条深路径 */
const THREE_GAMES = new Set(['beanrush.html']);

/**
 * `--enable-unsafe-swiftshader` 是必须的。
 *
 * 浏览器统一以 `--disable-gpu --headless=new` 启动（截图要跨机一致），此时 WebGL 只能走
 * 软件渲染；较新的 Chrome 不再默认允许，没有这个开关就创建不出 WebGL 上下文。
 * 本机装的是旧一些的 Edge，会静默回退，所以本地跑得好好的、CI 上 beanrush 直接起不来。
 */
const WEBGL_ARGS = ['--enable-unsafe-swiftshader'];

/**
 * 哪些错误值得整页重来一次。
 *
 * 只认「浏览器/渲染进程自己断了」这一类：软件渲染下 swiftshader 偶发把渲染进程搞崩，
 * CI 上同一个提交时而红时而绿，就是这么来的（Quality #44 红、#46 绿，代码没差）。
 * 超时不在此列——重试只会把 2 分钟变成 4 分钟，那是脚本或游戏真的慢，得看数据。
 */
const RETRYABLE = /Target closed|Session closed|detached|disconnected|Protocol error/i;

/**
 * 套在 window.THREE 上的守卫。
 *
 * 用 defineProperty 而不是在加载后改属性：游戏里是 `window.THREE=api` 赋值的，
 * 只有在赋值那一刻接管，才能保证后面所有读取都经过我们。
 */
const GUARD = () => {
  const missing = new Set();
  window.__missingThree = missing;
  let wrapped;
  Object.defineProperty(window, 'THREE', {
    configurable: true,
    get: () => wrapped,
    set: (value) => {
      wrapped = new Proxy(value, {
        get(target, key, receiver) {
          const result = Reflect.get(target, key, receiver);
          if (result === undefined && typeof key === 'string' && /^[A-Z]/.test(key)) missing.add(key);
          return result;
        },
      });
    },
  });
};

/** 整屏几乎同色说明白屏了。stdev 比肉眼判断可靠，也不受主题深浅影响 */
async function looksBlank(page) {
  const shot = await page.screenshot({ type: 'png' });
  const stats = await sharp(shot).stats();
  return Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev)) < 6;
}

/** WebGL2 有没有可用，是「游戏坏了」还是「这台机器跑不了 3D」的分水岭 */
function hasWebgl2(page) {
  return page.evaluate(() => {
    try {
      return Boolean(document.createElement('canvas').getContext('webgl2'));
    } catch {
      return false;
    }
  });
}

/**
 * 冷启动的 runner 上 Chrome 有时 20 秒还没写出调试端口（launchBrowser 的默认上限），
 * 直接判死太脆——Quality #45 就是这么红的：整轮 1 分钟，失败点在冒烟开头几秒。
 * 所以这里把等待放宽到 60 秒，并且起不来再试一次。
 */
async function launchWithRetry() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await launchBrowser({ args: WEBGL_ARGS, launchTimeout: 60_000, protocolTimeout: 120_000 });
    } catch (error) {
      if (attempt >= 2) throw error;
      console.log(`  … 浏览器没起来（${error.message}），重试一次`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/**
 * 跑一个游戏，返回结果行与问题清单。
 *
 * 页面级的异常全在这里接住、不外抛——一个游戏起不来不该让后面四个失去结果，
 * 上一次 CI 就是整轮崩在半路，日志里连表格都没印出来，什么线索都没有。
 */
async function checkGame(browser, file) {
  const started = Date.now();
  const errors = [];
  const problems = [];
  const missing = [];
  let webgl2 = null;
  let page = null;
  let retryable = false;
  let reason = '';

  try {
    page = await browser.newPage();

    page.on('pageerror', (error) => errors.push(`页面异常：${error.message}`));
    page.on('console', (message) => {
      /* 资源 404 会以「Failed to load resource」形式进控制台，但拿不到 URL。
         这类交给下面的 response 监听判断，免得把 favicon 的噪音算成失败。 */
      if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
        errors.push(`控制台错误：${message.text().slice(0, 200)}`);
      }
    });
    page.on('response', (response) => {
      /* 游戏页没有声明图标，浏览器会去根目录要 /favicon.ico，返回 404 属于常态 */
      if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
        errors.push(`资源 ${response.status()}：${response.url()}`);
      }
    });

    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(GUARD);

    await page.goto(`${base}/games/${file}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    if (THREE_GAMES.has(file)) {
      /* 软件渲染（CI 没有 GPU）建场景比本机慢得多，60s 会偶发不够 */
      await page.waitForFunction(() => window.__beanReady === true, { timeout: 120_000 });

      const revision = await page.evaluate(() => window.THREE?.REVISION ?? null);
      /* OrthographicCamera 是踩过的坑：它只被别名访问，静态扫描漏过它，这里钉住 */
      const required = await page.evaluate(() =>
        ['Mesh', 'WebGLRenderer', 'OrthographicCamera', 'BoxGeometry', 'InstancedMesh'].filter(
          (name) => typeof window.THREE?.[name] !== 'function'
        )
      );
      if (revision !== '185') problems.push(`${file} 里 three 的版本是 r${revision}，期望 r185`);
      if (required.length) problems.push(`${file} 的 THREE 缺少：${required.join(', ')}`);

      /* 走一遍：竞技场列表 → 第一张卡片 → 开始游玩。3D 场景是在这一步才建的 */
      await page.evaluate(() => document.querySelector('[data-page="library"]')?.click());
      await new Promise((resolve) => setTimeout(resolve, 500));
      await page.evaluate(() => document.querySelector('[data-detail]')?.click());
      await new Promise((resolve) => setTimeout(resolve, 500));
      const played = await page.evaluate(() => {
        const button = document.getElementById('p-detail-play');
        if (!button) return false;
        button.click();
        return true;
      });
      if (!played) problems.push(`${file} 找不到「开始游玩」按钮`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else if (file === 'pixelraid.html') {
      /* 横版动作游戏要真正按键：只验证能画出菜单无法发现移动和跳跃断掉 */
      await page.waitForFunction(() => window.__raidReady === true, { timeout: 10000 });
      const boot = await page.evaluate(() => ({ ...window.__raidState }));
      if (boot.phase !== 'title' || boot.stage !== 1) {
        problems.push('Pixel Raid 初始界面或关卡不正确：' + JSON.stringify(boot));
      }
      await page.click('#start');
      await page.waitForFunction(() => window.__raidState?.phase === 'playing', { timeout: 4000 });
      const start = await page.evaluate(() => ({ ...window.__raidState }));
      if (start.hp !== 5 || start.lives !== 3 || start.grenades !== 3) {
        problems.push('Pixel Raid 初始资源不正确：' + JSON.stringify(start));
      }

      await page.keyboard.down('d');
      await new Promise((resolve) => setTimeout(resolve, 380));
      await page.keyboard.up('d');
      const moved = await page.evaluate(() => ({ ...window.__raidState }));
      if (!(moved.x > start.x + 30)) problems.push('Pixel Raid 按 D 后角色没有向右移动');

      await page.keyboard.down('j');
      await new Promise((resolve) => setTimeout(resolve, 320));
      await page.keyboard.up('j');
      const fired = await page.evaluate(() => ({ ...window.__raidState }));
      if (fired.shots <= 0) problems.push('Pixel Raid 持续射击没有发射子弹');

      await page.keyboard.press('w');
      await new Promise((resolve) => setTimeout(resolve, 110));
      const jumped = await page.evaluate(() => ({ ...window.__raidState }));
      if (!(jumped.y < moved.y - 12 && jumped.ground === false)) {
        problems.push('Pixel Raid 跳跃没有离地：' + JSON.stringify(jumped));
      }

      await page.keyboard.press('k');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const thrown = await page.evaluate(() => ({ ...window.__raidState }));
      if (thrown.grenades !== start.grenades - 1) {
        problems.push('Pixel Raid 手雷没有正确扣除：' + JSON.stringify(thrown));
      }

      await page.keyboard.press('p');
      await page.waitForFunction(() => window.__raidState?.phase === 'pause', { timeout: 3000 });
      await page.keyboard.press('p');
      await page.waitForFunction(() => window.__raidState?.phase === 'playing', { timeout: 3000 });
      await page.click('#restart');
      const restarted = await page.evaluate(() => ({ ...window.__raidState }));
      if (restarted.phase !== 'playing' || restarted.stage !== 1 || restarted.shots !== 0 ||
          restarted.grenades !== 3) {
        problems.push('Pixel Raid 重新开始没有复位：' + JSON.stringify(restarted));
      }

      /* 同页切成手机视口；按住屏幕右箭头，断言实际位置改变，不止检查控件是否存在 */
      await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
      const target = await page.evaluate(() => {
        const btn = document.querySelector('[data-action="right"]');
        const controls = document.querySelector('.controls');
        const rect = btn?.getBoundingClientRect();
        return {
          visible: controls ? getComputedStyle(controls).display !== 'none' : false,
          width: rect?.width ?? 0, height: rect?.height ?? 0,
          x: rect ? rect.x + rect.width / 2 : 0,
          y: rect ? rect.y + rect.height / 2 : 0,
        };
      });
      if (!target.visible || target.width < 42 || target.height < 42) {
        problems.push('Pixel Raid 手机触屏按钮太小或被隐藏：' + JSON.stringify(target));
      } else {
        const beforeTouch = await page.evaluate(() => window.__raidState.x);
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        await new Promise((resolve) => setTimeout(resolve, 300));
        await page.mouse.up();
        const afterTouch = await page.evaluate(() => window.__raidState.x);
        if (!(afterTouch > beforeTouch + 20)) {
          problems.push('Pixel Raid 手机方向键按住后没有移动：' + (afterTouch - beforeTouch));
        }
      }
      await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    webgl2 = await hasWebgl2(page);

    if (await looksBlank(page)) {
      problems.push(`${file} 画面几乎全空，像是脚本没跑起来（WebGL2：${webgl2 ? '有' : '无'}）`);
    }

    const text = await page.evaluate(() => (document.body.innerText || '').trim().length);
    if (text < 30) problems.push(`${file} 页面上几乎没有可见文字（${text} 字）`);

    missing.push(...(await page.evaluate(() => [...(window.__missingThree ?? [])])));
  } catch (error) {
    retryable = RETRYABLE.test(error.message);
    reason = error.message.slice(0, 160);

    /* 超时的时候把游戏自己的失败提示带出来——卡在「正在布置派对赛道…」和
       提示「请用支持 WebGL 2 的浏览器打开」是两回事：前者是脚本问题，后者是环境问题 */
    const note = page
      ? await page
          .evaluate(() => (document.getElementById('load-text')?.textContent ?? '').trim().slice(0, 80))
          .catch(() => '')
      : '';
    webgl2 = page ? await hasWebgl2(page).catch(() => null) : null;
    problems.push(
      `${file} 跑不起来：${error.message}` +
        `${note ? `（页面提示：${note}）` : ''}（WebGL2：${webgl2 === null ? '未知' : webgl2 ? '有' : '无'}）`
    );
  } finally {
    /* 渲染进程崩掉时 close() 自己也会抛，吞掉即可——反正这个标签页已经不在了 */
    if (page) await page.close().catch(() => {});
  }

  for (const message of errors) problems.push(`${file} ${message}`);

  return {
    retryable,
    problems,
    /* 重试成功后就看不到这次的报错了，至少把原因留在一行日志里 */
    reason,
    row: {
      file,
      seconds: (Date.now() - started) / 1000,
      errors: errors.length,
      missing: missing.length,
      missingList: missing,
      webgl2,
    },
  };
}

async function main() {
  const games = fs
    .readdirSync(SRC_DIR)
    .filter((file) => file.endsWith('.html'))
    .sort();

  const expected = ['beanrush.html', 'pixelraid.html'];
  const extras = games.filter((game) => !expected.includes(game));
  const absent = expected.filter((game) => !games.includes(game));
  if (extras.length || absent.length) {
    throw new Error('游戏目录与预期不符，多余：' + extras.join(', ') + '；缺少：' + absent.join(', '));
  }
  for (const slug of ['2048', 'snake', 'breakout', 'minesweeper']) {
    if (fs.existsSync(path.join(process.cwd(), 'dist', 'games', slug, 'index.html')) ||
        fs.existsSync(path.join(SRC_DIR, slug + '.html'))) {
      throw new Error('旧游戏仍在发布产物里：' + slug);
    }
  }
  if (!fs.existsSync(path.join(process.cwd(), 'dist', 'games', 'pixelraid', 'index.html'))) {
    throw new Error('Pixel Raid 缺少试玩页路由');
  }

  const browser = await launchWithRetry();
  const rows = [];
  const failures = [];

  try {
    for (const file of games) {
      let result = await checkGame(browser, file);

      if (result.retryable) {
        /* 一个游戏重来一次就够——连续两次崩说明不是抖动 */
        console.log(`  … ${file} 的浏览器会话中途断了（${result.reason}），重来一次`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        result = await checkGame(browser, file);
      }

      rows.push(result.row);
      failures.push(...result.problems);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log('\n  游戏              耗时   WebGL2  报错  未导出的成员');
  for (const row of rows) {
    const flag = row.errors || row.missing.length ? '✗' : ' ';
    const webgl = row.webgl2 === null ? ' ? ' : row.webgl2 ? ' 有 ' : ' 无 ';
    console.log(
      `  ${flag} ${row.file.padEnd(18)}${row.seconds.toFixed(1).padStart(4)}s${webgl.padStart(6)}` +
        `${String(row.errors).padStart(5)}` +
        `${String(row.missing).padStart(10)}   ${row.missingList.slice(0, 6).join(', ')}`
    );
  }

  if (failures.length) {
    console.error('\n✗ 游戏冒烟失败：');
    for (const failure of failures) console.error(`  ${failure}`);
    console.error(
      '\n  如果报的是「缺少 THREE.xxx」，把 xxx 补进 scripts/lib/three-vendor.mjs 的扫描结果即可：\n' +
        '  裁掉的导出是静态扫描推断出来的，运行时守卫负责把漏网的抓出来。'
    );
    process.exit(1);
  }

  console.log(`\n✓ ${rows.length} 个游戏都能正常启动`);
}

/* 兜底：任何没接住的异常都要先说话再退出。CI 里只看到一个红灯、日志空白，
   排查成本远高于多写这十行（Quality #44 就是这么红过一次）。 */
main().catch((error) => {
  const detail = error?.stack ? error.stack.split('\n').slice(0, 8).join('\n  ') : String(error);
  console.error('\n✗ 游戏冒烟自己没跑起来（不是某个游戏的锅）：');
  console.error(`  ${detail}`);
  console.error('\n  常见原因：浏览器起不来（见 scripts/lib/browser.mjs）、预览服务没起、端口不是 4321。');
  process.exit(1);
});
