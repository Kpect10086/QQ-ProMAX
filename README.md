# QQ ProMAX

Owner: src/definition.ts, src/world.ts, src/config.ts.

本插件基于 [@hth768](https://github.com/hth768) 制作的 [QQ-final（cortico-world-qq-final）](https://github.com/hth768/cortico-world-qq-final) 插件开发。

QQ ProMAX 是 Cortico 的 QQ World 扩展，支持 QQ 群聊、私聊、空间、消息历史、表情包和语音，适配 Cortico 0.2.2 / World API 6。当前版本已移除桌宠功能，使用 MIT 协议开源。

## 安装

在 Cortico 扩展页搜索 QQ ProMAX，或手动安装 npm 包 `cortico-world-qq-promax@0.1.1`，重启已有 Cortico 后加载。也可以从本仓库下载或检出源码，在扩展页选择本机目录安装。

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

文字收发不需要 Python、语音模型或虚拟音频驱动。语音、ASR 及原生电话需要另行配置对应服务、模型或设备；本包不含私人音色或后台电话 EXE。默认不启用原生电话。QQ 空间与消息发送需要用户自己的登录及权限。

## 许可证

本版本使用 [MIT License](LICENSE)，保留上游版权声明。QQ-final 和语音模块的 MIT 授权来源见 [第三方声明](THIRD_PARTY_NOTICES.md)。完整可编辑 TypeScript 源码随本仓库和 0.1.1 安装包提供。

## 源码与开发

- 源码：[Kpect10086/QQ-ProMAX](https://github.com/Kpect10086/QQ-ProMAX)
- npm：[cortico-world-qq-promax](https://www.npmjs.com/package/cortico-world-qq-promax)
- 0.1.1 已移除桌宠、桌宠内置电脑操控、Electron 窗口与形象资源。升级时请使用 0.1.1 或更新版本。

使用 Windows 和 Node.js 22.13.0 或更新版本：

```sh
npm ci
npm test
npm run build:web
```

在 Cortico 扩展页选择本机目录可加载检出的源码。修改前端后重新运行 build:web，修改 TypeScript 后重启已有 Cortico。
