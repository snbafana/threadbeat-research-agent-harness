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
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchText(url);
    return parseDuckDuckGo(html).slice(0, limit);
  } catch {
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
      const html = await fetchText(url);
      return parseBing(html).slice(0, limit);
    } catch {
      return await searchWikipedia(query, { limit });
    }
  }
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

async function fetchText(url: string, options: { accept?: string } = {}): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
          "user-agent": USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`fetch failed ${response.status}: ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(500 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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

function parseBing(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blocks = html.split(/<li[^>]+class="b_algo"[^>]*>/i).slice(1);
  for (const block of blocks) {
    const href = block.match(/<a[^>]+href="([^"]+)"/i)?.[1] ?? "";
    const title = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? "";
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "";
    const url = normalizeHttpUrl(decodeHtml(href));
    if (!url) continue;
    results.push({
      title: cleanText(title),
      url,
      snippet: cleanText(snippet),
    });
  }
  return dedupeByUrl(results);
}

async function searchWikipedia(query: string, { limit }: { limit: number }): Promise<SearchResult[]> {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&origin=*&limit=${limit}&search=${encodeURIComponent(query)}`;
  const text = await fetchText(url, { accept: "application/json,text/plain;q=0.8,*/*;q=0.5" });
  const parsed = JSON.parse(text) as [string, string[], string[], string[]];
  const titles = parsed[1] ?? [];
  const snippets = parsed[2] ?? [];
  const urls = parsed[3] ?? [];
  return titles.flatMap((title, index) => {
    const url = urls[index];
    if (!url) return [];
    return [{
      title,
      url,
      snippet: snippets[index] ?? "",
    }];
  });
}

function normalizeHttpUrl(href: string): string {
  if (!href) return "";
  try {
    const parsed = new URL(href);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
