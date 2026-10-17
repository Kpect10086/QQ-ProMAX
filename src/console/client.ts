import type {
  WebUiClientBundle,
  WebUiPanel,
  WebUiPanelContext,
} from 'cortico/web/shared/client-panel.ts';


type FieldDef = {
  key: string;
  type: string;
  title: string;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  xHot: boolean;
};
type SchemaResp = { groupId: string; title?: string; properties: FieldDef[]; values: Record<string, unknown> };
type ModuleSpec = { id: string; title: string; desc: string; group: string; prefix: string; topOnly: boolean; status?: string; extra?: string };

// 与 world.ts modulePanels 对应
const MODULES: ModuleSpec[] = [
  {id: 'quiet', title: '静默白名单', desc: '作息睡眠和午休期间停止主动发送，只回复独立的群聊或私聊名单。', group: 'world:qqbot-quiet', prefix: '', topOnly: false, status: 'getQuietState'},
  { id: 'general', title: '连接与监听', desc: 'OneBot 连接参数与监听名单；连接类改动需重启生效。', group: 'world:qqbot', prefix: '', topOnly: true },
  { id: 'vision', title: '视觉', desc: '辅助视觉（VLM）：接收图片时用视觉模型理解。', group: 'world:qqbot', prefix: 'worlds.qqbot.vision.', topOnly: false },
  { id: 'sticker', title: '表情包', desc: '自动收藏表情包：下载消息里的图片并标注情感/用处。', group: 'world:qqbot', prefix: 'worlds.qqbot.sticker.', topOnly: false },
  { id: 'proactive', title: '主动说话', desc: '后台按状态机向监听会话主动冒泡闲聊。', group: 'world:qqbot', prefix: 'worlds.qqbot.proactive.', topOnly: false },
  { id: 'qzone', title: 'QQ空间', desc: 'QQ 空间动态发布、自动冒泡与评论回复。', group: 'world:qqbot', prefix: 'worlds.qqbot.qzone.', topOnly: false },
  { id: 'group-speak', title: '群聊限速', desc: '限制每个群单位窗口内 bot 发出的消息总量。', group: 'world:qqbot', prefix: 'worlds.qqbot.groupSpeak.', topOnly: false },
  { id: 'anti-loop', title: '防刷/话题结束', desc: '统计连续发言与静默时长，超限自动收尾。', group: 'world:qqbot', prefix: 'worlds.qqbot.antiLoop.', topOnly: false },
  { id: 'emotion', title: '情绪系统', desc: '每轮对话感知情绪、注入全局上下文。', group: 'world:qqbot', prefix: 'worlds.qqbot.emotion.', topOnly: false },
  { id: 'routine', title: '作息功能', desc: '睡眠/午休/活跃作息，到点播报。', group: 'world:qqbot', prefix: 'worlds.qqbot.routine.', topOnly: false },
  { id: 'reminder', title: '到点提醒', desc: '定时提醒到点自动发到对应会话。', group: 'world:qqbot', prefix: 'worlds.qqbot.reminder.', topOnly: false },
  { id: 'affinity', title: '好感度', desc: '好感度系统：随互动增减并注入对话上下文。', group: 'world:qqbot', prefix: 'worlds.qqbot.affinity.', topOnly: false },
  { id: 'admin', title: '群管理员', desc: '撤回/@全体/通知/审核进群/头衔/禁言/踢人。', group: 'world:qqbot', prefix: 'worlds.qqbot.admin.', topOnly: false },
  { id: 'voice', title: '语音收发', desc: '对方说话转文字、AI 回复转语音。可整体开关。', group: 'world:qqbot-voice', prefix: '', topOnly: false, status: 'getVoiceState' },
  { id: 'asr', title: '语音模型', desc: 'ASR 引擎与模型下载：sherpa-onnx int8 量化版约 228MB。', group: 'world:qqbot-asr', prefix: '', topOnly: false, status: 'getAsrModelState', extra: 'asr' },
  { id: 'call', title: '语音通话', desc: '触发词进入语音通话会话（模拟接听）。可整体开关。', group: 'world:qqbot-call', prefix: '', topOnly: false, status: 'getCallState' },
  { id: 'voxcpm', title: 'VoxCPM 侧车', desc: 'TTS 侧车子进程（语音合成）。可开关自拉起。', group: 'world:qqbot-voxcpm-sidecar', prefix: '', topOnly: false, status: 'getVoxcpmState' },
];

function isLongText(key: string, def: FieldDef): boolean {
  if (def.type !== 'string') return false;
  const k = key.toLowerCase();
  if (/prompt|greeting|farewell|notice|描述|systemprompt|voicedesc|voicedesign|extra|system/.test(k)) return true;
  if (def.description && def.description.length > 90) return true;
  return false;
}

function fmtVal(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'boolean') return v ? '开' : '关';
  if (Array.isArray(v)) return v.length ? v.join(' / ') : '（空）';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function statusText(st: Record<string, unknown>): string {
  return Object.entries(st).map(([k, v]) => `${k}: ${fmtVal(v)}`).join('\n');
}

function loadSchema(ctx: WebUiPanelContext, m: ModuleSpec): Promise<SchemaResp | null> {
  return ctx.invoke<SchemaResp>('config', [m.group, m.prefix, m.topOnly]).catch(() => null);
}

function renderField(ctx: WebUiPanelContext, def: FieldDef, value: unknown, commit: (v: unknown) => void): HTMLElement {
  const ui = ctx.ui;
  const wrap = document.createElement('div');
  wrap.style.margin = '10px 0';
  const lab = document.createElement('div');
  lab.style.fontWeight = '600';
  lab.style.marginBottom = '3px';
  lab.textContent = def.title + (def.xHot ? '' : '（改完需重启生效）');
  wrap.appendChild(lab);

  let control: HTMLElement;
  if (def.type === 'boolean') {
    control = ui.checkbox('', { checked: !!value, onChange: (v: boolean) => commit(v) }).el;
  } else if (def.enum && def.enum.length) {
    const v = def.enum.includes(String(value)) ? String(value) : def.enum[0];
    control = ui.select({
      value: v,
      options: def.enum.map((e: string) => ({ value: e, label: e })),
      onChange: (v: string) => commit(v),
    });
  } else if (def.type === 'integer' || def.type === 'number') {
    control = ui.input({
      value: value == null ? '' : String(value),
      type: 'number',
      onChange: (v: string) => commit(def.type === 'integer' ? parseInt(v || '0', 10) : parseFloat(v || '0')),
    });
  } else if (isLongText(def.key, def)) {
    control = ui.textarea({ value: value == null ? '' : String(value), rows: 4, onChange: (v: string) => commit(v) });
  } else if (/secret|key/i.test(def.key) || /key|密钥|token/i.test(def.title)) {
    control = ui.input({ value: value == null ? '' : String(value), type: 'password', onChange: (v: string) => commit(v) });
  } else {
    control = ui.input({ value: value == null ? '' : String(value), onChange: (v: string) => commit(v) });
  }
  wrap.appendChild(control);

  if (def.description) {
    const h = document.createElement('div');
    h.style.fontSize = '11px';
    h.style.opacity = '0.6';
    h.style.marginTop = '3px';
    h.style.lineHeight = '1.4';
    h.textContent = def.description;
    wrap.appendChild(h);
  }
  return wrap;
}

function makePanel(m: ModuleSpec): WebUiPanel {
  return {
    mount(ctx: WebUiPanelContext) {
      const ui = ctx.ui;
      const toast = (msg: string) => { try { ui.toast(msg); } catch { /* noop */ } };

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      const debounceCommit = (fn: () => void) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fn, 350);
      };
      const commit = (fn: () => void) => debounceCommit(fn);

      const sheet = ui.sheet({ title: m.title, desc: m.desc });
      const formWrap = document.createElement('div');

      const renderForm = (s: SchemaResp) => {
        formWrap.replaceChildren();
        if (!s.properties.length) {
          const empty = document.createElement('div');
          empty.style.opacity = '0.6';
          empty.textContent = '该模块暂无可配置项。';
          formWrap.appendChild(empty);
          return;
        }
        const head = document.createElement('div');
        head.style.fontWeight = '700';
        head.style.margin = '4px 0 8px';
        head.textContent = '配置项';
        formWrap.appendChild(head);
        const reload = () => { void loadSchema(ctx, m).then((s2) => { if (s2) renderForm(s2); }); };
        for (const def of s.properties) {
          formWrap.appendChild(renderField(ctx, def, s.values[def.key], (v) => {
            void ctx.setConfig(m.group, { [def.key]: v })
              .then(() => toast('已保存：' + def.key.split('.').pop()))
              .catch((e: unknown) => toast('保存失败：' + (e instanceof Error ? e.message : String(e))))
              .finally(reload);
          }));
        }
      };

      // 运行时状态（可选）
      if (m.status) {
        const statusBox = document.createElement('div');
        statusBox.style.whiteSpace = 'pre-wrap';
        statusBox.style.fontFamily = 'ui-monospace, monospace';
        statusBox.style.fontSize = '12px';
        statusBox.style.background = 'rgba(127,127,127,0.12)';
        statusBox.style.borderRadius = '6px';
        statusBox.style.padding = '8px 10px';
        statusBox.style.marginBottom = '10px';
        const refresh = ui.button('刷新状态', {
          onClick: () => {
            void ctx.invoke(m.status as string, []).then(
              (st) => { statusBox.textContent = statusText(st as Record<string, unknown>); },
              (e: unknown) => { statusBox.textContent = '状态读取失败：' + (e instanceof Error ? e.message : String(e)); },
            );
          },
        });
        sheet.body.appendChild(refresh);
        sheet.body.appendChild(statusBox);
        void ctx.invoke(m.status, []).then(
          (st) => { statusBox.textContent = statusText(st as Record<string, unknown>); },
          () => { statusBox.textContent = '状态读取失败'; },
        );
      }

      // ASR 下载按钮（额外）
      if (m.extra === 'asr') {
        const dl = ui.button('下载/校验 ASR 模型', {
          onClick: () => {
            dl.textContent = '下载中…';
            void ctx.invoke('downloadAsrModel', []).then(
              (r) => { toast(JSON.stringify(r)); },
              (e: unknown) => { toast('下载失败：' + (e instanceof Error ? e.message : String(e))); },
            ).finally(() => { dl.textContent = '下载/校验 ASR 模型'; });
          },
        });
        sheet.body.appendChild(dl);
      }

      sheet.body.appendChild(formWrap);
      ctx.root.appendChild(sheet.el);

      void loadSchema(ctx, m).then((schema) => {
        if (!schema) {
          formWrap.replaceChildren();
          formWrap.textContent = '配置读取失败（请确认 Cortico 已整进程重启并刷新页面）。';
        } else {
          renderForm(schema);
        }
      });
    },
  };
}

function sectionEl(title: string, items: string[]): HTMLElement {
  const wrap = document.createElement('div');
  const h = document.createElement('div');
  h.style.fontWeight = '600';
  h.style.margin = '8px 0 4px';
  h.textContent = title + (items.length ? ` (${items.length})` : '');
  wrap.appendChild(h);
  if (!items.length) {
    const p = document.createElement('div');
    p.style.opacity = '0.5';
    p.textContent = '（空）';
    wrap.appendChild(p);
  }
  for (const it of items) {
    const d = document.createElement('div');
    d.style.padding = '2px 0';
    d.style.fontSize = '13px';
    d.textContent = it;
    wrap.appendChild(d);
  }
  return wrap;
}

// 只读「监听名单」：服务端 getRoster 返回 groups/privates/convs（本扩展暂不支持网页编辑，改动走 config.json）。
const rosterPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '监听名单', desc: '当前监听的群与私聊及未读情况。' });
    sheet.body.textContent = '加载监听名单…';
    ctx.root.appendChild(sheet.el);
    void ctx.invoke('getRoster').then(
      (r) => {
        const data = r as { selfId?: number | null; mode?: string; groups?: number[]; privates?: number[]; convs?: Array<{ address: string; label?: string; kind?: string; active?: boolean; members?: number }> };
        sheet.body.replaceChildren();
        const info = document.createElement('div');
        info.style.fontSize = '12px';
        info.style.opacity = '0.7';
        info.style.marginBottom = '8px';
        info.textContent = `selfId: ${data.selfId ?? '—'}  mode: ${data.mode ?? '—'}  群数: ${(data.groups || []).length}  私聊数: ${(data.privates || []).length}`;
        sheet.body.appendChild(info);
        sheet.body.appendChild(sectionEl('监听群', (data.groups || []).map((g) => String(g))));
        sheet.body.appendChild(sectionEl('监听私聊', (data.privates || []).map((p) => String(p))));
        sheet.body.appendChild(sectionEl('活跃会话', (data.convs || []).map((c) => `${c.label || c.address} [${c.kind || '?'}]${c.active ? ' •在线' : ''} 成员:${c.members ?? 0}`)));
      },
      (e: unknown) => { sheet.body.textContent = '监听名单读取失败：' + (e instanceof Error ? e.message : String(e)); },
    );
  },
};

// 实时事件：走本面板的 stream 推送通道。
const eventsPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: '实时事件', desc: 'QQ 消息与通知的实时流（离线也能看已存储的）。' });
    const status = document.createElement('div');
    status.style.fontSize = '11px';
    status.style.opacity = '0.6';
    status.style.marginBottom = '6px';
    status.textContent = '连接中…';
    const list = document.createElement('div');
    list.style.maxHeight = 'calc(100vh - 320px)';
    list.style.overflowY = 'auto';
    sheet.body.append(status, list);
    ctx.root.appendChild(sheet.el);
    const handle = ctx.stream({
      open: () => { status.textContent = '● 已连接'; },
      close: (willRetry: boolean) => { status.textContent = willRetry ? '○ 已断开，重连中…' : '○ 已断开'; },
      message: (text: string) => {
        let e: { ts?: string; type?: string; text?: string } = {};
        try { e = JSON.parse(text); } catch { e = { text }; }
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.gap = '6px';
        row.style.padding = '3px 0';
        row.style.borderBottom = '1px solid rgba(127,127,127,0.12)';
        row.style.fontSize = '12px';
        const t = document.createElement('span');
        t.style.opacity = '0.5';
        t.style.flex = '0 0 auto';
        t.textContent = (e.ts || '').slice(11, 19);
        const ty = document.createElement('span');
        ty.style.flex = '0 0 auto';
        ty.style.opacity = '0.7';
        ty.textContent = e.type || '';
        const tx = document.createElement('span');
        tx.style.flex = '1';
        tx.textContent = e.text || '';
        row.append(t, ty, tx);
        list.appendChild(row);
        while (list.childElementCount > 300) list.removeChild(list.firstChild as Node);
        list.scrollTop = list.scrollHeight;
      },
    });
    return handle;
  },
};

const panels: Record<string, WebUiPanel> = {};
for (const m of MODULES) panels[m.id] = makePanel(m);
panels['roster'] = rosterPanel;
panels['events'] = eventsPanel;


const bundle: WebUiClientBundle = { panels };
export default bundle;
