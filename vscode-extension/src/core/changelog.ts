export interface NewsItem {
    title: string;
    link: string;
    date: Date;
    summary: string;
    /** Keywords from the filter that matched. */
    matched: string[];
}

function decodeEntities(s: string): string {
    return s
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block: string, name: string): string {
    const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
    return m ? decodeEntities(m[1]).trim() : '';
}

/** Parse an RSS 2.0 (or Atom) feed and keep entries matching any keyword (case-insensitive). */
export function parseFeed(xml: string, keywords: string[], max = 30): NewsItem[] {
    const items: NewsItem[] = [];
    const kw = keywords.map(k => k.toLowerCase()).filter(k => k);
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    for (const b of blocks) {
        const title = stripHtml(tag(b, 'title'));
        let link = tag(b, 'link');
        if (!link) { link = /<link[^>]*href="([^"]+)"/i.exec(b)?.[1] ?? ''; }
        const dateText = tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published');
        let summary = stripHtml(tag(b, 'description') || tag(b, 'summary'));
        summary = summary.replace(/The post .* appeared first on .*$/i, '').trim();
        const hay = `${title} ${summary}`.toLowerCase();
        const matched = kw.filter(k => hay.includes(k));
        if (kw.length && matched.length === 0) { continue; }
        items.push({ title, link, date: dateText ? new Date(dateText) : new Date(0), summary, matched });
        if (items.length >= max) { break; }
    }
    return items;
}

export async function fetchFeed(url: string, keywords: string[], timeoutMs = 15000): Promise<NewsItem[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'bc-alm-vscode' } });
        if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
        return parseFeed(await res.text(), keywords);
    } finally {
        clearTimeout(t);
    }
}
