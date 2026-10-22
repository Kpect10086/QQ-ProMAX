/** Owner: QQWorld.tools(); shared operation selectors preserve each existing handler and its gates. */
import type { ToolDef } from 'cortico/core/types.ts';

export function compactQQTools(original: ToolDef[]): ToolDef[] {
  const byName = new Map(original.map(tool => [tool.name, tool]));
  const retired = new Set(['qq_confirm_send', 'qq_send_audio']);
  const merged: ToolDef[] = [];
  function combine(name: string, description: string, selector: string, variants: Record<string, string>): void {
    const entries = Object.entries(variants).map(([value, oldName]) => {
      const tool = byName.get(oldName);
      if (!tool) throw new Error(`Missing QQ tool: ${oldName}`);
      retired.add(oldName);
      return { value, tool, schema: tool.parameters as { properties?: Record<string, unknown>; required?: string[] } };
    });
    const first = entries[0].tool;
    if (entries.some(({ tool }) => JSON.stringify(tool.tags) !== JSON.stringify(first.tags)
      || tool.barrierAfter !== first.barrierAfter || tool.endsTurn !== first.endsTurn)) {
      throw new Error(`Incompatible QQ tool execution policy: ${name}`);
    }
    const properties = Object.assign({}, ...entries.map(({ schema }) => schema.properties));
    const required = (entries[0].schema.required ?? []).filter(key => entries.every(({ schema }) => schema.required?.includes(key)));
    merged.push({
      ...first, name, description,
      parameters: { type: 'object', properties: {
        [selector]: { type: 'string', enum: entries.map(entry => entry.value) }, ...properties,
      }, required: [selector, ...required], additionalProperties: false },
      handler: async (args, ctx) => {
        const entry = entries.find(entry => entry.value === args[selector]);
        if (!entry) return { failed: true, text: `${selector} 必须是 ${entries.map(entry => entry.value).join(' / ')}。` };
        const payload = Object.fromEntries(Object.entries(args).filter(([key]) => key !== selector));
        const unexpected = Object.keys(payload).find(key => !Object.hasOwn(entry.schema.properties ?? {}, key));
        if (unexpected) return { failed: true, text: `${selector}=${entry.value} 不接受 ${unexpected}。` };
        const missing = entry.schema.required?.find(key => payload[key] === undefined);
        if (missing) return { failed: true, text: `${selector}=${entry.value} 必须填写 ${missing}。` };
        return entry.tool.handler(payload, ctx);
      },
    });
  }

  combine('qq_note_read', '查询私人笔记：view=list 列出条目，view=get 按 id 读全文。保留当前笔记后端与作用域。', 'view',
    { list: 'qq_note_list', get: 'qq_note_get' });
  combine('qq_note_update', '修改私人笔记：action=save 填 text 保存，action=forget 填 id 删除。只记值得长期保留的事实，不把未确认推测写成经历。', 'action',
    { save: 'qq_note_save', forget: 'qq_note_forget' });
  combine('qq_alias_update', '修改外号对应：action=set 填 alias、qq 记住或覆盖；action=forget 填 alias 删除。映射跨重启保留，who 参数可使用这些外号。', 'action',
    { set: 'qq_alias_set', forget: 'qq_alias_forget' });
  combine('qq_reminder_update', '管理定时提醒：action=add 填 text、when 新增，action=cancel 填 id 取消。when 支持带时区 ISO、HH:MM、明天 9:00、in 30m、30分钟后等；只能设未来时间。address 默认当前会话，scope 是备注；到点自动发送。用 qq_reminder_list 查询编号。', 'action',
    { add: 'qq_reminder_add', cancel: 'qq_reminder_cancel' });
  combine('qq_affinity_read', '查询关系分：view=person 读 who 的好感度（私聊可省略 who，群聊须指定）；view=ranking 按关系分从高到低列出所有人。', 'view',
    { person: 'qq_affinity_get', ranking: 'qq_affinity_list' });
  combine('qq_history', '查询当前允许读取的 QQ 历史：mode=recent 用 group 或 peer 指定会话，minutes 为回溯分钟；mode=search 用 keyword 检索所有可读会话。关闭或名单外的会话不可读取，结果按原发送时间显示。最近消息同时报告当前发送限制；无历史不表示会话关闭。', 'mode',
    { recent: 'qq_recent', search: 'qq_search' });
  combine('qq_qzone_read', '查询 QQ 空间：view=status 返回本地发布记录、配额、限制和回评状态；view=feeds 用 num 读取实际动态，依赖协议端支持。本地记录不能代表实时空间状态。', 'view',
    { status: 'qq_qzone_status', feeds: 'qq_qzone_feeds' });
  combine('qq_admin_join_decide', '审核加群申请：flag 来自 qq_admin_join_list；decision=approve 通过，decision=reject 拒绝并可填 reason 通知申请人。保留群管理权限和自动审核开关检查。', 'decision',
    { approve: 'qq_admin_join_approve', reject: 'qq_admin_join_reject' });

  const send = byName.get('qq_send');
  const audio = byName.get('qq_send_audio');
  if (!send || !audio) throw new Error('Missing QQ send handler');
  const combinedSend: ToolDef = {
    ...send,
    description: send.description + ' 发送已合成的 WAV 附件时只填 to、audio_handle；附件必须有可验证的 TTS 合成记录，不会发起通话。',
    parameters: { ...send.parameters, properties: { ...(send.parameters.properties as Record<string, unknown>),
      audio_handle: { type: 'string', description: '已合成 WAV 的 log: 或 mem: 附件句柄。与 text、voice、images、at、reply_message_id 互斥。' },
    } },
    handler: async (args, ctx) => {
      if (!Object.hasOwn(args, 'audio_handle')) return send.handler(args, ctx);
      if (typeof args.audio_handle !== 'string' || !args.audio_handle.trim()) return { failed: true, text: 'audio_handle 必须是非空附件句柄。' };
      if (Object.keys(args).some(key => !['to', 'audio_handle'].includes(key))) return { failed: true, text: '语音附件只接受 to、audio_handle；文字或图片另发。' };
      return audio.handler({ to: args.to, handle: args.audio_handle }, ctx);
    },
  };
  return original.filter(tool => !retired.has(tool.name)).map(tool => tool.name === 'qq_send' ? combinedSend : tool).concat(merged);
}
