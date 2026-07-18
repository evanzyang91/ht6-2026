import { z } from "zod/v4";
import type { ConventionStore } from "../store/conventionStore.js";
import { getRepoConventions } from "./get_repo_conventions.js";
import { predictReviewFeedback } from "./predict_review_feedback.js";

const repository = z.string().min(3).describe("GitHub owner/repository slug");

export function createToolDefinitions(store: ConventionStore) {
  return [
    {
      name: "get_repo_conventions",
      description: "Retrieve ranked, evidence-backed engineering conventions before writing code.",
      inputSchema: {
        repository,
        path: z.string().optional(),
        language: z.string().optional(),
        query: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      },
      run: (input: { repository: string; path?: string; language?: string; query?: string; limit?: number }) =>
        getRepoConventions(store, input),
    },
    {
      name: "find_similar_rejected_patterns",
      description: "Find historical rejected/accepted code examples similar to a planned change or snippet.",
      inputSchema: { repository, query: z.string().min(1), path: z.string().optional(), limit: z.number().int().min(1).max(20).optional() },
      run: async (input: { repository: string; query: string; path?: string; limit?: number }) => {
        const conventions = await getRepoConventions(store, input);
        return conventions.flatMap((convention) => convention.evidence.map((evidence) => ({
          conventionId: convention.id,
          rule: convention.rule,
          confidence: convention.confidence,
          pullRequest: evidence.pullRequest,
          filePath: evidence.filePath,
          rejectedCode: evidence.rejectedCode,
          acceptedCode: evidence.acceptedCode,
          reviewComment: evidence.reviewComment,
        }))).slice(0, input.limit ?? 10);
      },
    },
    {
      name: "predict_review_feedback",
      description: "Validate a generated unified diff against historical repository conventions.",
      inputSchema: { repository, diff: z.string().min(1) },
      run: (input: { repository: string; diff: string }) => predictReviewFeedback(store, input),
    },
    {
      name: "explain_engineering_decision",
      description: "Explain why a repository convention exists using linked historical evidence.",
      inputSchema: { repository, conventionId: z.string().optional(), query: z.string().optional() },
      run: async (input: { repository: string; conventionId?: string; query?: string }) => {
        const all = await store.all(input.repository);
        const matches = input.conventionId
          ? all.filter((item) => item.id === input.conventionId)
          : await getRepoConventions(store, { repository: input.repository, query: input.query, limit: 3 });
        return matches.map(({ id, title, rule, rationale, confidence, pathScopes, evidence }) => ({
          id, title, rule, rationale, confidence, pathScopes, evidence,
        }));
      },
    },
    {
      name: "summarize_personal_review_history",
      description: "Summarize convention categories and recurring feedback associated with a reviewer.",
      inputSchema: { repository, reviewer: z.string().min(1) },
      run: async (input: { repository: string; reviewer: string }) => {
        const conventions = (await store.all(input.repository)).filter((item) =>
          item.evidence.some((evidence) => evidence.reviewer.toLowerCase() === input.reviewer.toLowerCase()));
        const categories = conventions.reduce<Record<string, number>>((counts, item) => {
          counts[item.category] = (counts[item.category] ?? 0) + 1;
          return counts;
        }, {});
        return { reviewer: input.reviewer, conventionCount: conventions.length, categories, recurringRules: conventions.slice(0, 10).map((item) => item.rule) };
      },
    },
  ] as const;
}
