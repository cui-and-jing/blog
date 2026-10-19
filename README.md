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
| draft | 否 | `true` 时不出现在任何列表里 |
| featured | 否 | 预留，用于首页精选 |
| updated | 否 | 更新日期 |

写完提交推送，GitHub Actions 会自动构建部署。

## 目录结构

```
src/
├── content.config.ts        内容集合 schema
├── content/posts/           文章（Markdown / MDX）
├── layouts/BaseLayout.astro 全站外壳：head、导航、页脚、主题切换
├── components/Entry.astro   列表项
├── lib/site.ts              站点信息、导航、URL 与日期工具
├── pages/
│   ├── index.astro          首页
│   ├── posts/               文章列表 + 详情
│   ├── archive.astro        归档
│   ├── tags/                标签总览 + 单标签
│   ├── about.astro          关于
│   ├── rss.xml.js           RSS
│   └── 404.astro
└── styles/global.css        全站样式（设计变量在文件顶部）
```

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

- [ ] 评论系统（Twikoo 重新部署，或换 Giscus）
- [ ] 站内搜索（Pagefind）
- [ ] 旧站文章迁移
- [ ] 每篇文章的分享封面图
