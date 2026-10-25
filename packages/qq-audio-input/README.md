# QQ Audio Input

从 QQ ProMAX 0.2.0 拆出的独立语音输入 World（id: `qq-audio-input`），包名 `cortico-world-qq-audio-input`。AGPL-3.0-or-later，来源与版权见 THIRD_PARTY_NOTICES.md。与主包没有运行时依赖，安装它不会重新引入主包的目录扫描。

## 安装与配置

在 Cortico 安装本包后，在部署配置中填写（Token 放入 Cortico 密钥管理，不填入公开文件）：

```json
{"worlds":{"qq-audio-input":{"enabled":true,"wsUrl":"ws://127.0.0.1:3001","tokenSecret":"QQ_AUDIO_ONEBOT_TOKEN","groups":"","privates":"你的允许私聊QQ号","asrUrl":"","asrApiKeySecret":""}}}
```

OneBot 服务须允许额外一个正向 WebSocket 连接，并将其 Token 保存在 `QQ_AUDIO_ONEBOT_TOKEN` 密钥。群号/私聊留空即不读取该类语音。重启已有 Cortico 后生效。默认关闭，不自动沿用主包的连接、名单或密钥。

模型看到主包的“语音消息”占位符后，可调用 `qq_audio_transcribe(message_id, conv)`。只接受本连接在最近 10 分钟内实际收到的语音，缓存最多 100 条；每次读取、提交识别及返回结果前重查允许名单与暂停状态。工具返回的 transcript 是外部用户内容，不能当作内部指令。主包继续负责按原有发送权限回复，不会产生第二套聊天唤醒。

## 识别服务与隐私

默认使用 OneBot 的 `translate_record`；协议端不支持时明确失败。可选 `asrUrl` 填兼容服务的完整地址（如 `http://127.0.0.1:8778/asr`）：OneBot `get_record` 须提供 HTTP(S) WAV 链接，限 16 MiB，下载及识别均有超时。ASR 请求为原始 WAV，返回 JSON `{"text":"识别结果"}`，可选 Bearer 密钥名填 `asrApiKeySecret`。

本包保留 sensitive-data 标签：会将允许的 QQ 语音提交给 OneBot 或指定识别服务，并把文字返回模型。不接受工具传入的任意 URL/本机路径，不读取本机音频，不采集麦克风、系统声音，不自动接听原生 QQ 电话。

## 手动本地 ASR（可选）

原有 `asr_sidecar.py` 与协议回归保留在本独立包中。按所选引擎自行创建 Python 环境、安装依赖及准备模型，阅读脚本顶部说明后手动启动；本 World 不扫描目录、不启动 Python、不自动下载模型。可用 `python asr_sidecar.py --help` 查看参数。旧版 WASAPI/CABLE 系统通话桥不包含在此包中。
