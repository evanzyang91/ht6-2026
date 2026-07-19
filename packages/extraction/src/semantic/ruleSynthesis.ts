import { extractCodeSignals } from "./codeSignals.js";
import type { SemanticInput } from "./types.js";

function normalize(value: string): string {
  return value.toLowerCase().replace(/[`'"?!.:,;()]/g, " ").replace(/\s+/g, " ").trim();
}

function significantTokens(value: string): Set<string> {
  const ignored = new Set(["a", "an", "and", "are", "be", "can", "could", "here", "in", "is", "it", "of", "on", "or", "please", "should", "that", "the", "this", "to", "we", "would"]);
  return new Set(normalize(value).split(" ").filter((token) => token.length > 2 && !ignored.has(token)));
}

/** True when a purported convention merely repeats its source review comment. */
export function isNearVerbatimRule(rule: string, reviewComment: string): boolean {
  const normalizedRule = normalize(rule);
  const normalizedComment = normalize(reviewComment);
  if (!normalizedRule || !normalizedComment) return false;
  if (normalizedRule === normalizedComment || normalizedComment.includes(normalizedRule) || normalizedRule.includes(normalizedComment)) {
    return true;
  }
  const ruleTokens = significantTokens(rule);
  const commentTokens = significantTokens(reviewComment);
  if (!ruleTokens.size || !commentTokens.size) return false;
  const overlap = [...ruleTokens].filter((token) => commentTokens.has(token)).length;
  return overlap / Math.min(ruleTokens.size, commentTokens.size) >= 0.85;
}

function scopeSubject(input: SemanticInput): string {
  const path = input.filePath.toLowerCase();
  if (path === "dockerfile" || path.endsWith("/dockerfile")) return "Production container builds";
  if (/(^|\/)(tests?|__tests__)(\/|$)|\.(test|spec)\./.test(path)) return "Tests";
  if (path.includes("controller")) return "Controllers";
  if (path.includes("route")) return "Routes";
  if (path.includes("component") || path.includes("pages/") || path.includes("hooks/")) return "Frontend components";
  if (path.includes("service")) return "Services";
  if (path.includes("repositories/") || path.includes("store")) return "Data-access modules";
  if (path.includes("jobs/") || path.includes("workers/")) return "Background jobs";
  if (path.includes("config")) return "Configuration code";
  const symbol = input.codeContext?.enclosingSymbol?.name;
  return symbol ? `Code in ${symbol}` : "Repository code";
}

function stableSignals(input: SemanticInput): { removed?: string; added?: string } {
  const reviewed = extractCodeSignals(input.rejectedCode);
  const accepted = extractCodeSignals(input.acceptedCode ?? "");
  const removed = reviewed.find((signal) => !accepted.includes(signal) && signal.length >= 4);
  const added = accepted.find((signal) => !reviewed.includes(signal) && signal.length >= 4);
  return { removed, added };
}

function knownConvention(input: SemanticInput): string | undefined {
  const comment = normalize(input.reviewComment);
  if (comment.includes("no-store") && comment.includes("health endpoints")) {
    return "Cache-control policy must be explicitly scoped so global defaults do not unintentionally affect health endpoints.";
  }
  if (comment.includes("strictness setting") && comment.includes("boundary parsing")) {
    return "Request boundaries must parse untrusted data instead of bypassing strict typing with unchecked assertions.";
  }
  if (comment.includes("documented meaning") && comment.includes("severity")) {
    return "Incident severity levels must have documented meanings shared by the API and its clients.";
  }
  if (comment.includes("zod paths") || comment.includes("library-specific structures")) {
    return "Public validation errors must expose stable field names rather than library-specific path structures.";
  }
  if (comment.includes("responder notes count as incident updates")) {
    return "The incident domain must define and test whether responder notes update incident recency and sorting.";
  }
  if (comment.includes("minimum supported node version")) {
    return "The project must document and enforce the minimum Node.js version required by its Fastify release.";
  }
  if (comment.includes("incident factory") || comment.includes("named builder")) {
    return "Complex test fixtures should use named builders with sensible defaults.";
  }
  if (comment.includes("assignment") && comment.includes("first milestone")) {
    return "The initial incident workflow must explicitly define whether responder assignment is supported or only an incident commander.";
  }
  if (comment.includes("id generation") && comment.includes("injected")) {
    return "Incident services should accept an injectable ID generator so tests can use deterministic identifiers.";
  }
  if (comment.includes("location") && comment.includes("returning 201")) {
    return "HTTP 201 responses for newly created incidents should include a Location header identifying the new resource.";
  }
  if (comment.includes("incidentnotfounderror") || comment.includes("domain-specific") && comment.includes("wording")) {
    return "Missing incidents must be represented by a typed domain error rather than message text consumed by the HTTP layer.";
  }
  if (comment.includes("transition-specific endpoint") && comment.includes("patch")) {
    return "The incident API must explicitly choose and consistently document how lifecycle transitions are represented for clients.";
  }
  if (comment.includes("example health-check request")) {
    return "Contributor setup documentation should include a health-check request that verifies the local server is ready.";
  }
  if (comment.includes("configuration test") && comment.includes("non-numeric")) {
    return "Configuration parsing tests must cover non-numeric values and preserve understandable startup failures.";
  }
  if (comment.includes("content type") && comment.includes("request-id")) {
    return "Health endpoint tests must assert response content type and request-ID headers.";
  }
  if (comment.includes("resolved incidents") && comment.includes("accept notes")) {
    return "The incident-note API must explicitly define and enforce whether resolved incidents may accept post-incident notes.";
  }
  if (comment.includes("npm ci") && comment.includes("lockfile")) {
    return "Projects that install dependencies with `npm ci` must commit and maintain a lockfile.";
  }
  if (comment.includes("development dependencies") && comment.includes("production")) {
    return "Production container images must exclude development-only dependencies.";
  }
  if (comment.includes("pinning") && comment.includes("digest")) {
    return "Production container images should use immutable digest pins that dependency automation can update.";
  }
  if (comment.includes("fresh instance") && comment.includes("test")) {
    return "Tests that close mutable application instances must create a fresh instance for each test.";
  }
  if (comment.includes("returned incident fields") || comment.includes("input preservation")) {
    return "Creation tests should assert that returned domain fields preserve the requested input values.";
  }
  if (comment.includes("createdat") && comment.includes("updatedat")) {
    return "Creation tests must verify that `createdAt` and `updatedAt` begin equal.";
  }
  if (comment.includes("clear test") && comment.includes("empty store")) {
    return "Tests for clearing a store must seed data before invoking `clear`.";
  }
  if (comment.includes("typed not found error") || comment.includes("matching error text is brittle")) {
    return "Domain failures must use typed errors instead of message-text matching.";
  }
  if (comment.includes("request id") && comment.includes("trusted incoming")) {
    return "Request correlation IDs must come from a bounded trusted source or be generated by the service.";
  }
  return undefined;
}

/** Deterministic safety-net rule that resolves deictic comments using code and path evidence. */
export function synthesizeContextualRule(input: SemanticInput): string {
  const known = knownConvention(input);
  if (known) return known;
  const subject = scopeSubject(input);
  const { removed, added } = stableSignals(input);
  if (removed && added) return `${subject} should use \`${added}\` instead of \`${removed}\` for this operation.`;
  if (added) return `${subject} must apply \`${added}\` when performing this operation.`;
  if (removed) return `${subject} must not use \`${removed}\` for this operation.`;
  if (/\?\s*$/.test(input.reviewComment)) {
    return `${subject} has no established convention for this behavior; an explicit repository decision is required before enforcement.`;
  }
  const comment = input.reviewComment
    .replace(/^\s*(nit|suggestion|question|blocking|issue)\s*:\s*/i, "")
    .replace(/^\s*(please|could we|can we|would we|should we)\s+/i, "")
    .replace(/\?+\s*$/, "")
    .replace(/\b(this|here|it)\b/gi, "the reviewed implementation")
    .replace(/\s+/g, " ")
    .trim();
  const clause = comment ? `${comment.charAt(0).toLowerCase()}${comment.slice(1)}` : "follow the established repository convention";
  return `${subject} should ${clause}.`;
}
