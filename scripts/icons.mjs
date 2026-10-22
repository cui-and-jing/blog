/**
 * 生成站点图标：favicon.ico（16/32/48 三档）、apple-touch-icon.png（180）、
 * icon-192.png、icon-512.png。
 *
 * 用法：npm run icons
 * 只有改了 public/favicon.svg 才需要重跑，产物直接提交。
 *
 * 为什么不只留 SVG：线上实测 /favicon.ico、/apple-touch-icon.png 都是 404。
 * 现代浏览器认 SVG，但 iOS「添加到主屏幕」只认 apple-touch-icon，
 * 一部分阅读器与爬虫仍会无条件去取 /favicon.ico。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

/* 与 scripts/og-cards.mjs 同源；那边改浏览器候选时这里一起改 */
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('没找到 Chrome / Edge，用 CHROME_PATH 指一个再跑。');
  process.exit(1);
}

const svgSource = await fs.readFile(path.join(publicDir, 'favicon.svg'), 'utf8');

/**
 * 浏览器标签页的图标自己带圆角，但 apple-touch-icon 与 Android 图标会被系统
 * 再套一层圆角遮罩——自带圆角就变成两层。所以大尺寸一律用直角满版。
 */
const iconSvg = (rounded) =>
  svgSource
    .replace(/rx="[\d.]+"/, `rx="${rounded ? 14 : 0}"`)
    .replace('<svg ', '<svg width="100%" height="100%" ');

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--force-color-profile=srgb'],
});
const page = await browser.newPage();

/** 渲染成等宽高的 PNG，背景透明——图标自己带底色 */
async function renderPng(size, file, rounded = true) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${iconSvg(rounded)}`,
    { waitUntil: 'load' }
  );
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true, captureBeyondViewport: false, type: 'png' });
  const { size: bytes } = await fs.stat(file);
  console.log(`${path.relative(root, file).padEnd(28)} ${size}×${size}  ${(bytes / 1024).toFixed(1)} KB`);
  return fs.readFile(file);
}

/**
 * ICO 容器：6 字节头 + 每张图 16 字节目录 + PNG 数据。
 * Vista 之后的 ICO 允许直接内嵌 PNG，不必转成 BMP。
 */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, buffer }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // 调色板颜色数：真彩图为 0
    entry.writeUInt8(0, 3); // 保留
    entry.writeUInt16LE(1, 4); // 颜色平面
    entry.writeUInt16LE(32, 6); // 位深
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((image) => image.buffer)]);
}

const icoParts = [];
for (const size of [16, 32, 48]) {
  const tmp = path.join(publicDir, `.icon-${size}.png`);
  const buffer = await renderPng(size, tmp);
  icoParts.push({ size, buffer });
  await fs.rm(tmp);
}

const ico = buildIco(icoParts);
await fs.writeFile(path.join(publicDir, 'favicon.ico'), ico);
console.log(`public/favicon.ico            16/32/48  ${(ico.length / 1024).toFixed(1)} KB`);

await renderPng(180, path.join(publicDir, 'apple-touch-icon.png'), false);
await renderPng(192, path.join(publicDir, 'icon-192.png'), false);
await renderPng(512, path.join(publicDir, 'icon-512.png'), false);

await browser.close();
