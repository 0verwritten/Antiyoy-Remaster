// Builds the lakebed capsule and fails if the client bundle is over budget.
// lakebed's hard artifact limit is 1 MB. Auth, reactive queries, and mutations
// add the Lakebed client transport runtime. Keep a small margin below the hard
// limit while Lakebed includes inline source maps in deployment artifacts.
// Usage: node devtools/check-bundle.mjs [budgetBytes]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAKEBED_VERSION = "0.0.25";
const BUDGET = Number(process.argv[2] ?? 1000 * 1024);
const HARD_LIMIT = 1024 * 1024;
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
console.log(`client bundle: ${kb(client)} (budget ${kb(BUDGET)}, hard limit ${kb(HARD_LIMIT)})`);
console.log(`server bundle: ${kb(server)}`);

if (client > HARD_LIMIT) {
  console.error(`FAIL: client bundle exceeds Lakebed's ${kb(HARD_LIMIT)} hard limit`);
  process.exit(1);
}
if (client > BUDGET) {
  console.error(`FAIL: client bundle exceeds the ${kb(BUDGET)} budget`);
  process.exit(1);
}
console.log("OK: bundle within budget");
