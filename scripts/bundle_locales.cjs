"use strict";
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const catalogs = {};
for (const file of fs.readdirSync(path.join(root, "locales")).filter(file => file.endsWith(".json")).sort()) {
    catalogs[file.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(root, "locales", file), "utf8"));
}
const english = catalogs.en;
const protectedTokens = text => [...new Set(text.match(/https?:\/\/[^\s]+|\/v1(?:\/[a-z]+)*|\b(?:Discord|BetterDiscord|LocalTranslator|llama-server|BdApi\.Net\.fetch|JSON|UTF-8)\b|\d+/g) || [])];
for (const [locale, messages] of Object.entries(catalogs)) {
    if (Object.keys(messages).length !== Object.keys(english).length) throw Error(`${locale}: incomplete catalog`);
    for (const [key, value] of Object.entries(english)) {
        const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(",");
        if (typeof messages[key] !== "string" || !messages[key].trim() || placeholders(messages[key]) !== placeholders(value)) throw Error(`${locale}: invalid entry ${key}`);
        for (const token of protectedTokens(value)) {
            if (!messages[key].replace(/(?<=\d)[,\s\u202f](?=\d)/g, "").includes(token)) throw Error(`${locale}: missing protected token ${token} in ${key}`);
        }
        if (key.includes("version: 1") && (!messages[key].includes("version") || !messages[key].includes("entries"))) throw Error(`${locale}: changed glossary schema identifiers`);
        if (key === "glossaryEntryError" && ["en", "zh", "aliases"].some(field => !messages[key].includes(field))) throw Error(`${locale}: changed glossary field identifiers`);
    }
}
const filename = path.join(root, "LocalTranslator.plugin.js");
const source = fs.readFileSync(filename, "utf8");
fs.writeFileSync(filename, source.replace(/^const UI_MESSAGES = .*; \/\/ LOCAL_TRANSLATOR_LOCALES$/m,
    () => `const UI_MESSAGES = ${JSON.stringify(catalogs)}; // LOCAL_TRANSLATOR_LOCALES`), "utf8");
console.log(`Bundled ${Object.keys(catalogs).length} catalogs, ${Object.keys(english).length} strings each.`);
