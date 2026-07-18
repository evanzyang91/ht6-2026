const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface RateLimitError {
  status?: number;
  response?: { headers?: Record<string, string> };
}

// Belt-and-suspenders on top of @octokit/plugin-retry (which handles secondary rate limits and
// 5xx automatically): retries a 403 up to MAX_ATTEMPTS times, honoring a Retry-After header when
// GitHub sends one, falling back to exponential backoff (1s/2s/4s) otherwise.
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const error = err as RateLimitError;
      if (error.status !== 403 || attempt >= MAX_ATTEMPTS) throw err;

      const retryAfter = error.response?.headers?.["retry-after"];
      const delayMs = retryAfter ? Number(retryAfter) * 1000 : BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }
}
