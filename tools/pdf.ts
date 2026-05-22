import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const USER_AGENT = "threadbeat-research-agent/0.1 (+https://github.com/snbafana/threadbeat-research-agent-harness)";

export interface PdfExtractResult {
  source: string;
  byteLength: number;
  sha256: string;
  text: string;
  textChars: number;
  pdfArtifact?: string;
  textArtifact?: string;
  contentType?: string;
  warning?: string;
}

export async function pdfExtract({
  url,
  filePath,
  artifactDir,
  name,
  maxChars = 20000,
}: {
  url?: string;
  filePath?: string;
  artifactDir?: string;
  name?: string;
  maxChars?: number;
}): Promise<PdfExtractResult> {
  if (!url && !filePath) throw new Error("pdf.extract requires url or filePath");
  if (artifactDir) await mkdir(artifactDir, { recursive: true });

  const loaded = filePath ? await loadLocalPdf(filePath) : await fetchPdf(url as string);
  const source = filePath ?? (url as string);
  const slug = safeSlug(name ?? path.basename(source) ?? "pdf");
  const sha256 = createHash("sha256").update(loaded.bytes).digest("hex");
  const text = extractPdfText(loaded.bytes).slice(0, maxChars);
  const pdfArtifact = artifactDir ? path.join(artifactDir, `${slug}.pdf`) : undefined;
  const textArtifact = artifactDir ? path.join(artifactDir, `${slug}.txt`) : undefined;

  if (pdfArtifact) await writeFile(pdfArtifact, loaded.bytes);
  if (textArtifact) await writeFile(textArtifact, text);

  return {
    source,
    byteLength: loaded.bytes.length,
    sha256,
    text,
    textChars: text.length,
    pdfArtifact,
    textArtifact,
    contentType: loaded.contentType,
    warning: loaded.warning ?? (text.length < 200 ? "PDF text extraction was sparse; a stronger parser/render pass may be needed." : undefined),
  };
}

async function loadLocalPdf(filePath: string): Promise<{ bytes: Buffer; contentType?: string; warning?: string }> {
  return { bytes: await readFile(filePath), contentType: "application/pdf" };
}

async function fetchPdf(url: string): Promise<{ bytes: Buffer; contentType?: string; warning?: string }> {
  const response = await fetch(url, {
    headers: {
      "accept": "application/pdf,application/octet-stream,*/*;q=0.7",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`pdf fetch failed ${response.status}: ${url}`);
  const contentType = response.headers.get("content-type") ?? undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  const warning = contentType && !contentType.includes("pdf")
    ? `Fetched content-type is not clearly PDF: ${contentType}`
    : undefined;
  return { bytes, contentType, warning };
}

function extractPdfText(bytes: Buffer): string {
  const raw = bytes.toString("latin1");
  const chunks: string[] = [];
  for (const match of raw.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    chunks.push(decodePdfLiteral(match[0].replace(/\)\s*Tj$/, "").slice(1)));
  }
  for (const match of raw.matchAll(/\[(.*?)\]\s*TJ/gs)) {
    const body = match[1] ?? "";
    for (const literal of body.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      chunks.push(decodePdfLiteral(literal[0].slice(1, -1)));
    }
  }
  if (chunks.length) return cleanText(chunks.join(" "));
  return cleanText(raw.replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " "));
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function safeSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "pdf";
}
