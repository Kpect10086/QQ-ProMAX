// src/driver.ts
import { WebSocket, WebSocketServer } from "ws";
var OneBotDriver = class {
  opts;
  server = null;
  client = null;
  sockets = /* @__PURE__ */ new Set();
  active = null;
  pending = /* @__PURE__ */ new Map();
  echoSeq = 0;
  stopped = false;
  /** 正向（forward）模式断线重连退避计时器与当前延迟（指数退避，上限 30s）。 */
  reconnectTimer = void 0;
  reconnectDelay = 1e3;
  constructor(opts) {
    this.opts = opts;
  }
  async start() {
    if (this.server || this.client || this.reconnectTimer) throw new Error("OneBot driver \u5DF2\u542F\u52A8");
    this.stopped = false;
    try {
      if (this.opts.mode === "reverse") {
        this.assertReverseListenerIsSafe();
        await this.startReverse();
      } else {
        await this.startForward();
      }
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  /**
   * 反向监听的兜底安全闸：连进来的那一端能读全部下行消息、也能伪造入站事件。
   * 对外监听（非回环地址）时若没有 token，直接拒绝启动——宁可起不来，
   * 也不能默默开一个同网段任意机器都能接入的无鉴权端口。
   * 回环监听允许无 token（仅本机可达），但 world 侧仍会自动生成 token。
   */
  assertReverseListenerIsSafe() {
    const { wsHost, token } = this.opts;
    if (token) return;
    const host = (wsHost || "").trim();
    const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "";
    if (loopback) {
      this.opts.log.warn("\u53CD\u5411\u76D1\u542C\u672A\u8BBE token\uFF1B\u5F53\u524D\u4EC5\u76D1\u542C\u56DE\u73AF\u5730\u5740\uFF0C\u5EFA\u8BAE\u5728\u914D\u7F6E\u91CC\u586B\u4E00\u4E2A\u4EE5\u9632\u540C\u673A\u5176\u5B83\u8FDB\u7A0B\u63A5\u5165");
      return;
    }
    throw new Error(
      `\u62D2\u7EDD\u542F\u52A8\uFF1A\u53CD\u5411\u76D1\u542C\u5730\u5740 ${host} \u5BF9\u5916\u53EF\u8FBE\u4F46\u672A\u914D\u7F6E\u9274\u6743 token\u3002\u8BF7\u5728\u300C\u8FDE\u63A5\u4E0E\u76D1\u542C\u300D\u91CC\u8BBE\u7F6E OneBot Token\uFF0C\u6216\u628A\u76D1\u542C\u5730\u5740\u6539\u56DE 127.0.0.1\u3002`
    );
  }
  startReverse() {
    return new Promise((resolve3, reject) => {
      const { wsHost, wsPort, wsPath } = this.opts;
      let server;
      try {
        server = new WebSocketServer({ host: wsHost.trim() || "127.0.0.1", port: wsPort, path: wsPath || void 0 });
      } catch (e) {
        reject(e);
        return;
      }
      this.server = server;
      server.on("listening", () => {
        this.opts.log.info("\u53CD\u5411 WS \u670D\u52A1\u7AEF\u5DF2\u76D1\u542C", { host: wsHost, port: wsPort, path: wsPath });
        resolve3();
      });
      server.on("error", (err) => {
        this.opts.log.error("\u53CD\u5411 WS \u670D\u52A1\u7AEF\u9519\u8BEF", { err: String(err) });
        if (!this.stopped) reject(err);
      });
      server.on("connection", (socket, req) => this.onClientConnect(socket, req));
    });
  }
  /**
   * 从握手请求里取出对端携带的 token。
   *
   * OneBot v11 的鉴权约定是**请求头** `Authorization: Bearer <token>`
   * （框架内置的 qq world 也是这么发的，见 `src/worlds/qq/driver.ts`：
   *  `headers: token ? { Authorization: \`Bearer ${token}\` } : undefined`），
   * NapCat / Lagrange 等实现默认都走这一条。因此这里必须优先读请求头。
   *
   * 同时兼容 go-cqhttp 早期与部分实现的 query 传参（`?access_token=` / `?token=`），
   * 因为反向监听的服务端地址是 NapCat 侧手填的，用法不统一。
   */
  extractToken(req) {
    const auth = req.headers?.authorization;
    if (typeof auth === "string") {
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      if (m) return m[1].trim();
    }
    const alt = req.headers?.["access_token"];
    if (typeof alt === "string" && alt) return alt.trim();
    const url = req.url ?? "";
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    return query.get("access_token") ?? query.get("token") ?? "";
  }
  onClientConnect(socket, req) {
    if (this.stopped) {
      socket.terminate();
      return;
    }
    const url = (req.url ?? "").split("?")[0];
    const token = this.extractToken(req);
    if (this.opts.token && token !== this.opts.token) {
      this.opts.log.warn("\u63A5\u5165 Token \u4E0D\u5339\u914D\uFF0C\u62D2\u7EDD\u8FDE\u63A5", { url, presented: Boolean(token) });
      socket.close(1008, "invalid token");
      return;
    }
    if (this.active && this.active !== socket) {
      this.opts.log.warn("\u65B0\u7684\u53CD\u5411\u8FDE\u63A5\u63A5\u5165\uFF0C\u8E22\u6389\u5148\u524D\u90A3\u6761", { url });
      this.rejectSocketCalls(this.active);
      try {
        this.active.close(1008, "replaced by a newer connection");
      } catch {
      }
      this.sockets.delete(this.active);
    }
    this.sockets.add(socket);
    this.active = socket;
    this.opts.log.info("NapCat \u5DF2\u53CD\u5411\u8FDE\u5165", { total: this.sockets.size });
    this.opts.onConnectionChange?.(true);
    socket.on("message", (data) => {
      if (this.active === socket) this.onFrame(data.toString(), socket);
    });
    socket.on("close", () => {
      this.rejectSocketCalls(socket);
      this.sockets.delete(socket);
      if (this.active === socket) this.active = this.sockets.size ? Array.from(this.sockets).pop() ?? null : null;
      this.opts.log.info("NapCat \u8FDE\u63A5\u65AD\u5F00", { remaining: this.sockets.size });
      if (this.sockets.size === 0) this.opts.onConnectionChange?.(false);
    });
    socket.on("error", (err) => this.opts.log.warn("socket \u9519\u8BEF", { err: String(err) }));
  }
  /**
   * 正向（forward）模式：启动即返回，连接在后台进行；任一次失败/断开都会按指数退避自动重连
   * （1s → 2s → 4s … 上限 30s，连上后重置）。这样本扩展即使 NapCat 暂时离线也不会整段启动失败。
   */
  startForward() {
    this.connectForward();
    return Promise.resolve();
  }
  connectForward() {
    if (this.stopped || this.client) return;
    const url = new URL(this.opts.wsUrl);
    if (this.opts.token) url.searchParams.set("access_token", this.opts.token);
    const client = new WebSocket(url, {
      headers: this.opts.token ? { Authorization: `Bearer ${this.opts.token}` } : void 0
    });
    this.client = client;
    client.once("open", () => {
      if (this.stopped || this.client !== client) {
        client.terminate();
        return;
      }
      this.sockets.add(client);
      this.active = client;
      this.reconnectDelay = 1e3;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = void 0;
      }
      this.opts.log.info("\u5DF2\u6B63\u5411\u8FDE\u5165 NapCat", { url: `${url.protocol}//${url.host}${url.pathname}` });
      this.opts.onConnectionChange?.(true);
    });
    client.on("message", (data) => {
      if (this.active === client) this.onFrame(data.toString(), client);
    });
    client.once("close", () => {
      this.rejectSocketCalls(client);
      this.sockets.delete(client);
      const wasActive = this.active === client;
      if (wasActive) this.active = null;
      if (this.client !== client) return;
      this.client = null;
      if (this.stopped) return;
      this.opts.log.warn("NapCat \u8FDE\u63A5\u5173\u95ED\uFF0C\u5C06\u91CD\u8FDE", {});
      if (wasActive && this.sockets.size === 0) this.opts.onConnectionChange?.(false);
      this.scheduleReconnect();
    });
    client.on("error", (err) => {
      if (this.stopped || this.client !== client) return;
      this.opts.log.error("\u6B63\u5411\u8FDE\u63A5\u5931\u8D25\uFF0C\u5C06\u91CD\u8FDE", { err: String(err) });
    });
  }
  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer || this.client) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 3e4);
    this.opts.log.info("\u6B63\u5411\u8FDE\u63A5\u91CD\u8FDE\u6392\u7A0B", { delayMs: delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = void 0;
      this.connectForward();
    }, delay);
  }
  rejectSocketCalls(socket) {
    for (const [echo, call] of this.pending) {
      if (call.socket !== socket) continue;
      clearTimeout(call.timer);
      this.pending.delete(echo);
      call.reject(new Error(`API ${call.action} \u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u7ED3\u679C\u672A\u77E5\uFF1B\u8BF7\u5148\u67E5\u8BE2\u518D\u51B3\u5B9A\u662F\u5426\u91CD\u8BD5`));
    }
  }
  onFrame(raw, socket) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;
    if (msg.echo !== void 0) {
      const pending = this.pending.get(String(msg.echo));
      if (pending && pending.socket === socket) {
        clearTimeout(pending.timer);
        this.pending.delete(String(msg.echo));
        if (msg.status === "failed" || msg.retcode !== void 0 && msg.retcode !== 0 && !(msg.status === "async" && msg.retcode === 1)) {
          const detail = `[OneBot API \u5931\u8D25] action=${pending.action} retcode=${msg.retcode ?? "?"} message=${msg.message !== void 0 ? String(msg.message) : "(\u7A7A)"} data=${JSON.stringify(msg.data ?? null)}`;
          pending.reject(new Error(detail));
        } else {
          pending.resolve(msg.data);
        }
      }
      return;
    }
    if (msg.post_type) {
      this.opts.onEvent(msg);
    }
  }
  /** 是否已连接到 NapCat（active 套接字处于 OPEN 状态）。供上层在发送前/失败重试时判断。 */
  get connected() {
    const s = this.active;
    return !!s && s.readyState === WebSocket.OPEN;
  }
  /** 调用 OneBot API，回包按 echo 关联。 */
  callApi(action, params = {}) {
    const socket = this.active;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("\u672A\u8FDE\u63A5\u5230 NapCat"));
    }
    const echo = `c${(++this.echoSeq).toString(36)}_${Date.now().toString(36)}`;
    const payload = { action, params, echo };
    return new Promise((resolve3, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`API ${action} \u8D85\u65F6`));
      }, 3e4);
      this.pending.set(echo, { resolve: resolve3, reject, timer, action, socket });
      try {
        socket.send(JSON.stringify(payload), (error) => {
          if (!error || !this.pending.has(echo)) return;
          clearTimeout(timer);
          this.pending.delete(echo);
          reject(error);
        });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(e);
      }
    });
  }
  /** 拉取登录身份、群列表与好友列表，构建 QQIdentity。 */
  async refreshIdentity() {
    const login = await this.callApi("get_login_info") ?? {
      user_id: 0,
      nickname: ""
    };
    const groupsRaw = await this.callApi("get_group_list") ?? [];
    const groups = /* @__PURE__ */ new Map();
    for (const g of groupsRaw) groups.set(g.group_id, g.group_name);
    const friends = /* @__PURE__ */ new Map();
    try {
      const friendsRaw = await this.callApi("get_friend_list") ?? [];
      if (Array.isArray(friendsRaw)) {
        for (const f of friendsRaw) {
          const id = Number(f?.user_id);
          if (!id) continue;
          friends.set(id, {
            nickname: String(f.nickname ?? "").trim(),
            remark: f.remark !== void 0 && String(f.remark).trim() ? String(f.remark).trim() : void 0
          });
        }
      }
    } catch (e) {
      this.opts.log.warn("\u62C9\u53D6\u597D\u53CB\u5217\u8868\u5931\u8D25\uFF08\u79C1\u804A\u79F0\u547C\u9000\u5316\u4E3A\u6635\u79F0/QQ \u53F7\uFF09", { err: String(e) });
    }
    return {
      selfId: login.user_id,
      nickname: login.nickname,
      groups,
      friends,
      knownPeers: /* @__PURE__ */ new Map(),
      nicknameConflicts: /* @__PURE__ */ new Set(),
      loadedAt: Date.now()
    };
  }
  async getMemberInfo(groupId, userId) {
    try {
      const r = await this.callApi("get_group_member_info", {
        group_id: groupId,
        user_id: userId
      });
      return r ?? null;
    } catch {
      return null;
    }
  }
  /** 拉取群成员列表，用于按昵称解析 QQ 号（@人 / 戳一戳用）。 */
  async getGroupMemberList(groupId) {
    try {
      const r = await this.callApi("get_group_member_list", { group_id: groupId });
      return Array.isArray(r) ? r : [];
    } catch {
      return [];
    }
  }
  async getForwardMessages(forwardId, limit) {
    try {
      const r = await this.callApi("get_forward_msg", { id: forwardId });
      const list = Array.isArray(r) ? r : r && typeof r === "object" ? r.messages ?? r.message : null;
      return Array.isArray(list) ? list.slice(0, limit).map((node) => node && typeof node === "object" && node.data && !node.type && !node.message && !node.content ? node.data : node) : [];
    } catch {
      return [];
    }
  }
  async stop() {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = void 0;
    }
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("driver \u5DF2\u505C\u6B62"));
    }
    this.pending.clear();
    for (const s of this.sockets) {
      try {
        s.terminate();
      } catch {
      }
    }
    this.sockets.clear();
    this.active = null;
    if (this.client) {
      const client = this.client;
      this.client = null;
      try {
        client.terminate();
      } catch {
      }
    }
    if (this.server) {
      await new Promise((resolve3) => {
        this.server.close(() => resolve3());
      });
      this.server = null;
    }
  }
};

// src/local-resources.ts
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
function resourcePath(root, name, directory = false) {
  try {
    if (!root || !name || name.split(/[\\/]/).includes("..")) return null;
    const base = realpathSync(root);
    if (base === parse(base).root || !statSync(base).isDirectory()) return null;
    const target = resolve(base, name);
    const inside = (path) => {
      const rel = relative(base, path);
      return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep);
    };
    if (!inside(target)) return null;
    let parent = target;
    while (!existsSync(parent)) {
      if (lstatSync(parent, { throwIfNoEntry: false })?.isSymbolicLink()) return null;
      if (!directory || parent === dirname(parent)) return null;
      parent = dirname(parent);
    }
    if (!inside(realpathSync(parent))) return null;
    if (existsSync(target) && (directory ? !statSync(target).isDirectory() : !statSync(target).isFile())) return null;
    return target;
  } catch {
    return null;
  }
}

// src/normalize.ts
import { existsSync as existsSync2, realpathSync as realpathSync2, statSync as statSync2 } from "node:fs";
import { isAbsolute as isAbsolute2, relative as relative2, resolve as resolve2, sep as sep2 } from "node:path";

// src/qface-map.ts
var QQ_FACE_NAMES = {
  0: "\u60CA\u8BB6",
  1: "\u6487\u5634",
  2: "\u8272",
  3: "\u53D1\u5446",
  4: "\u5F97\u610F",
  5: "\u6D41\u6CEA",
  6: "\u5BB3\u7F9E",
  7: "\u95ED\u5634",
  8: "\u7761",
  9: "\u5927\u54ED",
  10: "\u5C34\u5C2C",
  11: "\u53D1\u6012",
  12: "\u8C03\u76AE",
  13: "\u5472\u7259",
  14: "\u5FAE\u7B11",
  15: "\u96BE\u8FC7",
  16: "\u9177",
  18: "\u6293\u72C2",
  19: "\u5410",
  20: "\u5077\u7B11",
  21: "\u53EF\u7231",
  22: "\u767D\u773C",
  23: "\u50B2\u6162",
  24: "\u9965\u997F",
  25: "\u56F0",
  26: "\u60CA\u6050",
  27: "\u6D41\u6C57",
  28: "\u61A8\u7B11",
  29: "\u60A0\u95F2",
  30: "\u594B\u6597",
  31: "\u5492\u9A82",
  32: "\u7591\u95EE",
  33: "\u5618",
  34: "\u6655",
  35: "\u6298\u78E8",
  36: "\u8870",
  37: "\u9AB7\u9AC5",
  38: "\u6572\u6253",
  39: "\u518D\u89C1",
  41: "\u53D1\u6296",
  42: "\u7231\u60C5",
  43: "\u8DF3\u8DF3",
  46: "\u732A\u5934",
  49: "\u62E5\u62B1",
  53: "\u86CB\u7CD5",
  54: "\u95EA\u7535",
  55: "\u70B8\u5F39",
  56: "\u5200",
  57: "\u8DB3\u7403",
  59: "\u4FBF\u4FBF",
  60: "\u5496\u5561",
  61: "\u996D",
  63: "\u73AB\u7470",
  64: "\u51CB\u8C22",
  66: "\u7231\u5FC3",
  67: "\u5FC3\u788E",
  69: "\u793C\u7269",
  74: "\u592A\u9633",
  75: "\u6708\u4EAE",
  76: "\u8D5E",
  77: "\u8E29",
  78: "\u63E1\u624B",
  79: "\u80DC\u5229",
  85: "\u98DE\u543B",
  86: "\u6004\u706B",
  89: "\u897F\u74DC",
  96: "\u51B7\u6C57",
  97: "\u64E6\u6C57",
  98: "\u62A0\u9F3B",
  99: "\u9F13\u638C",
  100: "\u7CD7\u5927\u4E86",
  101: "\u574F\u7B11",
  102: "\u5DE6\u54FC\u54FC",
  103: "\u53F3\u54FC\u54FC",
  104: "\u54C8\u6B20",
  105: "\u9119\u89C6",
  106: "\u59D4\u5C48",
  107: "\u5FEB\u54ED\u4E86",
  108: "\u9634\u9669",
  109: "\u5DE6\u4EB2\u4EB2",
  110: "\u5413",
  111: "\u53EF\u601C",
  112: "\u83DC\u5200",
  113: "\u5564\u9152",
  114: "\u7BEE\u7403",
  115: "\u4E52\u4E53",
  116: "\u793A\u7231",
  117: "\u74E2\u866B",
  118: "\u62B1\u62F3",
  119: "\u52FE\u5F15",
  120: "\u62F3\u5934",
  121: "\u5DEE\u52B2",
  122: "\u7231\u4F60",
  123: "NO",
  124: "OK",
  125: "\u8F6C\u5708",
  126: "\u78D5\u5934",
  127: "\u56DE\u5934",
  128: "\u8DF3\u7EF3",
  129: "\u6325\u624B",
  130: "\u6FC0\u52A8",
  131: "\u8857\u821E",
  132: "\u732E\u543B",
  133: "\u5DE6\u592A\u6781",
  134: "\u53F3\u592A\u6781",
  136: "\u53CC\u559C",
  137: "\u97AD\u70AE",
  138: "\u706F\u7B3C",
  140: "K\u6B4C",
  144: "\u559D\u5F69",
  145: "\u7948\u7977",
  146: "\u7206\u7B4B",
  147: "\u68D2\u68D2\u7CD6",
  148: "\u559D\u5976",
  151: "\u98DE\u673A",
  158: "\u949E\u7968",
  168: "\u836F",
  169: "\u624B\u67AA",
  171: "\u8336",
  172: "\u7728\u773C\u775B",
  173: "\u6CEA\u5954",
  174: "\u65E0\u5948",
  175: "\u5356\u840C",
  176: "\u5C0F\u7EA0\u7ED3",
  177: "\u55B7\u8840",
  178: "\u659C\u773C\u7B11",
  179: "doge",
  180: "\u60CA\u559C",
  181: "\u9A9A\u6270",
  182: "\u7B11\u54ED",
  183: "\u6211\u6700\u7F8E",
  184: "\u6CB3\u87F9",
  185: "\u7F8A\u9A7C",
  187: "\u5E7D\u7075",
  188: "\u86CB",
  190: "\u83CA\u82B1",
  192: "\u7EA2\u5305",
  193: "\u5927\u7B11",
  194: "\u4E0D\u5F00\u5FC3",
  197: "\u51B7\u6F20",
  198: "\u5443",
  199: "\u597D\u68D2",
  200: "\u62DC\u6258",
  201: "\u70B9\u8D5E",
  202: "\u65E0\u804A",
  203: "\u6258\u8138",
  204: "\u5403",
  205: "\u9001\u82B1",
  206: "\u5BB3\u6015",
  207: "\u82B1\u75F4",
  208: "\u5C0F\u6837\u513F",
  210: "\u98D9\u6CEA",
  211: "\u6211\u4E0D\u770B",
  212: "\u6258\u816E",
  214: "\u5575\u5575",
  215: "\u7CCA\u8138",
  216: "\u62CD\u5934",
  217: "\u626F\u4E00\u626F",
  218: "\u8214\u4E00\u8214",
  219: "\u8E6D\u4E00\u8E6D",
  220: "\u62FD\u70B8\u5929",
  221: "\u9876\u5471\u5471",
  222: "\u62B1\u62B1",
  223: "\u66B4\u51FB",
  224: "\u5F00\u67AA",
  225: "\u64A9\u4E00\u64A9",
  226: "\u62CD\u684C",
  227: "\u62CD\u624B",
  228: "\u606D\u559C",
  229: "\u5E72\u676F",
  230: "\u5632\u8BBD",
  231: "\u54FC",
  232: "\u4F5B\u7CFB",
  233: "\u6390\u4E00\u6390",
  234: "\u60CA\u5446",
  235: "\u98A4\u6296",
  236: "\u5543\u5934",
  237: "\u5077\u770B",
  238: "\u6247\u8138",
  239: "\u539F\u8C05",
  240: "\u55B7\u8138",
  241: "\u751F\u65E5\u5FEB\u4E50",
  242: "\u5934\u649E\u51FB",
  243: "\u7529\u5934",
  244: "\u6254\u72D7",
  245: "\u52A0\u6CB9\u5FC5\u80DC",
  246: "\u52A0\u6CB9\u62B1\u62B1",
  247: "\u53E3\u7F69\u62A4\u4F53",
  260: "\u642C\u7816\u4E2D",
  261: "\u5FD9\u5230\u98DE\u8D77",
  262: "\u8111\u9614\u75BC",
  263: "\u6CA7\u6851",
  264: "\u6342\u8138",
  265: "\u8FA3\u773C\u775B",
  266: "\u54E6\u54DF",
  267: "\u5934\u79C3",
  268: "\u95EE\u53F7\u8138",
  269: "\u6697\u4E2D\u89C2\u5BDF",
  270: "emm",
  271: "\u5403\u74DC",
  272: "\u5475\u5475\u54D2",
  273: "\u6211\u9178\u4E86",
  274: "\u592A\u5357\u4E86",
  276: "\u8FA3\u6912\u9171",
  277: "\u6C6A\u6C6A",
  278: "\u6C57",
  279: "\u6253\u8138",
  280: "\u51FB\u638C",
  281: "\u65E0\u773C\u7B11",
  282: "\u656C\u793C",
  283: "\u72C2\u7B11",
  284: "\u9762\u65E0\u8868\u60C5",
  285: "\u6478\u9C7C",
  286: "\u9B54\u9B3C\u7B11",
  287: "\u54E6",
  288: "\u8BF7",
  289: "\u7741\u773C",
  290: "\u6572\u5F00\u5FC3",
  291: "\u9707\u60CA",
  292: "\u8BA9\u6211\u5EB7\u5EB7",
  293: "\u6478\u9526\u9CA4",
  294: "\u671F\u5F85",
  295: "\u62FF\u5230\u7EA2\u5305",
  296: "\u771F\u597D",
  297: "\u62DC\u8C22",
  298: "\u5143\u5B9D",
  299: "\u725B\u554A",
  300: "\u80D6\u4E09\u65A4",
  301: "\u597D\u95EA",
  302: "\u5DE6\u62DC\u5E74",
  303: "\u53F3\u62DC\u5E74",
  304: "\u7EA2\u5305\u5305",
  305: "\u53F3\u4EB2\u4EB2",
  306: "\u725B\u6C14\u51B2\u5929",
  307: "\u55B5\u55B5",
  308: "\u6C42\u7EA2\u5305",
  309: "\u8C22\u7EA2\u5305",
  310: "\u65B0\u5E74\u70DF\u82B1",
  311: "\u6253call",
  312: "\u53D8\u5F62",
  313: "\u55D1\u5230\u4E86",
  314: "\u4ED4\u7EC6\u5206\u6790",
  315: "\u52A0\u6CB9",
  316: "\u6211\u6CA1\u4E8B",
  317: "\u83DC\u72D7",
  318: "\u5D07\u62DC",
  319: "\u6BD4\u5FC3",
  320: "\u5E86\u795D",
  321: "\u8001\u8272\u75DE",
  322: "\u62D2\u7EDD",
  323: "\u5ACC\u5F03",
  324: "\u5403\u7CD6",
  325: "\u60CA\u5413",
  326: "\u751F\u6C14",
  327: "\u52A0\u4E00",
  328: "\u9519\u53F7",
  329: "\u5BF9\u53F7",
  330: "\u5B8C\u6210",
  331: "\u660E\u767D",
  332: "\u4E3E\u724C\u724C",
  333: "\u70DF\u82B1",
  334: "\u864E\u864E\u751F\u5A01",
  336: "\u8C79\u5BCC",
  337: "\u82B1\u6735\u8138",
  338: "\u6211\u60F3\u5F00\u4E86",
  339: "\u8214\u5C4F",
  340: "\u70ED\u5316\u4E86",
  341: "\u6253\u62DB\u547C",
  342: "\u9178Q",
  343: "\u6211\u65B9\u4E86",
  344: "\u5927\u6028\u79CD",
  345: "\u7EA2\u5305\u591A\u591A",
  346: "\u4F60\u771F\u68D2\u68D2",
  347: "\u5927\u5C55\u5B8F\u5154",
  348: "\u798F\u841D\u535C"
};
var QQ_FACE_IDS = (() => {
  const map = {};
  for (const [id, name] of Object.entries(QQ_FACE_NAMES)) map[name] = Number(id);
  return map;
})();
var FACE_ALIASES = {
  \u65FA\u67F4: 277,
  \u72D7\u5934: 277,
  // NapCat 无「狗头」，取「汪汪」
  \u7B11cry: 182,
  // 「笑哭」
  \u5F00\u5FC3: 4,
  // 「得意」
  \u54ED: 9,
  // 「大哭」
  \u6124\u6012: 11,
  // 「发怒」
  \u4E0D\u5C51: 22,
  // 「白眼」
  \u4EB2\u4EB2: 109,
  // 「左亲亲」
  \u5927\u62C7\u6307: 76,
  // 「赞」
  \u7761\u89C9: 8,
  // 「睡」
  \u5410\u820C: 13
  // 「呲牙」
};
for (const [name, id] of Object.entries(FACE_ALIASES)) QQ_FACE_IDS[name] = id;
function faceIdByName(name) {
  const id = QQ_FACE_IDS[name];
  return id === void 0 ? null : id;
}

// src/normalize.ts
function resolveEmojiFile(emojiDir, fname) {
  try {
    if (!fname || fname.length > 200) return null;
    if (isAbsolute2(fname) || /^[a-zA-Z]:/.test(fname) || fname.includes("\0")) return null;
    const unified = fname.replace(/\//g, sep2);
    if (unified.split(sep2).some((seg) => seg === "..")) return null;
    const base = resolve2(emojiDir);
    const target = resolve2(base, unified);
    const rel = relative2(base, target);
    if (!rel || rel.startsWith("..") || isAbsolute2(rel)) return null;
    let realBase = base;
    let realTarget = target;
    try {
      realBase = realpathSync2(base);
      realTarget = realpathSync2(target);
    } catch {
      return null;
    }
    const realRel = relative2(realBase, realTarget);
    if (!realRel || realRel.startsWith("..") || isAbsolute2(realRel)) return null;
    if (!statSync2(realTarget).isFile()) return null;
    return target;
  } catch {
    return null;
  }
}
function renderSegmentsPlain(segments) {
  if (typeof segments === "string") return segments;
  if (!segments || !Array.isArray(segments)) return "";
  return segments.map((seg) => {
    switch (seg.type) {
      case "text":
        return seg.data.text ?? "";
      case "at":
        return `@${seg.data.name ?? seg.data.qq}`;
      case "face":
        return `[\u8868\u60C5${seg.data.id}]`;
      case "image":
        return "[\u56FE\u7247]";
      case "record":
        return "[\u8BED\u97F3]";
      case "video":
        return "[\u89C6\u9891]";
      case "file":
        return `[\u6587\u4EF6:${seg.data.name ?? ""}]`;
      case "forward":
        return "[\u5408\u5E76\u8F6C\u53D1]";
      default:
        return `[${seg.type}]`;
    }
  }).join("");
}
function buildOutgoing(text, emojiDir = "", onMissingSticker) {
  const segments = [];
  const re = /[\[［]([^\[\]［］]{1,240})[\]］]|@([^\s@]{1,30})/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: "text", data: { text: text.slice(last, m.index) } });
    if (m[1] !== void 0) {
      const inner = m[1].trim();
      const whole = m[0];
      if (inner.startsWith("\u8868\u60C5\u5305")) {
        const fname = inner.replace(/^表情包\s*[:：]?\s*/, "").trim();
        const p = emojiDir && resolveEmojiFile(emojiDir, fname);
        if (!p || !existsSync2(p) || !/\.(png|jpe?g|gif|webp)$/i.test(p)) {
          if (!onMissingSticker) throw new Error("\u8868\u60C5\u5305\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BBF\u95EE\uFF1B\u5148\u7528 qq_sticker_stats \u83B7\u53D6\u771F\u5B9E\u6587\u4EF6\u540D\uFF0C\u672C\u6B21\u672A\u53D1\u9001\u3002");
          onMissingSticker(whole);
        } else segments.push({ type: "image", data: { file: p, sub_type: 1 } });
      } else if (/^表情\s*\d+(?:[:：][^\]]*)?$/.test(inner)) {
      } else {
        const fid = faceIdByName(inner);
        if (fid === null) segments.push({ type: "text", data: { text: whole } });
      }
    } else if (m[2] !== void 0) {
      if (/^(all|everyone|全体|全体成员)$/i.test(m[2])) segments.push({ type: "text", data: { text: m[0] } });
      else segments.push({ type: "at", data: { qq: m[2], name: /^(\d{5,})$/.test(m[2]) ? void 0 : m[2] } });
    }
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: "text", data: { text: text.slice(last) } });
  if (segments.some((segment) => segment.type === "text" && /[\[［]\s*表情包/.test(segment.data.text))) {
    throw new Error("\u8868\u60C5\u5305\u6807\u8BB0\u4E0D\u5B8C\u6574\uFF1B\u8BF7\u4F7F\u7528 qq_sticker_stats \u8FD4\u56DE\u7684\u5B8C\u6574\u6807\u8BB0\uFF0C\u672C\u6B21\u672A\u53D1\u9001\u3002");
  }
  return segments;
}

// src/content-review.ts
async function reviewContent(url, text, purpose) {
  try {
    if (!url) throw new Error("Missing reviewer");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, purpose }),
      signal: AbortSignal.timeout(18e3)
    });
    const value = await res.json();
    if (!res.ok || !value || typeof value.allow !== "boolean") throw new Error("Invalid review");
    return {
      allow: value.allow,
      reason: typeof value.reason === "string" ? value.reason : "review",
      ...typeof value.sanitizedText === "string" && value.sanitizedText.trim() ? { sanitizedText: value.sanitizedText } : {}
    };
  } catch {
    return { allow: false, reason: "unavailable" };
  }
}

// packages/qq-qzone/src/qzone.ts
import { existsSync as existsSync3, readFileSync, writeFileSync, statSync as statSync3 } from "node:fs";
import { join as join2 } from "node:path";
var POST_ACTION = "send_qzone_msg";
var DELETE_ACTION = "delete_qzone_msg";
var GET_LIST_ACTION = "get_qzone_msg_list";
function startOfDay() {
  const d = /* @__PURE__ */ new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function cleanText(t) {
  let s = (t ?? "").trim();
  if (!s) return s;
  if (s.startsWith('"') && s.endsWith('"') || s.startsWith("\u201C") && s.endsWith("\u201D")) s = s.slice(1, -1).trim();
  if (s.startsWith("```") || s.startsWith("\xB7\xB7\xB7")) {
    const nl = s.search(/\n/);
    if (nl >= 0) s = s.slice(nl + 1);
    if (s.endsWith("```") || s.endsWith("\xB7\xB7\xB7")) s = s.slice(0, -3);
    s = s.trim();
  }
  return s;
}
function extractUins(ats) {
  const out = [];
  for (const a of ats) {
    const n = Number(a);
    if (Number.isFinite(n) && a.trim() !== "" && /^\d+$/.test(a.trim())) out.push(n);
  }
  return out;
}
function parseQzoneEvent(ev) {
  if (!ev || typeof ev !== "object") return null;
  const post = String(ev.post_type ?? "");
  const detail = String(ev.detail_type ?? ev.sub_type ?? "");
  const isQzone = post === "qzone" || post === "interact" || /qzone/i.test(detail) || /Qzone/i.test(detail) || /QZone/i.test(detail);
  if (!isQzone) return null;
  const tid = ev.tid ?? ev.feed_id ?? ev.feedId ?? (typeof ev.feed === "object" ? ev.feed?.tid : void 0);
  const commentId = ev.comment_id ?? ev.commentId ?? ev.cid ?? ev.comment?.id;
  const operatorId = typeof ev.operator_id === "number" ? ev.operator_id : typeof ev.user_id === "number" ? ev.user_id : void 0;
  const operatorNick = ev.operator_nick ?? ev.operatorNick ?? ev.user_nick ?? ev.nickname ?? (typeof ev.operator === "object" ? ev.operator?.nickname : void 0);
  const text = ev.content ?? ev.comment ?? ev.comment_text ?? ev.text;
  return { tid: tid ? String(tid) : void 0, commentId: commentId ? String(commentId) : void 0, operatorId, operatorNick: operatorNick ? String(operatorNick) : void 0, text: text ? String(text) : void 0, subType: detail };
}
var QZonePoster = class {
  cfg;
  log;
  dataDir;
  stateFile;
  opts;
  timer;
  lastPosts = [];
  dailyCount = 0;
  dayStart = startOfDay();
  processedComments = /* @__PURE__ */ new Set();
  lastReplyAt = 0;
  replyDailyCount = 0;
  constructor(opts) {
    this.opts = opts;
    this.cfg = opts.cfg;
    this.log = opts.log.child("qzone");
    this.dataDir = opts.dataDir;
    this.stateFile = opts.dataDir ? join2(opts.dataDir, "qzone-state.json") : "";
    this.load();
  }
  start() {
    if (!this.cfg.enabled) {
      this.log.info("QQ\u7A7A\u95F4\u52A8\u6001\u672A\u5F00\u542F");
      return;
    }
    this.timer = setInterval(() => void this.tick().catch((e) => this.log.warn("QQ\u7A7A\u95F4 tick \u5F02\u5E38", { err: String(e) })), Math.max(10, this.cfg.tickSec) * 1e3);
    this.log.info("QQ\u7A7A\u95F4\u52A8\u6001\u53D1\u5E03\u5668\u5DF2\u542F\u52A8", { tickSec: this.cfg.tickSec, permission: this.cfg.permission });
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = void 0;
    this.save();
  }
  /** 发一条动态。content 缺省时自动生成；images/ats 可选。 */
  async post(opts) {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return { ok: false, error: blocked };
    this.rolloverDay();
    if (this.cfg.dailyQuota > 0 && this.dailyCount >= this.cfg.dailyQuota) return { ok: false, error: "\u4ECA\u65E5\u53D1\u5E03\u914D\u989D\u5DF2\u7528\u5B8C\u3002" };
    let content = opts.content ? cleanText(opts.content) : "";
    if (!content) return { ok: false, error: "\u52A8\u6001\u5185\u5BB9\u4E3A\u7A7A" };
    let markedImages = [];
    try {
      const segments = buildOutgoing(content, this.opts.emojiDir ?? "");
      markedImages = segments.filter((segment) => segment.type === "image").map((segment) => {
        const file = segment.data.file;
        if (statSync3(file).size > 16 * 1024 * 1024) throw new Error("\u9644\u56FE\u8D85\u8FC7 16MB");
        return "base64://" + readFileSync(file).toString("base64");
      });
      content = renderSegmentsPlain(segments.filter((segment) => segment.type !== "image")).trim();
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    let ats = opts.ats ?? [];
    let body = content;
    for (const a of ats) {
      const name = /^\d+$/.test(a.trim()) ? a.trim() : a.trim();
      if (!body.includes("@" + name)) body = `@${name} ` + body;
    }
    if (body && this.opts.review && !await this.opts.review(body)) {
      body = content = "filtered";
      ats = [];
      opts = { ...opts, images: [] };
      markedImages = [];
    }
    const images = [...markedImages];
    try {
      for (const raw of opts.images ?? []) {
        const u = this.opts.resolveImage ? this.opts.resolveImage(raw.trim()) : raw.trim();
        if (!/^https?:\/\//i.test(u) && !/^base64:\/\//i.test(u)) throw new Error("\u9644\u56FE\u5730\u5740\u4E0D\u53EF\u7528\uFF1B\u4E0D\u5141\u8BB8\u4EFB\u610F\u672C\u673A\u6587\u4EF6\u8DEF\u5F84\u3002");
        images.push(u);
      }
      if (images.length > 9) throw new Error("\u6BCF\u6761\u52A8\u6001\u6700\u591A 9 \u5F20\u56FE\u7247\u3002");
    } catch (error) {
      return { ok: false, error: String(error) };
    }
    if (content !== "filtered" && !images.length && this.cfg.imageMode === "recent") {
      const u = this.opts.getRecentImageUrl?.() ?? "";
      if (/^https?:\/\//i.test(u) || /^base64:\/\//i.test(u)) images.push(u);
    }
    if (!body && !images.length) return { ok: false, error: "\u52A8\u6001\u6CA1\u6709\u53EF\u53D1\u5E03\u7684\u6B63\u6587\u6216\u56FE\u7247\u3002" };
    const params = { content: body };
    if (images.length) params.images = images;
    params.ugc_right = typeof opts.permission === "number" ? opts.permission : this.cfg.permission;
    const uins = extractUins(ats);
    if (uins.length) params.target_uins = uins;
    try {
      const blocked2 = this.opts.blockedReason?.();
      if (blocked2) return { ok: false, error: blocked2 };
      const r = await this.opts.callApi(POST_ACTION, params);
      const tid = r?.tid != null ? String(r.tid).trim() : void 0;
      if (!tid) return { ok: false, error: "\u534F\u8BAE\u7AEF\u672A\u8FD4\u56DE\u52A8\u6001 tid\uFF0C\u53D1\u5E03\u7ED3\u679C\u65E0\u6CD5\u786E\u8BA4\uFF1B\u8BF7\u5148\u8BFB\u53D6\u52A8\u6001\u5217\u8868\u6838\u5BF9\uFF0C\u4E0D\u8981\u91CD\u590D\u53D1\u5E03\u3002" };
      this.recordPost(tid, body);
      this.log.info("\u5DF2\u53D1 QQ\u7A7A\u95F4\u52A8\u6001", { tid, text: body.slice(0, 60) });
      return { ok: true, tid, text: body, ...images.length ? { imageCount: images.length } : {} };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn("\u53D1 QQ\u7A7A\u95F4\u52A8\u6001\u5931\u8D25", { err: msg });
      return { ok: false, error: msg };
    }
  }
  /** 删除一条动态。 */
  async delete(tid) {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return { ok: false, error: blocked };
    try {
      await this.opts.callApi(DELETE_ACTION, { tid });
      this.lastPosts = this.lastPosts.filter((p) => p.tid !== tid);
      this.save();
      this.log.info("\u5DF2\u5220 QQ\u7A7A\u95F4\u52A8\u6001", { tid });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn("\u5220 QQ\u7A7A\u95F4\u52A8\u6001\u5931\u8D25", { err: msg });
      return { ok: false, error: msg };
    }
  }
  /** 回复某条动态下的一条评论。 */
  async replyComment(tid, commentId, content, permitted = () => true) {
    const blocked = this.opts.blockedReason?.();
    if (blocked) return { ok: false, error: blocked };
    if (!permitted()) return { ok: false, error: "\u8BC4\u8BBA\u8BFB\u53D6\u6743\u9650\u5DF2\u53D8\u5316\u3002" };
    this.rolloverDay();
    const cfg = this.cfg.autoReplyComments;
    if (cfg.dailyQuota > 0 && this.replyDailyCount >= cfg.dailyQuota) return { ok: false, error: "\u4ECA\u65E5\u8BC4\u8BBA\u56DE\u590D\u914D\u989D\u5DF2\u7528\u5B8C\u3002" };
    if (Date.now() - this.lastReplyAt < cfg.cooldownSec * 1e3) return { ok: false, error: "\u8BC4\u8BBA\u56DE\u590D\u4ECD\u5728\u51B7\u5374\u3002" };
    let text = cleanText(content);
    if (text && this.opts.review && !await this.opts.review(text)) text = "filtered";
    if (!text) return { ok: false, error: "\u56DE\u590D\u5185\u5BB9\u4E3A\u7A7A" };
    try {
      const blocked2 = this.opts.blockedReason?.();
      if (blocked2) return { ok: false, error: blocked2 };
      if (!permitted()) return { ok: false, error: "\u8BC4\u8BBA\u8BFB\u53D6\u6743\u9650\u5DF2\u53D8\u5316\u3002" };
      await this.opts.callApi(this.cfg.commentAction, { tid, content: text, comment_id: commentId });
      this.lastReplyAt = Date.now();
      this.replyDailyCount++;
      this.save();
      this.log.info("\u5DF2\u56DE\u590D QQ\u7A7A\u95F4\u8BC4\u8BBA", { tid, commentId, text: text.slice(0, 40) });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn("\u56DE\u590D QQ\u7A7A\u95F4\u8BC4\u8BBA\u5931\u8D25", { err: msg, action: this.cfg.commentAction });
      return { ok: false, error: msg };
    }
  }
  /** 取自己的动态列表（尽力而为；get_qzone_msg_list 不一定所有 NapCat 版本都支持）。 */
  async getFeeds(num = 5) {
    try {
      const data = await this.opts.callApi(GET_LIST_ACTION, { num });
      const list = data;
      const feeds = Array.isArray(data) ? data : list?.msglist ?? list?.feeds;
      if (!Array.isArray(feeds)) return { ok: false, error: "\u534F\u8BAE\u7AEF\u8FD4\u56DE\u7684\u52A8\u6001\u5217\u8868\u683C\u5F0F\u65E0\u6CD5\u8BC6\u522B\uFF0C\u4E0D\u80FD\u636E\u6B64\u5224\u65AD\u7A7A\u95F4\u4E3A\u7A7A\u3002" };
      return { ok: true, feeds };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn("\u83B7\u53D6 QQ\u7A7A\u95F4\u52A8\u6001\u5217\u8868\u5931\u8D25", { err: msg });
      return { ok: false, error: msg };
    }
  }
  /** 处理一条 QZone 互动事件（评论/点赞等）。 */
  async onEvent(ev) {
    const p = parseQzoneEvent(ev);
    if (!p) return;
    const key = `${p.tid ?? ""}#${p.commentId ?? ""}`;
    if (p.commentId && this.processedComments.has(key)) return;
    if (p.commentId) {
      this.processedComments.add(key);
      while (this.processedComments.size > 1e3) this.processedComments.delete(this.processedComments.values().next().value);
      this.save();
    }
    this.log.info("\u6536\u5230 QQ\u7A7A\u95F4\u4E92\u52A8\u4E8B\u4EF6", { subType: p.subType, tid: p.tid, commentId: p.commentId, who: p.operatorNick });
    try {
      await this.opts.pushEvent({
        origin: "external",
        type: "qq-qzone.interact",
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        source: "qq-qzone",
        text: `\u3010QQ\u7A7A\u95F4${p.subType === "comment" ? "\u8BC4\u8BBA" : "\u4E92\u52A8"}\u3011${p.operatorNick ?? p.operatorId ?? "\u67D0\u4EBA"} \u5728\u4F60\u7684\u52A8\u6001(${p.tid ?? "?"})\u4E0B${p.subType === "comment" ? "\u8BC4\u8BBA" : "\u4E92\u52A8"}\uFF1A${p.text ?? ""}`,
        meta: { kind: "qzone_interact", subType: p.subType, tid: p.tid, commentId: p.commentId, operatorId: p.operatorId, operatorNick: p.operatorNick }
      });
    } catch {
    }
  }
  async tick() {
    if (!this.cfg.enabled || this.opts.blockedReason?.()) return;
    this.rolloverDay();
    if (this.cfg.dailyQuota > 0 && this.dailyCount >= this.cfg.dailyQuota) return;
    if (Math.random() >= this.cfg.chancePerTick) return;
    await this.opts.pushEvent({
      type: "qq-qzone.proactive",
      source: "qq-qzone",
      origin: "internal",
      ts: (/* @__PURE__ */ new Date()).toISOString(),
      text: "QQ \u7A7A\u95F4\u53D1\u5E03\u673A\u4F1A\uFF1A\u6839\u636E\u5F53\u524D\u8BB0\u5FC6\u81EA\u884C\u51B3\u5B9A\u662F\u5426\u7528 qq_qzone_post \u53D1\u5E03\u3002content \u5FC5\u987B\u7531\u4F60\u63D0\u4F9B\uFF1B\u65E0\u6CD5\u786E\u8BA4\u4E8B\u5B9E\u6216\u6CA1\u6709\u65B0\u5185\u5BB9\u53EF\u4EE5\u4E0D\u53D1\u3002"
    });
  }
  recordPost(tid, text) {
    this.lastPosts.push({ tid, text, at: Date.now() });
    while (this.lastPosts.length > 20) this.lastPosts.shift();
    this.rolloverDay();
    this.dailyCount += 1;
    this.save();
  }
  rolloverDay() {
    const today = startOfDay();
    if (today !== this.dayStart) {
      this.dayStart = today;
      this.dailyCount = 0;
      this.replyDailyCount = 0;
    }
  }
  rolloverReplyDay() {
    const today = startOfDay();
    if (today !== this.dayStart) {
      this.dayStart = today;
      this.replyDailyCount = 0;
    }
  }
  status() {
    return {
      enabled: this.cfg.enabled,
      blockedReason: this.opts.blockedReason?.() ?? null,
      dailyCount: this.dailyCount,
      dailyQuota: this.cfg.dailyQuota,
      autoReply: this.cfg.autoReplyComments.enabled,
      replyDailyCount: this.replyDailyCount,
      lastPosts: this.lastPosts.slice(-8).map((p) => ({ tid: p.tid, text: p.text.slice(0, 60), at: p.at }))
    };
  }
  load() {
    if (!this.stateFile || !existsSync3(this.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8"));
      this.lastPosts = Array.isArray(raw.lastPosts) ? raw.lastPosts : [];
      this.dailyCount = typeof raw.dailyCount === "number" ? raw.dailyCount : 0;
      this.dayStart = typeof raw.dayStart === "number" ? raw.dayStart : startOfDay();
      this.processedComments = new Set(Array.isArray(raw.processedComments) ? raw.processedComments : []);
      this.replyDailyCount = typeof raw.replyDailyCount === "number" ? raw.replyDailyCount : 0;
      this.lastReplyAt = typeof raw.lastReplyAt === "number" ? raw.lastReplyAt : 0;
    } catch {
    }
  }
  save() {
    if (!this.stateFile) return;
    try {
      const obj = {
        lastPosts: this.lastPosts,
        dailyCount: this.dailyCount,
        dayStart: this.dayStart,
        processedComments: [...this.processedComments],
        replyDailyCount: this.replyDailyCount,
        lastReplyAt: this.lastReplyAt
      };
      writeFileSync(this.stateFile, JSON.stringify(obj), "utf8");
    } catch {
    }
  }
};

// packages/qq-qzone/src/index.ts
import { readFileSync as readFileSync2, statSync as statSync4 } from "node:fs";
var defaults = {
  enabled: false,
  wsUrl: "ws://127.0.0.1:3001",
  tokenSecret: "QQ_QZONE_ONEBOT_TOKEN",
  allowedUsers: "",
  localResourcesDir: "",
  emojiDir: "emoji",
  contentReviewUrl: "",
  tickSec: 3600,
  chancePerTick: 0,
  dailyQuota: 5,
  permission: 1,
  autoReplyComments: false,
  replyDailyQuota: 20,
  replyCooldownSec: 60,
  commentAction: "send_qzone_comment",
  quietFrom: 0,
  quietTo: 0,
  timezone: "Asia/Shanghai"
};
var ids = (s) => String(s).split(/[\s,]+/).filter((v) => /^[1-9]\d*$/.test(v));
var schema = { id: "world:qq-qzone", owner: "world:qq-qzone", schema: { type: "object", title: "QQ \u7A7A\u95F4", properties: Object.fromEntries(
  Object.entries(defaults).map(([key, value]) => ["worlds.qq-qzone." + key, {
    type: typeof value,
    title: { enabled: "\u542F\u7528\u7A7A\u95F4", wsUrl: "OneBot \u6B63\u5411 WS \u5730\u5740", tokenSecret: "Token \u5BC6\u94A5\u540D", allowedUsers: "\u5141\u8BB8\u8BFB\u53D6\u8BC4\u8BBA\u7684 QQ \u53F7", localResourcesDir: "\u672C\u5730\u8D44\u6E90\u5141\u8BB8\u76EE\u5F55", emojiDir: "\u8868\u60C5\u76EE\u5F55", contentReviewUrl: "\u53EF\u9009\u5BA1\u6838\u5730\u5740", tickSec: "\u4EA4\u6D41\u673A\u4F1A\u95F4\u9694\uFF08\u79D2\uFF09", chancePerTick: "\u6BCF\u6B21\u6295\u9012\u6982\u7387", dailyQuota: "\u6BCF\u65E5\u53D1\u5E03\u4E0A\u9650\uFF080 \u4E0D\u9650\uFF09", permission: "\u9ED8\u8BA4\u53EF\u89C1\u6743\u9650", autoReplyComments: "\u8BC4\u8BBA\u5524\u9192\u4E3B\u6A21\u578B", replyDailyQuota: "\u6BCF\u65E5\u8BC4\u8BBA\u56DE\u590D\u4E0A\u9650\uFF080 \u4E0D\u9650\uFF09", replyCooldownSec: "\u8BC4\u8BBA\u56DE\u590D\u95F4\u9694\uFF08\u79D2\uFF09", commentAction: "\u56DE\u590D\u8BC4\u8BBA\u534F\u8BAE action", quietFrom: "\u9759\u9ED8\u5F00\u59CB\u5C0F\u65F6", quietTo: "\u9759\u9ED8\u7ED3\u675F\u5C0F\u65F6", timezone: "\u65F6\u533A" }[key],
    "x-hot": false,
    ...key === "chancePerTick" ? { minimum: 0, maximum: 1 } : {},
    ...["quietFrom", "quietTo"].includes(key) ? { minimum: 0, maximum: 23 } : {},
    ...key === "tickSec" ? { minimum: 10 } : {},
    ...["dailyQuota", "replyDailyQuota", "replyCooldownSec"].includes(key) ? { minimum: 0 } : {}
  }])
) } };
var QQZoneWorld = class {
  constructor(cfg, dataDir, secret) {
    this.cfg = cfg;
    this.dataDir = dataDir;
    this.secret = secret;
  }
  cfg;
  dataDir;
  secret;
  id = "qq-qzone";
  host = null;
  driver = null;
  poster = null;
  comments = /* @__PURE__ */ new Map();
  blocked() {
    if (!this.cfg.enabled || !this.host || !this.driver?.connected) return "QQ \u7A7A\u95F4\u672A\u542F\u7528\u6216\u672A\u8FDE\u63A5\u3002";
    if (this.host.isPaused?.()) return "\u8FD0\u884C\u5DF2\u6682\u505C\u3002";
    const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: this.cfg.timezone, hour: "2-digit", hourCycle: "h23" }).format(/* @__PURE__ */ new Date()));
    const { quietFrom: from, quietTo: to } = this.cfg;
    if (from !== to && (from < to ? hour >= from && hour < to : hour >= from || hour < to)) return "QQ \u7A7A\u95F4\u5904\u4E8E\u9759\u9ED8\u65F6\u6BB5\u3002";
    return null;
  }
  async start(host) {
    this.host = host;
    if (!this.cfg.enabled) return;
    if (!/^wss?:\/\//.test(this.cfg.wsUrl)) throw Error("OneBot \u5730\u5740\u5FC5\u987B\u4E3A WS(S)");
    const token = this.secret(this.cfg.tokenSecret);
    if (!token) throw Error("QQ \u7A7A\u95F4\u9700\u8981\u914D\u7F6E\u72EC\u7ACB OneBot Token \u5BC6\u94A5");
    this.poster = new QZonePoster({
      cfg: {
        enabled: true,
        tickSec: this.cfg.tickSec,
        chancePerTick: this.cfg.chancePerTick,
        dailyQuota: this.cfg.dailyQuota,
        permission: this.cfg.permission,
        imageMode: "none",
        autoReplyComments: { enabled: this.cfg.autoReplyComments, dailyQuota: this.cfg.replyDailyQuota, cooldownSec: this.cfg.replyCooldownSec },
        commentAction: this.cfg.commentAction
      },
      log: host.log,
      dataDir: this.dataDir,
      callApi: (action, params) => this.driver.callApi(action, params),
      blockedReason: () => this.blocked(),
      emojiDir: resourcePath(this.cfg.localResourcesDir, this.cfg.emojiDir, true) || "",
      resolveImage: (value) => this.image(value),
      review: async (text) => !this.cfg.contentReviewUrl || (await reviewContent(this.cfg.contentReviewUrl, text, "message")).allow,
      pushEvent: async (event) => {
        if (this.blocked()) return;
        const e = event;
        await host.pushEvent(e, { trigger: e.origin === "external" && !this.cfg.autoReplyComments ? "piggyback" : "debounce" });
      },
      identity: () => null,
      resolveSecret: (name) => name ? this.secret(name) : void 0
    });
    this.driver = new OneBotDriver({
      mode: "forward",
      wsUrl: this.cfg.wsUrl,
      wsHost: "127.0.0.1",
      wsPort: 0,
      wsPath: "/",
      token,
      log: host.log,
      onEvent: (event) => {
        const ev = event;
        const user = ev.operator_id ?? ev.user_id;
        if (this.blocked() || !ids(this.cfg.allowedUsers).includes(String(user))) return;
        const parsed = parseQzoneEvent(ev);
        if (parsed?.tid && parsed.commentId) {
          this.comments.set(parsed.tid + "#" + parsed.commentId, { user: String(user), at: Date.now() });
          while (this.comments.size > 1e3) this.comments.delete(this.comments.keys().next().value);
        }
        void this.poster?.onEvent(ev).catch((error) => host.log.warn("QQ \u7A7A\u95F4\u4E92\u52A8\u5904\u7406\u5931\u8D25", { error: String(error) }));
      }
    });
    await this.driver.start();
    this.poster.start();
  }
  async stop() {
    this.poster?.stop();
    await this.driver?.stop();
    this.poster = null;
    this.driver = null;
    this.host = null;
    this.comments.clear();
  }
  image(value) {
    if (/^https?:\/\//i.test(value)) return value;
    if (/^base64:\/\/[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length < 23 * 1024 * 1024) return value;
    const blob = this.host?.blob(value);
    if (blob && blob.mime.startsWith("image/") && blob.bytes.length <= 16 * 1024 * 1024) return "base64://" + Buffer.from(blob.bytes).toString("base64");
    const dir = resourcePath(this.cfg.localResourcesDir, this.cfg.emojiDir, true);
    const path = dir && resolveEmojiFile(dir, value);
    if (!path || statSync4(path).size > 16 * 1024 * 1024) throw Error("\u9644\u56FE\u4E0D\u5B58\u5728\u3001\u8D85\u8FC7 16 MiB \u6216\u8D85\u51FA\u5141\u8BB8\u76EE\u5F55\u3002");
    return "base64://" + readFileSync2(path).toString("base64");
  }
  tools() {
    const tool = (name, description, properties, required, run, read = false) => ({
      name,
      description,
      parameters: { type: "object", properties, required, additionalProperties: false },
      tags: [read ? "read" : "speak"],
      ...read ? {} : { barrierAfter: true },
      handler: async (args, ctx) => {
        if (ctx.signal?.aborted) return { failed: true, text: "\u64CD\u4F5C\u5DF2\u53D6\u6D88\u3002" };
        const blocked = read && args.view === "status" ? this.cfg.enabled && this.poster ? null : "QQ \u7A7A\u95F4\u672A\u542F\u7528\u3002" : this.blocked();
        if (blocked) return { failed: true, text: blocked };
        if (required.some((key) => typeof args[key] !== "string" || !String(args[key]).trim())) return { failed: true, text: "\u7F3A\u5C11\u5FC5\u586B\u7684\u975E\u7A7A\u6B63\u6587\u6216\u7F16\u53F7\u3002" };
        try {
          return { text: JSON.stringify(await run(args)) };
        } catch (error) {
          return { failed: true, text: String(error) };
        }
      }
    });
    return [
      tool(
        "qq_qzone_post",
        "\u53D1\u5E03 QQ \u7A7A\u95F4\u52A8\u6001\u3002content \u5FC5\u586B\uFF0C\u7531\u5F53\u524D\u4E3B\u6A21\u578B\u6839\u636E\u53EF\u6838\u5B9E\u7684\u8BB0\u5FC6\u64B0\u5199\uFF1B\u4E0D\u516C\u5F00\u79C1\u804A\u9690\u79C1\uFF0C\u522B\u4EBA\u7684\u7ECF\u5386\u4E0D\u5199\u6210\u81EA\u5DF1\u7684\u3002images \u4EC5\u63A5\u53D7\u771F\u5B9E\u7F51\u7EDC\u56FE\u7247\u3001\u56FE\u7247\u9644\u4EF6\u53E5\u67C4\u6216\u5141\u8BB8\u76EE\u5F55\u7684\u8868\u60C5\u6587\u4EF6\u540D\u3002\u8FD4\u56DE\u6210\u529F\u548C tid \u624D\u8868\u793A\u53D1\u5E03\u6210\u529F\uFF0C\u7ED3\u679C\u4E0D\u660E\u65F6\u5148\u8BFB\u5217\u8868\u907F\u514D\u91CD\u590D\u3002",
        { content: { type: "string" }, images: { type: "array", items: { type: "string" }, maxItems: 9 }, ats: { type: "array", items: { type: "string" } }, permission: { type: "number" } },
        ["content"],
        async (a) => {
          if (a.images !== void 0 && (!Array.isArray(a.images) || a.images.length > 9 || a.images.some((v) => typeof v !== "string"))) throw Error("images \u5FC5\u987B\u662F\u6700\u591A 9 \u4E2A\u5B57\u7B26\u4E32\u3002");
          if (a.ats !== void 0 && (!Array.isArray(a.ats) || a.ats.some((v) => typeof v !== "string"))) throw Error("ats \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4\u3002");
          return this.poster.post({ content: String(a.content), images: a.images, ats: a.ats, permission: typeof a.permission === "number" ? a.permission : void 0 });
        }
      ),
      tool("qq_qzone_delete", "\u5220\u9664\u5DF2\u77E5 tid \u7684\u7A7A\u95F4\u52A8\u6001\u3002", { tid: { type: "string" } }, ["tid"], (a) => this.poster.delete(String(a.tid))),
      tool("qq_qzone_reply", "\u56DE\u590D\u6700\u8FD1 24 \u5C0F\u65F6\u5185\u5141\u8BB8\u540D\u5355\u4E2D\u5B9E\u9645\u6536\u5230\u7684\u8BC4\u8BBA\u3002tid \u548C comment_id \u6765\u81EA\u7A7A\u95F4\u8BC4\u8BBA\u4E8B\u4EF6\uFF0Ccontent \u5FC5\u586B\u3002", { tid: { type: "string" }, comment_id: { type: "string" }, content: { type: "string" } }, ["tid", "comment_id", "content"], async (a) => {
        const row = this.comments.get(a.tid + "#" + a.comment_id);
        const permitted = () => !!row && Date.now() - row.at < 864e5 && ids(this.cfg.allowedUsers).includes(row.user);
        if (!permitted()) throw Error("\u8BC4\u8BBA\u672A\u5728\u672C\u8FDE\u63A5\u6536\u5230\u3001\u5DF2\u8FC7\u671F\u6216\u4E0D\u5728\u5141\u8BB8\u540D\u5355\u3002");
        return this.poster.replyComment(String(a.tid), String(a.comment_id), String(a.content), permitted);
      }),
      tool("qq_qzone_read", "\u67E5\u8BE2\u7A7A\u95F4\uFF1Aview=status \u8FD4\u56DE\u672C\u5730\u8BB0\u5F55\u548C\u9650\u5236\uFF0Cview=feeds \u8BF7\u6C42\u534F\u8BAE\u7AEF\u5B9E\u9645\u52A8\u6001\u3002", { view: { type: "string", enum: ["status", "feeds"] }, num: { type: "integer", minimum: 1, maximum: 20 } }, ["view"], async (a) => {
        if (a.view === "status") return this.poster.status();
        if (a.view !== "feeds" || a.num !== void 0 && (!Number.isInteger(a.num) || Number(a.num) < 1 || Number(a.num) > 20)) throw Error("view \u6216 num \u65E0\u6548\u3002");
        return this.poster.getFeeds(Number(a.num ?? 5));
      }, true)
    ];
  }
  webUi() {
    return { label: "QQ \u7A7A\u95F4", panels: [], config: [schema] };
  }
  envPromptVars() {
    return {};
  }
};
var definition = {
  id: "qq-qzone",
  label: "QQ \u7A7A\u95F4",
  defaults: () => ({ ...defaults }),
  create: (ctx) => new QQZoneWorld(ctx.cfg, ctx.dataDir, (name) => ctx.secret(name)),
  describe: {
    tools: new QQZoneWorld({ ...defaults }, "", () => "").tools().map(({ name, description, parameters, tags }) => ({ name, description, parameters, tags })),
    events: [
      { type: "qq-qzone.proactive", description: { zh: "\u7A7A\u95F4\u53D1\u5E03\u673A\u4F1A\uFF0C\u7531\u4E3B\u6A21\u578B\u51B3\u5B9A\u662F\u5426\u53D1\u5E03\u3002", en: "An opportunity for the main model to publish a post." } },
      { type: "qq-qzone.interact", description: { zh: "\u5141\u8BB8\u540D\u5355\u4E2D\u7684\u5916\u90E8\u7A7A\u95F4\u8BC4\u8BBA\u6216\u4E92\u52A8\u3002", en: "An external QZone interaction from an allowed user." } }
    ]
  }
};
var index_default = definition;
export {
  QQZoneWorld,
  index_default as default
};
