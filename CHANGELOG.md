# Changelog

## Unreleased

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
