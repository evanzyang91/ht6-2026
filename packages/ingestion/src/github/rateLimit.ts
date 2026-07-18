interface RateLimitedResponse {
  headers?: Record<string, string | number | undefined>;
}

const LOW_REMAINING_THRESHOLD = 5;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// Proactively backs off when a response reports we're nearly out of rate-limit budget, instead
// of waiting to get a 403. Reads the standard `x-ratelimit-remaining` / `x-ratelimit-reset`
// headers Octokit exposes on every response.
async function respectRateLimitHeaders(response: unknown): Promise<void> {
  const headers = (response as RateLimitedResponse | undefined)?.headers;
  if (!headers) return;

  const remaining = Number(headers["x-ratelimit-remaining"]);
  const reset = Number(headers["x-ratelimit-reset"]);
  if (!Number.isFinite(remaining) || !Number.isFinite(reset) || remaining > LOW_REMAINING_THRESHOLD) {
    return;
  }

  const delayMs = Math.max(0, reset * 1000 - Date.now()) + 1000;
  await sleep(delayMs);
}

// Retries primary/secondary rate-limit responses with bounded exponential backoff, and
// proactively pauses when a successful response reports the budget is nearly exhausted.
export async function withRateLimitRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await fn();
      await respectRateLimitHeaders(result);
      return result;
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status) : 0;
      if (status !== 403 && status !== 429) throw error;
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
    }
  }
  throw lastError;
}
