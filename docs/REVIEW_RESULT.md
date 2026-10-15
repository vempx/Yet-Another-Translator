# Review results / 审核记录

## v0.9.6

第十四轮复核（2026-10-15）关闭 T13-1，本次修改范围未发现新的重要问题。审核基线为 f19fdd5。Debug 模型列表与业务模型发现共享有效 ID 过滤；日志响应字段整理在异常隔离范围内执行。术语缓存／节省用量、版面独立开关与侧栏标记、日志兼容写入及去重的既有回归通过。162 项离线测试、Markdown 渲染、发送模式／设置 React 与侧栏模拟、10 份各 197 条语言包一致性检查均通过。发布准备仅提升版本与更新文档，不修改已审核实现。真实 Discord／实际模型服务仍待现场验收。

The fourteenth review on 2026-10-15 closed T13-1 with no new significant findings in scope, against commit f19fdd5. Debug model-list projection shares the normal valid-ID filter, and response diagnostics run within the logging exception boundary. Existing glossary cache/economy, per-area translation/sidebar tags, log compatibility and compact-format regressions passed. All 162 offline tests, Markdown rendering, send-mode/settings React and sidebar simulations, and consistency checks for 10 catalogs of 197 entries passed. Release preparation only updates version metadata and documentation. Live Discord and actual model services remain outside this acceptance scope.


## v0.9.5

第十一轮复核（2026-10-14）关闭 T10-1 和 T10-2，未发现新的重要问题。基线为 `66d96a0b3aad23c321c44382baa52da31813a499`。复核覆盖连接测试预算提示、独立用量统计、三状态发送、DeepSeek 参数及设置按钮回归；137 项离线测试、实际库 DOM 渲染、真实 React 宿主模拟和语言包一致性校验均通过。发布准备只更新版本及文档，未修改已审核的实现。真实 Discord／实际在线模型尚未现场验收。

The eleventh review on 2026-10-14 closed T10-1 and T10-2 with no new significant issues in scope. The reviewed commit is `66d96a0b3aad23c321c44382baa52da31813a499`. Validation covered test-budget feedback, separate usage accounting, three send modes, DeepSeek parameters and settings-footer regressions. All 137 offline tests, real-library DOM rendering, React host simulations and locale consistency checks passed. Release preparation changes only version metadata and documentation. Live Discord and actual online models remain untested.

## v0.9.4

## 中文

第九轮代码复核（2026-10-14）确认 T8-1 已修复，未发现新的阻塞问题，允许进行文档更新和版本发布。审核基线为 `94ade89`；发布准备只修改版本号、文档及发布记录，未再次修改功能实现。

验证包括语法检查、124 项离线测试、`scripts/verify_markdown.cjs` 真实 Markdown 库与 React 模拟 DOM 检查、既有本地渲染验证及 10 份语言包一致性校验。消息解析器优先级、标题、副文本、跨空行引用、表情／提及／隐藏剧透、安全过滤和卸载清理均在此次验证范围内。

此结论不代表真实 Discord 界面验收或所有在线服务商兼容性验证完成；未调用真实模型或发送 Discord 消息。发布前另行核对 Windows／Linux CI、版本、标签、ZIP 内容及 SHA-256。

## English

The ninth code review on 2026-10-14 closed T8-1 and found no new blocking issues, allowing documentation updates and release preparation. The reviewed implementation is commit `94ade89`; release preparation changes only version metadata, documentation and release records.

Validation covers syntax checks, 124 offline tests, the real Markdown library and React DOM simulation in `scripts/verify_markdown.cjs`, the existing local rendering checks, and consistency of all 10 locale catalogs. Parser priority, headings, subtext, quotes across blank lines, emoji, mentions, hidden spoilers, safety filtering and cleanup were included.

This does not constitute live Discord UI acceptance or compatibility testing of every online provider. No real model calls or Discord messages were sent. Windows/Linux CI, version and tag alignment, ZIP contents and SHA-256 are separately verified before publishing.
