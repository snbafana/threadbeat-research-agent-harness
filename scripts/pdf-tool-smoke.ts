#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pdfExtract } from "../tools/pdf.ts";

const runDir = await mkdtemp(path.join(os.tmpdir(), "threadbeat-pdf-smoke-"));

try {
  const pdfPath = path.join(runDir, "fixture.pdf");
  await writeFile(pdfPath, `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 74 >>
stream
BT
/F1 12 Tf
72 720 Td
(Threadbeat PDF extraction smoke primary source map) Tj
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000202 00000 n 
trailer
<< /Root 1 0 R /Size 5 >>
startxref
326
%%EOF
`);
  const result = await pdfExtract({
    filePath: pdfPath,
    artifactDir: path.join(runDir, "artifacts"),
    name: "fixture",
  });

  assert.match(result.text, /Threadbeat PDF extraction smoke/);
  assert.equal(result.sha256.length, 64);
  assert.ok(result.pdfArtifact?.endsWith(".pdf"));
  assert.ok(result.textArtifact?.endsWith(".txt"));

  console.log(JSON.stringify({ ok: true, smoke: "pdf-tool" }, null, 2));
} finally {
  await rm(runDir, { recursive: true, force: true });
}
