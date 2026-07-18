// Walks a GitHub-style endpoint with 100-item pages up to an optional item cap.
export async function paginateAll<T>(
  fetchPage: (page: number) => Promise<T[]>,
  maxItems = Number.POSITIVE_INFINITY
): Promise<T[]> {
  const result: T[] = [];
  for (let page = 1; result.length < maxItems; page += 1) {
    const items = await fetchPage(page);
    result.push(...items);
    if (items.length < 100) break;
  }
  return result.slice(0, maxItems);
}
