import {
  initializeRepositoryMemory,
  inspectRepositoryMemory,
  loadRepositoryMemory,
  validateRepositoryDiff,
  type EngineeringMemorySnapshot,
  type EngineeringMemoryValidationResult,
  type MemoryInitializationResult,
  type RepositoryMemoryInspection,
} from "@ht6/mcp-server/api";
import { createConventionStore, type ConventionStore } from "@ht6/mcp-server/store";
import { createSchema, createYoga } from "graphql-yoga";

export interface ApiOperations {
  inspect(repository: string): Promise<RepositoryMemoryInspection>;
  memory(repository: string): Promise<EngineeringMemorySnapshot>;
  validate(repository: string, diff: string): Promise<EngineeringMemoryValidationResult>;
  sync(repository: string, token: string, limit?: number): Promise<MemoryInitializationResult>;
}

export type RepositoryAuthorizer = (repository: string, token: string) => Promise<void>;

export function defaultOperations(store: ConventionStore = createConventionStore()): ApiOperations {
  return {
    inspect: (repository) => inspectRepositoryMemory(repository, { store }),
    memory: (repository) => loadRepositoryMemory(repository, { store }),
    validate: (repository, diff) => validateRepositoryDiff(repository, diff, { store }),
    sync: (repository, token, limit) => initializeRepositoryMemory(repository, { token, limit, store }),
  };
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new Error("Authentication required");
  return match[1];
}

const typeDefs = /* GraphQL */ `
  enum RepositoryMemoryStatus { unprocessed stale ready empty failed }

  type ConventionEvidence {
    episodeId: ID!
    pullRequest: Int!
    reviewer: String!
    filePath: String!
    reviewComment: String!
    rejectedCode: String!
    acceptedCode: String
  }

  type ConventionDetection {
    mode: String!
    semanticDescription: String!
    triggerSignals: [String!]!
    forbiddenSignals: [String!]!
    requiredSignals: [String!]!
    matchScope: String!
  }

  type Convention {
    id: ID!
    repository: String!
    title: String!
    rule: String!
    rationale: String!
    category: String!
    pathScopes: [String!]!
    languages: [String!]!
    prohibitedSignals: [String!]!
    preferredSignals: [String!]!
    detection: ConventionDetection
    confidence: Float!
    supportingEpisodes: [ID!]!
    evidence: [ConventionEvidence!]!
  }

  type ConventionDetection {
    mode: String!
    semanticDescription: String!
    triggerSignals: [String!]!
    forbiddenSignals: [String!]!
    requiredSignals: [String!]!
    matchScope: String!
  }

  type RepositoryMemory {
    repository: String!
    status: RepositoryMemoryStatus!
    conventionCount: Int!
    lastError: String
    conventions: [Convention!]!
  }

  type PredictedFeedback {
    conventionId: ID!
    rule: String!
    confidence: Float!
    supportCount: Int!
    matchedPath: String!
    matchedLine: Int
    matchedSignal: String
    reason: String!
    supportingPRs: [Int!]!
    acceptedExamples: [String!]!
  }

  type ValidationResult {
    conventionCount: Int!
    findings: [PredictedFeedback!]!
  }

  type SyncResult {
    repository: String!
    commentCount: Int!
    episodeCount: Int!
    conventionCount: Int!
  }

  type Query {
    repositoryMemory(repository: String!): RepositoryMemory!
    convention(repository: String!, id: ID!): Convention
    validateDiff(repository: String!, diff: String!): ValidationResult!
  }

  type Mutation {
    requestRepositorySync(repository: String!, limit: Int): SyncResult!
  }
`;

export function createGraphqlApi(options: {
  operations?: ApiOperations;
  authorize: RepositoryAuthorizer;
}) {
  const operations = options.operations ?? defaultOperations();
  const authorize = async (request: Request, repository: string): Promise<string> => {
    const token = bearerToken(request);
    await options.authorize(repository, token);
    return token;
  };
  const schema = createSchema({
    typeDefs,
    resolvers: {
      Query: {
        repositoryMemory: async (_parent, { repository }) => {
          const [inspection, memory] = await Promise.all([
            operations.inspect(repository),
            operations.memory(repository),
          ]);
          return { ...inspection, conventions: memory.conventions };
        },
        convention: async (_parent, { repository, id }) => {
          return (await operations.memory(repository)).conventions.find((item) => item.id === id) ?? null;
        },
        validateDiff: async (_parent, { repository, diff }) => {
          return operations.validate(repository, diff);
        },
      },
      Mutation: {
        requestRepositorySync: async (_parent, { repository, limit }, context) => {
          const token = await authorize(context.request, repository);
          return operations.sync(repository, token, limit ?? undefined);
        },
      },
    },
  });
  return createYoga({ schema, graphqlEndpoint: "/graphql", maskedErrors: false });
}
