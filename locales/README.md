# 界面语言包

插件从 Discord 的 LocaleStore／locale 模块读取界面语言，缺少接口时回退到页面语言和系统浏览器语言。相同语言的地区变体共用语言包，例如 en-US / en-GB、es-ES / es-419、pt-BR。简体、繁体中文分别处理；不支持的语言或缺少的文案回退到英文。

`en.json` 是完整的基准目录。键名中的中文是文案标识，并不表示当前显示语言；动态文案使用命名键，例如 `settingsSaved`。简体中文沿用原有文案。其他 `.json` 文件存放对应语言的显示文字，均可明文编辑。保留 `{url}`、`{language}` 等占位符，以及路径、产品名、数字和 API 标识。不要修改消息翻译目标的持久化值。

修改后在项目根目录运行：

```powershell
node scripts/bundle_locales.cjs
node --check YetAnotherTranslator.plugin.js
node --test YetAnotherTranslator.test.cjs
```

构建会校验语言包完整性、占位符及关键技术参数，然后将语言包内置到单个插件文件。安装时仍只需要更新 `YetAnotherTranslator.plugin.js`；插件运行不读取这些 JSON，也不会为了显示界面访问网络或请求模型。

`scripts/build_locales.cjs` 是开发阶段的语言包初稿生成工具，使用本机 llama-server，只发送英文界面文案，不发送 Discord 消息。默认保留已经存在的文件。生成初稿仍需检查术语和显示效果；修改语言包后重新构建。
