import { afterEach, expect, it, vi } from "vitest";
import { EngineeringMemoryGraphqlClient } from "../src/graphqlClient.js";

afterEach(() => vi.unstubAllGlobals());

it("queries validation through GraphQL with the GitHub bearer token", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    expect(init.headers).toMatchObject({ authorization: "Bearer github-token" });
    const request = JSON.parse(String(init.body)) as { variables: { repository: string; diff: string } };
    expect(request.variables).toEqual({ repository: "acme/api", diff: "+prisma.user.findMany()" });
    return new Response(JSON.stringify({
      data: { validateDiff: { conventionCount: 1, findings: [] } },
    }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new EngineeringMemoryGraphqlClient("http://localhost:8790/graphql", "github-token");
  await expect(client.validate("acme/api", "+prisma.user.findMany()"))
    .resolves.toEqual({ conventionCount: 1, findings: [] });
});

it("surfaces GraphQL errors", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    errors: [{ message: "Repository access denied" }],
  }), { headers: { "content-type": "application/json" } })));
  const client = new EngineeringMemoryGraphqlClient("http://localhost:8790/graphql", "bad-token");
  await expect(client.inspect("acme/private")).rejects.toThrow("Repository access denied");
});

it("requests an ingest-only refresh through GraphQL", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { query: string; variables: { repository: string; limit: number } };
    expect(request.query).toContain("requestRepositoryRefresh");
    expect(request.variables).toEqual({ repository: "acme/api", limit: 25 });
    return new Response(JSON.stringify({
      data: { requestRepositoryRefresh: { repository: "acme/api", commentCount: 4 } },
    }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new EngineeringMemoryGraphqlClient("http://localhost:8790/graphql", "github-token");
  await expect(client.refresh("acme/api", 25)).resolves.toEqual({ repository: "acme/api", commentCount: 4 });
});

it("falls back to the full sync mutation when the API predates ingest-only refresh", async () => {
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body)) as { query: string };
    if (request.query.includes("requestRepositoryRefresh")) {
      return new Response(JSON.stringify({
        errors: [{
          message: 'Cannot query field "requestRepositoryRefresh" on type "Mutation". Did you mean "requestRepositorySync"?',
        }],
      }), { headers: { "content-type": "application/json" } });
    }
    expect(request.query).toContain("requestRepositorySync");
    return new Response(JSON.stringify({
      data: {
        requestRepositorySync: {
          repository: "acme/api",
          commentCount: 6,
          episodeCount: 5,
          conventionCount: 2,
        },
      },
    }), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);

  const client = new EngineeringMemoryGraphqlClient("http://localhost:8790/graphql", "github-token");
  await expect(client.refresh("acme/api", 25)).resolves.toEqual({ repository: "acme/api", commentCount: 6 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
