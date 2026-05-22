#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createToolRunner } from "../tools/research-tools.ts";
import type { SearchResult } from "../tools/web.ts";

interface PersonRecord {
  name: string;
  sourceTitle: string;
  sourceUrl: string;
  snippet: string;
  addedAt: string;
  iteration: number;
}

interface DataRoomState {
  createdAt: string;
  query: string;
  people: PersonRecord[];
}

const dataRoomDir = process.env.DATA_ROOM_DIR ?? path.join("data-room", "research-heartbeat");
const query = process.env.DATA_ROOM_QUERY ?? "site:en.wikipedia.org AI safety researcher";

await mkdir(dataRoomDir, { recursive: true });
const statePath = path.join(dataRoomDir, "people.json");
const tracePath = path.join(dataRoomDir, "tool-trace.jsonl");
const state = await loadState(statePath, query);
const iteration = state.people.length + 1;
const events: Array<Record<string, unknown>> = [];
const runTool = createToolRunner({
  enabledTools: ["web.search"],
  event(action, data) {
    events.push({ time: new Date().toISOString(), action, ...data });
  },
});

const knownUrls = new Set(state.people.map((person) => person.sourceUrl));
const results = await searchCandidateQueries(query);
const candidate = results.find((result) => !knownUrls.has(result.url) && extractPersonName(result))
  ?? results.find((result) => !knownUrls.has(result.url));
if (!candidate) throw new Error("web.search returned no candidate people");
const name = extractPersonName(candidate);
if (!name) throw new Error(`web.search returned no person-like candidate: ${candidate.title}`);

const person: PersonRecord = {
  name,
  sourceTitle: candidate.title,
  sourceUrl: candidate.url,
  snippet: candidate.snippet,
  addedAt: new Date().toISOString(),
  iteration,
};
state.people.push(person);

await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await appendFile(path.join(dataRoomDir, "iteration-log.jsonl"), `${JSON.stringify({
  time: new Date().toISOString(),
  iteration,
  added: person,
})}\n`);
await appendFile(tracePath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");

console.log(JSON.stringify({
  ok: true,
  dataRoomDir,
  iteration,
  added: person,
}, null, 2));

async function searchCandidateQueries(baseQuery: string): Promise<SearchResult[]> {
  const queries = [
    `${baseQuery} person researcher founder`,
    "Eliezer Yudkowsky AI safety researcher",
    "Paul Christiano AI safety researcher",
    "Dario Amodei AI safety researcher",
  ];
  const merged: SearchResult[] = [];
  const seen = new Set<string>();

  for (const searchQuery of queries) {
    const results = await runTool("web.search", {
      query: searchQuery,
      limit: 10,
    }, "Heartbeat data-room iteration searches for one more person to add.") as SearchResult[];
    for (const result of results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      merged.push(result);
    }
    if (merged.some((result) => extractPersonName(result))) break;
  }

  return merged;
}

async function loadState(file: string, defaultQuery: string): Promise<DataRoomState> {
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing) return JSON.parse(existing) as DataRoomState;
  return {
    createdAt: new Date().toISOString(),
    query: defaultQuery,
    people: [],
  };
}

function extractPersonName(result: SearchResult): string | null {
  const titleLead = result.title.split(/\s[-|–]\s/)[0]?.trim() ?? result.title;
  const candidates = [
    titleLead,
    result.title,
    result.snippet,
  ];
  for (const candidate of candidates) {
    const withoutTitles = candidate.replace(/^(Dr\.|Prof\.|Professor)\s+/i, "").trim();
    for (const match of withoutTitles.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/g)) {
      const name = match[0];
      if (!isGenericName(name)) return name;
    }
  }
  return null;
}

function isGenericName(value: string): boolean {
  const normalized = value.toLowerCase();
  return [
    "ai safety",
    "artificial intelligence",
    "funding aisafety",
    "wikipedia",
    "united states",
    "effective altruism",
    "machine learning",
    "uk government",
    "research agenda",
    "technical ai",
  ].some((generic) => normalized.includes(generic));
}
