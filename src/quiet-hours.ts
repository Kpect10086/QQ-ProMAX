import type {ConfigGroup} from 'cortico/core/types.ts';
import type {RoutineConfig} from './proactive.ts';
import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
export interface QuietReplyConfig {enabled: boolean; groups: string | number[]; privates: string | number[];}
export const QQ_QUIET_DEFAULTS: QuietReplyConfig = {enabled: false, groups: '', privates: ''};
export const QQ_QUIET_GROUP: ConfigGroup = {id: 'world:qqbot-quiet', owner: 'world:qqbot', schema: {
  type: 'object', title: '静默期间回复白名单', description: '静默时间沿用作息页面的睡眠和午休时段。期间停止主动消息、提醒及空间主动活动，只回复以下名单；名单仍须在监听范围内。', properties: {
    'worlds.qqbot.quietReply.enabled': {type: 'boolean', title: '按作息静默并限制回复', 'x-hot': true},
    'worlds.qqbot.quietReply.groups': {type: 'string', title: '允许回复的群号', description: '逗号、中文逗号、空格或换行分隔。留空时静默期间不回复任何群。', 'x-hot': true},
    'worlds.qqbot.quietReply.privates': {type: 'string', title: '允许回复的私聊 QQ 号', description: '与监听名单独立；留空时静默期间不回复任何私聊。', 'x-hot': true},
  },
}};

/** Start inclusive, end exclusive, including intervals across midnight. */
export function routineQuiet(routine: RoutineConfig, timezone: string, now = new Date()): boolean {
  if (!routine.enabled) return false;
  const parts = new Intl.DateTimeFormat('en-US', {timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now);
  const minutes = Number(parts.find(part => part.type === 'hour')!.value) * 60 + Number(parts.find(part => part.type === 'minute')!.value);
  const parse = (value: string): number | null => {
    const match = /^(\d{1,2}):(\d{2})$/u.exec(value);
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  return [[routine.sleepStart, routine.sleepEnd], [routine.lazyStart, routine.lazyEnd]].some(([from, to]) => {
    const start = parse(from), end = parse(to);
    if (start === null || end === null) return true;
    if (start === end) return false;
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  });
}
export function quietReplyAllowed(address: string, config: QuietReplyConfig): boolean {
  const match = /^(group|private):(\d+)$/u.exec(address);
  if (!match) return false;
  const raw = match[1] === 'group' ? config.groups : config.privates;
  const ids = (Array.isArray(raw) ? raw : raw.split(/[\s,，;；、]+/u)).map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
  return ids.includes(Number(match[2]));
}

/** A successful reply consumes its source cursor across restarts. */
export class QuietReplies {
  private readonly consumed: Record<string, number>;
  constructor(private readonly file: string) {
    const rows = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    if (!rows || Array.isArray(rows) || typeof rows !== 'object' || Object.values(rows).some(value => !Number.isSafeInteger(value) || Number(value) < 0)) throw Error('Invalid quiet reply cursors');
    this.consumed = rows;
  }
  allows(address: string, cursor: number): boolean {return cursor > (this.consumed[address] ?? 0);}
  mark(address: string, cursor: number): void {
    if (!this.allows(address, cursor)) return;
    this.consumed[address] = cursor;
    if (!this.file) return;
    mkdirSync(dirname(this.file), {recursive: true});
    writeFileSync(this.file + '.tmp', JSON.stringify(this.consumed)); renameSync(this.file + '.tmp', this.file);
  }
}
