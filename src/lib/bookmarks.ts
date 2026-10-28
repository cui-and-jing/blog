/**
 * 本地阅读收藏，只保存公开文章的 slug，不上传，也不依赖账户。
 * 兼容存储被禁用 / 数据损坏的浏览器：当页可用，跨页持久化则按浏览器权限决定。
 */
export const BOOKMARKS_KEY = 'cui-jing:saved-posts:v1';
const LIMIT = 500;
let session: string[] = [];

function clean(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && item.length > 0 && item.length < 300
  ))].slice(0, LIMIT);
}

export function readBookmarks(): string[] {
  try {
    const stored = localStorage.getItem(BOOKMARKS_KEY);
    return stored === null ? [...session] : clean(JSON.parse(stored));
  } catch {
    return [...session];
  }
}

export function writeBookmarks(value: string[]): void {
  session = clean(value);
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(session));
  } catch {
    // 浏览器禁止本地存储时，仅在当前页面保留状态。
  }
}
