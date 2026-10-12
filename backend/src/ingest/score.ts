/** Built-in 818 / gossip keyword lexicon for title scoring and source_type. */

export interface ScoreResult {
  score: number;
  reasons: string[];
}

/** Higher weight = stronger 818 signal. */
const KEYWORDS: Array<{ word: string; weight: number; reason: string }> = [
  { word: '实锤', weight: 5, reason: '实锤' },
  { word: '锤爆', weight: 5, reason: '锤爆' },
  { word: '开盒', weight: 5, reason: '开盒' },
  { word: '塌房', weight: 4, reason: '塌房' },
  { word: '出轨', weight: 4, reason: '出轨' },
  { word: '分手', weight: 3, reason: '分手' },
  { word: '锤', weight: 3, reason: '锤' },
  { word: '八卦', weight: 3, reason: '八卦' },
  { word: '瓜', weight: 2, reason: '瓜' },
  { word: '爆料', weight: 3, reason: '爆料' },
  { word: '丑闻', weight: 3, reason: '丑闻' },
  { word: '吃瓜', weight: 2, reason: '吃瓜' },
  { word: '翻车', weight: 2, reason: '翻车' },
  { word: '人设崩', weight: 3, reason: '人设崩' },
  { word: '内鬼', weight: 2, reason: '内鬼' },
  { word: '撕逼', weight: 2, reason: '撕逼' },
  { word: '对线', weight: 1, reason: '对线' },
  { word: '818', weight: 4, reason: '818' },
];

/** Map matched keywords → coarse source_type; first match wins by priority. */
const SOURCE_TYPE_RULES: Array<{ words: string[]; type: string }> = [
  { words: ['开盒'], type: 'doxxing' },
  { words: ['实锤', '锤爆', '锤'], type: 'evidence' },
  { words: ['出轨', '分手'], type: 'relationship' },
  { words: ['塌房', '丑闻', '人设崩', '翻车'], type: 'scandal' },
  { words: ['八卦', '瓜', '吃瓜', '爆料', '818', '撕逼'], type: 'gossip' },
];

export function score818(title: string): ScoreResult {
  const reasons: string[] = [];
  let score = 0;
  for (const { word, weight, reason } of KEYWORDS) {
    if (title.includes(word)) {
      score += weight;
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }
  return { score, reasons };
}

/** Coarse source_type from title/body text; default `other`. */
export function classifySourceType(text: string): string {
  for (const rule of SOURCE_TYPE_RULES) {
    if (rule.words.some((w) => text.includes(w))) return rule.type;
  }
  return 'other';
}

export function truncateSummary(body: string, max = 200): string {
  const t = body.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max);
}
