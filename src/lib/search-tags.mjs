/** Search-index and pre-rendered search cards share one stable tag rule. */
export const uniqueSearchTags = (tags) => [...new Set(tags)];
