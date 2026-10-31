/**
 * Rank overlapping article tags by distinct labels rather than repeated metadata.
 * Keep the candidate's first-appearance order for the visible explanation.
 */
export function relatedTagRelevance(currentTags, candidateTags) {
  const current = new Set(currentTags);
  const shared = [...new Set(candidateTags)].filter((tag) => current.has(tag));
  return {
    score: shared.length * 2,
    reason: shared.slice(0, 2).map((tag) => `#${tag}`).join(' '),
  };
}
