import type { DescribeText, EventDescribe } from 'cortico/core/types.ts';
import type { WorldDefinition } from 'cortico/world.ts';
import { QQWorld } from './world.ts';
import { qqDefaults, qqTimezoneOptions, type QQConfigSection } from './config.ts';

/** 每个工具一句给人看的话;市场与扩展页按界面语言取。 */
const TOOL_SUMMARIES: Record<string, DescribeText> = {
  qq_admin: {zh:'执行一项受权限保护的群管理操作。',en:'Run one authorized group administration action.'},
  qq_note_read: { zh: "查询私人笔记列表或条目。", en: "Read notebook entries or one entry." },
  qq_note_update: { zh: "保存或删除私人笔记。", en: "Save or forget a notebook entry." },
  qq_alias_update: { zh: "设置或删除外号对应。", en: "Set or forget a nickname mapping." },
  qq_reminder_update: { zh: "新增或取消定时提醒。", en: "Add or cancel a reminder." },
  qq_history: { zh: "查看最近消息或检索可读历史。", en: "Read recent messages or search permitted history." },
  qq_send: {
    zh: '回复 QQ 消息的唯一渠道:往群或私聊发一条消息,可引用回复、@人。',
    en: 'The only way to answer a QQ message: send one to a group or private chat, with quoting and mentions.',
  },
  qq_view_image: {
    zh: '主动重看一张刚收到的 QQ 图片,取回它的文字描述。',
    en: 'Take another look at a received QQ picture and get its description.',
  },
  qq_sticker_stats: {
    zh: '查看已收藏表情包的统计与真实文件名,发图前先取文件名。',
    en: 'List collected stickers with their real filenames, needed before replying with one.',
  },
  qq_proactive_status: {
    zh: '查看主动说话调度器的状态、今日配额与近期主动发言。',
    en: 'Show the proactive-speaking scheduler state, daily quota and recent unsolicited messages.',
  },
  qq_poke: {
    zh: '戳一戳某个人(群内或私聊)。',
    en: 'Poke someone, in a group or privately.',
  },
  qq_reminder_list: {
    zh: '列出所有未触发的提醒/记事。',
    en: 'List every reminder that has not fired yet.',
  },
  qq_alias_list: {
    zh: '列出所有记住的外号与 QQ 号对应关系。',
    en: 'List every stored nickname-to-QQ mapping.',
  },
};

const EVENTS: EventDescribe[] = [
  {type:'qq.proactive',description:{zh:'主动交流或作息变化的机会，由主模型判断是否发言。',en:'An opportunity for the main model to decide whether to speak.'}},
  {
    type:'qq.sent',
    description:{zh:'协议确认成功发送的本账号消息，仅作衔接和记忆来源，不是新入站请求。',en:'A protocol-confirmed outgoing message from this account, for continuity and memory, not a new incoming request.'},
  },
  {
    type: 'qq.reply_progress',
    description: {zh:'近期协议确认发送的内容，只用于衔接，不是新消息。',en:'Recent protocol-confirmed sends for continuity, not new incoming messages.'},
  },
  {
    type: 'qq.send_policy',
    description: {zh: '当前 QQ 发送权限、回复开关和静默限制。', en: 'Current QQ send permissions, reply switches and quiet-hour restrictions.'},
  },
  {
    type: 'qqbot.output',
    description: {zh: '实际发送正文被替换为 filtered 的内部回执。', en: 'An internal receipt when the actual sent body was replaced with filtered.'},
  },
  {
    type: 'qq.message',
    description: {
      zh: '一条监听到的群聊或私聊消息,已通过唤醒判断,进入本轮处理。',
      en: 'A listened group or private message that passed the wake check and entered this turn.',
    },
  },
  {
    type: 'qq.group-request',
    description: {
      zh: '有人申请加群或被邀请进群,等待管理员审批。',
      en: 'Someone requested to join the group or was invited, awaiting admin approval.',
    },
  },
  {
    type: 'system',
    description: {
      zh: '系统提示:连接状态、或用运行时信息替换占位符后的说明文字。',
      en: 'A system notice: connection state, or text whose placeholders were filled at runtime.',
    },
  },
  {
    type: 'qq.recall',
    description: {
      zh: '某条群消息被撤回。',
      en: 'A group message was recalled.',
    },
  },
  {
    type: 'qq.member',
    description: {
      zh: '群成员变动:有人进群或退群。',
      en: 'Group membership changed: someone joined or left.',
    },
  },
  {
    type: 'qq.poke',
    description: {
      zh: '有人戳了戳机器人,或被机器人戳。',
      en: 'Someone poked the bot, or the bot poked someone.',
    },
  },
  {
    type: 'qq.react',
    description: {
      zh: '有人给某条消息贴了表情回应。',
      en: 'A message received an emoji reaction.',
    },
  },
  {
    type: 'qq.forward',
    description: {
      zh: '收到一条合并转发消息。',
      en: 'A merged-forward message arrived.',
    },
  },
];

export const definition: WorldDefinition<QQConfigSection> = {
  id: 'qqbot',
  label: 'QQ ProMAX',
  defaults: qqDefaults,
  configOptions(kind) {
    if (kind === 'qq-timezone') return qqTimezoneOptions();
    return [];
  },
  create(ctx) {
    return new QQWorld(ctx.cfg, ctx.packageDir, ctx.dataDir, name=>ctx.secret(name));
  },
  describe: {
    tools: QQWorld.describeToolSpecs().map(({name, description, parameters, tags}) => ({
      name, description, parameters, tags, summary: TOOL_SUMMARIES[name],
    })),
    events: EVENTS,
  },
};
