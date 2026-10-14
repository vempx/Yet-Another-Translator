# v0.9.4 review result / 审核结论

## 中文

第九轮代码复核（2026-10-14）确认 T8-1 已修复，未发现新的阻塞问题，允许进行文档更新和版本发布。审核基线为 `94ade89`；发布准备只修改版本号、文档及发布记录，未再次修改功能实现。

验证包括语法检查、124 项离线测试、`scripts/verify_markdown.cjs` 真实 Markdown 库与 React 模拟 DOM 检查、既有本地渲染验证及 10 份语言包一致性校验。消息解析器优先级、标题、副文本、跨空行引用、表情／提及／隐藏剧透、安全过滤和卸载清理均在此次验证范围内。

此结论不代表真实 Discord 界面验收或所有在线服务商兼容性验证完成；未调用真实模型或发送 Discord 消息。发布前另行核对 Windows／Linux CI、版本、标签、ZIP 内容及 SHA-256。

## English

The ninth code review on 2026-10-14 closed T8-1 and found no new blocking issues, allowing documentation updates and release preparation. The reviewed implementation is commit `94ade89`; release preparation changes only version metadata, documentation and release records.

Validation covers syntax checks, 124 offline tests, the real Markdown library and React DOM simulation in `scripts/verify_markdown.cjs`, the existing local rendering checks, and consistency of all 10 locale catalogs. Parser priority, headings, subtext, quotes across blank lines, emoji, mentions, hidden spoilers, safety filtering and cleanup were included.

This does not constitute live Discord UI acceptance or compatibility testing of every online provider. No real model calls or Discord messages were sent. Windows/Linux CI, version and tag alignment, ZIP contents and SHA-256 are separately verified before publishing.
