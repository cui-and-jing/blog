import { getCollection } from 'astro:content';
import type { CollectionEntry } from 'astro:content';
import { showDrafts } from './posts';
import { plainNote, titleFromText } from './note-text';

export type Note = CollectionEntry<'notes'>;

/** 正文纯文本，供搜索索引、列表摘参与分享封面使用 */
export const noteText = (note: Note): string => plainNote(note.body ?? '');

/** 锚点名：文件名去掉扩展名，非字母数字一律换成横线 */
export const noteAnchor = (note: Note): string => `n-${note.id.replace(/[^\w-]+/g, '-')}`;

/** 笔记没有标题字段，取正文第一句当标题 */
export const noteTitle = (note: Note, limit = 40): string => titleFromText(noteText(note), limit);

/**
 * 列表里的摘要。
 * 标题本来就是正文第一句，摘要从第一句之后开始，否则同一行会念两遍。
 * 这里用**完整**第一句来切断，不能用截断后的标题——标题超过 40 字时，
 * 摘要会从截断处接上，把那半句重复一遍。
 */
export function noteExcerpt(note: Note, limit = 90): string {
  const text = noteText(note);
  const match = text.match(/^[^。！？!?]{1,120}[。！？!?]/);
  const first = match ? match[0].replace(/[。！？!?]$/, '') : '';
  const rest = first && text.startsWith(first) ? text.slice(first.length) : text;
  return rest.replace(/^[。！？!?，、\s]+/, '').slice(0, limit);
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
