"use strict";
// Rebuild/check the offline root-zone snapshot; this script never accesses the network.
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, "..");
const snapshot = fs.readFileSync(path.join(root, "data", "iana-tlds.txt"), "utf8");
const lines = snapshot.trim().split(/\r?\n/);
if (!/^# Version \d+, Last Updated /.test(lines[0])) throw Error("Invalid IANA snapshot header");
const labels = lines.filter(line => line && !line.startsWith("#"));
if (labels.length < 1000 || new Set(labels).size !== labels.length || labels.some(label => !/^[A-Z0-9-]+$/.test(label))) throw Error("Invalid IANA root labels");
for (const required of ["COM", "APP", "ZIP", "PY"]) if (!labels.includes(required)) throw Error("Incomplete IANA snapshot");
const filename = path.join(root, "YetAnotherTranslator.plugin.js");
const source = fs.readFileSync(filename, "utf8");
const marker = /^const DOMAIN_ROOTS = .*; \/\/ YAT_DOMAIN_ROOTS$/m;
if (!marker.test(source)) throw Error("Domain root bundle marker is missing");
const bundled = source.replace(marker, () => `const DOMAIN_ROOTS = new Set(${JSON.stringify(labels.map(label => label.toLowerCase()).join(" "))}.split(" ")); // YAT_DOMAIN_ROOTS`);
if (process.argv.includes("--check")) {if (bundled !== source) throw Error("Bundled domain roots are out of date");}
else fs.writeFileSync(filename, bundled, "utf8");
console.log(`Validated ${labels.length} offline IANA domain roots.`);
