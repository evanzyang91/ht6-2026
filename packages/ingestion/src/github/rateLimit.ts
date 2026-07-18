// Retries primary/secondary rate-limit responses with bounded exponential backoff.
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status) : 0;
      if (status !== 403 && status !== 429) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 8000)));
    }
  }
  throw lastError;
}
