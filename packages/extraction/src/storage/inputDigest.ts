import type { RawComment } from "@ht6/shared";
import { createHash } from "node:crypto";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(object[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Hashes a repository snapshot independently of comment order and object key insertion order. */
export function inputDigest(comments: RawComment[]): string {
  const canonical = [...comments].sort((left, right) =>
    left.repository.localeCompare(right.repository)
    || left.commentId.localeCompare(right.commentId)
    || left.createdAt.localeCompare(right.createdAt)
  );
  return createHash("sha256").update(stableJson(canonical)).digest("hex");
}
