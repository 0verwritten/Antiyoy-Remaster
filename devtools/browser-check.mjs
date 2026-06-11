// Real-browser smoke test against a running `npx lakebed dev` server.
// Usage: node devtools/browser-check.mjs [port|url]
// Needs: npm i (in devtools/), plus Google Chrome installed (playwright-core
// drives the system Chrome via channel:"chrome" — no browser download).
import { chromium } from "playwright-core";

const arg = process.argv[2] ?? "3203";
const base = arg.startsWith("http") ? arg : `http://localhost:${arg}`;
const errors = [];

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("favicon")) errors.push("console: " + m.text());
});

await page.goto(base + "/", { waitUntil: "networkidle", timeout: 45000 });
await page.getByRole("button", { name: /^play$/i }).click();
await page.waitForTimeout(1800);
await page.screenshot({ path: "/tmp/antiyoy-check-game.png" });

// Click a tile of the human player's color (original green #60b55c).
const spot = await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const ctx = c.getContext("2d");
  const data = ctx.getImageData(0, 0, c.width, c.height).data;
  const dpr = window.devicePixelRatio || 1;
  for (let y = 120; y < c.height - 120; y += 5) {
    for (let x = 80; x < c.width - 80; x += 5) {
      const i = (y * c.width + x) * 4;
      if (
        Math.abs(data[i] - 0x60) < 12 &&
        Math.abs(data[i + 1] - 0xb5) < 12 &&
        Math.abs(data[i + 2] - 0x5c) < 12
      ) {
        return { x: x / dpr, y: y / dpr };
      }
    }
  }
  return null;
});
if (!spot) throw new Error("no green tile found on canvas");
await page.mouse.click(spot.x, spot.y);
await page.waitForTimeout(500);
const hud = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 160));
console.log("HUD after selecting province:", hud);

await page.keyboard.press("e"); // end turn -> AI plays
await page.waitForTimeout(3500);
const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 80));
console.log("after end turn:", after);
await page.screenshot({ path: "/tmp/antiyoy-check-round2.png" });

console.log("ERRORS:", errors.length ? errors.join("\n") : "none");
console.log("screenshots: /tmp/antiyoy-check-game.png /tmp/antiyoy-check-round2.png");
await browser.close();
process.exit(errors.length ? 1 : 0);
