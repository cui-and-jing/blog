import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { showDrafts } from './posts';

export type Note = CollectionEntry<'notes'>;

/** 把 Markdown 压成一行纯文本，用来推导标题、摘要与搜索结果 */
function plain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~`|=\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 正文纯文本，供搜索索引与列表摘要使用 */
export const noteText = (note: Note): string => plain(note.body ?? '');

/** 锚点名：文件名去掉扩展名，非字母数字一律换成横线 */
export const noteAnchor = (note: Note): string => `n-${note.id.replace(/[^\w-]+/g, '-')}`;

/**
 * 笔记没有标题字段，取正文第一句当标题。
 * 遇到句号/问号/感叹号就断，太长再硬截，最后补省略号。
 */
export function noteTitle(note: Note, limit = 40): string {
  const text = noteText(note);
  if (!text) return '无标题';
  const match = text.match(/^[^。！？!?]{1,120}[。！？!?]/);
  const first = match ? match[0] : text;
  const body = first.replace(/[。！？!?]$/, '');
  return body.length > limit ? `${body.slice(0, limit)}…` : body;
}

/**
 * 全部笔记，按时间倒序。
 * 同一天先写的排前面（文件名里带时分，id 的字典序正好等于时间序）。
 */
export async function getNotes(): Promise<Note[]> {
  const notes = await getCollection('notes', ({ data }) => showDrafts || !data.draft);
  return notes.sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf() || b.id.localeCompare(a.id)
  );
}
