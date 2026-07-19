import type {
  EngineeringMemorySnapshot,
  EngineeringMemoryValidationResult,
  MemoryInitializationResult,
  RepositoryMemoryInspection,
} from "@ht6/mcp-server/api" with { "resolution-mode": "import" };

interface GraphqlResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

const conventionFields = `
  id repository title rule rationale category confidence
  pathScopes languages prohibitedSignals preferredSignals supportingEpisodes
  detection { mode semanticDescription triggerSignals forbiddenSignals requiredSignals matchScope }
  evidence { episodeId pullRequest reviewer filePath reviewComment rejectedCode acceptedCode }
`;

export class EngineeringMemoryGraphqlClient {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  private async request<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const result = await response.json() as GraphqlResponse<T>;
    if (!response.ok || result.errors?.length || !result.data) {
      throw new Error(result.errors?.map((error) => error.message).join("; ")
        ?? `Engineering Memory API returned HTTP ${response.status}`);
    }
    return result.data;
  }

  async inspect(repository: string): Promise<RepositoryMemoryInspection> {
    const data = await this.request<{ repositoryMemory: RepositoryMemoryInspection }>(`
      query InspectRepositoryMemory($repository: String!) {
        repositoryMemory(repository: $repository) { repository status conventionCount lastError }
      }
    `, { repository });
    return data.repositoryMemory;
  }

  async memory(repository: string): Promise<EngineeringMemorySnapshot> {
    const data = await this.request<{ repositoryMemory: EngineeringMemorySnapshot }>(`
      query RepositoryMemory($repository: String!) {
        repositoryMemory(repository: $repository) { repository conventions { ${conventionFields} } }
      }
    `, { repository });
    return data.repositoryMemory;
  }

  async validate(repository: string, diff: string): Promise<EngineeringMemoryValidationResult> {
    const data = await this.request<{ validateDiff: EngineeringMemoryValidationResult }>(`
      query ValidateDiff($repository: String!, $diff: String!) {
        validateDiff(repository: $repository, diff: $diff) {
          conventionCount
          findings {
            conventionId rule confidence supportCount matchedPath matchedLine matchedSignal
            reason supportingPRs acceptedExamples
          }
        }
      }
    `, { repository, diff });
    return data.validateDiff;
  }

  async sync(repository: string, limit: number): Promise<MemoryInitializationResult> {
    const data = await this.request<{ requestRepositorySync: MemoryInitializationResult }>(`
      mutation RequestRepositorySync($repository: String!, $limit: Int) {
        requestRepositorySync(repository: $repository, limit: $limit) {
          repository commentCount episodeCount conventionCount
        }
      }
    `, { repository, limit });
    return data.requestRepositorySync;
  }
}
