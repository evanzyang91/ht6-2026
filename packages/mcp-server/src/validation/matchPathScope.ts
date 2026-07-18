import type { Convention } from "@ht6/shared";

// Checks whether a file falls within a convention's path scopes.
export function matchesPathScope(convention: Convention, filePath: string): boolean {
  if (!convention.pathScopes.length) return true;
  return convention.pathScopes.some((glob) => {
    if (glob === "**") return true;
    const pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLE_STAR::").replace(/\*/g, "[^/]*").replace(/::DOUBLE_STAR::/g, ".*");
    return new RegExp(`^${pattern}$`).test(filePath);
  });
}
