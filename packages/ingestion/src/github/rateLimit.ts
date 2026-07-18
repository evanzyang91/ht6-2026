// TODO: check response rate-limit headers / handle secondary rate limits with backoff+retry.
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  throw new Error("not implemented");
}
