// Copies docs/USER_MANUAL.md into web/lib/manual.generated.ts so the Help page can show it
// (Vercel builds from web/, and the manual lives at the repository root in docs/).
// Runs automatically before `npm run dev`, `npm run build` and `npm run typecheck`.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "docs", "USER_MANUAL.md");
const out = join(here, "..", "lib", "manual.generated.ts");
if (!existsSync(src)) {
  if (existsSync(out)) process.exit(0); // keep the last copy
  writeFileSync(out, "export const MANUAL_MD = \"# User manual\\n\\nThe manual file was not found.\";\n");
  process.exit(0);
}
const md = readFileSync(src, "utf8");
const next = `// Generated from docs/USER_MANUAL.md by scripts/embed-manual.mjs — edit the manual, not this file.\nexport const MANUAL_MD = ${JSON.stringify(md)};\n`;
if (!existsSync(out) || readFileSync(out, "utf8") !== next) writeFileSync(out, next);
