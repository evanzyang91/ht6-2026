import type { Convention } from "@ht6/shared";

// Applies convention path globs and normalized language scope.
export function filterByScope(
  conventions: Convention[],
  opts: { path?: string; language?: string }
): Convention[] {
  const globMatches = (glob: string, path: string) => {
    if (glob === "**") return true;
    const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "::DOUBLE_STAR::").replace(/\*/g, "[^/]*").replace(/::DOUBLE_STAR::/g, ".*");
    return new RegExp(`^${escaped}$`).test(path);
  };
  return conventions.filter((convention) => {
    const pathMatch = !opts.path || !convention.pathScopes.length || convention.pathScopes.some((scope) => globMatches(scope, opts.path!));
    const languageMatch = !opts.language || !convention.languages.length || convention.languages.some((language) => language.toLowerCase() === opts.language!.toLowerCase());
    return pathMatch && languageMatch;
  });
}
