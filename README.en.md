[简体中文](README.md) | [English](README.en.md)

# Yet Another Translator

An LLM-powered BetterDiscord plugin for automatic message translation, individual translations, and translation before sending.

## Features

- **Automatic translation:** Translates visible messages one at a time, follows new messages and scrolling, and reuses cached results.
- **Per-message language selection:** Click a source-language badge to change that message's target or permanently switch the global default.
- **Translate before sending:** Translates drafts while retaining replies and attachments. Optionally includes the original and an AI translation label in the target language.
- **Context and terminology:** Uses channel topics, nearby messages, quoted originals, and custom glossaries.
- **Message display:** Prefers Discord's message parser for Markdown, including headings, subtext, quotes across blank lines, lists and code blocks. Preserves custom emoji, mentions and spoilers hidden until revealed. View originals or request fresh translations.
- **Manual translator:** Enter text, select a target language, and copy the result.
- **Localized interface:** Follows Discord's language. Supports Simplified Chinese, Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Portuguese, Russian, and Italian, with English as the fallback.

## Usage

### Install and configure an LLM

1. Download the plugin ZIP from [Releases](https://github.com/vempx/Yet-Another-Translator/releases) and extract `YetAnotherTranslator.plugin.js`. Each release includes `SHA256SUMS.txt` to verify the ZIP. Interface translations are bundled; no separate language pack is needed.
2. Open the plugins folder from BetterDiscord settings, place the file there, and enable it. When upgrading, replace the old plugin and keep only one copy.
3. Select Local or Online under Model service type, then enter the API base URL, model ID and required API key. Local supports the service root or `/v1`. Online preserves provider paths such as `https://api.deepseek.com/v1` or `https://openrouter.ai/api/v1`; full `/chat/completions` URLs are also accepted. Online endpoints must support Chat Completions.
4. Test the connection using the current form without saving. Then choose Save and close in the modal footer to apply changes. Cancel or dismissing the window discards edits. Specify a model name when multiple models are available, and use supported context/output limits. The port entered in the URL is used; 8080 is only the default.

Online connection tests with a specified model send one short synthetic message, potentially incurring provider charges, without sending chat history. Without a model ID, `/models` is used for discovery. Providers without that endpoint require a model ID. See the [DeepSeek](https://api-docs.deepseek.com/guides/multi_round_chat/) and [OpenRouter](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request) API documentation for endpoint details.

### Translate messages

- Enable automatic translation in settings or the message context menu. Successful translations replace the displayed originals; use the context menu to view the original. Disabling automatic translation restores the originals.
- Use the message context menu to translate an individual message or translate it again. Manual translations retain the original when automatic translation is off.
- The settings target language applies with Save and close. To remove per-message overrides, select the explicit apply-and-clear-overrides action before saving.
- Click a source-language badge, then a language name to retranslate just that message. The circular arrows permanently change the global default and enable automatic translation, including for other channels and future plugin sessions.
- Open the manual translator from the context menu to translate text you enter yourself.
- Headings (`#`, `##`, `###`), subtext (`-#`) and multiline quotes (`>>>`) render as message formatting. Compatibility rules are used when the host message parser is unavailable. Spoilers remain hidden until clicked.

### Translate before sending

1. Click the paper-plane icon with an A next to the message box. A highlighted icon means the feature is enabled.
2. Select the outgoing target language beside it. This is independent of the default language for incoming messages.
3. Type your message and press Enter or click Send. The plugin translates it before submission.
4. For bilingual messages, enable the include-original option and save. It is off by default. The original and translation are separated by a blank line; ordinary translations have an inline AI label styled smaller and gray by this plugin. Code blocks, quotes and lists retain a separate label for safe formatting. Font size and color apply locally for plugin users.

### Use a glossary

1. Right-click a channel, forum, or thread and enable custom translation.
2. Enter the full path to a glossary JSON file under that area in the plugin settings.
3. Check the glossary, then choose Save and close. Threads without their own configuration can inherit the parent forum's glossary.

Use the supplied [glossaries](glossaries/README.md), or create your own using the [generation prompt](GLOSSARY_GENERATION_PROMPT.md). New translations read saved glossary changes; manually retranslate existing results to refresh them. Configuring a glossary does not enable automatic translation.

## Notes

- Select Local or Online under Model service type. Local mode retains the loopback restriction; Online supports HTTPS APIs compatible with Chat Completions, including providers and compatible proxies.
- Messages and selected conversation context are sent to the configured LLM service. A proxy may forward them to its upstream provider. API keys are stored unencrypted in BetterDiscord's configuration.
- Incoming translations are visible only to you. Translate-before-sending submits the final content to the conversation; enabling include-original also sends the original text.
- Changing the draft, reply, channel, target language, or sending options during translation cancels the task. Failures and oversized messages retain the draft without automatically sending the original. Attachment-only messages pass through; edits to existing messages do not use translate-before-sending.
- Bilingual length checks include the original, translation, separators, and label. Unclosed code, spoiler delimiters, or quotes spanning sections may be rejected; adjust the original and retry.
- Translation quality depends on the model and loaded context. Missing historical replies are not downloaded automatically. Check important content against the original.
- A successful connection test does not guarantee successful generation. Try a short translation to verify it. Context budgets are estimates; actual usage depends on data returned by the service.
- v0.9.4 passed code review, 124 offline tests, real Markdown library and React DOM simulation checks, and Windows/Linux CI. Live Discord UI and online-provider acceptance testing have not been performed.
- Keep your configuration and glossaries when upgrading. Do not enable old and new copies of the plugin together.
