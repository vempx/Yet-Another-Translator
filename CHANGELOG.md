# Changelog

## Unreleased

- Reduced Debug log duplication: originals appear only at operation start, full prompts remain once in request JSON, and cache-hit events refer to the final result instead of repeating it. Version 2 entries retain request/response correlation and leave existing logs unchanged.

- Fixed missing Debug request/response events after the first log entry: support BetterDiscord’s direct Buffer export when measuring UTF-8 log size. Added full-chain logging coverage with an existing file and an automatically resolved model.

- Fixed Debug logging on BetterDiscord’s limited filesystem bridge, which has no fs.promises or appendFile. Preserve append/rotation behavior and recover filesystem error codes stripped by Electron.

- Added opt-in Debug file logging with timestamps, resolved models, translation kinds, originals, exact redacted prompts, responses, usage, duration, cache and repair events. Logs rotate with three backups; write errors do not interrupt translation.

- Fixed sidebar auto-translation tags for non-link channel rows, stable list/name IDs and absolute links. Reserve space inside the name to avoid clipping, and clean up tags across remounts and row reuse.
- Saved automatic visible-message translation per area, with sidebar/message context-menu switches, current-area settings and sidebar icon tags. Channels and threads are independent; legacy global enabling migrates only to the current area, and permanent language switching does not enable other areas.
- Cache translations by the glossary content actually sent rather than local file versions. Empty selections normalize to no glossary; selected changes and explicit refresh still regenerate.
- Added optional economical glossary prompts, off by default, with smaller nearby-term budgets, short-message filtering, matched aliases, duplicate merging and bounded notes while preserving disambiguation fields.

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
