export type ReviewPurpose = 'broadcast' | 'message' | 'incoming' | 'memory' | 'received';
export interface ContentDecision { allow: boolean; reason: string; sanitizedText?: string }

/** A configured reviewer must return a boolean decision; transport errors never allow content. */
export async function reviewContent(url: string, text: string, purpose: ReviewPurpose): Promise<ContentDecision> {
  try {
    if (!url) throw new Error('Missing reviewer');
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({text, purpose}), signal: AbortSignal.timeout(18000)});
    const value = await res.json() as ContentDecision;
    if (!res.ok || !value || typeof value.allow !== 'boolean') throw new Error('Invalid review');
    return {allow: value.allow, reason: typeof value.reason === 'string' ? value.reason : 'review',
      ...(typeof value.sanitizedText === 'string' && value.sanitizedText.trim() ? {sanitizedText: value.sanitizedText} : {})};
  } catch { return {allow: false, reason: 'unavailable'}; }
}

export async function reviewMemory(url: string, text: string, purpose: 'memory'|'received' = 'memory'): Promise<string> {
  if (!url || !text.trim()) return text;
  const safe: string[] = [];
  // shortcut: long records are reviewed in bounded chunks; use contextual chunking if records span chunk boundaries.
  for (let offset = 0; offset < text.length; offset += 5000) {
    const part = text.slice(offset, offset + 5000);
    const result = await reviewContent(url, part, purpose);
    if (result.allow) safe.push(part);
    else if (result.sanitizedText) safe.push(result.sanitizedText);
    else throw new Error('Memory content review unavailable');
  }
  return safe.join('');
}
