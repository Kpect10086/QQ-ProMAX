// src/console/client.ts
var TUTORIAL_URL = "https://github.com/hth768/cortico-world-qq-final/blob/main/docs/guide.md";
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
  { id: "voice", title: "\u8BED\u97F3\u53D1\u9001", desc: "AI \u56DE\u590D\u8F6C\u8BED\u97F3\uFF1B\u97F3\u9891\u8F93\u5165\u9700\u5355\u72EC\u5B89\u88C5 QQ Audio Input\u3002\u53EF\u6574\u4F53\u5F00\u5173\u3002", group: "world:qqbot-voice", prefix: "", topOnly: false, status: "getVoiceState" }
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
    const num = (v) => def.type === "integer" ? parseInt(v || "0", 10) : parseFloat(v || "0");
    control = ui.input({
      value: value == null ? "" : String(value),
      type: "number",
      onChange: (v) => commit(num(v)),
      onCommit: (v) => commit(num(v))
    });
  } else if (isLongText(def.key, def)) {
    control = ui.textarea({
      value: value == null ? "" : String(value),
      rows: 4,
      onChange: (v) => commit(v),
      onCommit: (v) => commit(v)
    });
  } else if (/secret|key/i.test(def.key) || /key|密钥|token/i.test(def.title)) {
    control = ui.input({
      value: value == null ? "" : String(value),
      type: "password",
      onChange: (v) => commit(v),
      onCommit: (v) => commit(v)
    });
  } else {
    control = ui.input({
      value: value == null ? "" : String(value),
      onChange: (v) => commit(v),
      onCommit: (v) => commit(v)
    });
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
      if (m.id === "general") {
        const bar = ui.rowbar();
        const link = document.createElement("a");
        link.href = TUTORIAL_URL;
        link.target = "_blank";
        link.rel = "noreferrer noopener";
        link.textContent = "\u{1F4D8} \u4F7F\u7528\u6559\u7A0B";
        link.style.fontSize = "13px";
        link.style.textDecoration = "none";
        link.style.color = "var(--accent, #16a34a)";
        link.title = "\u65B0\u7A97\u53E3\u6253\u5F00\u63A5\u5165\u6559\u7A0B";
        bar.appendChild(link);
        const restart = ui.button("\u91CD\u542F\u8FDE\u63A5", {
          size: "sm",
          onClick: () => {
            restart.disabled = true;
            restart.textContent = "\u91CD\u542F\u4E2D\u2026";
            void ctx.invoke("restartConnection", []).then(
              (r) => {
                const res = r;
                const msg = res?.message ?? (res?.ok ? "\u5DF2\u91CD\u542F\u8FDE\u63A5\u3002" : "\u91CD\u542F\u5931\u8D25\u3002");
                toast(msg);
                if (res?.target) restart.textContent = `\u5DF2\u91CD\u542F \xB7 ${res.target}`;
              },
              (e) => {
                toast("\u91CD\u542F\u5931\u8D25\uFF1A" + (e instanceof Error ? e.message : String(e)));
              }
            ).finally(() => {
              restart.disabled = false;
              setTimeout(() => {
                restart.textContent = "\u91CD\u542F\u8FDE\u63A5";
              }, 4e3);
            });
          }
        });
        bar.appendChild(restart);
        if (m.id === "general") {
          void ctx.invoke("getReverseToken", []).then((r) => {
            const t = typeof r === "string" ? r : "";
            if (!t) return;
            const box = document.createElement("div");
            box.className = "msgline";
            box.style.cssText = "margin-top:8px;font-size:12px";
            box.textContent = `\u53CD\u5411\u8FDE\u63A5 Token\uFF08\u81EA\u52A8\u751F\u6210\uFF0C\u5DF2\u4FDD\u5B58\u5230 dataDir/reverse-token.txt\uFF09\uFF1A${t} \u2014 \u8BF7\u5728 NapCat\u300C\u8BBE\u7F6E\u53CD\u5411\u5BA2\u6237\u7AEF\u300D\u7684 Token \u91CC\u586B\u540C\u4E00\u4E32\uFF0C\u5426\u5219\u8FDE\u4E0D\u4E0A\u3002`;
            bar.parentElement?.insertBefore(box, bar.nextSibling);
          }, () => {
          });
        }
        sheet.body.appendChild(bar);
        const tip = document.createElement("div");
        tip.style.fontSize = "12px";
        tip.style.opacity = "0.7";
        tip.style.margin = "0 0 10px";
        tip.innerHTML = "\u9ED8\u8BA4\u662F<b>\u53CD\u5411\u8FDE\u63A5</b>\uFF1A\u684C\u5BA0\u5F00\u76D1\u542C\u3001NapCat \u4E3B\u52A8\u8FDE\u5165\uFF0C\u6B64\u65F6 <b>OneBot Token \u7559\u7A7A</b>\u5373\u53EF\u3002\u53EA\u6709\u6539\u6210\u300C\u6B63\u5411\u8FDE\u63A5\u300D\u65F6\u624D\u9700\u8981\u586B Token\uFF08\u586B NapCat \u91CC<b>\u6B63\u5411 WS \u670D\u52A1\u5668</b>\u90A3\u4E2A\uFF09\u3002";
        sheet.body.appendChild(tip);
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
var ROSTER_KEYS = {
  groups: "worlds.qqbot.groups",
  privates: "worlds.qqbot.privates"
};
var ROSTER_LABELS = { groups: "\u76D1\u542C\u7FA4", privates: "\u76D1\u542C\u79C1\u804A" };
var rosterPanel = {
  mount(ctx) {
    const ui = ctx.ui;
    const sheet = ui.sheet({ title: "\u76D1\u542C\u540D\u5355", desc: "\u5F53\u524D\u76D1\u542C\u7684\u7FA4\u4E0E\u79C1\u804A\uFF1B\u4E0B\u65B9\u53EF\u76F4\u63A5\u7F16\u8F91\uFF0C\u4FDD\u5B58\u5373\u65F6\u751F\u6548\uFF08\u65E0\u9700\u91CD\u542F\uFF09\u3002" });
    const status = ui.msgline("\u52A0\u8F7D\u76D1\u542C\u540D\u5355\u2026");
    sheet.body.appendChild(status);
    const formHost = document.createElement("div");
    sheet.body.appendChild(formHost);
    ctx.root.appendChild(sheet.el);
    const errText = (e) => e instanceof Error ? e.message : String(e);
    const build = (data) => {
      formHost.replaceChildren();
      const groupsVal = (data.groups || []).join(" ");
      const privatesVal = (data.privates || []).join(" ");
      const info = document.createElement("div");
      info.style.fontSize = "12px";
      info.style.opacity = "0.7";
      info.style.marginBottom = "8px";
      info.textContent = `selfId: ${data.selfId ?? "\u2014"}  mode: ${data.mode ?? "\u2014"}  \u7FA4\u6570: ${(data.groups || []).length}  \u79C1\u804A\u6570: ${(data.privates || []).length}`;
      const saveField = async (which, raw) => {
        status.textContent = `\u6B63\u5728\u4FDD\u5B58${ROSTER_LABELS[which]}\u2026`;
        try {
          await ctx.setConfig("world:qqbot", { [ROSTER_KEYS[which]]: raw.trim() });
          status.textContent = `${ROSTER_LABELS[which]}\u5DF2\u4FDD\u5B58 \u2713 \u5373\u65F6\u751F\u6548\uFF08\u65E0\u9700\u91CD\u542F\uFF09`;
        } catch (e) {
          status.textContent = `${ROSTER_LABELS[which]}\u4FDD\u5B58\u5931\u8D25\uFF1A${errText(e)}`;
          status.classList.add("bad");
          return;
        }
        status.classList.remove("bad");
        try {
          const r = await ctx.invoke("getRoster");
          info.textContent = `selfId: ${r.selfId ?? "\u2014"}  mode: ${r.mode ?? "\u2014"}  \u7FA4\u6570: ${(r.groups || []).length}  \u79C1\u804A\u6570: ${(r.privates || []).length}`;
        } catch {
        }
      };
      const commitGroups = (v) => {
        void saveField("groups", v);
      };
      const commitPrivates = (v) => {
        void saveField("privates", v);
      };
      const groupsInput = ui.textarea({
        value: groupsVal,
        rows: 3,
        placeholder: "\u76D1\u542C\u7684\u7FA4\u53F7\uFF0C\u7528\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694\uFF1B\u7559\u7A7A=\u5168\u90E8\u7FA4",
        onChange: commitGroups,
        onCommit: commitGroups
      });
      const privatesInput = ui.textarea({
        value: privatesVal,
        rows: 3,
        placeholder: "\u76D1\u542C\u7684\u79C1\u804A QQ \u53F7\uFF0C\u7528\u7A7A\u683C\u6216\u9017\u53F7\u5206\u9694\uFF1B\u7559\u7A7A=\u4E0D\u76D1\u542C\u79C1\u804A",
        onChange: commitPrivates,
        onCommit: commitPrivates
      });
      const groupWrap = document.createElement("div");
      groupWrap.style.margin = "10px 0";
      const gl = document.createElement("div");
      gl.style.fontWeight = "600";
      gl.style.marginBottom = "3px";
      gl.textContent = "\u76D1\u542C\u7FA4\uFF08\u7A7A\u683C/\u9017\u53F7\u5206\u9694\uFF09";
      groupWrap.append(gl, groupsInput);
      const privWrap = document.createElement("div");
      privWrap.style.margin = "10px 0";
      const pl = document.createElement("div");
      pl.style.fontWeight = "600";
      pl.style.marginBottom = "3px";
      pl.textContent = "\u76D1\u542C\u79C1\u804A\uFF08\u7A7A\u683C/\u9017\u53F7\u5206\u9694\uFF09";
      privWrap.append(pl, privatesInput);
      const saveAll = ui.button("\u4FDD\u5B58\u4E24\u4E2A\u540D\u5355", {
        onClick: () => {
          status.textContent = "\u6B63\u5728\u4FDD\u5B58\u2026";
          void ctx.setConfig("world:qqbot", {
            [ROSTER_KEYS.groups]: groupsInput.value.trim(),
            [ROSTER_KEYS.privates]: privatesInput.value.trim()
          }).then(
            () => {
              status.textContent = "\u76D1\u542C\u7FA4\u4E0E\u76D1\u542C\u79C1\u804A\u5DF2\u4FDD\u5B58 \u2713 \u5373\u65F6\u751F\u6548";
              status.classList.remove("bad");
            },
            (e) => {
              status.textContent = "\u4FDD\u5B58\u5931\u8D25\uFF1A" + errText(e);
              status.classList.add("bad");
            }
          );
        }
      });
      formHost.append(info, groupWrap, privWrap, saveAll);
      formHost.appendChild(sectionEl("\u6D3B\u8DC3\u4F1A\u8BDD", (data.convs || []).map((c) => `${c.label || c.address} [${c.kind || "?"}]${c.active ? " \u2022\u5728\u7EBF" : ""} \u6210\u5458:${c.members ?? 0}`)));
    };
    const load = () => {
      status.textContent = "\u52A0\u8F7D\u76D1\u542C\u540D\u5355\u2026";
      status.classList.remove("bad");
      return ctx.invoke("getRoster").then(
        (r) => {
          status.textContent = "\u7F16\u8F91\u540E\u5931\u7126\u6216\u6309 Ctrl/\u2318+Enter \u5373\u81EA\u52A8\u4FDD\u5B58\u3002";
          build(r);
        },
        (e) => {
          status.textContent = "\u76D1\u542C\u540D\u5355\u8BFB\u53D6\u5931\u8D25\uFF1A" + errText(e);
          status.classList.add("bad");
        }
      );
    };
    void load();
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
