// Renders the simulator camera images and the architecture diagram.
// Usage: node scripts/render-assets.mjs   (uses the locally installed Chrome through Playwright)
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const jobs = [
  { src: "scenes/walter-front-door.svg", out: "public/sim/walter-front-door.jpg", width: 1280, height: 720, type: "jpeg" },
  { src: "scenes/walter-driveway.svg", out: "public/sim/walter-driveway.jpg", width: 1280, height: 720, type: "jpeg" },
  { src: "docs/architecture.html", out: "docs/architecture.png", width: 1600, height: 1000, type: "png", scale: 2 },
];

const only = process.argv[2];
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const job of jobs) {
  if (only && !job.src.includes(only)) continue;
  const file = path.join(root, job.src);
  if (!fs.existsSync(file)) {
    console.log("skip (missing)", job.src);
    continue;
  }
  const page = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: job.scale ?? 1 });
  if (job.src.endsWith(".svg")) {
    const svg = fs.readFileSync(file, "utf8");
    await page.setContent(`<html><body style="margin:0;background:#000">${svg}</body></html>`);
  } else {
    await page.goto("file://" + file.replace(/\\/g, "/"));
  }
  await page.waitForTimeout(400);
  fs.mkdirSync(path.dirname(path.join(root, job.out)), { recursive: true });
  await page.screenshot({ path: path.join(root, job.out), type: job.type, quality: job.type === "jpeg" ? 86 : undefined, clip: { x: 0, y: 0, width: job.width, height: job.height } });
  console.log("wrote", job.out);
  await page.close();
}
await browser.close();
