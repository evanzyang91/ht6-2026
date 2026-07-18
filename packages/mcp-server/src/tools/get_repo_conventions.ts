// MCP tool: get_repo_conventions
// Input: { repository: string, path?: string, language?: string, query?: string }
// Output: Convention[] (compact, ranked by retrieval/index.ts)
//
// TODO: define the MCP tool schema and handler, delegating to retrieveConventions().

export const getRepoConventionsTool = {
  name: "get_repo_conventions",
  // TODO: inputSchema, handler
};
