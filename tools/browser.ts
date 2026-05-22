import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { webFetch } from "./web.ts";

export interface BrowserSnapshot {
  url: string;
  title: string;
  text: string;
  textChars: number;
  mode: "browser" | "fallback_fetch";
  screenshotArtifact?: string;
  textArtifact?: string;
  warning?: string;
}

export async function browserSnapshot({
  url,
  artifactDir,
  name,
  maxChars = 12000,
}: {
  url: string;
  artifactDir?: string;
  name?: string;
  maxChars?: number;
}): Promise<BrowserSnapshot> {
  if (artifactDir) await mkdir(artifactDir, { recursive: true });
  const slug = safeSlug(name ?? new URL(url).hostname);

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      const title = await page.title();
      const text = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, maxChars);
      const screenshotArtifact = artifactDir ? path.join(artifactDir, `${slug}.png`) : undefined;
      const textArtifact = artifactDir ? path.join(artifactDir, `${slug}.txt`) : undefined;
      if (screenshotArtifact) await page.screenshot({ path: screenshotArtifact, fullPage: true });
      if (textArtifact) await writeFile(textArtifact, text);
      return {
        url,
        title,
        text,
        textChars: text.length,
        mode: "browser",
        screenshotArtifact,
        textArtifact,
      };
    } finally {
      await browser.close();
    }
  } catch (error) {
    const fetched = await webFetch(url, { maxChars });
    const textArtifact = artifactDir ? path.join(artifactDir, `${slug}.fallback.txt`) : undefined;
    if (textArtifact) await writeFile(textArtifact, fetched.text);
    return {
      url,
      title: fetched.title,
      text: fetched.text,
      textChars: fetched.charCount,
      mode: "fallback_fetch",
      textArtifact,
      warning: `Browser snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "snapshot";
}
