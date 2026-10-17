import { nowIso, shortTime } from 'cortico/core/util.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { faceName, faceIdByName } from './qface-map.ts';
import type { OneBotSegment } from './types.ts';

/** 把 OneBot 消息段数组渲染为对模型友好的纯文本（含引用/表情/@ 标注）。 */
export function renderIncoming(
  segments: OneBotSegment[] | string | undefined,
  ctx: { timezone: string; selfId: number; replyText?: string; replyRef?: string },
): string {
  if (typeof segments === 'string') return segments;
  if (!segments || !Array.isArray(segments)) return '';
  const out: string[] = [];
  if (ctx.replyText && ctx.replyRef) {
    out.push(`「引用 ${ctx.replyRef}${ctx.replyText ? '：' + ctx.replyText : ''}」`);
  }
  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        out.push(seg.data.text ?? '');
        break;
      case 'at':
        out.push(formatMention(seg.data.qq, seg.data.name, ctx.selfId));
        break;
      case 'face':
        out.push(`[表情${seg.data.id}：${faceName(Number(seg.data.id))}]`);
        break;
      case 'image':
        out.push(seg.data.summary ? `[图片：${seg.data.summary}]` : '[图片]');
        break;
      case 'record':
        out.push('[语音]');
        break;
      case 'video':
        out.push('[视频]');
        break;
      case 'file':
        out.push(`[文件：${seg.data.name ?? seg.data.file}]`);
        break;
      case 'forward':
        out.push('[合并转发消息]');
        break;
      case 'json':
      case 'xml': {
        const card = parseJsonCard(seg.data.data);
        out.push(card ? `[卡片：${card}]` : '[卡片]');
        break;
      }
      default:
        out.push(`[${seg.type}]`);
    }
  }
  return out.join('').trim();
}

function formatMention(qq: string, name: string | undefined, selfId: number): string {
  const id = Number(qq);
  if (id === selfId) return '@我';
  return name ? `@${name}` : `@${qq}`;
}

/** 纯文本形态（无引用），用于历史/搜索展示。 */
export function renderSegmentsPlain(segments: OneBotSegment[] | string | undefined): string {
  if (typeof segments === 'string') return segments;
  if (!segments || !Array.isArray(segments)) return '';
  return segments
    .map((seg) => {
      switch (seg.type) {
        case 'text':
          return seg.data.text ?? '';
        case 'at':
          return `@${seg.data.name ?? seg.data.qq}`;
        case 'face':
          return `[表情${seg.data.id}]`;
        case 'image':
          return '[图片]';
        case 'record':
          return '[语音]';
        case 'video':
          return '[视频]';
        case 'file':
          return `[文件:${seg.data.name ?? ''}]`;
        case 'forward':
          return '[合并转发]';
        default:
          return `[${seg.type}]`;
      }
    })
    .join('');
}

/**
 * 把待发送文本构建为 OneBot 发送段（对齐 fat-fish parse_reply_segments）：
 *   - [表情包:文件名] → image 段（本地文件，位于 emojiDir 下；文件缺失则丢弃，不报错）
 *   - [表情N] / [表情N:名称] → face 段
 *   - [中文表情名]（命中映射，如 [旺柴]/[笑哭]）→ face 段
 *   - @名字 / @QQ号 → at 段
 *   - 其它 [..] → 普通文本（保留方括号原样）
 * emojiDir 为空时不解析表情包标记。
 */
export function buildOutgoing(text: string, emojiDir = ''): OneBotSegment[] {
  const segments: OneBotSegment[] = [];
  const re = /\[([^\[\]]{1,40})\]|@([^\s@]{1,30})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', data: { text: text.slice(last, m.index) } });
    if (m[1] !== undefined) {
      const inner = m[1];
      const whole = m[0];
      if (inner.startsWith('表情包:')) {
        const fname = inner.slice('表情包:'.length).trim();
        if (emojiDir && fname) {
          const p = join(emojiDir, fname);
          if (existsSync(p)) segments.push({ type: 'image', data: { file: p } });
        }
        // 目录未配置或文件缺失：丢弃该标记
      } else if (/^表情\s*\d+(?:[:：][^\]]*)?$/.test(inner)) {
        const id = inner.match(/^表情\s*(\d+)/)![1];
        segments.push({ type: 'face', data: { id: Number(id) } });
      } else {
        const fid = faceIdByName(inner);
        if (fid !== null) segments.push({ type: 'face', data: { id: fid } });
        else segments.push({ type: 'text', data: { text: whole } });
      }
    } else if (m[2] !== undefined) {
      segments.push({ type: 'at', data: { qq: m[2], name: /^(\d{5,})$/.test(m[2]) ? undefined : m[2] } });
    }
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', data: { text: text.slice(last) } });
  if (segments.length === 0) segments.push({ type: 'text', data: { text } });
  return segments;
}

export interface SplitReplyOptions {
  /** 是否按句拆分（false 则整段作为一条）。 */
  splitBySentence: boolean;
  /** 每条消息最多容纳句数。 */
  sentencesPerMessage: number;
  /** 单条消息字节上限，超过则对文字再按字节硬切。 */
  maxBytes: number;
  maxMessages?: number;
}

/**
 * 把构建好的发送段拆成多条消息（对齐 fat-fish split_text_segments_by_sentence
 * + split_text_and_images）：文字按句标点拆分，face 跟随最后一条，image 独立成条；
 * 单条仍超 maxBytes 时再按字节硬切。splitBySentence=false 则整体一条。
 */
export function splitReplyIntoMessages(segments: OneBotSegment[], opts: SplitReplyOptions): OneBotSegment[][] {
  const images = segments.filter((s) => s.type === 'image');
  const textParts = segments.filter((s) => s.type !== 'image');
  const groups: OneBotSegment[][] = [];

  if (textParts.length) {
    if (!opts.splitBySentence) {
      groups.push(textParts);
    } else {
      const fullText = textParts
        .filter((s) => s.type === 'text')
        .map((s) => (s.data as { text?: string }).text ?? '')
        .join('');
      const faces = textParts.filter((s) => s.type === 'face');
      const sentences = fullText
        .split(/(?<=[。！？!?；;])/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length <= 1) {
        groups.push(textParts);
      } else {
        for (let i = 0; i < sentences.length; i += opts.sentencesPerMessage) {
          const chunk = sentences.slice(i, i + opts.sentencesPerMessage).join('');
          if (opts.maxBytes > 0 && Buffer.byteLength(chunk, 'utf8') > opts.maxBytes) {
            for (const sub of splitLongText(chunk, opts.maxBytes)) {
              groups.push([{ type: 'text', data: { text: sub } }]);
            }
          } else {
            groups.push([{ type: 'text', data: { text: chunk } }]);
          }
        }
        if (faces.length && groups.length) groups[groups.length - 1].push(...faces);
      }
    }
  }
  for (const img of images) groups.push([img]);
  if (opts.maxMessages != null && groups.length > opts.maxMessages) {
    const packed: OneBotSegment[][] = [];
    let bytes = 0;
    for (const group of groups) {
      const size = group.reduce((n,s) => n + (s.type === 'text' ? Buffer.byteLength(String(s.data.text ?? ''),'utf8') : 0),0);
      if (opts.maxBytes > 0 && size > opts.maxBytes) throw new Error('私聊回复过长，请精简正文后重发；本次未发送。');
      if (!packed.length || (opts.maxBytes > 0 && bytes + size > opts.maxBytes)) {packed.push([]);bytes = 0;}
      packed[packed.length - 1].push(...group);bytes += size;
    }
    if (packed.length > opts.maxMessages) throw new Error('私聊回复超过剩余消息条数，请精简正文后重发；本次未发送。');
    return packed;
  }
  return groups.length ? groups : [[{ type: 'text', data: { text: '' } }]];
}

/** 把 [表情N] 标记展开成可读名称（用于 env/正文展示）。 */
export function renderTextWithFaces(text: string): string {
  return text.replace(/\[表情(\d+)(?::[^\]]*)?\]/g, (_m, id) => `[表情${id}：${faceName(Number(id))}]`);
}

/** 把长文本按字节数切分为多条（fat-fish split_for_sending 思路）。 */
export function splitLongText(text: string, maxBytes: number): string[] {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const curBytes = Buffer.byteLength(cur, 'utf8');
    if (lineBytes > maxBytes) {
      // 单行长于上限：硬切
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      let rest = line;
      while (Buffer.byteLength(rest, 'utf8') > maxBytes) {
        let cut = maxBytes;
        while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > maxBytes) cut -= 8;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
      continue;
    }
    if (curBytes + lineBytes + 1 > maxBytes && cur) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 解析 OneBot json 卡片描述（minimax / 掘地求生 / 红石等小游戏卡片）。 */
export function parseJsonCard(data: string | undefined): string | null {
  if (!data) return null;
  try {
    const card = JSON.parse(data);
    const prompt = card?.meta?.detail_1?.text ?? card?.prompt;
    if (typeof prompt === 'string' && prompt.trim()) return prompt.trim().slice(0, 200);
    if (Array.isArray(card?.app) === false && typeof card?.text === 'string') return card.text.slice(0, 200);
  } catch {
    /* 非 JSON，忽略 */
  }
  return null;
}

/** 事件行时间戳前缀。 */
export function eventClock(timezone: string, d: Date = new Date()): string {
  return shortTime(timezone, d);
}

export function eventTs(timezone: string, d: Date = new Date()): string {
  return nowIso(timezone, d);
}
