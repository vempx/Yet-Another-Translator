[简体中文](README.md) | [English](README.en.md)

# Yet Another Translator

An LLM-powered BetterDiscord plugin for automatic message translation, individual translations, and translation before sending.

## Features

- **Automatic translation:** Translates visible messages one at a time, follows new messages and scrolling, and reuses cached results.
- **Per-message language selection:** Click a source-language badge to change that message's target or permanently switch the global default.
- **Translate before sending:** Translates drafts while retaining replies and attachments. Optionally includes the original and an AI translation label in the target language.
- **Context and terminology:** Uses channel topics, nearby messages, quoted originals, and custom glossaries.
- **Message display:** Preserves Markdown, custom emoji, mentions, and spoilers hidden until revealed.
- **Manual translator:** Enter text, select a target language, and copy the result.
- **Localized interface:** Follows Discord's language, falling back to English for unsupported languages.

## Usage

### Install and configure an LLM

1. Download the plugin ZIP from [Releases](https://github.com/vempx/Yet-Another-Translator/releases) and extract `YetAnotherTranslator.plugin.js`.
2. Open the plugins folder from BetterDiscord settings, place the file there, and enable it. When upgrading, retain your settings and glossaries, replace the old plugin, and keep only one copy.
3. Select Local, Online or the dedicated DeepSeek service type, then enter the API base URL, model ID and required API key. Local uses a loopback address and supports the service root or `/v1`. Online preserves provider paths such as `https://openrouter.ai/api/v1`; full `/chat/completions` URLs are also accepted. Online endpoints must support Chat Completions over HTTPS.
4. Test the connection using the current form without saving. Then choose Save and close in the modal footer to apply changes. Cancel or dismissing the window discards edits. Use context and output limits supported by your service.

**DeepSeek:** Enter the service URL, model ID, and key. Thinking is off by default; enable it to choose low, high, or maximum effort. Thinking and translation share the output budget, and only the final translation is displayed or sent. If a test reports insufficient budget, lower the effort or disable thinking before retrying.

### Translate messages

- Enable automatic translation in settings or the message context menu. Successful translations replace the displayed originals; use the context menu to view the original. Disabling automatic translation restores the originals.
- Use the message context menu to translate an individual message or translate it again. Manual translations retain the original when automatic translation is off.
- The settings target language applies with Save and close. To remove per-message overrides, select the explicit apply-and-clear-overrides action before saving.
- Click a source-language badge, then a language name to retranslate just that message. The circular arrows permanently change the global default and enable automatic translation, including for other channels and future plugin sessions.
- Open the manual translator from the context menu to translate text you enter yourself.

### Translate before sending

1. Click the paper-plane icon with an A next to the message box to cycle through three modes: unlit sends the original, blue-violet sends only the translation, and teal sends both. Hover for the current mode and next action.
2. Select the outgoing target language beside it. This is independent of the default language for incoming messages.
3. Type your message and press Enter or click Send. The plugin submits it using the selected mode.
4. Bilingual mode is linked to the include-original setting: button changes save immediately, while settings edits require Save and close. Bilingual messages include an AI translation label; its smaller gray styling applies only locally.

### Use a glossary

1. Right-click a channel, forum, or thread and enable custom translation.
2. Enter the full path to a glossary JSON file under that area in the plugin settings.
3. Check the glossary, then choose Save and close. Threads without their own configuration can inherit the parent forum's glossary.

Use the supplied [glossaries](glossaries/README.md), or create your own using the [generation prompt](GLOSSARY_GENERATION_PROMPT.md). New translations read saved glossary changes; manually retranslate existing results to refresh them. Configuring a glossary does not enable automatic translation.

The optional economical glossary mode is off by default. It reduces nearby-only terms for independent short messages, keeps matched aliases, merges duplicates and shortens notes while preserving game and character details. It may reduce supporting information; turn it off when needed. Request caches use the glossary content actually sent, so editing an unselected entry alone does not regenerate a translation. Changes to selected entries and explicit retranslation still take effect.

## Notes

- Incoming translations are visible only to you. Translate-before-sending submits the final content to the conversation.
- Messages and selected context are sent to the configured model service. API keys are stored locally without encryption. Online translations and connection tests may incur charges; usage reporting lists them separately. Cancelling a request does not guarantee zero consumption.
- Changing the draft, reply, channel, or sending options during translation cancels the task. Failures, oversized messages, or incomplete formatting retain the draft without sending the original automatically. Attachment-only messages pass through; edits to existing messages do not use translate-before-sending.
- Translation quality depends on the model and available context. After testing the connection, try a short translation to check the result. Verify important content against the original.
