# Changelog

## Unreleased

## 0.10.3 — 2026-10-17

- Place source-language badges consistently at the start of translated message rows, and use a single localized original/translation toggle tooltip.

- Shorten outgoing translation tooltips to show only the current send mode or translation status.

- Replace the per-message translation toolbar text with a shared 文/A switching icon in all UI languages; retain localized tooltips and accessibility labels.

## 0.10.2 — 2026-10-17

- Keep mass-mention authorization case-sensitive and retain settings styles/focus protection when the plugin stops before mounted panels close.

- Reject newly introduced mentions and link destinations before translated sends; retain drafts on failure. Render model-added links as plain text.
- Keep Discord's original display for emoji-, link- and mention-only messages.
- Let outgoing translations wait for the next request slot, with cancellation, timeout and bounded queue safeguards.
- Release disabled settings-panel resources on unmount; validate saved settings and repair malformed non-sensitive fields in memory without silently replacing service credentials.
- Reuse message snapshots and ancestor visibility measurements within each automatic translation scan.

## 0.10.1 — 2026-10-16

## 中文

- **DeepSeek 识图**：支持 Flash 模型翻译、概括图片内文字，沿用上下文和术语表。图片可能大量消耗 token，请慎用。
- **术语匹配优化**：支持简繁检索、有限角色简称及词尾匹配，合并共同译名，为聊天上下文保留预算。
- **减少重复翻译**：相同在途请求共享生成，切换语言可复用缓存，纯表情跳过翻译。
- **稳定性修复**：完善请求取消、发送剧透保护及设置面板样式，补充 Debug 参考筛选信息。

---

## English

- **DeepSeek vision:** Translate and summarize image text with Flash models, context and glossaries. Image requests may consume many tokens; use with care.
- **Glossary matching:** Simplified/traditional lookup, bounded character-name variants, shared-name merging and room for conversation context.
- **Fewer duplicate translations:** Share identical in-flight requests, reuse cached language results and skip emoji-only messages.
- **Reliability:** Improve cancellation, outgoing spoiler protection, settings styles and Debug reference-selection details.

## 0.9.9 — 2026-10-16

## 中文

- **跳过自己的消息**：自动翻译默认保留本人原文，仍作为其他消息的上下文；可关闭，手动翻译不受影响。
- **设置界面整理**：按功能分组，说明放在选项下方，高级参数可折叠，连接结果就近显示。
- **文档补充**：主要功能加入图片文字翻译与概括，并提示可能大量消耗 token，请谨慎使用。

---

## English

- **Skip your own messages:** Enabled by default for automatic translation, while retaining originals as context. Optional; manual translation is unaffected.
- **Settings layout:** Grouped controls, help text below options, collapsible advanced parameters and inline connection feedback.
- **Documentation:** Added image text translation and summaries to the feature list, with a warning about potentially high token usage.

## 0.9.8 — 2026-10-16

## 中文

- **服务配置记忆**：本地、在线和 DeepSeek 分别保存地址、模型、密钥及参数，切换时自动恢复。
- **统一命名**：注册名和配置文件统一为 YetAnotherTranslator，支持迁移旧设置。
- **发送内容过滤**：纯表情、纯链接及无文字图片／附件直接原样发送，跳过翻译；双语模式也不重复附加内容。

---

## English

- **Service profiles**: Local, online and DeepSeek services remember their own endpoint, model, key and parameters.
- **Consistent naming**: Registration and configuration now use YetAnotherTranslator, with legacy settings migration.
- **Send filtering**: Emoji-only, link-only and text-free image/attachment messages bypass translation and are sent unchanged, including in bilingual mode.

## 0.9.7 — 2026-10-15

## 中文

- **图片文字翻译与概括**：右键消息图片，一次视觉生成即可翻译图片内文字并概括要点，无额外 OCR 步骤。结果以灰色小字显示在图片下方，点击原文语言标签可切换本图目标语言。
- **图片菜单兼容改进**：完善媒体遮罩、代理图片及放大查看器中的右键入口，支持同一消息中的多张图片。
- **重译与缓存**：再次选择图片翻译会读取最新术语和聊天上下文；复用图片数据及已完成的语言结果，减少重复下载与生成。修复消息附言被混入图片译文的问题。
- **图片请求限制**：PNG、JPEG、GIF、WebP 统一检查文件大小和尺寸；服务支持时，在生成前检查输入 token 预算。
- **双语发送排版**：去掉原文与译文之间额外的空行。

**使用说明**：图片翻译目前仅支持本地 llama-server，需使用视觉模型及匹配的 mmproj。术语在请求前按图片附言、版面名称和聊天上下文筛选，仅出现在图片内的词条无法提前匹配。

---

## English

- **Image text translation and summaries**: Right-click a message image to translate its text and summarize key points in one vision generation, with no separate OCR step. Results appear below the image in small gray text; click the source-language badge to change that image’s target language.
- **More reliable image menus**: Improved right-click support for media overlays, proxied images, full-size viewers, and multiple images in one message.
- **Refresh and caching**: Choosing image translation again reloads current glossary terms and chat context. Image data and completed language results are reused to reduce repeated downloads and generation. Fixed message captions being included in image translations.
- **Image request limits**: File-size and dimension checks now cover PNG, JPEG, GIF, and WebP. Input tokens are checked before generation when the server supports counting.
- **Bilingual sending**: Removed the extra blank line between the original and translated text.

**Usage**: Image translation currently requires a local llama-server with a vision model and matching mmproj. Glossary terms are selected before the request using the image caption, area names, and chat context; terms appearing only inside the image cannot be matched in advance.

## 0.9.6 — 2026-10-15

## 中文

- **按版面自动翻译**：频道和帖子分别保存开关，可从侧栏、消息右键菜单或设置中切换；已开启的版面显示侧栏图标。永久切换目标语言不会开启其他版面的自动翻译。
- **减少术语相关消耗**：修改未被本次请求采用的词条不再使翻译缓存失效；新增默认关闭的“术语节省用量”，精简附近术语、别名和备注，保留必要消歧信息。
- **新增 Debug 日志**：默认关闭，开启后可查看请求提示词、模型、响应、用量及缓存／修复记录。支持日志轮转，减少重复内容，并修复 BetterDiscord 下的追加写入与完整事件记录问题。
- **日志异常隔离**：修复开启 Debug 时，模型列表中的空条目可能导致翻译失败的问题；日志整理或写入失败不应中断翻译。

**注意**：Debug 日志包含聊天原文、引用、上下文和提示词，请妥善保管。配置的 API Key 会脱敏，思考正文不写入日志。升级时保留配置与术语表；旧版全局自动翻译开启状态仅迁移到当前版面，其他版面需单独开启。

**验证**：已通过代码复核、162 项离线测试及 Markdown／界面模拟验证；真实 Discord 界面和实际模型服务仍需现场验收。

---

## English

- **Automatic translation per area**: Channels and threads now save their switches independently. Toggle them from the sidebar, message context menu, or settings; enabled areas show a sidebar icon. Permanently changing the target language does not enable translation in other areas.
- **Lower glossary overhead**: Editing terms unused by a request no longer invalidates its translation cache. An optional glossary economy mode, off by default, trims nearby terms, aliases, and notes while retaining disambiguation information.
- **Debug logging**: Opt-in logs record request prompts, models, responses, usage, and cache/repair events. Logs rotate and avoid redundant content. Fixes address appending and missing events in BetterDiscord.
- **Logging error isolation**: Fixed a case where null model-list entries caused translation to fail only with Debug enabled. Log formatting or write failures should not interrupt translation.

**Notes**: Debug logs contain original messages, quoted text, context, and prompts; keep them private. Configured API keys are redacted, and reasoning text is excluded. Retain your settings and glossaries when upgrading. The old global automatic-translation switch migrates to the current area only; enable other areas separately.

**Validation**: Code review, all 162 offline tests, and Markdown/UI simulations passed. Live Discord UI and actual model-service acceptance testing remain outstanding.

## 0.9.5 — 2026-10-14

## 中文

本次更新改进发送模式切换，新增 DeepSeek 专用思考配置，并完善连接测试的反馈和用量统计。

### 新增与改进

- **三状态发送按钮**：点击纸飞机图标，依次切换“发送原文 → 仅发送译文 → 原文及译文”。紫蓝色表示仅译文，青绿色表示双语；切换模式会取消待发送的翻译任务并保留草稿。双语模式与设置中的“发送时附带原文”联动。
- **DeepSeek 专用配置**：新增独立服务类型，支持思考开关及低／高／最大强度。思考默认关闭，专用参数仅用于 DeepSeek 模式；插件只显示和发送最终译文，不展示思考正文。
- **设置按钮排版**：底部“取消”在左、“保存并关闭”在右，统一配色并增加间距，保留统一保存和取消编辑的行为。
- **连接测试反馈修复**：思考测试未完成输出时，明确显示本次实际额度，并提示降低思考强度或关闭思考后手动重试，不再引导无效地提高翻译输出上限；不会自动重试。
- **独立测试用量统计**：“查看请求用量”区分翻译与连接测试，单独记录模型列表检查、取消和失败；即使测试因额度耗尽而失败，服务已返回的 token 用量也会保留。

### 注意事项与验证

- 思考与译文共用输出额度。开启思考时，连接测试最多使用当前输出额度与 2048 tokens 中较小的值，可能产生服务商费用；取消但未收到用量的请求，其实际消耗仍未知。
- 两项上轮审核问题均已通过复核；137 项离线测试、Markdown 渲染及发送按钮／设置界面模拟验证通过。真实 Discord 界面和实际在线服务尚未现场实测。
- 升级时保留配置和术语表，替换旧插件文件，只保留一份 `YetAnotherTranslator.plugin.js`。

---

## English

This release improves send-mode switching, adds dedicated DeepSeek thinking controls, and makes connection-test feedback and usage reporting clearer.

### What's new

- **Three send modes**: Click the paper-plane button to cycle through **Original → Translation only → Original and translation**. Purple-blue indicates translation only; teal indicates bilingual sending. Switching modes cancels pending translation and retains the draft. Bilingual mode is linked to the include-original setting.
- **Dedicated DeepSeek configuration**: A separate provider option adds a thinking toggle and low/high/max effort. Thinking is off by default, and these parameters apply only in DeepSeek mode. Only the final translation is displayed or sent; reasoning text is not shown.
- **Settings button layout**: Cancel sits on the left and Save and close on the right, with consistent colors and clearer spacing. Saving and discarding edits work as before.
- **Clearer connection-test failures**: Incomplete thinking tests report the actual test budget and suggest lowering effort or disabling thinking before retrying manually. They no longer suggest an ineffective increase to the translation output limit. Tests do not retry automatically.
- **Separate test usage**: Usage reporting distinguishes translations from connection tests and tracks model-list checks, cancellations, and failures separately. Server-reported token usage is retained even when a test fails after exhausting its budget.

### Notes and validation

- Thinking and the final translation share the output budget. With thinking enabled, connection tests use the lower of the configured output limit and 2048 tokens and may incur provider charges. Actual consumption remains unknown when a cancelled request returns no usage data.
- Both findings from the previous review are resolved. All 137 offline tests, Markdown rendering checks, and send-button/settings UI simulations passed. Live Discord UI and actual online-service acceptance testing have not been performed.
- When upgrading, retain your configuration and glossaries, replace the old plugin file, and keep only one copy of `YetAnotherTranslator.plugin.js`.

## 0.9.4 — 2026-10-14

### 中文

- 新增在线 LLM 配置，支持兼容 Chat Completions 的 HTTPS 地址、模型 ID 和 API Key，并保留自定义路径和端口。
- 设置改为统一“保存并关闭”或“取消”；测试连接使用草稿配置，不保存修改。
- 修复译文 Markdown 显示，支持标题、副文本和跨空行引用，保留表情、提及和隐藏剧透。
- 普通译文的 AI 标注改为行内小灰字；代码块、引用和列表保留安全分隔。字号和颜色仅本机生效。
- 插件文件与默认术语目录改为 YetAnotherTranslator 命名，更新双语使用文档与校验说明。
- 通过代码复核、124 项离线测试、真实库模拟渲染及 Windows／Linux CI；真实 Discord 界面与在线服务商尚未现场实测。

### English

- Settings now use a draft with Save and close and Cancel in the native modal footer. All edits apply together when saved; cancellation and dismissal discard them. Connection tests use the draft without persisting it. Custom API ports are retained.
- Prefer Discord's message parser for translated Markdown, with headings and lists enabled. Compatibility rules cover headings followed immediately by body text, subtext and multiline quotes across blank lines; real React DOM regressions also verify emoji, mentions, hidden spoilers, unsafe links and cleanup.
- Show ordinary AI translation labels inline with smaller muted text locally; retain safe separators for code blocks, quotes and lists.
- Added local/online model service selection with HTTPS Chat Completions-compatible endpoints, provider-specific base paths, model IDs and Bearer API keys. Online connection tests with a specified model use a short synthetic message without requiring a models endpoint.
- Renamed the plugin file to `YetAnotherTranslator.plugin.js` and the default glossary folder to `YetAnotherTranslator-glossaries`. Updated installation instructions, build scripts and tests.

## 0.9.3 — 2026-10-14

- Validate outgoing translations before caching them. Rejected spoiler, Markdown and length results regenerate on the next manual retry; existing invalid entries are evicted individually. Valid caches survive cancellation, with no automatic retries.
- Separated original text, translation and the AI label into independent paragraphs to preserve closing code fences and ordinary quote/list boundaries.
- Reject unclosed code/spoiler markers and Discord quotes that extend across sections, retaining the draft instead of silently changing its formatting. Translations that lose original spoiler markers are also rejected.
- Check minimum possible bilingual message length and target-language label support before glossary lookup or model inference. The final complete-length check remains in place.
- Added regression coverage for Markdown boundaries, zero-inference rejection and every preset target at both account length limits.

## 0.9.2 — 2026-10-14

- Added an immediately saved, default-off setting to include the original when translating before sending. A single message contains the original, a newline, the translation and an AI translation label in the selected target language.
- Labels cover all preset target languages and are independent of the UI locale, without additional model requests.
- The complete outgoing text is checked against Discord's length limit. Changing the format cancels pending sends; failures retain the draft.

## 0.9.1 — 2026-10-14

- The default target language now saves and applies immediately when selected. Closing BetterDiscord's settings modal no longer discards the choice.
- Native input/change events for the same selection are deduplicated. Other unfinished settings remain in the form and are not persisted by the language selector.
- The current automatic translation switch and independent outgoing language are preserved.

## 0.9.0 — 2026-10-14

- Unified automatic translation language updates. Settings preserve newer defaults selected from a message menu unless the setting is explicitly edited.
- Added an explicit action to apply the default language and clear per-message overrides, including when the default language has not changed. Saving settings retains the automatic translation on/off state.
- Preserved Discord's native rendering for messages containing only mentions and links. Mixed translations resolve user nicknames, roles and channels without exposing raw mention codes. Native mention clicks remain available when the original element can be identified.
- Kept code and escaped mention syntax literal, and mentions inside spoilers hidden until revealed.
- Stored built-in errors as language keys and parameters so existing settings, glossary-check and translation errors update when Discord's language changes. External error details remain unchanged.
- Updated author to **vempx** and linked the plugin to this repository.
- Added publishing documentation, local ZIP packaging and CI checks.

Validation: syntax checks, complete offline regression suite, language catalog validation and ZIP contents/hash verification. Discord's live settings interactions and native mention popovers still require a client check; automated fixtures do not confirm those UI interactions on every Discord build.

## Earlier development

The plugin already supported contextual automatic translation, per-message target selection, a global permanent target switch, translation before sending, editable channel glossaries, source-language badges, spoilers, custom emoji and UI localization.
