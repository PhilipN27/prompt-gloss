import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";

const testDir = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(testDir, "../out");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "package.json"), '{"type":"module"}\n', "utf8");
