import config from '../data/comments.json';

/**
 * Giscus（基于 GitHub Discussions）的站点配置。
 *
 * repoId / categoryId 由 `npm run comments:setup` 自动写入，
 * 两个值都是公开信息，提交进仓库没有问题。
 * 只要有一个为空，评论区就整体不渲染——宁可不显示，也不要线上留一个坏掉的框。
 */
export const COMMENTS = {
  repo: config.repo,
  repoId: config.repoId,
  category: config.category,
  categoryId: config.categoryId,
  /** 两个 ID 齐了才算接通 */
  enabled: Boolean(config.repoId && config.categoryId),
  /** 以 pathname 为键：文章改标题不影响已有讨论 */
  mapping: 'pathname',
  lang: 'zh-CN',
  /**
   * 深色用 transparent_dark 而不是 dark：
   * 让 giscus 透出本站的暖色卡片背景，不至于在页面里嵌一块冷蓝的 GitHub 面板。
   */
  themes: { light: 'light', dark: 'transparent_dark' },
} as const;

export const commentsThreadUrl = `https://github.com/${config.repo}/discussions`;
