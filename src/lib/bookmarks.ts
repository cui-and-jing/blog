/**
 * 本地阅读收藏，只保存公开文章的 slug，不上传，也不依赖账户。
 * 兼容保存被禁用 / 数据损坏的浏览器：当页可用，跨页持久化则按浏览器权限决定。
 */
export const BOOKMARKS_KEY = 'cui-jing:saved-posts:v1';
const LIMIT = 500;
let session: string[] | null = null;

function clean(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string =>
    typeof item === 'string' && item.length > 0 && item.length < 300
  ))].slice(0, LIMIT);
}

export function readBookmarks(refresh = false): string[] {
  // A storage event from another tab supersedes this page's unsaved snapshot.
  if (refresh) session = null;
  /* Readable old storage must not undo a click when writes are rejected.
     An empty array is also a pending change: the last bookmark was removed. */
  try {
    return session ?? clean(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

export function writeBookmarks(value: string[]): void {
  session = clean(value);
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(session));
    // Successful storage writes need no session fallback: a missing key then means it was removed.
    session = null;
  } catch {
    // 浏览器禁止本地保存时，只在当前页面保留状态。
  }
}
