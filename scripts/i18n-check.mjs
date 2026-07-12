// i18n kulcskészlet-ellenőrző: a messages/hu.json és messages/en.json
// kulcsait diffeli. Nem-üres diff = hiba (exit 1).
// Futtatás: npm run i18n:check

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const load = (file) =>
  JSON.parse(fs.readFileSync(path.join(root, "messages", file), "utf8"));

const flatten = (obj, prefix = []) =>
  Object.entries(obj).flatMap(([key, value]) =>
    value !== null && typeof value === "object"
      ? flatten(value, [...prefix, key])
      : [[...prefix, key].join(".")],
  );

const hu = new Set(flatten(load("hu.json")));
const en = new Set(flatten(load("en.json")));

const onlyHu = [...hu].filter((k) => !en.has(k)).sort();
const onlyEn = [...en].filter((k) => !hu.has(k)).sort();

if (onlyHu.length > 0 || onlyEn.length > 0) {
  console.error("i18n:check HIBA — a kulcskészletek eltérnek:");
  for (const k of onlyHu) console.error(`  csak hu.json: ${k}`);
  for (const k of onlyEn) console.error(`  csak en.json: ${k}`);
  process.exit(1);
}

console.log(`i18n:check OK — ${hu.size} kulcs, mindkét nyelven azonos készlet.`);
