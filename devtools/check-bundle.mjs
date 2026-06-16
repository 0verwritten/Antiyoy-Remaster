// Builds the Lakebed capsule and reports client/server bundle sizes.
// Pass a byte budget to make the script fail when the client exceeds it.
// Usage: node devtools/check-bundle.mjs [optionalBudgetBytes]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAKEBED_VERSION = "0.0.25";
const BUDGET = process.argv[2] ? Number(process.argv[2]) : null;
const webDir = join(dirname(fileURLToPath(import.meta.url)), "..", "web");

execFileSync("npx", ["--yes", `lakebed@${LAKEBED_VERSION}`, "build", "--target", "anonymous"], {
  cwd: webDir,
  stdio: ["ignore", "ignore", "inherit"],
});

const artifact = JSON.parse(
  readFileSync(join(webDir, ".lakebed/artifacts/web.anonymous.json"), "utf8")
).artifact;
const client = artifact.client.bytes;
const server = artifact.server.source.bytes;
const kb = (n) => (n / 1024).toFixed(1) + " KB";
console.log(`client bundle: ${kb(client)}${BUDGET ? ` (budget ${kb(BUDGET)})` : ""}`);
console.log(`server bundle: ${kb(server)}`);

if (BUDGET && client > BUDGET) {
  console.error(`FAIL: client bundle exceeds the ${kb(BUDGET)} budget`);
  process.exit(1);
}
console.log(BUDGET ? "OK: bundle within budget" : "OK: bundle size reported");
