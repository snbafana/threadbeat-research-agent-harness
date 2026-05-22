import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface TranslationResult {
  sourceText: string;
  targetLanguage: string;
  detectedScripts: string[];
  translatedText: string;
  glossary: Array<{ source: string; target: string }>;
  confidence: "low" | "medium" | "high";
  warning?: string;
  artifact?: string;
}

const GLOSSARY: Record<string, string> = {
  "国土空间规划": "territorial spatial planning",
  "自然资源局": "natural resources bureau",
  "控制性详细规划": "regulatory detailed planning",
  "政府信息公开": "government information disclosure",
  "规划图": "planning map",
  "地图": "map",
  "省": "province",
  "市": "city",
  "县": "county",
};

export async function translateText({
  text,
  targetLanguage = "en",
  artifactDir,
  name,
}: {
  text: string;
  targetLanguage?: string;
  artifactDir?: string;
  name?: string;
}): Promise<TranslationResult> {
  const detectedScripts = detectScripts(text);
  const glossary = Object.entries(GLOSSARY)
    .filter(([source]) => text.includes(source))
    .map(([source, target]) => ({ source, target }));
  const translatedText = applyGlossary(text, glossary);
  const result: TranslationResult = {
    sourceText: text,
    targetLanguage,
    detectedScripts,
    translatedText,
    glossary,
    confidence: glossary.length || detectedScripts.length === 1 && detectedScripts.includes("latin") ? "medium" : "low",
    warning: "Deterministic glossary translation only; preserve original text and use a model/human translator before relying on nuance.",
  };

  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    const suffix = createHash("sha256").update(text).digest("hex").slice(0, 10);
    result.artifact = path.join(artifactDir, `${safeSlug(name ?? "translation")}-${suffix}.json`);
    await writeFile(result.artifact, `${JSON.stringify(result, null, 2)}\n`);
  }

  return result;
}

function detectScripts(text: string): string[] {
  const scripts = new Set<string>();
  if (/\p{Script=Han}/u.test(text)) scripts.add("han");
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(text)) scripts.add("kana");
  if (/\p{Script=Hangul}/u.test(text)) scripts.add("hangul");
  if (/\p{Script=Cyrillic}/u.test(text)) scripts.add("cyrillic");
  if (/[A-Za-z]/.test(text)) scripts.add("latin");
  return [...scripts];
}

function applyGlossary(text: string, glossary: Array<{ source: string; target: string }>): string {
  let translated = text;
  for (const { source, target } of glossary) {
    translated = translated.replaceAll(source, `${source} [${target}]`);
  }
  return translated;
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "translation";
}
