// TODO: generic helper to walk a paginated GitHub REST endpoint and yield/collect all items.
export async function paginateAll<T>(
  fetchPage: (page: number) => Promise<T[]>
): Promise<T[]> {
  throw new Error("not implemented");
}
