# Debug 日志 / Debug logs

## 启用 / Enable

在插件设置开启 Debug，填写本地绝对 `.log` 文件路径，保存并关闭。缺少的父目录会在首次记录时创建；请使用单独的日志文件。关闭 Debug 后不再记录，已有文件保留；取消设置编辑不会改变已保存的日志配置。

Enable Debug in settings, enter an absolute local `.log` file path, then Save and close. Missing parent directories are created on the first event. Use a dedicated log file. Disabling logging retains existing files; cancelling settings edits preserves the saved configuration.

日志可能包含聊天原文、附近消息、回复、版面名称和选中术语。API Key 与 Authorization 不写入，原文或错误中出现的当前密钥也会替换为 `[REDACTED]`；不记录独立的思考正文。分享前检查日志中的其它个人信息。

Logs can contain chat text, nearby messages, replies, area names and selected glossary terms. API keys and Authorization are excluded, and matching configured secrets in text/errors become `[REDACTED]`. Separate reasoning text is excluded. Review other private information before sharing.

## 格式与字段 / Format and fields

每条事件以 Markdown 二级标题分隔，标题含 UTC 时间、翻译类型、事件名称与关联 ID。其后的 `json` 代码块是完整结构化记录；原文和请求内每条消息另外展开为文本代码块，方便直接阅读。包含反引号的内容使用更长的围栏。提示词与实际请求一致，但密钥经过脱敏。

Each event has a Markdown heading with UTC time, translation kind, event name and operation ID. The following `json` block is the authoritative structured record. Original text and each request message also appear in readable text blocks with collision-safe fences. Prompts match the actual request except for secret redaction.

| 字段 / Field | 含义 / Meaning |
| --- | --- |
| `schemaVersion` | 当前为 1 / Currently 1 |
| `timestamp`, `localTime` | UTC ISO 时间与本地时间 / UTC ISO and local time |
| `operationId`, `requestId` | 一次翻译及其接口请求的关联 ID / Translation and API request correlation IDs |
| `translationType` | `manual` 手动（含单条重译）、`outgoing` 发送、`automatic` 自动、`connection_test` 连接测试 |
| `provider`, `endpoint`, `model` | 服务类型、基础地址、实际模型；自动选择前可为空 / Provider, base URL and resolved model; model may be null before discovery |
| `targetLanguage`, `channelId`, `messageId` | 目标语言及可获取的版面／消息 ID / Target language and available channel/message IDs |
| `originalText` | 本次待翻译原文 / Original text submitted for translation |
| `requestBody` | 实际请求参数及 `messages`，包含选中的上下文与术语 / Actual request parameters and messages, including selected context/glossary |
| `phase` | `initial` 首次请求或 `repair` 修复请求 / Initial or repair request |
| `elapsedMs`, `durationMs` | 操作总耗时与单次接口耗时（毫秒）/ Operation elapsed time and individual API duration in milliseconds |
| `usage`, `finishReason` | 服务返回的用量与结束原因；未提供时为空 / Reported usage and finish reason; null when unavailable |
| `responseText`, `translation` | 模型响应内容与最终译文 / Model response content and final translation |
| `error` | 错误名称、可用代码及说明 / Error name, available code and message |

## 事件 / Events

- `operation_start` → `api_request` → `api_response` → `operation_complete`：正常请求；自动获取模型时也会记录 `/models`。修复请求复用同一 operationId，使用独立 requestId。
- `cache_hit`：复用客户端缓存，没有调用模型。已展示的历史译文若直接恢复，不进入客户端，也不会新增一次翻译记录。
- `skipped`：纯链接、提及或自定义表情等无需模型处理的消息。
- `api_error`、`operation_error`、`operation_cancelled`：接口错误、整体失败或取消。进入翻译客户端前被本地检查阻止的操作不产生模型请求日志。

Normal calls progress through start, request, response and completion events. Model discovery and repair requests share the operation ID. Cache hits and skipped native-only content do not call the model. Restoring already displayed historical translations does not enter the client and adds no translation log. Errors and cancellations are explicit; local checks before entering the translation client do not create model request logs.

## 文件管理 / File management

当前文件约 10 MB 时轮转为 `.log.1`、`.log.2`、`.log.3`，总计最多四份；单条记录完整保留，因此单份可超过软上限。异步串行写入，待写队列最多 256 条事件，过载时丢弃日志并提示，翻译继续。目录／权限问题同样只影响日志。多实例不要共用同一个文件。

Files rotate at approximately 10 MB into `.log.1`, `.log.2` and `.log.3`, retaining at most four files. Whole events are preserved, so a file can exceed this soft limit. Writes are asynchronous and serialized; the queue allows 256 events before dropping logs and notifying without interrupting translation. Path/permission failures only affect logging. Use separate files for multiple instances.

仓库默认忽略 `.log` 和编号备份。Debug 不会自行发送日志、上传聊天或增加模型请求；使用现有缓存时仍遵循原缓存策略。

The repository ignores `.log` files and numbered backups. Debug does not upload logs or add model requests; existing caching behavior is preserved.
