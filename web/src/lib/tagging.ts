// "AI tagging" for the Pro tier.
//
// Deliberately dependency-free keyword extraction: the reference point being
// made is the entitlement gate in front of it, not the tagging itself. Swap
// this for a real model call in a production agent.

const STOP_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'but', 'by', 'can', 'could', 'did', 'do', 'does',
  'for', 'from', 'had', 'has', 'have', 'he', 'her', 'his', 'how', 'i', 'if',
  'in', 'into', 'is', 'it', 'its', 'just', 'like', 'more', 'most', 'my', 'no',
  'not', 'of', 'on', 'one', 'or', 'other', 'our', 'out', 'over', 'she', 'so',
  'some', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'up', 'was', 'we', 'were', 'what', 'when', 'which',
  'who', 'will', 'with', 'would', 'you', 'your'
]);

export function suggestTags(content: string, maxTags = 5): string[] {
  const counts = new Map<string, number>();
  for (const raw of content.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOP_WORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxTags)
    .map(([word]) => word);
}
