# Cui & Jing · 博客

基于 [Astro](https://astro.build) 的静态博客，Markdown / MDX 写作，零前端框架运行时。
部署在 GitHub Pages（项目站点，路径 `/blog/`）。

旧站（Hexo）仍在 `cui-and-jing.github.io`，本站是它的重写版，互不影响。

## 首页内容入口

首页首屏有「开始阅读」和「看看笔记」两个直接入口，分别链接文章列表与笔记时间流。
「系列」栏目复用文章 frontmatter 的 `series` 和 `seriesOrder`，由 `collectSeries()` 自动聚合并按最近更新排序：
首页最多展示两组系列，每组预览前三篇，按钮始终指向该系列的第一篇（不是最近更新的一篇）。
少于两篇文章的系列不会出现；系列为空时整个模块自动隐藏。

- 模块结构：`src/components/HomeSeries.astro`
- 首页数据与入口：`src/pages/index.astro`
- 响应式样式：`src/styles/layout.css`
- 浏览器回归：`scripts/a11y-keyboard.mjs`，验证链接、阅读顺序、键盘焦点和手机触控尺寸。

## 稍后再读与旧游戏链接

文章卡片和文章页的首尾都有「收藏」入口：单击保存，再单击移除；文章列表的
「只看收藏」可与分类、作者组合使用，筛选状态保存在 URL（`saved=1`）。
收藏只存文章 slug，在本机的 `localStorage['cui-jing:saved-posts:v1']`，不会上传、
不要求登录，跨标签页会同步状态。无痕模式或禁止本地存储时，本页仍可操作，
但重新加载后可能无法保留。收藏不承诺跨设备同步。

- 存储与容错：`src/lib/bookmarks.ts`（坏数据过滤、禁止存储时的会话回退）
- 同步组件：`src/components/BookmarkToggle.astro`（卡片、正文上方与文末共用）
- 筛选：`src/pages/posts/index.astro`；保留不启用 JavaScript 时的分类和作者原有链接
- 回归测试：`scripts/a11y-keyboard.mjs` 检查收藏读写、两个入口同步、组合筛选、空状态

四款已移除的小游戏（2048、贪吃蛇、打砖块、扫雷）不会恢复到游戏中心。
GitHub Pages 将旧地址交给站点 `404.html`，页面根据旧 URL 显示
「去看现有游戏」的链接；其他不存在的页面仍使用通用 404 提示。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:4321/blog/
npm run build    # 产物在 dist/
npm run preview  # 预览构建结果
```

要求 Node ≥ 22.22。

## 写一篇新文章

一条命令生成骨架和 frontmatter：

```bash
npm run new -- "标题" --slug my-post --series 从笔记到发布 --category 技术 --tags Astro,写作
npm run new -- "标题" --slug my-post --author jing   # Jing 写的加 --author，默认是 cui
npm run new          # 什么都不给就交互式问
```

默认写成草稿（`draft: true`）：`npm run dev` 里能正常看排版，文章顶部有一条「草稿预览」提示，
列表卡片带「草稿」徽标；`npm run build`、RSS、sitemap、搜索索引都会把它排除。
发布时把 frontmatter 里的 `draft` 改成 `false`（建的时候加 `--publish` 也可以）。
判断只写在 `src/lib/posts.ts` 一处：dev 环境放行草稿，构建环境一律过滤。

也可以直接在 `src/content/posts/` 下新建 `.md`（或 `.mdx`）文件，文件名即 URL（`hello-astro.md` → `/posts/hello-astro/`）。

```yaml
---
title: 文章标题
author: cui                  # 必填：cui 或 jing
date: 2026-10-19
description: 一句话摘要，会显示在列表页和搜索结果里
tags:
  - Astro
  - 博客
category: 技术
cover: /covers/my-post.jpg   # 可选，不填则自动生成渐变封面
draft: false
---
```

字段说明：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| title | 是 | 文章标题 |
| author | 是 | `cui` 或 `jing`。**没有默认值**，忘了写构建会直接报错 |
| date | 是 | 发布日期，`YYYY-MM-DD` |
| description | 否 | 摘要，列表页与 RSS 使用 |
| tags | 否 | 字符串数组 |
| category | 否 | 单个分类，用于归档页 |
| cover | 否 | 封面图路径（放 `public/` 下）。**不填会自动按文章名生成一张渐变封面**，不会出现空图 |
| draft | 否 | `true` 时不出现在任何列表里 |
| featured | 否 | 首页大卡优先取这一篇（多篇同时标时取最新的一篇） |
| updated | 否 | 更新日期 |
| series | 否 | 系列名，同名文章会串成一条阅读线 |
| seriesOrder | 否 | 系列内顺序，从 1 开始；不填按日期排在后面 |

### 系列

同一个 `series` 的文章会自动出现在 `/series/` 与 `/series/<系列名>/`，文章顶部也会多一条
「系列 · 第 n / N 篇」，带上一篇与下一篇。少于两篇的系列不会生成页面，免得只有一篇文章时到处是空壳。
系列的一句话简介写在 `src/data/series.json`，不写就用系列名与篇数。

### 封面是怎么来的

没配 `cover` 时，`src/lib/cover.ts` 用文章 slug 算出一个稳定哈希，从 8 组预置色板里挑一组，
再配一张抽象的 SVG 图形和一个大字水印。同一篇文章的封面永远一致，不同文章之间会自动错开色相，
不依赖任何外链图床——旧站用 `picsum.photos` 随机图，同一篇刷新还会换图，这里不会。

想换成真实图片，把图放进 `public/covers/`，frontmatter 写 `cover: /covers/xxx.jpg` 即可，
卡片和文章页会自动改用图片并保留遮罩，保证标题可读。

写完跑一次 `npm run og` 生成分享封面（详见「分享与 SEO」），然后提交推送，GitHub Actions 会自动构建部署。

### 配图

```bash
npm run image -- ~/Desktop/截图.png --post hello-astro
```

图片会收进 `src/assets/posts/<slug>/`，宽度超过 1600px 的自动缩到 1600（`--max` 可改），
然后打印一段能直接粘贴的 `import` + `<Figure>`。构建时由 `<Picture>` 生成 AVIF/WebP 与四档 srcset，
脚本不预转格式，免得做两遍。重名会自动加序号，不会覆盖旧图。
缩边与尺寸读取用的是 Astro 自带的 `sharp`，缺失时会退化成原样复制。

## 写一条笔记

文章之外还有一条更轻的通道：`/notes/`。一条笔记就是一段话，没有标题、没有摘要，
不发列表页，只按时间排在时间流里。

```bash
npm run note -- "想到的一句话"
npm run note -- "带标签的一条" --tags 写作,方法
npm run note -- "先存着" --draft      # 草稿，构建不发布
```

命令会写一个 `src/content/notes/2026-10-22-1015.md`（文件名带时分，同一天写多条也不撞车），
并打印这条笔记的独立页地址 `/notes/2026-10-22-1015/`。

- 标题与摘要都由正文推导（第一句话截到 40 字），所以**不需要写 frontmatter 里的 title**
- 每条笔记有自己的页面：时间流里「单独打开」，分享出去是一张带标题的卡片（有 OG 图）；
  独立页是 `noindex`——一百字的碎片不该占搜索结果的位置，但链接照常可点
- 独立页会把和标题完全重复的第一段去掉，页面从第二句开始读
- 首页有一块「最近想法」显示最新 3 条；页脚、导航、标签页、归档页都有入口
- 标签横跨两类内容：`/tags/CSS/` 会同时列出文章和笔记，计数是两者之和
- 搜索里与文章一起参与打分，结果带「笔记」徽标；**空查询时只列文章**，不让碎片淹没长文
- 订阅走单独的 `notes.xml`：主 feed 只放文章，订「文章」的人不该被短句刷屏
- 超过 900 字会被 `lint:content` 提醒「该写成文章了」

## 正文组件（MDX）

把文章后缀改成 `.mdx` 就能用下面这些组件，**不需要 import**：`src/pages/posts/[...slug].astro`
在渲染 `<Content />` 时统一注入了。

| 组件 | 用途 | 写法 |
| --- | --- | --- |
| `Callout` | 说明 / 提示 / 注意 / 警告 | `<Callout type="warn" title="注意">…</Callout>` |
| `KeyPoints` | 文首或文末的要点框 | `<KeyPoints>` 里写普通列表 |
| `Steps` + `Step` | 有先后顺序的操作 | `<Steps><Step title="第一步">…</Step></Steps>` |
| `Details` | 折叠的可选内容 | `<Details title="展开看配置">…</Details>` |
| `Figure` | 带图注的配图 | `<Figure src={shot} alt="…" caption="…" />`（`shot` 从 `src/assets/` import） |

几个约定：

- 组件标签和里面的 Markdown 之间**要留空行**，否则 MDX 会当成普通文本。
- `.md` 文件不能用组件；需要时把后缀改成 `.mdx`，URL 不变（`id` 不含扩展名）。
- `Figure` 有两种写法：从 `src/assets/` 导入的图片会自动生成 AVIF/WebP 与四档 `srcset`，宽高由文件决定；
  直接传 `public/` 下的字符串路径则原样输出，这种写法必须自己写 `width` / `height`。
- 图片仍可点开灯箱；`maxWidth` 可以把截图限制得比正文窄一些。
- 实时效果和全部可用的正文元素都在 `/styleguide/`（`noindex`，不进 sitemap 与站内搜索）。

## 目录结构

```
src/
├── content.config.ts        内容集合 schema（posts / notes，author 为必填枚举）
├── content/posts/           文章（Markdown / MDX）
├── content/notes/           短笔记：只有 date / tags / draft，正文一段话
├── assets/                  正文配图：import 进来才会做响应式与格式转换
├── layouts/BaseLayout.astro 全站外壳：head、导航、页脚、阅读设置与快捷键面板、正文增强脚本
├── layouts/ProsePageLayout.astro  单页正文版式（排版样例页使用）
├── components/
│   ├── mdx/                 写作组件：Callout / KeyPoints / Steps / Step / Details / Figure
│   ├── Analytics.astro      访问统计（配置为空时不输出任何脚本）
│   ├── Cover.astro          封面：有图用图，无图生成渐变
│   ├── PostCard.astro       文章卡片（整卡拉伸链接，分类可单独点）
│   ├── Featured.astro       首页主推大卡
│   ├── CategoryTiles.astro  技术/学习/生活三块渐变分类卡
│   ├── RelatedPosts.astro   文末「接着读」（同分类 +3、共同标签各 +2 打分）
│   ├── AuthorAvatar.astro   字母头像（首字母 + 各自色相，不依赖图片）
│   ├── NoteCopy.astro       笔记「复制链接」按钮（时间流与独立页共用，剪贴板失败会降级）
│   ├── Comments.astro       Giscus 评论区（懒加载 + 主题同步 + 失败兜底）
│   └── Sidebar.astro        作者卡 + 标签 + 最近更新（首页可关掉作者卡）
├── data/authors.ts          作者档案：名字、简介、关注方向、头像色相（署名与 /authors/ 的唯一来源）
├── data/comments.json       Giscus 的 repoId / categoryId
├── data/series.json         系列简介（不填则用系列名与篇数自动生成）
├── data/analytics.json      统计服务配置（默认 none）
├── data/font-charset.json   字体子集覆盖的字符（npm run fonts 生成，fonts:check 比对用）
├── data/font-files.json     带指纹的字体文件名（npm run fonts 生成，head 里的 preload 用）
├── data/font-pages.json     每页用哪一片增量字体（npm run fonts 生成，布局按路径取用）
├── lib/site.ts              站点信息、导航、URL 与日期工具
├── lib/series.ts            系列归组、排序与「第 n / N 篇」
├── lib/cover.ts             封面色板与哈希
├── lib/comments.ts          评论配置读取（缺 ID 时整块不渲染）
├── lib/posts.ts             取文章：dev 含草稿，构建只取已发布
├── lib/notes.ts             取笔记：标题/摘要从正文推导，锚点名统一在这里生成
├── lib/note-text.ts         纯文本与标题推导（不依赖 astro:content，分享封面脚本也用它）
├── lib/tags.ts              标签聚合：文章与笔记同一个口径，标签页共用
├── pages/
│   ├── index.astro          首页
│   ├── posts/               文章列表 + 详情
│   ├── notes/               笔记时间流（按年月分组）+ 每条笔记的独立页
│   ├── series/              系列总览 + 系列详情
│   ├── archive.astro        归档（年度统计 + 月度节奏条）
│   ├── tags/                标签总览 + 单标签
│   ├── category/            分类页（每个分类一页）
│   ├── games/               游戏：大厅（index）+ 全屏试玩外壳（[slug]）
│   ├── subscribe.astro      订阅落地页（两个 feed 的说明与复制）
│   ├── search.astro         站内搜索
│   ├── search-index.json.ts 构建时生成搜索索引
│   ├── robots.txt.ts        robots（含 sitemap 地址）
│   ├── site.webmanifest.ts  站点清单（start_url 跟着 base 走，不写死）
│   ├── about.astro          关于
│   ├── authors.astro        作者：两人的介绍 + 各自写过的文章与笔记
│   ├── license.mdx          版权与转载（CC BY-NC-SA 4.0 + 代码 MIT）
│   ├── styleguide.mdx       排版样例（noindex，给自己查的）
│   ├── rss.xml.js           RSS（文章）
│   ├── notes.xml.ts         笔记 RSS
│   └── 404.astro
├── styles/
│   ├── global.css           样式入口，只按顺序 @import，不写规则
│   ├── fonts.css            自托管字体的 @font-face（npm run fonts 生成，不要手改）
│   ├── tokens.css           颜色 / 字号 / 间距 / 圆角 / 阴影 / 字体栈
│   ├── base.css             重置与焦点样式
│   ├── typography.css       中文排版细节：标点挤压、避头尾、数字等宽
│   ├── layout.css           外壳、页头、首屏、分类块
│   ├── components.css       封面、卡片、侧栏、作者卡
│   ├── settings.css         阅读设置面板与快捷键表
│   ├── article.css          文章页与正文排版
│   ├── pages.css            评论、归档、系列、标签、关于、页脚、404
│   ├── responsive.css       断点覆盖（要排在它覆盖的规则之后）
│   ├── games.css / motion.css / search.css
│   ├── notes.css            笔记时间流、独立页、标签/归档里的笔记行
│   ├── subscribe.css        订阅落地页
│   ├── authors.css          字母头像、/authors/ 页面
│   ├── enhance.css          代码块附加件、灯箱、移动端目录
│   ├── prose-extras.css     提示框、要点、步骤、图注、脚注、表格
│   └── print.css            打印稿
├── scripts/
│   ├── new-post.mjs         新建文章骨架（npm run new）
│   ├── new-note.mjs         新建短笔记（npm run note）
│   ├── image-inbox.mjs      配图归位 + 生成 Figure 片段（npm run image）
│   ├── fonts.mjs            按站内用字裁字体子集，再按页切增量片（npm run fonts / fonts:check / fonts:check:pages）
│   ├── og-cards.mjs         生成文章与笔记的分享封面并压缩（npm run og）
│   ├── icons.mjs            从 favicon.svg 生成 ico / apple-touch / 192 / 512（npm run icons）
│   ├── lint-content.mjs     内容体检（npm run lint:content）
│   ├── budget.mjs           产物体积预算（npm run budget）
│   ├── budget-wire.mjs      首屏传输预算，用浏览器实测字节（npm run budget:wire）
│   ├── perf.mjs             渲染指标：LCP / CLS / TBT / 长任务（npm run perf）
│   ├── a11y-audit.mjs       axe 全站扫描（npm run a11y）
│   ├── a11y-keyboard.mjs    键盘与读屏实测（npm run a11y:keys）
│   ├── visual-regression.mjs 视觉回归（npm run visual / visual:update）
│   ├── games.mjs            构建后压缩游戏页：换成裁剪过的 three，其余脚本压到最小（npm run games / vendor:three）
│   ├── games-smoke.mjs      游戏冒烟：能否启动、画面是否空白、裁剪的 three 有没有缺导出（npm run games:smoke）
│   ├── preflight.mjs        发布前一键跑完全部检查（npm run preflight）
│   ├── lib/browser.mjs      无头浏览器统一入口（spawn + CDP，绕开 Edge 引导程序的假失败）
│   └── lib/three-vendor.mjs 推断游戏用到哪些 three 导出，打成 IIFE 全局（被 games.mjs 调用）
├── tests/visual/
│   ├── baseline/            视觉基线，126 张 JPEG，需随样式改动一起提交
│   └── meta.json            基线生成环境（platform + 浏览器版本）
└── public/
    ├── favicon.svg           矢量图标（浏览器标签页优先用这个）
    ├── favicon.ico           16/32/48 三档（老浏览器与爬虫会直接请求）
    ├── apple-touch-icon.png  180×180 直角满版，iOS 自己加圆角
    ├── icon-192.png / icon-512.png  清单里的图标，同样直角满版
    ├── og.png               默认分享图（1200×630）
    ├── fonts/               自托管字体子集，文件名带内容指纹（npm run fonts 生成，需提交）
    ├── og/                  文章与笔记的分享封面 + manifest.json（供内容体检比对）
    └── games/               游戏单文件（构建时原样拷贝，不进打包）
```

样式拆成了多个文件，但 `global.css` 只负责 `@import`，构建时 Vite 会把它们并回一个 CSS 文件，
运行时不会多出请求。**顺序就是层叠顺序**，`responsive.css` 必须排在它要覆盖的规则之后。

## 游戏模块

游戏大厅在 `/games/`：保留《糖河奇遇》的大型封面卡片，下一张是原创横版动作游戏《像素突围》。
两款游戏的试玩页都使用通用路由 `/games/<slug>/`（外壳 + iframe，支持全屏），本体是独立 HTML 文件。

| 游戏 | 路由 | 玩法 |
| --- | --- | --- |
| BEAN RUSH 7 · 糖河奇遇 | `/games/beanrush/` | 3D 派对：单人挑战或双人同屏 |
| PIXEL RAID · 像素突围 | `/games/pixelraid/` | 原创像素横版：两关、平台跳跃、连续射击、手雷与首领战 |

**旧游戏已移除**：2048、SNAKE、BREAKOUT、MINESWEEPER 的注册、封面和源 HTML 均已删除，
不再生成对应的试玩路由。历史链接会落到站点 404 页面。

《像素突围》为纯 HTML Canvas 2D 游戏，无第三方 CDN 或素材，桌面支持 A/D 或方向键移动、
W / ↑ / 空格跳跃、J/Z 开火、K/X 手雷、S/↓ 下蹲、P/Esc 暂停、R 重开；
触屏提供移动、下蹲、跳跃、射击、手雷按钮，并建议横屏游玩。支持检查点、
三条命、恢复和强化道具，以及本机最高分（`localStorage.pixel-raid.best`）。
角色、美术、关卡和命名均原创，仅参考横版跑动射击的玩法形式。

**战斗增强（v2）**：两关开场附近都有能直接拾取的紫色武器箱，拾取后开启 12 秒散弹攻击
（同时发射三颗弹丸，射速比普通步枪慢），倒计时结束自动切回步枪；
原有的快速连射补给和手雷仍然有效。Boss 攻击前会出现红光与蓄力条，
生命降至一半及以下时进入更密集的弹幕阶段：第一关从单发变为三发，
第二关从三发变为五发。武器及效果剩余时间显示在上方状态栏。

测试分为两层：`npm run raid:test` 利用虚拟时钟检查武器拾取、
散弹持续时间、两关 Boss 攻击模式以及通关流程，不给正式游戏加入作弊接口；
`npm run games:smoke` 使用 Chromium 实测键盘、射击、跳跃、手雷、
拾取散弹后的三发弹道、触屏操作，同时继续验证《糖河奇遇》。



### 体积：源码可读，发布压缩

`public/games/*.html` 保留**可读的源码形态**（beanrush 是三万行、内联了完整的 three.js r185 源码），
压缩发生在构建之后：`npm run build` 会接着跑 `scripts/games.mjs`，只压 `dist` 里的产物，
`<style>` 不动（整页 CSS 才 19KB gzip，压它省不到 5KB，而 `content:` 里的引号最容易压坏）。

beanrush 的大头是 three.js，它一个人占整页的 54%。压缩分两步：

1. **裁剪导出**——`scripts/lib/three-vendor.mjs` 扫游戏源码，只保留真正用到的 39 个名字，
   用 esbuild 打成 IIFE 挂回全局 `THREE`。未压缩源码 1541KB → 554KB（gzip 143KB）。
2. **压缩其余脚本**——esbuild transform，每块原地处理。

合并效果：**2054KB → 1035KB，gzip 465 → 347KB（−25%）**。

裁剪的依据是静态扫描，而静态扫描一定会漏，所以配了两道保险：

- **扫描放得很宽**：`<任意标识符>.<大写名>`，不限定 `THREE.`。因为视图层用的是别名
  `T.OrthographicCamera(...)`，只扫 `THREE.` 会让公园能进、一开竞技场就白屏。
  几何体更是以字符串形态存在（`geo('BoxGeometry', ...)` → `new THREE[type]`），
  所以「参数位与方括号里的字符串字面量」也要一起求交。
- **运行时守卫**：`npm run games:smoke` 给 `window.THREE` 套 Proxy，真访问到不存在的成员就
  把名字打出来。它同时断言：能就绪、画面不是空白、没有报错、`REVISION` 对得上、
  以及 `OrthographicCamera` 这类被别名访问的类确实存在。

新增游戏时：丢单文件进 `public/games/`、在 `src/lib/site.ts` 的 `GAMES` 里加一条
（`slug` / `title` / `subtitle` / `description` / `tags` / `facts` / `file` / `accent` /
`badge` / `weight`），再到 `scripts/budget.mjs` 的 `GAME_LIMITS` 里登记体积上限——
**漏登记会直接判失败**，免得下一个 beanrush 又是涨到 2MB 才被发现。

三个注意点：
- `scripts/fonts.mjs` 扫 `dist` 统计字符集时**跳过 `dist/games/`**——这些页面用系统字体，
  混进来会把公共片撑大
- 游戏页自成一档进 `budget.mjs`（逐页 gzip 上限），`budget-wire.mjs` 也会实测
  六个游戏路由的真实传输；`/games/<slug>/` 与 `/games/*.html` 都在 axe 扫描列表里
- `games-smoke.mjs` 会实际启动两款游戏，并为 Pixel Raid 检查开始、移动、跳跃、开火、手雷、
  暂停/继续、重开、手机触屏按住移动；同时阻止被移除的旧游戏重新出现在产物中
- `games.mjs` 每次都从 `public/` 重新推导、覆盖 `dist/`，所以连跑两次产物逐字节相同；
  不要反过来手改 `dist/games/`，会被下一次构建盖掉

## 搜索

`/search/` 是纯客户端搜索，不需要后端或第三方服务：

- 构建时 `src/pages/search-index.json.ts` 把每篇文章压成纯文本，输出 `/search-index.json`（含标题、
  摘要、标签、分类、日期、链接与正文）。
- 短笔记也在索引里（`type: "note"`），结果带「笔记」徽标、不显示阅读时长；空查询时列表只列文章。
- 搜索结果可选择「全部 / 文章 / 笔记」，结果数量随选择更新。直接打开搜索页时默认只列文章；
  输入关键词后默认搜索全部内容。明确选择类型后，条件写入 `?type=post|note|all`，
  可与 `?q=...` 一起分享；浏览器前进/后退会恢复关键词和类型。
- 键盘 `↑` `↓` 选择结果时，使用独立读屏状态区播报第几条和标题，输入框始终保持焦点。
- 如果 `search-index.json` 暂时不可用，会明确提示正文及笔记搜索不可用，
  改用 HTML 内已有的文章标题、标签和摘要搜索；笔记/全部类型暂不可选，
  不会将可访问的文章错误显示成零结果。
- `scripts/a11y-keyboard.mjs` 使用 Chromium 真实测试搜索分类、URL 历史、键盘播报、
  390px 手机布局，并主动把索引请求改成 503 验证降级功能。

- 页面按 标题 > 标签 > 分类 > 摘要 > 正文 加权打分，命中处高亮，并显示命中那句话的上下文。
- 多个关键词按**覆盖率**打分而不是 AND：`Astro 图片` 里只提了 Astro 的文章仍会出现，只是排在
  两个词都命中的后面。全是「的」「了」这类虚词时按空查询处理，不会返回零结果。
- 支持 `↑` `↓` 选择、`Enter` 打开（没选时直接开第一条）、`Esc` 清空；顶栏搜索图标、
  `Ctrl / ⌘ + K`、`/` 都能进入搜索。
- 最近 6 条搜索记在 `localStorage`，回车或点结果时写入，可一键清空；无结果时给出最近文章与热门标签。
- 索引很小（当前 3 篇文章约 3 KB），文章多了以后仍然是一次请求；如果将来上千篇，可以换 Pagefind。

## 阅读体验

- 顶栏右侧的设置按钮打开「阅读设置」面板：**主题**（跟随系统 / 浅色 / 深色）、**正文字体**（宋 / 黑 / 楷）、
  **字号**、**行距**四项。偏好统一存在 `localStorage.settings`，全站生效；首帧之前就在 `<head>`
  内联脚本里落好 `data-theme` / `data-font` / `data-reading`，不会先按默认值闪一下再变。
  选「跟随系统」时，用户改系统深浅色，站点会实时跟着变。
- 文章标题下方还留了一组 `A−` / `A` / `A+`，它和面板里的「字号」是同一份状态——两边都能改，
  改完另一边立刻同步。
- 按 `?` 打开快捷键总览。`Ctrl/⌘ + K`、`/`、灯箱里的 `+` `-` `0` `←` `→`、`Esc` 这些以前只存在于
  代码里，现在有一处地方能查到。
- 宽表格在窄屏不再挤压正文，改为在 `.table-wrap` 里横向滚动，并在可滚动时补一道边缘阴影。
- 文章页右侧目录跟随滚动高亮；侧栏内容超出一屏时，当前条目会自动滚进可视区。
- 单列布局（≤1080px）下，页面级动作收进页脚上方的**底部操作条**：目录 / 搜索 / 顶部。
  它是一整条实心底栏，不再像以前那样用浮钮盖住正文；`body` 会让出 56px，末尾内容不会被压住。
  目录在原生 `<dialog>` 里，Esc 可关。
- 代码块自动显示语言标签和复制按钮（触屏设备上按钮常显）；超过 24 行自动折叠，
  按钮写着总行数，打印时自动摊开。
- 正文图片可点击放大：滚轮 / `+` `-` 缩放（1×–4×，以指针为中心）、放大后拖动平移、
  双击或 `0` 复位、右上角可开原图；图片统一 `loading="lazy"`。
- 章节标题旁的 `#` 只复制章节链接，不会误把阅读位置跳到该章节。
- 鼠标停在段落上，左侧出现 `#`，点击复制「引用文字 + 文章标题 + 锚点链接」；
  选中半句就只引半句。窄屏没有左侧余量，这个入口会隐藏。
- 读到一半关掉，下次回来会看到「上次读到 xx% · 继续」浮条；新记录按**正文**
  （不含侧栏、评论、相关推荐和页脚）计算，动态插入评论也不会改变已保存的阅读位置。
  读完正文就清记录，点「不再提示」后当前页面不再写回；此前按整页比例保存的旧记录仍可恢复。
  恢复时尊重系统的减少动态效果设置。
- 配图放在 `src/assets/` 并通过 `<Figure>` 导入时，会自动生成 AVIF/WebP 与四档 `srcset`，
  图片实际只按正文宽度下载（一张 1200px 截图从 209 KB 降到 20 KB 左右）。
- 文章页阅读进度条以**正文**为准，读完正文即到 100%，不会要求再滚过评论区和页脚；
  滚动超过 700px 仍可「回到顶部」。
- 打印或「存为 PDF」时自动摘掉导航、侧栏、目录、评论、分享条与推荐，封面不打印，
  代码块转浅色并允许换行，外链地址以括号形式印在正文后（`@media print`）。

## 字体与中文排版

正文用自托管的**思源宋体**（[Noto Serif SC](https://github.com/notofonts/noto-cjk)，SIL OFL）。
系统字体在 Windows 上会落到宋体（点阵感强、小字发虚），macOS 落到宋体 SC，两端观感差很远；
把字体打包进来，这套「纸感」设计在两台上才是同一个东西。

字体不是整包引入，而是按**站内真正出现过的字**裁成子集：

```bash
# 源字体 11 MB，只放本地，不进仓库
curl -sL --create-dirs \
  https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf \
  -o .fonts/NotoSerifSC-Regular.otf

npm run fonts     # → public/fonts/*.woff2 + src/styles/fonts.css + src/data/font-*.json
```

- **汉字分两层**，因为整片汉字是首屏最大的一块（232 KB），而单个页面实际只用到 200–420 字：
  - **公共片**：出现在 ≥4 个页面里的字（386 字 / 98 KB），写进全局 `fonts.css`，每页都要下
  - **每页增量片**：这一页剩下的独有字（20–80 字 / 7–25 KB），由布局按当前路径注入一段 `@font-face`
- 收集字符时会先剥掉注释（`<!-- -->` 与 `/* */`）。注释里的字不会渲染到页面上，若不剥，
  每改一句注释都可能给子集添一个字，把 `fonts:check` 顶红、逼着重新裁一遍字体。
- `unicode-range` 必须**精确到码点**。写成 `U+4E00-9FFF` 这种宽区间，浏览器会因为「页面有汉字」
  把整片都算作命中，分片等于没分。
- `latin`（ASCII + Latin-1，101 字 / 52 KB）与 `punct`（中日韩标点与全角，28 字 / 5 KB）不分片，给宽区间就够。
- 文件名与 `@font-face` 家族名都带内容指纹（`prose-serif-han.0966ae97.woff2` / `Prose Serif 69dd61`）。
  子集一变就是新 URL，不会被 GitHub Pages 的缓存按旧文件返回。
- 公共片在 `<head>` 里 `preload`；增量片与另外两片交给 CSS 自然加载——太小了，提前抢带宽不划算。
- `font-display: swap`。汉字全角等宽、行高按倍数算，所以字体到达前后的替换**不产生位移**
  （实测 CLS < 0.001，LCP 不受影响——文字先用系统宋体就渲染完了）。
- 字体没加载完、或者某个字刚好不在子集里，会沿 `--font-serif` 的栈落到系统宋体，不会出现空白或豆腐块。
- 实测（390px、冷缓存、首次访问）：首页 **336 KB → 211 KB**，文章页 **→ 241 KB**，
  字体总量 290 KB → 163–189 KB。`npm run budget:wire` 把这条线钉在 CI 里。

**每加一篇新文章都要重跑 `npm run fonts`**，否则新出现的字会悄悄回退成系统宋体。
`npm run fonts` 要读 `dist`（按真实渲染结果算每页用字），所以先 `npm run build`。
两道校验都会在 CI 与 `preflight` 里跑：

- `npm run fonts:check`：`src/` 里有没有子集外的字（不需要构建，跑得早）
- `npm run fonts:check:pages`：构建后逐页比对「公共片 + 该页增量片」是否覆盖了该页所有字，
  新增页面漏进映射时直接失败

中文排版另外补了几条渐进增强规则（`src/styles/typography.css`），浏览器不支持就回到原样：

- `text-spacing-trim: trim-start`——行首全角标点压到半宽，中文段落的左边缘才是一条直线
- `line-break: strict`——避头尾，句读与后括号不出现在行首
- `hanging-punctuation: allow-end`——行末标点悬到版心之外（目前只有 Safari 实现）
- `font-variant-numeric: tabular-nums`——数字等宽，日期、评分与表格列才对得齐

设置面板里的「黑 / 楷」两档直接用系统字体，不增加任何下载量；只有「宋」是自托管的那份。

## 评论

文章底部用 [Giscus](https://giscus.app) 接 GitHub Discussions，静态站不需要后端。
`src/components/Comments.astro` 负责懒加载（滚到附近才拉 iframe）、深浅色同步、加载骨架与失败兜底，
并把评论总数显示在标题旁。

启用只要两步（各点一次）：

1. 仓库 Settings → General → Features → 勾选 **Discussions**
2. 打开 <https://github.com/apps/giscus> → Install → 只勾选本仓库

然后写配置：

```bash
npm run comments:setup            # 自动取 repoId / categoryId，写入 src/data/comments.json
npm run comments:setup -- --list  # 只列出仓库里的讨论分类
```

两个 ID 都齐了评论区才渲染；没配置时整块不出现，线上不会留一个坏掉的框。
讨论按 `pathname` 关联，改标题不影响已有评论，改 slug 会让评论「迷路」。

新文章第一次被访问时 giscus 会返回 `Discussion not found`，这是正常的——有人登录后发表第一条评论，
讨论才在仓库里建出来，之后所有人（包括未登录读者）都能看到列表。所以这个 404 不能当加载失败处理。

> 实测国内网络下 `giscus.app` 首次要 8–13 秒（TLS 握手就占 4 秒），所以评论区做了懒加载（距视口 1400px 开始拉）、
> `preconnect`、骨架屏和 16 秒兜底。想让读者更快看到评论，可以自建 giscus 到 Vercel 绑自定义域名，
> 再把 `Comments.astro` 里的 `script.src` 与 postMessage 的 origin 换掉即可。

## 作者与署名

站名就是两个人的名字，所以每篇文章和每条笔记都必须写 `author`：

```yaml
---
title: 标题
author: cui      # 或 jing
---
```

- `author` 在 schema 里是**必填枚举**，故意不给默认值：忘了写会在 `astro check` 与
  `lint:content` 同时报错，而不是默默把 Jing 的文章标成 Cui
- 署名出现在三处：文章标题那行的 kicker、文末统计、`/authors/` 的清单
- JSON-LD 的 `author` 是具体的人（`@type: Person` + `@id` 指向 `/authors/#cui`），
  `/authors/` 页同时输出两个 `Person` 实体并挂上各自的作品，搜索引擎能把「谁写的」串起来
- 两份 feed 用 `<dc:creator>` 带作者名（RSS 2.0 的 `<author>` 要求 `email (Name)` 格式，
  我们没有公开邮箱）；分享封面右下角标「文 / Cui」
- 名字、简介、关注方向、头像色相都在 `src/data/authors.ts`。
  加第三个人要同步改 `src/content.config.ts` 的枚举与 `scripts/lint-content.mjs` 的 `AUTHOR_IDS`
- `npm run new` / `npm run note` 默认写 `author: cui`，Jing 写的时候加 `--author jing`

头像不是图片：首字母 + 各自的色相（Cui 陶土 18°、Jing 墨绿 168°），深浅主题共用一套，
外层 `aria-hidden`，名字永远由旁边的文本给出。

## 订阅

`/subscribe/` 是给人看的落地页，不是 feed 本身。页脚和笔记页的订阅入口都指向它，
而不是直接甩一个 `/rss.xml`——不熟悉 RSS 的读者点开一段裸 XML 只会把页面关掉。

- 两个 feed 分开：`/rss.xml`（文章）、`/notes.xml`（笔记），页面上各给一个「复制地址」按钮
- 地址由 `Astro.site` 拼出来，换域名不用改文案
- 「怎么用」三步 + 四个阅读器外链（`rel="noopener noreferrer"`）
- 页脚仍保留两个 feed 的直接链接，给已经知道自己在做什么的人

## 分享与 SEO

- 每页输出 `WebSite` 结构化数据；文章页额外输出 `BlogPosting` 与 `BreadcrumbList`。
- 每篇文章有自己的分享封面 `public/og/<slug>.png`（1200×630，纸感底 + 文章配色卡叠 +
  标题/摘要/标签），由 `npm run og` 生成；`cover` 字段优先，没生成过则退回 `public/og.png`。
- 每条笔记也有分享封面 `public/og/note-<id>.png`，标题取正文第一句、摘要从第二句开始。
  指纹记在 `public/og/manifest.json`；笔记的指纹只含标题/日期/标签，改正文不影响。
- 笔记独立页 `noindex`，但保留链接（`follow`），碎片页不占搜索结果的位置。
- 文末有分享条：复制链接（带降级）、微博、以及手机上可用的系统分享。
- `rss.xml` 输出**全文**（`content:encoded`）而不只是摘要，订阅器里能直接读完；
  正文里的 `/blog/...` 与 `#锚点` 会补成绝对地址，避免在阅读器里点不开。
- `robots.txt` 由 `src/pages/robots.txt.ts` 生成，自动带上 sitemap 地址；
  404 页带 `noindex`，搜索页不进 sitemap（纯客户端工具，没有独立内容）。
- sitemap 带 `lastmod`：文章取 `updated`（没写就取 `date`），首页 / 归档 / 标签页 / 分类页 / 系列页
  取该页涉及文章里最新的一天。没有日期的静态页不写，不拿构建时间凑数。
- 页头有「跳到正文」链接，键盘 Tab 第一下就能用。

### 图标与站点清单

`public/favicon.svg` 是唯一的设计源，其余尺寸都由 `npm run icons` 从它渲染：

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `favicon.svg` | 矢量 | 现代浏览器标签页优先用这个，**带圆角** |
| `favicon.ico` | 16 / 32 / 48 | 老浏览器、阅读器与爬虫会无条件请求它 |
| `apple-touch-icon.png` | 180 | iOS「添加到主屏幕」 |
| `icon-192.png` / `icon-512.png` | 192 / 512 | `site.webmanifest` 里的安装图标 |

后三个是**直角满版**：iOS 与 Android 会自己再套一层圆角遮罩，图标自带圆角就变成两层。

`site.webmanifest` 由 `src/pages/site.webmanifest.ts` 输出而不是静态 JSON，
这样 `start_url` 与图标地址会跟着 `astro.config.mjs` 的 `base` 走，换部署路径不会静默失效。

### 分享封面怎么生成

```bash
npm run og
```

需要本机装 Chrome 或 Edge（脚本用 `puppeteer-core`，可用 `CHROME_PATH` 指定路径）。
所有要真渲染的脚本（分享封面、图标、axe、键盘实测、传输预算、视觉基线）都从
`scripts/lib/browser.mjs` 拿浏览器——**不要直接 `puppeteer.launch`**：新版 Edge 的
`msedge.exe` 是个引导程序，拉起真正的浏览器进程后自己立刻以 0 退出，puppeteer 会误判成启动失败
（`Failed to launch the browser process: Code: 0`）。统一入口改成自己 spawn、等
`DevToolsActivePort` 落盘后再走 CDP 连接，顺带把临时配置目录也收拾干净。
**新文章写完、改了标题后跑一次**，把 `public/og/*.png` 一起提交——图是构建产物之外的静态文件，
CI 不生成（GitHub Actions 里没有中文字体，渲染会变成方框）。

配色复用了 `src/lib/cover.ts` 的色板，所以分享图和列表里的渐变封面是同一套颜色；
背面两张卡固定用品牌色（陶土 / 墨绿）打底，正面撞色时会自动换成深蓝。
卡片右下角标「文 / Cui」或「文 / Jing」，取自 frontmatter 的 `author`。

puppeteer 直接截出来的 PNG 一张 270–300 KB，脚本会用 `sharp` 无损重编码一遍（80–90 KB），
像素完全不变。社媒抓取卡片时少下 190 KB，比调色板量化更划算（量化会让渐变出 banding）。


## 设计

卡片式布局：纸感暖灰底 + 白卡 + 18px 圆角 + 双层阴影，首页为主推大卡 + 双列网格 + 右侧粘性侧栏。
配色索引在 `--accent`（陶土 #b4431f）与 `--accent-2`（墨绿 #2f6f66），封面色板在 `src/lib/cover.ts`。
深色模式跟随系统并可手动切换，切换无闪烁。

### 移动端

七项导航在 ≤720px 收进抽屉（`#nav-drawer`），顶栏只留「站名 + 搜索 + 阅读设置 + 菜单」。
站名不再隐藏——导航让出空间后放得下，新访客在窄屏也能看见这是谁家的站。

**顶栏与底部操作条上的每个控件都不小于 44×44**。这条不是审美偏好：改动前七个导航项挤在
一行，靠 12px → 11.2px 缩字号硬撑，390px 下每个只有 32×31，手指经常点错。现在由
`npm run a11y:keys` 在 320 / 360 / 390 三档逐个体检，破了就红。

单列布局（≤1080px）下，页面级动作收到页脚上方的底部操作条里，见「阅读体验」一节。

## 动效

- 滚动入场：`BaseLayout` 里的 IntersectionObserver 给常见块（卡片、侧栏、标题区等）自动加
  `data-reveal`，同组元素按顺序错峰 55ms。**只有在 JS 就绪后才加这个属性**，所以禁用 JS
  或脚本报错时内容不会消失。
- 全部动效都在 `@media (prefers-reduced-motion: no-preference)` 内，系统开启「减少动态效果」时自动关闭。
- 位置动画统一用 `translate` / `scale` 这两个独立属性，避免和卡片 hover 的 `transform` 互相覆盖。
- 文章页有顶部阅读进度条，滚动超过 700px 出现「回到顶部」。
- 主题切换在支持的浏览器里用 View Transitions 做圆形扩散，不支持时直接切换。

## 改站点信息

编辑 `src/lib/site.ts`：站名、副标题、描述、导航项、GitHub 地址。
改配色改 `src/styles/tokens.css` 的 `:root` 与 `[data-theme='dark']` 变量。
改作者资料改 `src/data/authors.ts`。

## 质量检查

```bash
npm run lint:content  # 不需要构建：frontmatter、标题层级、图片、内链、中文排版、分享封面
npm run fonts:check   # 不需要构建：正文用字是否都在字体子集里（缺字会静默回退）
npm run fonts:check:pages # 需要 dist：逐页核对「公共片 + 该页增量片」是否覆盖了该页所有字
npm run fonts         # 需要 .fonts/ 源字体与 dist：重新裁子集，产物要提交
npm run check         # astro check：类型与模板
npm run budget        # 需要 dist：主站五类上限 + 五个游戏页逐页 gzip 上限
npm run budget:wire   # 需要先 build + preview：实测 12 条路由（含六个游戏路由）首次访问的传输字节与字体字节
npm run perf          # 需要先 build + preview：Slow 4G + 4× CPU 下实测 LCP / CLS / TBT 与首屏字节
npm run games:smoke   # 需要先 build + preview：五个游戏能否启动、裁剪的 three 有没有缺导出
npm run vendor:three  # 只看 three 的裁剪结果（导出名单与体积），不碰 dist
npm run a11y          # 需要先 build + preview：axe-core 扫全站 27 条路由 × 浅/深两套主题 + 4 个游戏直连页 + 四个面板
npm run a11y:keys     # 需要先 build + preview：Tab 顺序、焦点环、复制播报、设置面板、快捷键表、移动端抽屉、触控目标 44px
npm run visual        # 需要先 build + preview：21 条路由 × 浅/深 × 3 视口，和基线逐像素比
npm run visual:update # 样式改动确认无误后重建基线
npm run preflight     # 一条命令串起：og → lint → fonts:check → check → 构建 → 游戏页压缩 → budget → fonts:check:pages → a11y → a11y:keys → games:smoke → budget:wire
```

`preflight` 会自己起 `astro preview` 并在结束时收掉，任何一步失败就停；`--ci` 跳过分享封面
（CI 没有中文字体，渲染出来是方框），`--skip-build` 复用现有 `dist` 只跑检查，
`--visual` 额外跑一遍视觉回归（比全站截图慢，改过样式时用），`--perf` 额外跑渲染指标
（改过首屏、字体、布局脚本时用）。

`visual` 的基线在 `tests/visual/baseline/`（126 张 JPEG，约 5.6 MB），元信息记在
`tests/visual/meta.json`，包含生成时的 `platform` 与浏览器版本。**换机器或换浏览器后会直接跳过比对**
——字体栅格化不同会让所有页面都"失败"，那种红叉没有信息量，在本机跑一次 `--update` 重建即可。
3D 游戏页用 canvas 实时渲染，逐帧不同，不在比对范围内。

截图只覆盖视口首屏，不拍整页：整页截图受懒加载与 `position: fixed` 元素影响，同一份代码能差出
几个百分点，假阳性比覆盖不到正文更麻烦。所以它盯的是导航、hero、卡片、页头这类首屏结构的意外改动，
正文排版的回归靠 `styleguide` 那一页兜底。

`lint:content` 检查的是「构建不会报错、但读者会看到」的问题：

- 缺 `title` / `description`、摘要过长会被列表页截断、标题跳级、图片缺 `alt` 或宽高
- 正文内链指向的文章不存在（包括指向草稿）
- 代码块没写语言、链接文字是「点这里」
- 中文排版：中英文之间缺空格、半角标点混进中文、重复标点、一段超过 420 字、行尾空格、
  连续三行空行、标题末尾带句号——**都是提醒不拦构建**，觉得是有意为之就忽略
- `public/og/<slug>.png` 缺失——**这一条是硬错误**，因为分享封面不会在 CI 里生成（runner 没有中文字体，
  渲染出来是方框）。`npm run og` 会同时写一份 `public/og/manifest.json`，改了标题却没重画也会被提醒。

`budget` 的上限写在 `scripts/budget.mjs` 顶部：CSS 104 KB / gzip 21 KB，JS 32 KB / gzip 12 KB，
单页 HTML 80 KB，主站图片 600 KB，字体 320 KB。游戏与分享封面不计入——它们不在首屏路径上。

`budget:wire` 量的是另一件事：**第一次访问实际传输了多少字节**。`budget` 看磁盘文件大小，
看不见 gzip、也看不见某页到底请求了哪几个字体分片。它用禁用缓存的浏览器逐路由统计
`encodedDataLength`，只算同源请求（评论 iframe 这类第三方不掺进来），
上限写在 `scripts/budget-wire.mjs` 顶部：首页 230 KB、文章页 265 KB、笔记页 230 KB，
字体单独一条 200 KB 的线——它占首屏七成以上，回退成整片汉字时总量未必超，代价却回去了。

`.github/workflows/quality.yml` 在每次 push 与 PR 时依次跑
`lint:content` → `fonts:check` → `check` → 构建 → `budget` → `fonts:check:pages` → `a11y` → `a11y:keys` → `budget:wire`，
任一步失败都会变红（它和部署工作流相互独立，不会拦住发布）。

工作流里的 action 都是用大版本号（`checkout@v7`、`setup-node@v7`、`deploy-pages@v5`、
`withastro/action@v6`）。`.github/dependabot.yml` 每周一查 npm：补丁与小版本合成一个 PR，
大版本单独提；GitHub Actions 本身每月查一次。

## 访问统计

默认不加载任何统计脚本。要用时改 `src/data/analytics.json`，**填完就生效，不用改代码**：

```json
// Umami Cloud 或自建
{ "provider": "umami", "src": "https://cloud.umami.is/script.js", "websiteId": "xxxxxxxx" }

// Plausible
{ "provider": "plausible", "src": "https://plausible.io/js/script.js", "domain": "cui-and-jing.github.io" }
```

`src/components/Analytics.astro` 只在配置齐全时输出一个 `defer` 脚本，`provider` 保持 `none` 时
连一个字节都不会多。两家都是无 cookie 统计，不需要同意横幅；换服务只改这一个文件。
本地 `npm run preview` 也会被计入，看数据时留意一下。

## 部署

仓库 Settings → Pages → Source 选择 **GitHub Actions**，然后推送到 `main` 即可。

当前配置为项目站点：

```js
site: 'https://cui-and-jing.github.io'
base: '/blog'
```

**如果以后绑定自定义域名**（如 `blog.example.com`），把 `astro.config.mjs` 里的 `base` 改成 `'/'`，
并在 `public/` 下加一个 `CNAME` 文件写入域名。

也可以用环境变量覆盖，不用改代码：

```bash
BLOG_SITE=https://blog.example.com BLOG_BASE=/ npm run build
```

## 待办

- [x] 站内搜索（构建时索引，客户端匹配）
- [x] 评论系统（Giscus，见上文配置）
- [x] 每篇文章单独的分享封面图（`npm run og`）
- [x] RSS 全文输出（`content:encoded`）
- [x] 阅读字号三档 + 打印样式 + 宽表格横向滚动
- [x] 正文写作组件（提示框 / 要点 / 步骤 / 折叠 / 图注）与脚注样式
- [x] 全站无障碍审计脚本 + CI 门禁
- [x] 内容体检（frontmatter / 标题层级 / 图片 / 内链 / 分享封面）接入 CI
- [x] 系列与合集（`series` + `/series/` + 文章顶部系列条）
- [x] 正文图片响应式（`astro:assets`，AVIF/WebP + srcset）
- [x] 可配置访问统计（默认关闭）
- [x] 样式按层拆分（构建后仍是单个 CSS 文件）
- [x] 写作脚手架 + 草稿本地预览 + 图片收件箱
- [x] 体积预算、发布前 preflight、sitemap lastmod
- [x] 搜索升级（正文覆盖率打分、命中上下文、搜索历史、空态建议）
- [x] 阅读体验升级（灯箱缩放拖动、阅读位置记忆、代码块折叠、段落深链接）
- [x] 视觉回归基线（21 路由 × 浅/深 × 3 视口）
- [x] 短笔记流（`/notes/` + 独立 feed + 搜索接入 + `npm run note`）
- [x] 首页置顶（`featured` 真正生效）、CI action 升级、Dependabot
- [x] 内容入口统一（标签与归档同时认文章和笔记，导航补入口）
- [x] 订阅落地页 `/subscribe/`、笔记独立页与分享卡
- [x] 作者维度（`author` 必填、署名、`/authors/`、JSON-LD Person、feed 的 `dc:creator`）
- [x] 站点标识（ico / apple-touch / 192 / 512 / webmanifest、RSS 自链接、分享图压缩、`/license/`）
- [x] 移动端信息架构（导航收进抽屉、触控目标 44×44、站名保留、底部操作条替掉压正文的浮钮）
- [x] 首屏瘦身（字体按页切增量片、实测传输预算门禁）
- [ ] 旧站文章迁移
- [ ] 访问统计（等提供 Umami / Plausible 账号后填 `src/data/analytics.json`）
