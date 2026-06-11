/**
 * postinstall: make `sharp` import-safe without its native binary.
 *
 * @xenova/transformers eagerly imports sharp for IMAGE pipelines; our text
 * feature-extraction never calls it, but a missing native build makes the
 * import itself throw. If sharp doesn't load, overwrite its entrypoint with a
 * lazy stub that imports fine and only throws if an image op is actually used.
 */
import { createRequire } from "node:module";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
try {
  require("sharp");
  console.log("[stub-sharp] sharp loads natively — no stub needed");
  process.exit(0);
} catch {
  /* fall through and stub */
}

const STUB = `// STUB (Handoff, text-only build): sharp's native binary is unavailable here.
// transformers.js imports sharp eagerly but text embedding never calls it.
module.exports = new Proxy(function () { throw new Error('sharp stub: image ops unavailable'); }, {
  get() { return () => { throw new Error('sharp stub: image ops unavailable'); }; },
});
`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "node_modules", ".pnpm");
let stubbed = 0;
if (existsSync(root)) {
  for (const d of readdirSync(root)) {
    if (!d.startsWith("sharp@")) continue;
    const entry = join(root, d, "node_modules", "sharp", "lib", "index.js");
    if (existsSync(entry)) {
      writeFileSync(entry, STUB);
      stubbed++;
    }
  }
}
console.log(`[stub-sharp] stubbed ${stubbed} sharp install(s) — text embedding unaffected`);
