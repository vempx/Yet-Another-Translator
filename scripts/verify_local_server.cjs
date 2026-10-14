"use strict";
// Uses synthetic messages only. Never connects to Discord's sending API.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const sandbox = {module: {exports: {}}, require, __dirname: root, URL, AbortController, TextDecoder, setTimeout, clearTimeout};
const source = fs.readFileSync(path.join(root, "YetAnotherTranslator.plugin.js"), "utf8");
const version = /@version\s+(\S+)/.exec(source)?.[1] || "unknown";
vm.runInNewContext(source +
    "\nmodule.exports.verification = {TranslationClient, DEFAULTS, validateSettings};", sandbox);
const {TranslationClient, DEFAULTS, validateSettings} = sandbox.module.exports.verification;

async function main() {
    let saved = {};
    const config = process.argv[2] || (process.env.APPDATA && path.join(process.env.APPDATA, "BetterDiscord", "plugins", "LocalTranslator.config.json"));
    if (config && fs.existsSync(config)) saved = JSON.parse(fs.readFileSync(config, "utf8")).settings || {};
    const settings = validateSettings({...DEFAULTS, ...saved, targetLanguage: "English", maxTokens: 512, timeoutSeconds: 60});
    const headers = settings.apiKey ? {Authorization: `Bearer ${settings.apiKey}`} : {};
    const report = {date: new Intl.DateTimeFormat("en-CA", {timeZone: "Asia/Hong_Kong"}).format(new Date()), pluginVersion: version, transport: "real local model; synthetic text; no Discord sends", cases: []};
    const client = new TranslationClient(fetch);
    try {
        const models = await client.models({...settings, timeoutSeconds: 5});
        settings.model ||= models[0];
        try {
            const url = new URL("/props", settings.baseUrl);
            url.searchParams.set("model", settings.model);
            const response = await fetch(url, {headers, signal: AbortSignal.timeout(5000)});
            if (response.ok) {
                const props = await response.json();
                const capacity = props.default_generation_settings?.n_ctx;
                if (Number.isInteger(capacity) && capacity >= 2048) settings.contextTokens = Math.min(capacity, 262144);
                report.serverContextTokens = capacity || null;
            }
        } catch {report.serverContextTokens = null;}
        const glossary = {name: "Synthetic verification", version: "1", entries: [
            {en: "Iuno", zh: "尤诺"}, {en: "signature weapon", zh: "专武"}
        ], priorities: ["direct", "direct"]};
        const base = {target: {draft: true, sentAt: "2026-10-14T00:00:00Z"}, before: [], after: []};
        const cases = [
            ["short", "我同意。", base],
            ["reply and terms", "尤诺的专武值得抽吗？", {...base, reply: {id: "1", speaker: "test-speaker", text: "Iuno is fun to play."}, glossary}],
            ["dense references", "尤诺的专武值得抽吗？", {...base, before: Array.from({length: 6}, (_, index) => ({id: String(index + 2), text: "Synthetic game discussion. ".repeat(100)})), glossary}],
            ["Markdown and URL", "请看 **设置** 和 `r.Test=1`：[说明](https://example.com)", base],
            ["bilingual equality", "我同意你的看法。", {...base, reply: {id: "99", text: "I agree with your opinion."},
                glossary: {name: "Synthetic phrase", version: "1", entries: [{en: "I agree with your opinion.", zh: "我同意你的看法。"}], priorities: ["direct"]}}],
            ["Japanese heading and language metadata", "翻訳：こんにちは", {...base, detectLanguage: true}],
            ["spoiler and language metadata", "This is ||a secret|| message.", {...base, detectLanguage: true}]
        ];
        for (const [name, source, context] of cases) {
            const before = {...client.stats};
            const result = await client.translate(source, settings, undefined, context);
            report.cases.push({name, outputCharacters: result.length, generations: client.stats.generations - before.generations,
                actualPromptTokens: client.stats.usageResponses > before.usageResponses ? client.stats.promptTokens - before.promptTokens : null,
                actualCompletionTokens: client.stats.usageResponses > before.usageResponses ? client.stats.completionTokens - before.completionTokens : null,
                estimatedInput: client.stats.lastEstimatedInput, configuredInputLimit: settings.contextTokens - settings.maxTokens,
                ...(name === "bilingual equality" ? {outputMatchesReply: result === context.reply.text} : {})});
            if (context.detectLanguage) {
                report.cases.at(-1).sourceLanguage = client.sourceLanguageFor(source);
                report.cases.at(-1).translationHasJSONEnvelope = result.startsWith('{"translation"');
                if (name.startsWith("spoiler")) report.cases.at(-1).spoilerDelimitersPreserved = result.includes("||");
            }
        }
        const beforeCache = client.stats.generations;
        await client.translate(cases[0][1], settings, undefined, {...base, target: {...base.target, sentAt: "2026-10-14T01:00:00Z"}});
        report.stableDraftCache = client.stats.generations === beforeCache;
        const controller = new AbortController();
        const pending = client.translate("这是一个用于取消检查的本地合成句子。".repeat(30), settings, controller.signal, base);
        setTimeout(() => controller.abort(), 100);
        try {await pending; report.cancellation = "generation completed before abort";}
        catch (error) {report.cancellation = error.name === "AbortError" ? "client abort verified; server inference stop requires server logs" : error.message;}
        report.statistics = client.stats;
        report.status = "completed";
    } catch (error) {report.status = "unavailable or incomplete"; report.error = error.message;}
    fs.writeFileSync(path.join(root, `LOCAL_SERVER_VERIFICATION_${version}.json`), JSON.stringify(report, null, 2), "utf8");
    console.log(JSON.stringify(report, null, 2));
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
