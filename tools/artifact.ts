import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { JsonValue } from "./research-tools.ts";

type ArtifactFormat = "json" | "text";

export interface ArtifactWriteResult {
  artifact: string;
  metadataArtifact: string;
  format: ArtifactFormat;
  byteLength: number;
  sha256: string;
  preview: string;
  sourceUrl?: string;
}

export async function writeArtifact({
  artifactDir,
  name,
  content,
  format = typeof content === "string" ? "text" : "json",
  sourceUrl,
}: {
  artifactDir: string;
  name: string;
  content: JsonValue;
  format?: ArtifactFormat;
  sourceUrl?: string;
}): Promise<ArtifactWriteResult> {
  await mkdir(artifactDir, { recursive: true });

  const slug = safeSlug(name);
  const extension = format === "json" ? "json" : "txt";
  const body = format === "json" ? `${JSON.stringify(content, null, 2)}\n` : String(content);
  const artifact = path.join(artifactDir, `${slug}.${extension}`);
  const metadataArtifact = path.join(artifactDir, `${slug}.meta.json`);
  const bytes = Buffer.from(body);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const preview = body.replace(/\s+/g, " ").trim().slice(0, 500);
  const metadata = {
    artifact,
    format,
    byteLength: bytes.length,
    sha256,
    preview,
    sourceUrl,
    writtenAt: new Date().toISOString(),
  };

  await writeFile(artifact, bytes);
  await writeFile(metadataArtifact, `${JSON.stringify(metadata, null, 2)}\n`);

  return {
    artifact,
    metadataArtifact,
    format,
    byteLength: bytes.length,
    sha256,
    preview,
    sourceUrl,
  };
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "artifact";
}
