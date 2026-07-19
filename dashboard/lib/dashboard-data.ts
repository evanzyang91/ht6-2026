import { readGitHubSession } from "./github-auth";

export interface DashboardData {
  repository: string;
  source: "live" | "demo";
  connection: "live" | "demo" | "authentication-required" | "api-error";
  viewer?: { login: string; avatarUrl: string };
  summary: {
    commentsAnalyzed: number;
    pullRequests: number;
    conventions: number;
    acceptedFixRate: number;
    reviewers: number;
  };
  topComments: Array<{
    id: string;
    comment: string;
    category: string;
    count: number;
    pullRequests: number;
    confidence: number;
  }>;
  categories: Array<{ name: string; count: number }>;
  reviewers: Array<{ name: string; initials: string; comments: number }>;
}

interface Evidence {
  pullRequest: number;
  reviewer: string;
  reviewComment: string;
  acceptedCode?: string | null;
}

interface Convention {
  id: string;
  title: string;
  rule: string;
  category: string;
  confidence: number;
  supportingEpisodes: string[];
  evidence: Evidence[];
}

const demoData: DashboardData = {
  repository: "acme/api",
  source: "demo",
  connection: "demo",
  summary: {
    commentsAnalyzed: 64,
    pullRequests: 38,
    conventions: 11,
    acceptedFixRate: 0.78,
    reviewers: 7,
  },
  topComments: [
    {
      id: "service-layer",
      comment: "Controllers shouldn’t call Prisma directly — go through the service layer.",
      category: "Architecture",
      count: 18,
      pullRequests: 12,
      confidence: 0.91,
    },
    {
      id: "react-query",
      comment: "Use React Query here instead of fetching server state in useEffect.",
      category: "Architecture",
      count: 13,
      pullRequests: 9,
      confidence: 0.87,
    },
    {
      id: "graphql-mocks",
      comment: "Mock GraphQL in this unit test; don’t call the real API.",
      category: "Testing",
      count: 9,
      pullRequests: 7,
      confidence: 0.84,
    },
  ],
  categories: [
    { name: "Architecture", count: 31 },
    { name: "Testing", count: 14 },
    { name: "Security", count: 9 },
    { name: "Reliability", count: 6 },
    { name: "Style", count: 4 },
  ],
  reviewers: [
    { name: "sarah-reviews", initials: "SR", comments: 17 },
    { name: "mike-platform", initials: "MP", comments: 13 },
    { name: "priya-api", initials: "PA", comments: 11 },
    { name: "jordan-web", initials: "JW", comments: 8 },
  ],
};

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function initials(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "RV";
}

function deriveDashboardData(
  repository: string,
  conventions: Convention[],
  viewer: { login: string; avatarUrl: string },
): DashboardData {
  const evidence = conventions.flatMap((item) => item.evidence);
  const pullRequests = new Set(evidence.map((item) => item.pullRequest));
  const reviewerCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  for (const convention of conventions) {
    const category = titleCase(convention.category);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + convention.evidence.length);
  }
  for (const item of evidence) {
    reviewerCounts.set(item.reviewer, (reviewerCounts.get(item.reviewer) ?? 0) + 1);
  }

  return {
    repository,
    source: "live",
    connection: "live",
    viewer,
    summary: {
      commentsAnalyzed: evidence.length,
      pullRequests: pullRequests.size,
      conventions: conventions.length,
      acceptedFixRate: evidence.length
        ? evidence.filter((item) => Boolean(item.acceptedCode)).length / evidence.length
        : 0,
      reviewers: reviewerCounts.size,
    },
    topComments: [...conventions]
      .sort((left, right) => right.supportingEpisodes.length - left.supportingEpisodes.length)
      .slice(0, 3)
      .map((convention) => ({
        id: convention.id,
        comment: convention.evidence[0]?.reviewComment || convention.rule,
        category: titleCase(convention.category),
        count: convention.supportingEpisodes.length,
        pullRequests: new Set(convention.evidence.map((item) => item.pullRequest)).size,
        confidence: convention.confidence,
      })),
    categories: [...categoryCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count),
    reviewers: [...reviewerCounts.entries()]
      .map(([name, comments]) => ({ name, initials: initials(name), comments }))
      .sort((left, right) => right.comments - left.comments)
      .slice(0, 4),
  };
}

export async function loadDashboardData(): Promise<DashboardData> {
  const endpoint = process.env.ENGINEERING_MEMORY_API_URL;
  const repository = process.env.ENGINEERING_MEMORY_REPOSITORY;
  if (!endpoint || !repository) return demoData;
  const session = await readGitHubSession();
  if (!session) return { ...demoData, repository, connection: "authentication-required" };
  const viewer = { login: session.login, avatarUrl: session.avatarUrl };

  const query = `
    query DashboardMemory($repository: String!) {
      repositoryMemory(repository: $repository) {
        repository
        conventions {
          id title rule category confidence supportingEpisodes
          evidence { pullRequest reviewer reviewComment acceptedCode }
        }
      }
    }
  `;

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ query, variables: { repository } }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ...demoData, repository, connection: "api-error", viewer };
    const payload = await response.json() as {
      data?: { repositoryMemory?: { repository: string; conventions: Convention[] } };
      errors?: unknown[];
    };
    const memory = payload.data?.repositoryMemory;
    if (!memory || payload.errors?.length) return { ...demoData, repository, connection: "api-error", viewer };
    return deriveDashboardData(memory.repository, memory.conventions, viewer);
  } catch {
    return { ...demoData, repository, connection: "api-error", viewer };
  }
}
