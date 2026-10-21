# Cui & Jing · 博客

基于 [Astro](https://astro.build) 的静态博客，纯 Markdown 写作，零前端框架运行时。
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

在 `src/content/posts/` 下新建 `.md` 文件，文件名即 URL（`hello-astro.md` → `/posts/hello-astro/`）。

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

### 封面是怎么来的

没配 `cover` 时，`src/lib/cover.ts` 用文章 slug 算出一个稳定哈希，从 8 组预置色板里挑一组，
再配一张抽象的 SVG 图形和一个大字水印。同一篇文章的封面永远一致，不同文章之间会自动错开色相，
不依赖任何外链图床——旧站用 `picsum.photos` 随机图，同一篇刷新还会换图，这里不会。

想换成真实图片，把图放进 `public/covers/`，frontmatter 写 `cover: /covers/xxx.jpg` 即可，
卡片和文章页会自动改用图片并保留遮罩，保证标题可读。

写完提交推送，GitHub Actions 会自动构建部署。

## 目录结构

```
src/
├── content.config.ts        内容集合 schema
├── content/posts/           文章（Markdown / MDX）
├── layouts/BaseLayout.astro 全站外壳：head、导航、页脚、主题切换
├── components/
│   ├── Cover.astro          封面：有图用图，无图生成渐变
│   ├── PostCard.astro       文章卡片（整卡拉伸链接，分类可单独点）
│   ├── Featured.astro       首页主推大卡
│   ├── CategoryTiles.astro  技术/学习/生活三块渐变分类卡
│   └── Sidebar.astro        作者卡 + 标签 + 最近更新（首页可关掉作者卡）
├── lib/site.ts              站点信息、导航、URL 与日期工具
├── lib/cover.ts             封面色板与哈希
├── pages/
│   ├── index.astro          首页
│   ├── posts/               文章列表 + 详情
│   ├── archive.astro        归档
│   ├── tags/                标签总览 + 单标签
│   ├── category/            分类页（每个分类一页）
│   ├── games/               游戏：大厅 + 全屏试玩外壳
│   ├── search.astro         站内搜索
│   ├── search-index.json.ts 构建时生成搜索索引
│   ├── robots.txt.ts        robots（含 sitemap 地址）
│   ├── about.astro          关于
│   ├── rss.xml.js           RSS
│   └── 404.astro
├── styles/global.css        全站样式（设计变量在文件顶部）
└── public/
    ├── og.png               默认分享图（1200×630）
    └── games/               游戏单文件（构建时原样拷贝，不进打包）
```

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
- 页面按 标题 > 标签 > 分类 > 摘要 > 正文 加权打分，多个关键词按 AND 组合，命中处高亮。
- 支持 `↑` `↓` 选择、`Enter` 打开、`Esc` 清空；顶栏搜索图标、`Ctrl / ⌘ + K`、`/` 都能进入搜索。
- 索引很小（当前 3 篇文章约 3 KB），文章多了以后仍然是一次请求；如果将来上千篇，可以换 Pagefind。

## 阅读体验

- 文章页右侧目录跟随滚动高亮；侧栏内容超出一屏时，当前条目会自动滚进可视区。
- 宽度 ≤1080px 时出现左下角「目录」按钮，点开是底部抽屉（原生 `<dialog>`，Esc 可关）。
- 代码块自动显示语言标签和复制按钮（触屏设备上按钮常显）。
- 正文图片可点击放大，支持 `←` `→` 切换、`Esc` 关闭；图片未加载时不影响正文。
- 文章页有阅读进度条，滚动超过 700px 出现「回到顶部」。

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
- 默认分享图 `public/og.png`（1200×630），文章可被 `cover` 覆盖；同时输出 `og:*` 与
  `twitter:summary_large_image`。
- `robots.txt` 由 `src/pages/robots.txt.ts` 生成，自动带上 sitemap 地址。
- 页头有「跳到正文」链接，键盘 Tab 第一下就能用。

## 设计

卡片式布局：纸感暖灰底 + 白卡 + 18px 圆角 + 双层阴影，首页为主推大卡 + 双列网格 + 右侧粘性侧栏。
配色索引在 `--accent`（陶土 #bf4a26）与 `--accent-2`（墨绿 #2f6f66），封面色板在 `src/lib/cover.ts`。
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
- [ ] 旧站文章迁移
- [ ] 每篇文章单独的分享封面图（目前统一用 `public/og.png`）
- [ ] 文章内图片压缩与响应式尺寸（`astro:assets`）
