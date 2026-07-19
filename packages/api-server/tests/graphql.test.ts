import { expect, it, vi } from "vitest";
import { createGraphqlApi, type ApiOperations } from "../src/schema.js";

const convention = {
  id: "conv-1", repository: "acme/api", title: "Use services", rule: "Controllers use services",
  rationale: "Observed", category: "architecture", pathScopes: ["src/**"], languages: ["typescript"],
  prohibitedSignals: ["prisma.user.findMany"], preferredSignals: ["userService.list"], confidence: 0.91,
  detection: { mode: "forbidden-signal", semanticDescription: "Direct Prisma access is forbidden.",
    triggerSignals: [], forbiddenSignals: ["prisma.user.findMany"], requiredSignals: [], matchScope: "line" },
  supportingEpisodes: ["episode-1"], evidence: [{ episodeId: "episode-1", pullRequest: 12,
    reviewer: "sam", filePath: "src/controller.ts", reviewComment: "Use a service",
    rejectedCode: "prisma.user.findMany()", acceptedCode: "userService.list()" }],
};

function operations(): ApiOperations {
  return {
    inspect: async (repository) => ({ repository, status: "ready", conventionCount: 1 }),
    memory: async (repository) => ({ repository, conventions: [convention] }),
    validate: async () => ({ conventionCount: 1, findings: [] }),
    sync: async (repository) => ({ repository, commentCount: 4, episodeCount: 3, conventionCount: 1 }),
    refresh: async (repository) => ({ repository, commentCount: 4 }),
  };
}

it("serves repository memory without GitHub authorization", async () => {
  const authorize = vi.fn(async () => undefined);
  const api = createGraphqlApi({ operations: operations(), authorize });
  const response = await api.fetch("http://api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `query($repository: String!) {
      repositoryMemory(repository: $repository) {
        status conventionCount conventions {
          id detection { mode semanticDescription forbiddenSignals matchScope }
          evidence { pullRequest }
        }
      }
    }`, variables: { repository: "acme/api" } }),
  });
  const body = await response.json() as { data: { repositoryMemory: { status: string; conventions: unknown[] } } };
  expect(body.data.repositoryMemory).toMatchObject({
    status: "ready",
    conventions: [{ id: "conv-1", detection: { mode: "forbidden-signal", matchScope: "line" } }],
  });
  expect(authorize).not.toHaveBeenCalled();
});

it("keeps repository sync protected by a bearer token", async () => {
  const api = createGraphqlApi({ operations: operations(), authorize: async () => undefined });
  const response = await api.fetch("http://api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: `mutation {
      requestRepositorySync(repository: "acme/api") { repository }
    }` }),
  });
  const body = await response.json() as { errors: Array<{ message: string }> };
  expect(body.errors[0].message).toBe("Authentication required");
});

it("passes the authenticated GitHub token only to repository sync", async () => {
  const values = operations();
  values.sync = vi.fn(values.sync);
  const api = createGraphqlApi({ operations: values, authorize: async () => undefined });
  const response = await api.fetch("http://api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer ephemeral-token" },
    body: JSON.stringify({ query: `mutation {
      requestRepositorySync(repository: "acme/api", limit: 25) { repository conventionCount }
    }` }),
  });
  expect(response.status).toBe(200);
  expect(values.sync).toHaveBeenCalledWith("acme/api", "ephemeral-token", 25);
});

it("passes the authenticated GitHub token only to repository refresh", async () => {
  const values = operations();
  values.refresh = vi.fn(values.refresh);
  const api = createGraphqlApi({ operations: values, authorize: async () => undefined });
  const response = await api.fetch("http://api/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer ephemeral-token" },
    body: JSON.stringify({ query: `mutation {
      requestRepositoryRefresh(repository: "acme/api", limit: 25) { repository commentCount }
    }` }),
  });
  const body = await response.json() as { data: { requestRepositoryRefresh: { repository: string; commentCount: number } } };
  expect(response.status).toBe(200);
  expect(body.data.requestRepositoryRefresh).toEqual({ repository: "acme/api", commentCount: 4 });
  expect(values.refresh).toHaveBeenCalledWith("acme/api", "ephemeral-token", 25);
});
