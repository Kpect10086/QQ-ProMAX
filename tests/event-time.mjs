const relative = /今天|昨天|前天|明天|后天|上周|本周|下周|上个月|下个月|去年|今年|明年/u;

/** 延迟投递的原始采集时间由 World 写入 sourceTs；缺席时沿用事件记录时间。 */
export function sourceEventTime(event) {
  const sourceTs = event.meta?.sourceTs;
  return typeof sourceTs === 'string' && /T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(sourceTs)
    && Number.isFinite(Date.parse(sourceTs)) ? Date.parse(sourceTs) : Date.parse(event.ts);
}

export function anchorTime(text, referenceAt, explicit, timezone = 'Asia/Singapore') {
  const original = text.match(relative)?.[0] ?? '';
  if (explicit === null) return { occurredAt: null, timeConfidence: 0, timeTextOriginal: original, timezone };
  if (explicit !== undefined) {
    if (typeof explicit !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/u.test(explicit) || !Number.isFinite(Date.parse(explicit))) throw Error('发生时间需要带时区的 ISO 时间');
    return { occurredAt: new Date(explicit).toISOString(), timeConfidence: 1, timeTextOriginal: original, timezone };
  }
  const days = { 今天: 0, 昨天: -1, 前天: -2, 明天: 1, 后天: 2 };
  if (original && !(original in days)) return { occurredAt: null, timeConfidence: 0, timeTextOriginal: original, timezone };
  // shortcut: calendar conversion supports the deployment's UTC+8 zone; use Temporal for other zones.
  if (original && !['Asia/Singapore', 'Asia/Shanghai'].includes(timezone)) return { occurredAt: null, timeConfidence: 0, timeTextOriginal: original, timezone };
  const date = new Date(referenceAt + (days[original] ?? 0) * 86400000 + (original ? 8 * 3600000 : 0));
  const occurredAt = original ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - 8 * 3600000).toISOString() : date.toISOString();
  return { occurredAt, timeConfidence: original ? 0.6 : 0.5, timeTextOriginal: original, timezone };
}

export function absoluteSummary(text, time) {
  return text.replace(new RegExp(relative.source, 'gu'), time.occurredAt ? new Intl.DateTimeFormat('sv-SE', { timeZone: time.timezone }).format(new Date(time.occurredAt)) : '时间不确定');
}

export function relativeTime(occurredAt, now = Date.now(), timezone = 'Asia/Singapore') {
  if (!occurredAt) return '时间不确定';
  const day = ms => new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date(ms));
  const delta = Math.round((Date.parse(day(now)) - Date.parse(day(Date.parse(occurredAt)))) / 86400000);
  if(delta===0)return '今天';if(delta===1)return '昨天';if(delta===2)return '前天';
  const original=day(Date.parse(occurredAt)),current=day(now);
  const week=date=>Math.floor((Date.parse(date)/86400000+3)/7);
  if(week(current)-week(original)===1)return `上周（${original}）`;
  const month=date=>Number(date.slice(0,4))*12+Number(date.slice(5,7));
  if(month(current)-month(original)===1)return `上个月（${original}）`;
  return original;
}
