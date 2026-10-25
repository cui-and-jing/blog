/**
 * 无头浏览器的统一入口，给所有需要真渲染的脚本（审计、截图、体积测量、图标生成）共用。
 *
 * 为什么不用 `puppeteer.launch`：
 * 新版 Edge 的 msedge.exe 是个引导程序——它拉起真正的浏览器进程后自己立刻以 0 退出，
 * 连 `--user-data-dir` 指定的独立配置目录也一样。puppeteer 见到子进程退出就判定
 * 「启动失败」（Failed to launch the browser process: Code: 0），此时浏览器其实活得好好的。
 * 所以这里自己 spawn，等 DevToolsActivePort 落盘后再走 CDP 连接；关闭时把子进程与临时
 * 配置目录一起收掉。CI 上用 Chrome 时行为一致，不必分支。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const candidates = [
  /* Windows：Edge 无处不在，Chrome 有也用 Chrome 更稳 */
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  /* CI（ubuntu-latest）与 Linux 桌面 */
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findBrowser() {
  return process.env.CHROME_PATH ?? candidates.find((p) => fs.existsSync(p)) ?? null;
}

const DEFAULT_ARGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--hide-scrollbars',
  '--mute-audio',
  /* 截图与视觉基线要跨机器一致：固定字体栅格化与色彩空间 */
  '--font-render-hinting=none',
  '--force-color-profile=srgb',
  /* 本机的系统代理会劫持 127.0.0.1，预览页直接连 */
  '--no-proxy-server',
  '--proxy-bypass-list=*',
];

/**
 * 清掉以前留下来的配置目录。
 *
 * close() 里会删自己的目录，但脚本被 Ctrl-C、超时或 CI 取消时走不到那里，
 * 一个 profile 动辄上百 MB，攒上几十个能把系统盘塞满（本项目真实踩过：
 * 临时目录里躺了一百多个，占掉几 GB，最后 ENOSPC 连 shell 都起不来）。
 * 只清一小时前的，正在跑的兄弟进程不受影响。
 */
function sweepStaleProfiles() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let entries;
  try {
    entries = fs.readdirSync(os.tmpdir(), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('blog-browser-')) continue;
    const full = path.join(os.tmpdir(), entry.name);
    try {
      if (fs.statSync(full).mtimeMs > cutoff) continue;
      fs.rmSync(full, { recursive: true, force: true });
    } catch {
      /* 还被占着就下次再说 */
    }
  }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.args] 追加的启动参数
 * @param {number} [options.protocolTimeout] 单条 CDP 命令的超时，默认 60s
 * @param {number} [options.launchTimeout] 等待调试端口的时间，默认 20s
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function launchBrowser({ args = [], protocolTimeout = 60_000, launchTimeout = 20_000 } = {}) {
  const executablePath = findBrowser();
  if (!executablePath) {
    console.error('找不到浏览器，请设置 CHROME_PATH');
    process.exit(2);
  }

  sweepStaleProfiles();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blog-browser-'));
  const child = spawn(
    executablePath,
    [...DEFAULT_ARGS, `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', ...args, 'about:blank'],
    { stdio: 'ignore' },
  );

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + launchTimeout;
  let port = '';
  let exitedAt = 0;
  const debug = process.env.BROWSER_DEBUG === '1';
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
      if (port) break;
    }
    /* 引导程序退出是常态（真正的浏览器已另起进程），给它 3 秒把端口写出来再判定失败 */
    if (child.exitCode !== null && !exitedAt) exitedAt = Date.now();
    if (exitedAt && Date.now() - exitedAt > 3000) break;
    if (debug) console.error('[browser] waiting', { exists: fs.existsSync(portFile), exitCode: child.exitCode });
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!port) {
    child.kill();
    throw new Error(`浏览器没有写出调试端口（${launchTimeout}ms），检查 ${executablePath}`);
  }

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null,
    protocolTimeout,
  });

  /* 原生 close() 只断 CDP；这里的子进程与临时目录得自己收 */
  const close = browser.close.bind(browser);
  browser.close = async () => {
    await close().catch(() => {});
    child.kill();
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      /* 配置目录偶发被系统占着，留在临时目录里不影响结果 */
    }
  };
  return browser;
}
