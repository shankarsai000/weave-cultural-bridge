import { readFile, writeFile } from "node:fs/promises";
const files = [
  "web/index.html",
  "src/core.js",
  "src/exporters.js",
  "src/fixtures.js",
  "src/synesthesia.js",
  "src/rehearsal.js",
  "web/app.js",
];
const [template, ...parts] = await Promise.all(files.map((f) => readFile(f, "utf8")));
// Clean relative imports so concatenated module executes cleanly in browser
const cleaned = parts.map((code) => code.replace(/^\s*import\s+.*?from\s+["']\.\/.*?["'];?\s*$/gm, ""));
await writeFile("public/index.html", template.replace("/*@@BUNDLE@@*/", () => cleaned.join("\n;\n")));
console.log("wrote public/index.html");
