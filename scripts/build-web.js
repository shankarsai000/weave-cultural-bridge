// Bundles core, exporters, fixtures and the app into one self-contained page, public/index.html.
// Run from the project root. The bundle has no imports, so the same file also runs as a published page.
import { readFile, writeFile } from "node:fs/promises";
const files = ["web/index.html", "src/core.js", "src/exporters.js", "src/fixtures.js", "web/app.js"];
const [template, ...parts] = await Promise.all(files.map((f) => readFile(f, "utf8")));
await writeFile("public/index.html", template.replace("/*@@BUNDLE@@*/", () => parts.slice(0, 4).join("\n;\n")));
console.log("wrote public/index.html");
