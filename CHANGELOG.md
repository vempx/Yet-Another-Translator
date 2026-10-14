# Changelog

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

The plugin already supported contextual automatic translation, per-message target selection, a global permanent target switch, translation before sending, editable channel glossaries, source-language badges, spoilers, custom emoji and UI localization. The original `LocalTranslator` registration ID and filename are retained to preserve existing BetterDiscord settings.
