const USER_AGENT = "threadbeat-research-agent/0.1 (+https://github.com/snbafana/threadbeat-research-agent-harness)";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  text: string;
  charCount: number;
}

export async function webSearch(query: string, { limit = 5 }: { limit?: number } = {}): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  return parseDuckDuckGo(html).slice(0, limit);
}

export async function webFetch(url: string, { maxChars = 12000 }: { maxChars?: number } = {}): Promise<FetchedPage> {
  const html = await fetchText(url);
  const title = textBetween(html, /<title[^>]*>/i, /<\/title>/i);
  const text = htmlToText(html).slice(0, maxChars);
  return {
    url,
    title: cleanText(title),
    text,
    charCount: text.length,
  };
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
      "user-agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`fetch failed ${response.status}: ${url}`);
  return await response.text();
}

function parseDuckDuckGo(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<a[^>]+class="result__a"[^>]*>/i).slice(1);
  for (const block of blocks) {
    const rawHref = block.match(/href="([^"]+)"/i)?.[1] ?? "";
    const rawTitle = block.split(/<\/a>/i)[0] ?? "";
    const snippet = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      ?? block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      ?? "";
    const url = normalizeDuckDuckGoUrl(decodeHtml(rawHref));
    if (!url) continue;
    results.push({
      title: cleanText(rawTitle),
      url,
      snippet: cleanText(snippet),
    });
  }
  return dedupeByUrl(results);
}

function normalizeDuckDuckGoUrl(href: string): string {
  if (!href) return "";
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.toString();
  } catch {
    return "";
  }
  return "";
}

function htmlToText(html: string): string {
  return cleanText(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function textBetween(value: string, start: RegExp, end: RegExp): string {
  const startMatch = value.match(start);
  if (startMatch?.index === undefined) return "";
  const rest = value.slice(startMatch.index + startMatch[0].length);
  const endMatch = rest.match(end);
  return endMatch?.index === undefined ? "" : rest.slice(0, endMatch.index);
}

function cleanText(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'");
}

function dedupeByUrl(results: SearchResult[]): SearchResult[] {
  const seen = new Set();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}
