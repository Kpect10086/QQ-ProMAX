// src/console/client.ts
var MODULES = [
  { id: "quiet", title: "\u9759\u9ED8\u767D\u540D\u5355", desc: "\u4F5C\u606F\u7761\u7720\u548C\u5348\u4F11\u671F\u95F4\u505C\u6B62\u4E3B\u52A8\u53D1\u9001\uFF0C\u53EA\u56DE\u590D\u72EC\u7ACB\u7684\u7FA4\u804A\u6216\u79C1\u804A\u540D\u5355\u3002", group: "world:qqbot-quiet", prefix: "", topOnly: false, status: "getQuietState" },
  { id: "general", title: "\u8FDE\u63A5\u4E0E\u76D1\u542C", desc: "OneBot \u8FDE\u63A5\u53C2\u6570\u4E0E\u76D1\u542C\u540D\u5355\uFF1B\u8FDE\u63A5\u7C7B\u6539\u52A8\u9700\u91CD\u542F\u751F\u6548\u3002", group: "world:qqbot", prefix: "", topOnly: true },
  { id: "vision", title: "\u89C6\u89C9", desc: "\u8F85\u52A9\u89C6\u89C9\uFF08VLM\uFF09\uFF1A\u63A5\u6536\u56FE\u7247\u65F6\u7528\u89C6\u89C9\u6A21\u578B\u7406\u89E3\u3002", group: "world:qqbot", prefix: "worlds.qqbot.vision.", topOnly: false },
  { id: "sticker", title: "\u8868\u60C5\u5305", desc: "\u81EA\u52A8\u6536\u85CF\u8868\u60C5\u5305\uFF1A\u4E0B\u8F7D\u6D88\u606F\u91CC\u7684\u56FE\u7247\u5E76\u6807\u6CE8\u60C5\u611F/\u7528\u5904\u3002", group: "world:qqbot", prefix: "worlds.qqbot.sticker.", topOnly: false },
  { id: "proactive", title: "\u4E3B\u52A8\u8BF4\u8BDD", desc: "\u540E\u53F0\u6309\u72B6\u6001\u673A\u5411\u76D1\u542C\u4F1A\u8BDD\u4E3B\u52A8\u5192\u6CE1\u95F2\u804A\u3002", group: "world:qqbot", prefix: "worlds.qqbot.proactive.", topOnly: false },
  { id: "qzone", title: "QQ\u7A7A\u95F4", desc: "QQ \u7A7A\u95F4\u52A8\u6001\u53D1\u5E03\u3001\u81EA\u52A8\u5192\u6CE1\u4E0E\u8BC4\u8BBA\u56DE\u590D\u3002", group: "world:qqbot", prefix: "worlds.qqbot.qzone.", topOnly: false },
  { id: "group-speak", title: "\u7FA4\u804A\u9650\u901F", desc: "\u9650\u5236\u6BCF\u4E2A\u7FA4\u5355\u4F4D\u7A97\u53E3\u5185 bot \u53D1\u51FA\u7684\u6D88\u606F\u603B\u91CF\u3002", group: "world:qqbot", prefix: "worlds.qqbot.groupSpeak.", topOnly: false },
  { id: "anti-loop", title: "\u9632\u5237/\u8BDD\u9898\u7ED3\u675F", desc: "\u7EDF\u8BA1\u8FDE\u7EED\u53D1\u8A00\u4E0E\u9759\u9ED8\u65F6\u957F\uFF0C\u8D85\u9650\u81EA\u52A8\u6536\u5C3E\u3002", group: "world:qqbot", prefix: "worlds.qqbot.antiLoop.", topOnly: false },
  { id: "emotion", title: "\u60C5\u7EEA\u7CFB\u7EDF", desc: "\u6BCF\u8F6E\u5BF9\u8BDD\u611F\u77E5\u60C5\u7EEA\u3001\u6CE8\u5165\u5168\u5C40\u4E0A\u4E0B\u6587\u3002", group: "world:qqbot", prefix: "worlds.qqbot.emotion.", topOnly: false },
  { id: "routine", title: "\u4F5C\u606F\u529F\u80FD", desc: "\u7761\u7720/\u5348\u4F11/\u6D3B\u8DC3\u4F5C\u606F\uFF0C\u5230\u70B9\u64AD\u62A5\u3002", group: "world:qqbot", prefix: "worlds.qqbot.routine.", topOnly: false },
  { id: "reminder", title: "\u5230\u70B9\u63D0\u9192", desc: "\u5B9A\u65F6\u63D0\u9192\u5230\u70B9\u81EA\u52A8\u53D1\u5230\u5BF9\u5E94\u4F1A\u8BDD\u3002", group: "world:qqbot", prefix: "worlds.qqbot.reminder.", topOnly: false },
  { id: "affinity", title: "\u597D\u611F\u5EA6", desc: "\u597D\u611F\u5EA6\u7CFB\u7EDF\uFF1A\u968F\u4E92\u52A8\u589E\u51CF\u5E76\u6CE8\u5165\u5BF9\u8BDD\u4E0A\u4E0B\u6587\u3002", group: "world:qqbot", prefix: "worlds.qqbot.affinity.", topOnly: false },
  { id: "admin", title: "\u7FA4\u7BA1\u7406\u5458", desc: "\u64A4\u56DE/@\u5168\u4F53/\u901A\u77E5/\u5BA1\u6838\u8FDB\u7FA4/\u5934\u8854/\u7981\u8A00/\u8E22\u4EBA\u3002", group: "world:qqbot", prefix: "worlds.qqbot.admin.", topOnly: false },
  { id: "voice", title: "\u8BED\u97F3\u6536\u53D1", desc: "\u5BF9\u65B9\u8BF4\u8BDD\u8F6C\u6587\u5B57\u3001AI \u56DE\u590D\u8F6C\u8BED\u97F3\u3002\u53EF\u6574\u4F53\u5F00\u5173\u3002", group: "world:qqbot-voice", prefix: "", topOnly: false, status: "getVoiceState" },
  { id: "asr", title: "\u8BED\u97F3\u6A21\u578B", desc: "ASR \u5F15\u64CE\u4E0E\u6A21\u578B\u4E0B\u8F7D\uFF1Asherpa-onnx int8 \u91CF\u5316\u7248\u7EA6 228MB\u3002", group: "world:qqbot-asr", prefix: "", topOnly: false, status: "getAsrModelState", extra: "asr" },
  { id: "call", title: "\u8BED\u97F3\u901A\u8BDD", desc: "\u89E6\u53D1\u8BCD\u8FDB\u5165\u8BED\u97F3\u901A\u8BDD\u4F1A\u8BDD\uFF08\u6A21\u62DF\u63A5\u542C\uFF09\u3002\u53EF\u6574\u4F53\u5F00\u5173\u3002", group: "world:qqbot-call", prefix: "", topOnly: false, status: "getCallState" },
  { id: "voxcpm", title: "VoxCPM \u4FA7\u8F66", desc: "TTS \u4FA7\u8F66\u5B50\u8FDB\u7A0B\uFF08\u8BED\u97F3\u5408\u6210\uFF09\u3002\u53EF\u5F00\u5173\u81EA\u62C9\u8D77\u3002", group: "world:qqbot-voxcpm-sidecar", prefix: "", topOnly: false, status: "getVoxcpmState" }
];
function isLongText(key, def) {
  if (def.type !== "string") return false;
  const k = key.toLowerCase();
  if (/prompt|greeting|farewell|notice|描述|systemprompt|voicedesc|voicedesign|extra|system/.test(k)) return true;
  if (def.description && def.description.length > 90) return true;
  return false;
}
function fmtVal(v) {
  if (v == null) return "\u2014";
  if (typeof v === "boolean") return v ? "\u5F00" : "\u5173";
  if (Array.isArray(v)) return v.length ? v.join(" / ") : "\uFF08\u7A7A\uFF09";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
function statusText(st) {
  return Object.entries(st).map(([k, v]) => `${k}: ${fmtVal(v)}`).join("\n");
}
function loadSchema(ctx, m) {
  return ctx.invoke("config", [m.group, m.prefix, m.topOnly]).catch(() => null);
}
function renderField(ctx, def, value, commit) {
  const ui = ctx.ui;
  const wrap = document.createElement("div");
  wrap.style.margin = "10px 0";
  const lab = document.createElement("div");
  lab.style.fontWeight = "600";
  lab.style.marginBottom = "3px";
  lab.textContent = def.title + (def.xHot ? "" : "\uFF08\u6539\u5B8C\u9700\u91CD\u542F\u751F\u6548\uFF09");
  wrap.appendChild(lab);
  let control;
  if (def.type === "boolean") {
    control = ui.checkbox("", { checked: !!value, onChange: (v) => commit(v) }).el;
  } else if (def.enum && def.enum.length) {
    const v = def.enum.includes(String(value)) ? String(value) : def.enum[0];
    control = ui.select({
      value: v,
      options: def.enum.map((e) => ({ value: e, label: e })),
      onChange: (v2) => commit(v2)
    });
  } else if (def.type === "integer" || def.type === "number") {
    control = ui.input({
      value: value == null ? "" : String(value),
      type: "number",
      onChange: (v) => commit(def.type === "integer" ? parseInt(v || "0", 10) : parseFloat(v || "0"))
    });
  } else if (isLongText(def.key, def)) {
    control = ui.textarea({ value: value == null ? "" : String(value), rows: 4, onChange: (v) => commit(v) });
  } else if (/secret|key/i.test(def.key) || /key|密钥|token/i.test(def.title)) {
    control = ui.input({ value: value == null ? "" : String(value), type: "password", onChange: (v) => commit(v) });
  } else {
    control = ui.input({ value: value == null ? "" : String(value), onChange: (v) => commit(v) });
  }
  wrap.appendChild(control);
  if (def.description) {
    const h = document.createElement("div");
    h.style.fontSize = "11px";
    h.style.opacity = "0.6";
    h.style.marginTop = "3px";
    h.style.lineHeight = "1.4";
    h.textContent = def.description;
    wrap.appendChild(h);
  }
  return wrap;
}
function makePanel(m) {
  return {
    mount(ctx) {
      const ui = ctx.ui;
      const toast = (msg) => {
        try {
          ui.toast(msg);
        } catch {
        }
      };
      let debounceTimer = null;
      const debounceCommit = (fn) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(fn, 350);
      };
      const commit = (fn) => debounceCommit(fn);
      const sheet = ui.sheet({ title: m.title, desc: m.desc });
      const formWrap = document.createElement("div");
      const renderForm = (s) => {
        formWrap.replaceChildren();
        if (!s.properties.length) {
          const empty = document.createElement("div");
          empty.style.opacity = "0.6";
          empty.textContent = "\u8BE5\u6A21\u5757\u6682\u65E0\u53EF\u914D\u7F6E\u9879\u3002";
          formWrap.appendChild(empty);
          return;
        }
        const head = document.createElement("div");
        head.style.fontWeight = "700";
        head.style.margin = "4px 0 8px";
        head.textContent = "\u914D\u7F6E\u9879";
        formWrap.appendChild(head);
        const reload = () => {
          void loadSchema(ctx, m).then((s2) => {
            if (s2) renderForm(s2);
          });
        };
        for (const def of s.properties) {
          formWrap.appendChild(renderField(ctx, def, s.values[def.key], (v) => {
            void ctx.setConfig(m.group, { [def.key]: v }).then(() => toast("\u5DF2\u4FDD\u5B58\uFF1A" + def.key.split(".").pop())).catch((e) => toast("\u4FDD\u5B58\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)))).finally(reload);
          }));
        }
      };
      if (m.status) {
        const statusBox = document.createElement("div");
        statusBox.style.whiteSpace = "pre-wrap";
        statusBox.style.fontFamily = "ui-monospace, monospace";
        statusBox.style.fontSize = "12px";
        statusBox.style.background = "rgba(127,127,127,0.12)";
        statusBox.style.borderRadius = "6px";
        statusBox.style.padding = "8px 10px";
        statusBox.style.marginBottom = "10px";
        const refresh = ui.button("\u5237\u65B0\u72B6\u6001", {
          onClick: () => {
            void ctx.invoke(m.status, []).then(
              (st) => {
                statusBox.textContent = statusText(st);
              },
              (e) => {
                statusBox.textContent = "\u72B6\u6001\u8BFB\u53D6\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e));
              }
            );
          }
        });
        sheet.body.appendChild(refresh);
        sheet.body.appendChild(statusBox);
        void ctx.invoke(m.status, []).then(
          (st) => {
            statusBox.textContent = statusText(st);
          },
          () => {
            statusBox.textContent = "\u72B6\u6001\u8BFB\u53D6\u5931\u8D25";
          }
        );
      }
      if (m.extra === "asr") {
        const dl = ui.button("\u4E0B\u8F7D/\u6821\u9A8C ASR \u6A21\u578B", {
          onClick: () => {
            dl.textContent = "\u4E0B\u8F7D\u4E2D\u2026";
            void ctx.invoke("downloadAsrModel", []).then(
              (r) => {
                toast(JSON.stringify(r));
              },
              (e) => {
                toast("\u4E0B\u8F7D\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)));
              }
            ).finally(() => {
              dl.textContent = "\u4E0B\u8F7D/\u6821\u9A8C ASR \u6A21\u578B";
            });
          }
        });
        sheet.body.appendChild(dl);
      }
      sheet.body.appendChild(formWrap);
      ctx.root.appendChild(sheet.el);
      void loadSchema(ctx, m).then((schema) => {
        if (!schema) {
          formWrap.replaceChildren();
          formWrap.textContent = "\u914D\u7F6E\u8BFB\u53D6\u5931\u8D25\uFF08\u8BF7\u786E\u8BA4 Cortico \u5DF2\u6574\u8FDB\u7A0B\u91CD\u542F\u5E76\u5237\u65B0\u9875\u9762\uFF09\u3002";
        } else {
          renderForm(schema);
        }
      });
    }
  };
}
function sectionEl(title, items) {
  const wrap = document.createElement("div");
  const h = document.createElement("div");
  h.style.fontWeight = "600";
  h.style.margin = "8px 0 4px";
  h.textContent = title + (items.length ? ` (${items.length})` : "");
  wrap.appendChild(h);
  if (!items.length) {
    const p = document.createElement("div");
    p.style.opacity = "0.5";
    p.textContent = "\uFF08\u7A7A\uFF09";
    wrap.appendChild(p);
  }
  for (const it of items) {
    const d = document.createElement("div");
    d.style.padding = "2px 0";
    d.style.fontSize = "13px";
    d.textContent = it;
    wrap.appendChild(d);
  }
  return wrap;
}
var rosterPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u76D1\u542C\u540D\u5355", desc: "\u5F53\u524D\u76D1\u542C\u7684\u7FA4\u4E0E\u79C1\u804A\u53CA\u672A\u8BFB\u60C5\u51B5\u3002" });
    sheet.body.textContent = "\u52A0\u8F7D\u76D1\u542C\u540D\u5355\u2026";
    ctx.root.appendChild(sheet.el);
    void ctx.invoke("getRoster").then(
      (r) => {
        const data = r;
        sheet.body.replaceChildren();
        const info = document.createElement("div");
        info.style.fontSize = "12px";
        info.style.opacity = "0.7";
        info.style.marginBottom = "8px";
        info.textContent = `selfId: ${data.selfId ?? "\u2014"}  mode: ${data.mode ?? "\u2014"}  \u7FA4\u6570: ${(data.groups || []).length}  \u79C1\u804A\u6570: ${(data.privates || []).length}`;
        sheet.body.appendChild(info);
        sheet.body.appendChild(sectionEl("\u76D1\u542C\u7FA4", (data.groups || []).map((g) => String(g))));
        sheet.body.appendChild(sectionEl("\u76D1\u542C\u79C1\u804A", (data.privates || []).map((p) => String(p))));
        sheet.body.appendChild(sectionEl("\u6D3B\u8DC3\u4F1A\u8BDD", (data.convs || []).map((c) => `${c.label || c.address} [${c.kind || "?"}]${c.active ? " \u2022\u5728\u7EBF" : ""} \u6210\u5458:${c.members ?? 0}`)));
      },
      (e) => {
        sheet.body.textContent = "\u76D1\u542C\u540D\u5355\u8BFB\u53D6\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e));
      }
    );
  }
};
var eventsPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u5B9E\u65F6\u4E8B\u4EF6", desc: "QQ \u6D88\u606F\u4E0E\u901A\u77E5\u7684\u5B9E\u65F6\u6D41\uFF08\u79BB\u7EBF\u4E5F\u80FD\u770B\u5DF2\u5B58\u50A8\u7684\uFF09\u3002" });
    const status = document.createElement("div");
    status.style.fontSize = "11px";
    status.style.opacity = "0.6";
    status.style.marginBottom = "6px";
    status.textContent = "\u8FDE\u63A5\u4E2D\u2026";
    const list = document.createElement("div");
    list.style.maxHeight = "calc(100vh - 320px)";
    list.style.overflowY = "auto";
    sheet.body.append(status, list);
    ctx.root.appendChild(sheet.el);
    const handle = ctx.stream({
      open: () => {
        status.textContent = "\u25CF \u5DF2\u8FDE\u63A5";
      },
      close: (willRetry) => {
        status.textContent = willRetry ? "\u25CB \u5DF2\u65AD\u5F00\uFF0C\u91CD\u8FDE\u4E2D\u2026" : "\u25CB \u5DF2\u65AD\u5F00";
      },
      message: (text) => {
        let e = {};
        try {
          e = JSON.parse(text);
        } catch {
          e = { text };
        }
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "6px";
        row.style.padding = "3px 0";
        row.style.borderBottom = "1px solid rgba(127,127,127,0.12)";
        row.style.fontSize = "12px";
        const t = document.createElement("span");
        t.style.opacity = "0.5";
        t.style.flex = "0 0 auto";
        t.textContent = (e.ts || "").slice(11, 19);
        const ty = document.createElement("span");
        ty.style.flex = "0 0 auto";
        ty.style.opacity = "0.7";
        ty.textContent = e.type || "";
        const tx = document.createElement("span");
        tx.style.flex = "1";
        tx.textContent = e.text || "";
        row.append(t, ty, tx);
        list.appendChild(row);
        while (list.childElementCount > 300) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
      }
    });
    return handle;
  }
};
var panels = {};
for (const m of MODULES) panels[m.id] = makePanel(m);
panels["roster"] = rosterPanel;
panels["events"] = eventsPanel;
var bundle = { panels };
var client_default = bundle;
export {
  client_default as default
};
