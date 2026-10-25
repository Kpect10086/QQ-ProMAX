# QQ ProMAX

Owner: src/definition.ts, src/world.ts, src/config.ts.

群名、昵称和群名片按外部展示数据处理：消息中转义并限制长度，system 环境与内部通知使用群号和 QQ 号。主动聊天的原始会话记录放在外部资料段，不拼入 system；旧情绪缓存中的名字不会继续进入 system 提示。此隔离降低名称冒充内部指令的风险，聊天正文和模型对外部资料的理解仍需遵守权限与发送限制。

本插件基于 [@hth768](https://github.com/hth768) 制作的 [QQ-final（cortico-world-qq-final）](https://github.com/hth768/cortico-world-qq-final) 插件开发。

QQ ProMAX 是 Cortico 的 QQ World 扩展，支持 QQ 群聊、私聊、空间、消息历史、表情包和语音发送，适配 Cortico 0.2.6 / World API 6。当前版本已移除桌宠功能，按当前上游源码的 AGPL-3.0-or-later 发布。

运行时仅依赖 ws，图片下载、时间格式化和工具自描述实现均随包提供；不要求 Coopanion/Cortico 安装目录含 src 源码，也不要求给宿主额外补装 pino。

## 安装

在 Cortico 扩展页搜索 QQ ProMAX，或手动安装 npm 包 `cortico-world-qq-promax@0.2.0`，重启已有 Cortico 后加载。也可以从本仓库下载或检出源码，在扩展页选择本机目录安装。

本扩展与 cortico-world-qq-final 使用相同的 World id（qqbot）。迁移时保留 worlds.qqbot 配置，先停用并卸载旧扩展，再安装本扩展；不可同时加载两份 qqbot。

## 接入 QQ

需要自己运行 SnowLuma 或 NapCat 的 OneBot v11 服务。包内不包含 QQ 账号、Access Token、监听名单、聊天记录或语音模型。

1. 在 QQ ProMAX → 连接与监听，选择正向 WebSocket 并填自己的 OneBot 地址和 Token，或设置反向监听参数。
2. 分别填写允许监听的群号与私聊 QQ 号。留空不读取该类会话；群聊/私聊回复开关独立生效。
3. 重启后发送一条新消息验证。启动前历史最多补读 10 条，旧消息不触发回复。

私聊每次回复最多条数默认 3，0 为不限。按模型回合及收件人计数，文字、图片、语音共享额度，分句超出时合并；无法容纳时先拒绝并反馈精简要求。没有历史记录不等于私聊关闭，qq_recent 会返回当前读取及发送状态。

启用作息静默后，主动消息、提醒和空间写入停止；仅回复静默白名单里的新消息。直播状态文件、内容审核地址和语言指令文件都是可选配置；本包不附带任何部署专用服务。

QQ 空间默认关闭，开启后依赖协议端支持对应扩展接口。qq_qzone_status 展示本地记录和限制，qq_qzone_feeds 读取实际动态。没有发布 tid 时结果无法确认，先查询列表再决定是否重试。

## 可选功能

文字收发不需要 Python、语音模型或虚拟音频驱动。主包仅提供 TTS 语音发送（native/custom/local/voxcpm），不识别、解码或向模型回退上传入站语音，不采集麦克风、系统声音，也不接听原生 QQ 电话。TTS 模型由用户自行启动服务并填写地址；主包不再查找或执行 Python、侧车脚本或下载模型。

QQ 语音消息的文字识别已拆到独立包 [QQ Audio Input](packages/qq-audio-input/README.md)，须单独安装、启用、填写自己的 OneBot 正向连接及允许名单。默认关闭；其隐私标签独立保留。它提供按近期消息编号转写的工具，不会重复触发主包的聊天事件，也不调用其他 World。

### 本地资源目录（0.2.0 迁移）

在「连接与监听」设置 `worlds.qqbot.localResourcesDir`，必须是已存在的专用目录，例如 `D:/QQBotResources`。留空仅使用 Cortico 分配给本扩展的数据目录。不要把磁盘根目录或个人主目录用作资源目录。

- `emojiDir`、`sticker.dir`、`generationInstructionFile` 和 `directorStatusFile` 只能指向允许目录内的资源；相对路径以该目录为基准。
- 超出目录、`..`、符号链接/Windows junction 越界均被拒绝。不会回溯或列举父目录，不会扫描其他扩展、Python 环境或模型。
- 旧表情目录若位于允许目录外，将停止使用。把表情复制到专用目录（例如 `emoji` 子目录），或将允许目录设为原来的专用表情目录，并相应填写 `emojiDir`。目录配置改动后重启已有 Cortico。
- 固定的插件配置、缓存和笔记仍写入宿主分配的本扩展 dataDir；它们不构成可向模型开放的文件浏览器。

主包仍会读取用户明确允许监听的 QQ 聊天、图片和历史，并提交给用户配置的模型/辅助服务；QQ 空间需要用户登录与权限。功能拆分不等于聊天内容不涉及隐私。市场标签撤销及第三方认证由市场维护者复核，发布新版不会自行抹掉历史警示。

## 许可证

本版本使用 [AGPL-3.0-or-later](LICENSE)，与 package.json 和当前上游声明一致；旧版 MIT 来源及版权声明继续保留，见 [第三方声明](THIRD_PARTY_NOTICES.md) 和 LICENSE-MIT。完整可编辑 TypeScript 源码随本仓库提供。

## 源码与开发

- 源码：[Kpect10086/QQ-ProMAX](https://github.com/Kpect10086/QQ-ProMAX)
- npm：[cortico-world-qq-promax](https://www.npmjs.com/package/cortico-world-qq-promax)
- 0.1.2 已移除桌宠、桌宠内置电脑操控、Electron 窗口与形象资源。升级时请使用 0.1.2 或更新版本。

支持 Windows、Linux，运行时需要 Node.js 22.16.0+；开发与 CI 使用 Node.js 22.22.2+ 或 24.15.0+（锁定的开发依赖要求更高补丁版本）：

```sh
npm ci
npm test
npm run typecheck
npm run build:web
```

在 Cortico 扩展页选择本机目录可加载检出的源码。修改前端后重新运行 build:web，修改 TypeScript 后重启已有 Cortico。

## Linux 部署

1. 安装上述 Node.js 版本和 Cortico 0.2.6，检出本仓库后执行上面的开发命令，再在 Cortico 扩展页选择这个目录。
2. 单独启动已经登录的 NapCat / 兼容 OneBot v11 服务。在「连接与监听」填写可从 Cortico 所在主机访问的 WebSocket 地址、Token 和监听名单；Docker 内的 `127.0.0.1` 指该容器自身。
3. 先关闭语音发送，用列入允许名单的 QQ 号验证接收、回复与重连。空间仍要求协议端支持对应接口。
4. 视频预览需将 FFmpeg 放入 PATH；只使用下载的有限 MP4 内容抽帧，不读取视频声音。
5. 需要语音输入时，按独立扩展的说明另行安装和配置。旧的 `asr.*`、`call.*`、`voxcpmSidecar.*` 配置在主包中不再执行，不会自动迁移或启动后台进程。

GitHub Actions 在 Ubuntu / Windows、Node 22 / 24 上执行测试、仅生产依赖的安装验收、类型检查与 WebUI 构建。模拟测试不替代真实账号、模型与设备验收。

可选 Python 协议回归：`npm run test:asr`，测试已随 ASR 侧车移至独立扩展目录，无须下载模型。

QQ 登录仍需自行部署 SnowLuma / NapCat 等兼容服务。第三方组件有独立许可；本插件的 AGPL 不授予第三方组件的使用或分发权利。
