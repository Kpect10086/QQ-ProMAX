import type { ToolDef, WorldHost } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';

export interface HistoryCtx {
  getHost: () => WorldHost | null;
  sourceId: string;
  timezone: string;
  convLabel: (address: string) => string;
  canRead: (address: string) => boolean;
  sendBlock: (address: string) => string | null;
}

/** 群聊历史查询工具（Cortico 内置 world 的可增量特性）。 */
export function makeHistoryTools(ctx: HistoryCtx): ToolDef[] {
  return [
    {
      name: 'qq_recent',
      tags: ['read'],
      description:
        '查询监听名单内且回复开关开启的群或私聊最近消息及当前发送限制（按原发送时间显示）。没有历史消息不代表私聊关闭；读取开放时可按发送限制使用 qq_send 联系。关闭的会话不可读取，等待用户重新开启。参数 group 为群号；查私聊时改用 peer。',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'number', description: '群号；与 peer 二选一。' },
          peer: { type: 'number', description: '私聊对方 QQ；与 group 二选一。' },
          minutes: { type: 'number', description: '回溯时间窗（分钟），默认 60。' },
          limit: { type: 'number', description: '最多返回条数，默认 30。' },
        },
        required: [],
      },
      handler: async (args) => {
        const host = ctx.getHost();
        if (!host) return '历史存储尚未就绪。';
        const group = typeof args.group === 'number' ? args.group : Number(args.group ?? 0);
        const peer = typeof args.peer === 'number' ? args.peer : Number(args.peer ?? 0);
        const address = group ? `group:${group}` : peer ? `private:${peer}` : '';
        if (!address) return '请提供 group 或 peer。';
        if (!ctx.canRead(address)) return '该会话未开放读取（回复开关关闭或不在监听名单）。';
        const limit = Math.min(Number(args.limit ?? 30), 100);
        const minutes = Number(args.minutes ?? 60);
        const fromTs = new Date(Date.now() - minutes * 60_000).toISOString();
        const events = host.store
          .range({ source: ctx.sourceId, senderKey: address, fromTs, limit: limit * 4 })
          .filter((e) => e.type === 'qq.message' && e.contextDelivery !== 'archive-only' && ctx.canRead(e.senderKey ?? '')
            && Date.parse(String(e.meta?.sourceTs ?? e.ts)) >= Date.parse(fromTs))
          .slice(-limit)
          .reverse();
        const status = `会话 ${address} 读取已开放；当前发送限制：${ctx.sendBlock(address) ?? '允许发送'}。`;
        if (!events.length) return `${status}\n${ctx.convLabel(address)} 在最近 ${minutes} 分钟内没有消息记录；这不代表会话关闭。需要联系时使用 qq_send(to="${address}", text=正文)，仍须遵守当前发送限制。`;
        const label = ctx.convLabel(address);
        const lines = events.map(
          (e) => `[${shortTime(ctx.timezone, new Date(String(e.meta?.sourceTs ?? e.ts)))}] ${e.senderKey ?? ''} ${e.text}`,
        );
        return `${status}\n${label} 最近消息：\n${lines.join('\n')}`;
      },
    },
    {
      name: 'qq_search',
      tags: ['read'],
      description: '在当前允许读取的 QQ 会话中按关键词检索历史消息，返回匹配片段及上下文。回复开关关闭或名单外的会话不会返回。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '不区分大小写的包含匹配关键词。' },
          limit: { type: 'number', description: '最多返回的命中组数，默认 10。' },
        },
        required: ['keyword'],
      },
      handler: async (args) => {
        const host = ctx.getHost();
        if (!host) return '历史存储尚未就绪。';
        const keyword = String(args.keyword ?? '').trim();
        if (!keyword) return '请提供 keyword。';
        const limit = Math.min(Number(args.limit ?? 10), 30);
        const hits = host.store.grep({ keyword, source: ctx.sourceId, limit:100, context: 1 })
          .filter(h => h.events.some(e => e.cursor === h.hitCursor && e.contextDelivery !== 'archive-only' && ctx.canRead(e.senderKey ?? '')))
          .map(h => ({...h,events:h.events.filter(e => e.contextDelivery !== 'archive-only' && ctx.canRead(e.senderKey ?? ''))})).slice(0,limit);
        if (!hits.length) return `没有找到包含「${keyword}」的 QQ 消息。`;
        const blocks = hits.map((h) => {
          const lines = h.events.map((e) => `[${shortTime(ctx.timezone, new Date(String(e.meta?.sourceTs ?? e.ts)))}] ${e.senderKey ?? ''} ${e.text}`);
          return lines.join('\n');
        });
        return `检索「${keyword}」命中 ${hits.length} 处：\n\n${blocks.join('\n\n')}`;
      },
    },
  ];
}
