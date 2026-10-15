"use strict";
// Build-time only: translates bundled UI text with the user's local llama-server.
// No Discord messages or credentials are included in the translation payload.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const english = JSON.parse(fs.readFileSync(path.join(root, "locales/en.json"), "utf8"));
const keys = Object.keys(english);
const names = {"zh-TW": "Traditional Chinese (Taiwan)", ja: "Japanese", ko: "Korean", fr: "French", de: "German", es: "Spanish", pt: "Brazilian Portuguese", ru: "Russian", it: "Italian", nl: "Dutch", pl: "Polish", tr: "Turkish", uk: "Ukrainian", ar: "Arabic", hi: "Hindi", th: "Thai", vi: "Vietnamese", id: "Indonesian", da: "Danish", sv: "Swedish", no: "Norwegian", fi: "Finnish", cs: "Czech", el: "Greek", hu: "Hungarian", ro: "Romanian", bg: "Bulgarian", hr: "Croatian", lt: "Lithuanian"};
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(",");
async function main() {
    const configPath = path.join(process.env.APPDATA, "BetterDiscord/plugins/YetAnotherTranslator.config.json");
    const settings = JSON.parse(fs.readFileSync(configPath, "utf8")).settings;
    const url = new URL(settings.baseUrl); if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw Error("Local server required");
    url.pathname = "/v1"; url.search = ""; url.hash = "";
    const headers = {"Content-Type": "application/json", ...(settings.apiKey ? {Authorization: `Bearer ${settings.apiKey}`} : {})};
    const models = await (await fetch(`${url.toString().replace(/\/$/, "")}/models`, {headers})).json();
    const model = settings.model || models.data[0].id;
    const queue = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(names);
    const failures = [];
    async function worker() {
        while (queue.length) {
            const locale = queue.shift(), destination = path.join(root, `locales/${locale}.json`);
            if (!names[locale]) throw Error(`Unknown locale ${locale}`);
            if (fs.existsSync(destination)) continue;
            try {
                const translated = {};
                for (let start = 0; start < keys.length; start += 150) {
                    const batch = keys.slice(start, start + 150);
                    const input = Object.fromEntries(batch.map((key, index) => [String(start + index), english[key]]));
                    const response = await fetch(`${url.toString().replace(/\/$/, "")}/chat/completions`, {
                        method: "POST", headers, signal: AbortSignal.timeout(180000),
                        body: JSON.stringify({model, temperature: 0, max_tokens: 10000, chat_template_kwargs: {enable_thinking: false}, messages: [
                            {role: "system", content: `Translate this software UI JSON into ${names[locale]}. Return only a JSON object with exactly the same numeric keys. Preserve every {placeholder} EXACTLY, every number, file/API path, identifier (en, zh, aliases, entries, version, usage), product name (Discord, BetterDiscord, YetAnotherTranslator, llama-server) and URL. Use concise natural software UI wording. Do not translate identifiers or add explanations. This is UI localization, not chat translation. /no_think`},
                            {role: "user", content: JSON.stringify(input)}
                        ]})
                    });
                    if (!response.ok) throw Error(`HTTP ${response.status}`);
                    const data = await response.json();
                    const output = JSON.parse(data.choices[0].message.content.replace(/^\s*```(?:json)?\s*/, "").replace(/\s*```\s*$/, ""));
                    for (const [index, key] of batch.entries()) {
                        const text = output[String(start + index)];
                        if (typeof text !== "string" || !text.trim() || placeholders(text) !== placeholders(english[key])) throw Error(`Invalid key ${start + index}`);
                        translated[key] = text;
                    }
                }
                fs.writeFileSync(destination, JSON.stringify(translated, null, 2) + "\n", "utf8");
                console.log(`${locale}: ${keys.length} strings generated and placeholders checked`);
            } catch (error) {failures.push(locale); console.log(`${locale}: ${error.message}`);}
        }
    }
    await Promise.all([worker(), worker()]);
    if (failures.length) {console.log(`Retry: ${failures.join(" ")}`); process.exitCode = 1;}
}
main().catch(error => {console.error(error.message); process.exitCode = 1;});
