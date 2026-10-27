# QQ 空间（src/index.ts, src/qzone.ts）

`cortico-world-qq-qzone@0.1.0` 是独立的 Cortico World API 6 扩展，支持发布、删除、读取动态及回复评论。运行时只依赖 `ws`，不依赖 QQ ProMAX，也不直接调用其他 World。需用户自行登录并运行支持空间扩展接口的 OneBot 服务。

在扩展页安装并重启已有 Cortico，在 `worlds.qq-qzone` 配置：

1. `enabled` 默认 `false`；填写独立的正向 `wsUrl` 和 `tokenSecret`（默认 `QQ_QZONE_ONEBOT_TOKEN`）。密钥值填写在 Cortico 密钥库，不能把值填入密钥名。
2. `allowedUsers` 填允许读取评论的 QQ 号，逗号或空白分隔；空名单不读取评论。回复仅限本连接最近 24 小时实际收到、且调用时仍被允许的评论。
3. `quietFrom/quietTo` 按 `timezone` 指定静默时段，二者相同关闭静默。暂停、静默或断线时不执行空间操作。独立扩展不继承 QQ ProMAX 的监听名单或静默设置。
4. 默认不自动投递发布机会。需要时设置 `chancePerTick`（0–1）和 `tickSec`（至少 10 秒）；到点只投递事件，由当前主模型自行决定是否调用发布工具。`autoReplyComments` 控制评论是否唤醒主模型，关闭时仅随下一轮带入上下文。

工具：

- `qq_qzone_post(content, images?, ats?, permission?)`：正文必填，不后台调用额外模型。图片可用 HTTP(S) URL、图片附件句柄、base64 或允许资源目录下真实表情文件名；最多 9 张，每个本地图片最多 16 MiB。正文的表情标记也必须指向允许目录内的真实文件。
- `qq_qzone_read(view=status|feeds, num?)`：本地状态与协议动态分开读取；本地无记录不代表空间为空。
- `qq_qzone_reply(tid, comment_id, content)`：正文必填，编号取实际收到的评论事件。
- `qq_qzone_delete(tid)`：删除已知动态。

只在回执包含成功与真实 `tid` 时确认发布；缺少 `tid` 时先查动态列表，避免重复发布。`dailyQuota` 控制发布上限，`replyDailyQuota/replyCooldownSec` 控制回复配额和冷却。`contentReviewUrl` 可选；配置后审核失败或拒绝时不发送原文。

从 QQ ProMAX 0.2.0 升级：主包已移除 `worlds.qqbot.qzone` 的执行逻辑。先停用旧空间功能，安装本包，手动复制仍需使用的发布频率、配额、可见权限与评论 action，再填写独立连接和名单。旧的模型、提示词和“最近聊天自动附图”不迁移；由主模型显式提供正文与图片。不自动读取旧聊天或笔记。需要保留本地发布记录时，在停止扩展后备份并复制旧数据目录的 `qzone-state.json` 到新扩展的数据目录。

完整源码在 [QQ-ProMAX](https://github.com/Kpect10086/QQ-ProMAX/tree/main/packages/qq-qzone)。仓库根目录运行 `npm ci && npm run build:qzone` 生成可独立安装的 `dist/index.mjs`，测试保留在根目录 `tests/`。许可证为 AGPL-3.0-or-later，保留来源版权声明。
