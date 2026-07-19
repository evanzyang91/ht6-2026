export interface ReviewEpisode {
  id: string;
  pullRequest: number;
  reviewer: string;
  filePath: string;
  reviewComment: string;
  rejectedCode: string;
  acceptedCode?: string | null;
}

export interface Convention {
  id: string;
  title: string;
  rule: string;
  rationale: string;
  category: string;
  confidence: number;
  pathScopes: string[];
  languages: string[];
  supportingEpisodes: string[];
  evidence: ReviewEpisode[];
}

export interface DashboardData {
  repository: string;
  connection: "live" | "configuration-error" | "api-error";
  status?: string;
  error?: string;
  conventions: Convention[];
  reviewEpisodes: ReviewEpisode[];
}

function emptyData(
  repository: string,
  connection: DashboardData["connection"],
  error: string,
): DashboardData {
  return { repository, connection, error, conventions: [], reviewEpisodes: [] };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const endpoint = process.env.ENGINEERING_MEMORY_API_URL?.trim();
  const repository = process.env.ENGINEERING_MEMORY_REPOSITORY?.trim();
  if (!endpoint || !repository) {
    return emptyData(
      repository || "unconfigured",
      "configuration-error",
      "Set ENGINEERING_MEMORY_API_URL and ENGINEERING_MEMORY_REPOSITORY.",
    );
  }

  const query = `
    query DashboardMemory($repository: String!) {
      repositoryMemory(repository: $repository) {
        repository
        status
        conventions {
          id title rule rationale category confidence pathScopes languages supportingEpisodes
          evidence {
            episodeId pullRequest reviewer filePath reviewComment rejectedCode acceptedCode
          }
        }
      }
    }
  `;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables: { repository } }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return emptyData(repository, "api-error", `GraphQL API returned HTTP ${response.status}.`);
    }

    const payload = await response.json() as {
      data?: {
        repositoryMemory?: {
          repository: string;
          status: string;
          conventions: Array<Omit<Convention, "evidence"> & {
            evidence: Array<Omit<ReviewEpisode, "id"> & { episodeId: string }>;
          }>;
        };
      };
      errors?: Array<{ message?: string }>;
    };
    const memory = payload.data?.repositoryMemory;
    if (!memory || payload.errors?.length) {
      return emptyData(
        repository,
        "api-error",
        payload.errors?.[0]?.message || "GraphQL returned no repository memory.",
      );
    }

    const conventions: Convention[] = memory.conventions.map((convention) => ({
      ...convention,
      evidence: convention.evidence.map(({ episodeId, ...episode }) => ({ id: episodeId, ...episode })),
    }));
    const episodesById = new Map<string, ReviewEpisode>();
    for (const convention of conventions) {
      for (const episode of convention.evidence) episodesById.set(episode.id, episode);
    }

    return {
      repository: memory.repository,
      connection: "live",
      status: memory.status,
      conventions,
      reviewEpisodes: [...episodesById.values()].sort((left, right) => right.pullRequest - left.pullRequest),
    };
  } catch (error) {
    return emptyData(
      repository,
      "api-error",
      `Unable to reach ${endpoint}: ${error instanceof Error ? error.message : "request failed"}. `
        + "Confirm that the API server is running.",
    );
  }
}
