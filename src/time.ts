/** QQ timestamp helpers, adapted from Cortico core/util.ts (MIT). */
export function nowIso(timezone: string, d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = `${fmt.format(d).replace(' ', 'T')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const offMin = -getTimezoneOffsetMinutes(timezone, d);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${parts}${sign}${hh}:${mm}`;
}

/**
 * 目标时区相对UTC的偏移(分钟, UTC-本地=负东区)。墙钟各字段按 UTC 拼回时刻再相减,
 * 结果与进程自身的时区无关。
 */
export function getTimezoneOffsetMinutes(timezone: string, d: Date): number {
  const parts: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(d)) parts[p.type] = Number(p.value);
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (Math.floor(d.getTime() / 1000) * 1000 - wall) / 60000;
}

export function shortTime(timezone: string, d: Date = new Date()): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

