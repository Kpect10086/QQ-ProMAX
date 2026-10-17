# 第三方声明

Owner: src/asr, asr_sidecar.py, package.json.

QQ ProMAX 基于 [@hth768](https://github.com/hth768) 制作的 [QQ-final（cortico-world-qq-final）](https://github.com/hth768/cortico-world-qq-final) 插件开发。本版本使用 MIT 许可证，完整条款见 [LICENSE](LICENSE)。

## QQ-final

上游 MIT 授权核对版本：[`fa5dbe61054da7a52f9a5119b6bdb23249694811`](https://github.com/hth768/cortico-world-qq-final/tree/fa5dbe61054da7a52f9a5119b6bdb23249694811)。该版本的 [LICENSE](https://github.com/hth768/cortico-world-qq-final/blob/fa5dbe61054da7a52f9a5119b6bdb23249694811/LICENSE) 与 package.json 均声明 MIT。保留 Copyright (c) 2026 Phantivia。

QQ ProMAX 保留 QQ-final 的连接、消息解析、空间、语音等基础代码，并在其上增加监听及发送策略、回执处理和 Cortico API 6 适配。本仓库提供完整可编辑源码。

## 语音切句与并句

`src/asr/listener.ts`、`src/asr/segmenter.ts`、`src/asr/result.ts` 采用上述 QQ-final MIT 版本的源码，与移除桌宠前保留的语音处理逻辑一致；`recognizer.ts` 在其 MIT 代码基础上保留本插件的原始 WAV 请求支持。

切句与识别结果处理的原始来源为 Pal-AI-Lab 的 [cortico-world-desktop-pet](https://github.com/Pal-AI-Lab/cortico-world-desktop-pet/tree/7ce70c271add681cbcb19cfebb07c40ac03215e3)，该独立仓库的 [LICENSE](https://github.com/Pal-AI-Lab/cortico-world-desktop-pet/blob/7ce70c271add681cbcb19cfebb07c40ac03215e3/LICENSE) 为 MIT，保留 Copyright (c) 2026 Phantivia。本版本不包含桌宠窗口、形象资源、桌宠工具或电脑操控模块。

## 依赖与可选模型

运行时 npm 依赖 ws 使用 MIT 许可证。开发依赖保留各自许可证。

可选的 Python ASR 侧车需要使用者自行安装语音运行库、下载模型，并遵守各项目和模型的许可证。本仓库不附带语音模型。
