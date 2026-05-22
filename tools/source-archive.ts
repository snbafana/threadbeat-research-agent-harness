import { writeArtifact, type ArtifactWriteResult } from "./artifact.ts";
import type { JsonValue } from "./research-tools.ts";

export interface SourceArchiveResult extends ArtifactWriteResult {
  archiveId: string;
  url: string;
  title: string;
  decision: string;
  sourceArtifacts: string[];
}

export async function archiveSource({
  artifactDir,
  index,
  result,
  fetched,
  pdf,
  decision,
  rank,
}: {
  artifactDir: string;
  index: number;
  result: Record<string, unknown>;
  fetched: Record<string, unknown>;
  pdf?: Record<string, unknown> | null;
  decision: Record<string, unknown>;
  rank: Record<string, unknown>;
}): Promise<SourceArchiveResult> {
  const title = stringValue(result.title) || stringValue(fetched.title) || `source ${index}`;
  const url = stringValue(result.url) || stringValue(fetched.url);
  const archiveId = `source-${index}`;
  const sourceArtifacts = [
    stringValue(pdf?.pdfArtifact),
    stringValue(pdf?.textArtifact),
    stringValue(fetched.screenshotArtifact),
    stringValue(fetched.textArtifact),
  ].filter(Boolean);
  const content = {
    archiveId,
    citation: {
      title,
      url,
      sourceType: stringValue(decision.sourceType),
    },
    result: jsonObject(result),
    fetched: {
      url: stringValue(fetched.url),
      title: stringValue(fetched.title),
      charCount: numberValue(fetched.charCount),
      textPreview: stringValue(fetched.text).slice(0, 1200),
    },
    pdf: pdf ? jsonObject(pdf) : null,
    decision: jsonObject(decision),
    rank: jsonObject(rank),
    sourceArtifacts,
  };
  const written = await writeArtifact({
    artifactDir,
    name: archiveId,
    content,
    format: "json",
    sourceUrl: url,
  });

  return {
    ...written,
    archiveId,
    url,
    title,
    decision: stringValue(decision.decision),
    sourceArtifacts,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function jsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, jsonValue(entry)]),
  );
}

function jsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === "object") return jsonObject(value as Record<string, unknown>);
  return null;
}
