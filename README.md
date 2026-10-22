# Cui & Jing · 博客

基于 [Astro](https://astro.build) 的静态博客，Markdown / MDX 写作，零前端框架运行时。
部署在 GitHub Pages（项目站点，路径 `/blog/`）。

旧站（Hexo）仍在 `cui-and-jing.github.io`，本站是它的重写版，互不影响。

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
| date | 是 | 发布日期，`YYYY-MM-DD` |
| description | 否 | 摘要，列表页与 RSS 使用 |
| tags | 否 | 字符串数组 |
| category | 否 | 单个分类，用于归档页 |
| cover | 否 | 封面图路径（放 `public/` 下）。**不填会自动按文章名生成一张渐变封面**，不会出现空图 |
| draft | 否 | `true` 时不出现在任何列表里 |
| featured | 否 | 预留，用于首页精选 |
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
├── content.config.ts        内容集合 schema（含 series / seriesOrder）
├── content/posts/           文章（Markdown / MDX）
├── assets/                  正文配图：import 进来才会做响应式与格式转换
├── layouts/BaseLayout.astro 全站外壳：head、导航、页脚、主题切换、正文增强脚本
├── layouts/ProsePageLayout.astro  单页正文版式（排版样例页使用）
├── components/
│   ├── mdx/                 写作组件：Callout / KeyPoints / Steps / Step / Details / Figure
│   ├── Analytics.astro      访问统计（配置为空时不输出任何脚本）
│   ├── Cover.astro          封面：有图用图，无图生成渐变
│   ├── PostCard.astro       文章卡片（整卡拉伸链接，分类可单独点）
│   ├── Featured.astro       首页主推大卡
│   ├── CategoryTiles.astro  技术/学习/生活三块渐变分类卡
│   ├── RelatedPosts.astro   文末「接着读」（同分类 +3、共同标签各 +2 打分）
│   ├── Comments.astro       Giscus 评论区（懒加载 + 主题同步 + 失败兜底）
│   └── Sidebar.astro        作者卡 + 标签 + 最近更新（首页可关掉作者卡）
├── data/comments.json       Giscus 的 repoId / categoryId
├── data/series.json         系列简介（不填则用系列名与篇数自动生成）
├── data/analytics.json      统计服务配置（默认 none）
├── lib/site.ts              站点信息、导航、URL 与日期工具
├── lib/series.ts            系列归组、排序与「第 n / N 篇」
├── lib/cover.ts             封面色板与哈希
├── lib/comments.ts          评论配置读取（缺 ID 时整块不渲染）
├── lib/posts.ts             取文章：dev 含草稿，构建只取已发布
├── pages/
│   ├── index.astro          首页
│   ├── posts/               文章列表 + 详情
│   ├── series/              系列总览 + 系列详情
│   ├── archive.astro        归档（年度统计 + 月度节奏条）
│   ├── tags/                标签总览 + 单标签
│   ├── category/            分类页（每个分类一页）
│   ├── games/               游戏：大厅 + 全屏试玩外壳
│   ├── search.astro         站内搜索
│   ├── search-index.json.ts 构建时生成搜索索引
│   ├── robots.txt.ts        robots（含 sitemap 地址）
│   ├── about.astro          关于
│   ├── styleguide.mdx       排版样例（noindex，给自己查的）
│   ├── rss.xml.js           RSS
│   └── 404.astro
├── styles/
│   ├── global.css           样式入口，只按顺序 @import，不写规则
│   ├── tokens.css           颜色 / 字号 / 间距 / 圆角 / 阴影
│   ├── base.css             重置与焦点样式
│   ├── layout.css           外壳、页头、首屏、分类块
│   ├── components.css       封面、卡片、侧栏、作者卡
│   ├── article.css          文章页与正文排版
│   ├── pages.css            评论、归档、系列、标签、关于、页脚、404
│   ├── responsive.css       断点覆盖（要排在它覆盖的规则之后）
│   ├── games.css / motion.css / search.css
│   ├── enhance.css          代码块附加件、灯箱、移动端目录
│   ├── prose-extras.css     提示框、要点、步骤、图注、脚注、表格
│   └── print.css            打印稿
├── scripts/
│   ├── new-post.mjs         新建文章骨架（npm run new）
│   ├── image-inbox.mjs      配图归位 + 生成 Figure 片段（npm run image）
│   ├── og-cards.mjs         生成每篇文章的分享封面（npm run og）
│   ├── lint-content.mjs     内容体检（npm run lint:content）
│   ├── budget.mjs           产物体积预算（npm run budget）
│   ├── a11y-audit.mjs       axe 全站扫描（npm run a11y）
│   ├── a11y-keyboard.mjs    键盘与读屏实测（npm run a11y:keys）
│   ├── visual-regression.mjs 视觉回归（npm run visual / visual:update）
│   └── preflight.mjs        发布前一键跑完全部检查（npm run preflight）
├── tests/visual/
│   ├── baseline/            视觉基线，90 张 JPEG，需随样式改动一起提交
│   └── meta.json            基线生成环境（platform + 浏览器版本）
└── public/
    ├── og.png               默认分享图（1200×630）
    ├── og/                  每篇文章的分享封面 + manifest.json（供内容体检比对）
    └── games/               游戏单文件（构建时原样拷贝，不进打包）
```

样式拆成了多个文件，但 `global.css` 只负责 `@import`，构建时 Vite 会把它们并回一个 CSS 文件，
运行时不会多出请求。**顺序就是层叠顺序**，`responsive.css` 必须排在它要覆盖的规则之后。

## 游戏模块

游戏大厅在 `/games/`，试玩在 `/games/beanrush/`（细栏 + iframe 铺满视口，支持全屏）。
游戏本体是一个自包含 HTML（Three.js 内联，无 CDN、无后端），放在 `public/games/beanrush.html`，
构建时原样拷进 `dist/games/`。

要加新游戏：把单文件丢进 `public/games/`，在 `src/lib/site.ts` 的 `GAMES` 里加一条
（标题、描述、标签、`file` 路径），大厅页会自动渲染。试玩页目前按 `beanrush` 单独一个路由，
新游戏可以复用同样的外壳或直接链接到 HTML。

游戏用 `bean-rush.*` 前缀写 localStorage，和博客的 `theme` 键不冲突。

## 搜索

`/search/` 是纯客户端搜索，不需要后端或第三方服务：

- 构建时 `src/pages/search-index.json.ts` 把每篇文章压成纯文本，输出 `/search-index.json`（含标题、
  摘要、标签、分类、日期、链接与正文）。
- 页面按 标题 > 标签 > 分类 > 摘要 > 正文 加权打分，命中处高亮，并显示命中那句话的上下文。
- 多个关键词按**覆盖率**打分而不是 AND：`Astro 图片` 里只提了 Astro 的文章仍会出现，只是排在
  两个词都命中的后面。全是「的」「了」这类虚词时按空查询处理，不会返回零结果。
- 支持 `↑` `↓` 选择、`Enter` 打开（没选时直接开第一条）、`Esc` 清空；顶栏搜索图标、
  `Ctrl / ⌘ + K`、`/` 都能进入搜索。
- 最近 6 条搜索记在 `localStorage`，回车或点结果时写入，可一键清空；无结果时给出最近文章与热门标签。
- 索引很小（当前 3 篇文章约 3 KB），文章多了以后仍然是一次请求；如果将来上千篇，可以换 Pagefind。

## 阅读体验

- 文章标题下方有「字号」三档（`A−` / `A` / `A+`），选中后写进 `localStorage`，全站文章通用。
  首帧之前就在 `<head>` 内联脚本里落好 `data-reading`，不会先按标准字号闪一下再变。
- 宽表格在窄屏不再挤压正文，改为在 `.table-wrap` 里横向滚动，并在可滚动时补一道边缘阴影。
- 文章页右侧目录跟随滚动高亮；侧栏内容超出一屏时，当前条目会自动滚进可视区。
- 宽度 ≤1080px 时出现左下角「目录」按钮，点开是底部抽屉（原生 `<dialog>`，Esc 可关）。
- 代码块自动显示语言标签和复制按钮（触屏设备上按钮常显）；超过 24 行自动折叠，
  按钮写着总行数，打印时自动摊开。
- 正文图片可点击放大：滚轮 / `+` `-` 缩放（1×–4×，以指针为中心）、放大后拖动平移、
  双击或 `0` 复位、右上角可开原图；图片统一 `loading="lazy"`。
- 鼠标停在段落上，左侧出现 `#`，点击复制「引用文字 + 文章标题 + 锚点链接」；
  选中半句就只引半句。窄屏没有左侧余量，这个入口会隐藏。
- 读到一半关掉，下次回来会看到「上次读到 xx% · 继续」浮条；滚到底自动清记录。
- 配图放在 `src/assets/` 并通过 `<Figure>` 导入时，会自动生成 AVIF/WebP 与四档 `srcset`，
  图片实际只按正文宽度下载（一张 1200px 截图从 209 KB 降到 20 KB 左右）。
- 文章页有阅读进度条，滚动超过 700px 出现「回到顶部」。
- 打印或「存为 PDF」时自动摘掉导航、侧栏、目录、评论、分享条与推荐，封面不打印，
  代码块转浅色并允许换行，外链地址以括号形式印在正文后（`@media print`）。

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

## 分享与 SEO

- 每页输出 `WebSite` 结构化数据；文章页额外输出 `BlogPosting` 与 `BreadcrumbList`。
- 每篇文章有自己的分享封面 `public/og/<slug>.png`（1200×630，纸感底 + 文章配色卡叠 +
  标题/摘要/标签），由 `npm run og` 生成；`cover` 字段优先，没生成过则退回 `public/og.png`。
- 文末有分享条：复制链接（带降级）、微博、以及手机上可用的系统分享。
- `rss.xml` 输出**全文**（`content:encoded`）而不只是摘要，订阅器里能直接读完；
  正文里的 `/blog/...` 与 `#锚点` 会补成绝对地址，避免在阅读器里点不开。
- `robots.txt` 由 `src/pages/robots.txt.ts` 生成，自动带上 sitemap 地址；
  404 页带 `noindex`，搜索页不进 sitemap（纯客户端工具，没有独立内容）。
- sitemap 带 `lastmod`：文章取 `updated`（没写就取 `date`），首页 / 归档 / 标签页 / 分类页 / 系列页
  取该页涉及文章里最新的一天。没有日期的静态页不写，不拿构建时间凑数。
- 页头有「跳到正文」链接，键盘 Tab 第一下就能用。

### 分享封面怎么生成

```bash
npm run og
```

需要本机装 Chrome 或 Edge（脚本用 `puppeteer-core`，可用 `CHROME_PATH` 指定路径）。
**新文章写完、改了标题后跑一次**，把 `public/og/*.png` 一起提交——图是构建产物之外的静态文件，
CI 不生成（GitHub Actions 里没有中文字体，渲染会变成方框）。

配色复用了 `src/lib/cover.ts` 的色板，所以分享图和列表里的渐变封面是同一套颜色；
背面两张卡固定用品牌色（陶土 / 墨绿）打底，正面撞色时会自动换成深蓝。


## 设计

卡片式布局：纸感暖灰底 + 白卡 + 18px 圆角 + 双层阴影，首页为主推大卡 + 双列网格 + 右侧粘性侧栏。
配色索引在 `--accent`（陶土 #b4431f）与 `--accent-2`（墨绿 #2f6f66），封面色板在 `src/lib/cover.ts`。
深色模式跟随系统并可手动切换，切换无闪烁。

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
改配色改 `src/styles/global.css` 顶部的 `:root` 与 `[data-theme='dark']` 变量。

## 质量检查

```bash
npm run lint:content  # 不需要构建：frontmatter、标题层级、图片、内链、中文排版、分享封面
npm run check         # astro check：类型与模板
npm run budget        # 需要 dist：CSS / JS / 单页 HTML / 图片四类上限
npm run a11y          # 需要先 build + preview：axe-core 扫全站 17 条路由 × 浅/深两套主题
npm run a11y:keys     # 需要先 build + preview：Tab 顺序、焦点环、复制播报、字号、Esc、移动端目录
npm run visual        # 需要先 build + preview：15 条路由 × 浅/深 × 3 视口，和基线逐像素比
npm run visual:update # 样式改动确认无误后重建基线
npm run preflight     # 一条命令串起：og → lint → check → 构建 → budget → a11y → a11y:keys
```

`preflight` 会自己起 `astro preview` 并在结束时收掉，任何一步失败就停；`--ci` 跳过分享封面
（CI 没有中文字体，渲染出来是方框），`--skip-build` 复用现有 `dist` 只跑检查，
`--visual` 额外跑一遍视觉回归（比全站截图慢，改过样式时用）。

`visual` 的基线在 `tests/visual/baseline/`（90 张 JPEG，约 3.8 MB），元信息记在
`tests/visual/meta.json`，包含生成时的 `platform` 与浏览器版本。**换机器或换浏览器后会直接跳过比对**
——字体栅格化不同会让所有页面都"失败"，那种红叉没有信息量，在本机跑一次 `--update` 重建即可。
3D 游戏页用 canvas 实时渲染，逐帧不同，不在比对范围内。

`lint:content` 检查的是「构建不会报错、但读者会看到」的问题：

- 缺 `title` / `description`、摘要过长会被列表页截断、标题跳级、图片缺 `alt` 或宽高
- 正文内链指向的文章不存在（包括指向草稿）
- 代码块没写语言、链接文字是「点这里」
- 中文排版：中英文之间缺空格、半角标点混进中文、重复标点、一段超过 420 字、行尾空格、
  连续三行空行、标题末尾带句号——**都是提醒不拦构建**，觉得是有意为之就忽略
- `public/og/<slug>.png` 缺失——**这一条是硬错误**，因为分享封面不会在 CI 里生成（runner 没有中文字体，
  渲染出来是方框）。`npm run og` 会同时写一份 `public/og/manifest.json`，改了标题却没重画也会被提醒。

`budget` 的上限写在 `scripts/budget.mjs` 顶部：CSS 90 KB / gzip 18 KB，JS 32 KB / gzip 12 KB，
单页 HTML 80 KB，主站图片 600 KB。游戏与分享封面不计入——它们不在首屏路径上。

`.github/workflows/quality.yml` 在每次 push 与 PR 时依次跑
`lint:content` → `check` → 构建 → `budget` → `a11y` → `a11y:keys`，任一步失败都会变红
（它和部署工作流相互独立，不会拦住发布）。

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
- [x] 视觉回归基线（15 路由 × 浅/深 × 3 视口）
- [ ] 旧站文章迁移
