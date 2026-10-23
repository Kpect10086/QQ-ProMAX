# QQ ProMAX

Owner: src/definition.ts, src/world.ts, src/config.ts.

本插件基于 [@hth768](https://github.com/hth768) 制作的 [QQ-final（cortico-world-qq-final）](https://github.com/hth768/cortico-world-qq-final) 插件开发。

QQ ProMAX 是 Cortico 的 QQ World 扩展，支持 QQ 群聊、私聊、空间、消息历史、表情包和语音，适配 Cortico 0.2.6 / World API 6。当前版本已移除桌宠功能，按当前上游源码的 AGPL-3.0-or-later 发布。

## 安装

在 Cortico 扩展页搜索 QQ ProMAX，或手动安装 npm 包 `cortico-world-qq-promax@0.1.3`，重启已有 Cortico 后加载。也可以从本仓库下载或检出源码，在扩展页选择本机目录安装。

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
3. 先关闭语音和原生电话，用一个列入白名单的 QQ 号验证接收、回复、重连。群聊、私聊、图片、历史、空间与普通语音消息不依赖 Windows 桌面；空间仍要求协议端支持相应扩展接口。
4. 需要本地 ASR 时，以有写权限的目录创建 Python venv，并按所选引擎安装依赖，例如 `python3 -m venv /your/path/venv_vox`。把绝对目录填入 `asr.localVenv`，设置模型目录及 `asr.mode=local`。Linux 自动识别 `bin/python3` / `bin/python`；Windows 继续使用 `Scripts/python.exe`。也可用 `QQBOT_ASR_PYTHON` 指定解释器绝对路径，或用 `QQBOT_ASR_VENV` 指定 venv；面板中的 `asr.localVenv` 优先。
5. 视频抽帧与普通音频解码需 FFmpeg，可放到 PATH 或填写 `asr.ffmpegPath`。TTS 侧车需自行提供兼容服务脚本、Python 环境与模型，`voxcpmSidecar.venv` 同样支持 Linux 布局。

`call.mode=system` 的 Windows WASAPI/CABLE/可访问控件音频桥不随本包提供，也未移植为 Linux 桌面电话实现。Linux 默认使用语音消息或 `simulated`；只有自行提供兼容外部 `call.bridgeUrl` 时才使用 `system`。未配置脚本时 Linux 不自动搜索并运行 Windows 音频桥。

新增 GitHub Actions 会在 Ubuntu / Windows 上执行安装、测试、类型检查和 WebUI 构建。模拟测试不能替代真实账号、语音模型与设备验收；实际部署后需验证所用协议端的收发、重连、语音和空间回执。

可选 Python 协议回归不需要语音模型：`python3 -m unittest discover -s tests -p test_asr_sidecar.py -v`（Windows 可将 `python3` 换为 `python`，或执行 `npm run test:asr`）。侧车默认日志写入 Cortico 提供的扩展数据目录，避免 Linux 安装目录只读导致启动失败。

## 0.1.2 运行条件

文字收发仅需 Cortico 0.2.6、Node.js 22.16+ 和已登录的 OneBot v11 服务（NapCat / SnowLuma）；在面板填地址、Token、监听群与私聊名单。基础依赖 ws 随安装获取。不得同时加载 qq-final 与 QQ ProMAX。

预编译 WebUI 已包含。表情包目录默认随用户使用收集，包不附带私人图片。工具按用途合并为 33 个，支持视频附件、语音附件和已有 TTS 音频句柄发送。需要语音时另行安装并启用对应 TTS / ASR 服务；Python 侧车需 Python 与所选引擎运行库（例如 funasr、modelscope、torch、torchaudio，或 sherpa-onnx），模型需自行下载。包不附带音色、模型或电话桥接 EXE。原生通话依赖 Windows 音频设备及兼容桥接，默认不开启。

通用审核可单独安装 cortico-world-speechreview，配置 worlds.qqbot.contentReviewUrl 为 http://127.0.0.1:7795/review；留空时不调用审核服务。填写后审核拒绝或失败会阻止原文发送。空间接口依赖协议端支持；登录、权限及网络需要用户自行准备。

本插件仅连接用户自行部署的 OneBot v11 服务，不附带或自动部署 SnowLuma / QQ 客户端组件。服务与客户端有独立许可；本插件的 AGPL 不授予第三方组件的使用或分发权利。

公开 Cortico 未提供 WorldHost.isPaused 查询时，World 的额外暂停检查不可用；发送与操作前请关闭对应扩展开关，进行中的工具仍通过 AbortSignal 取消。
