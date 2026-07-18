import type { Convention } from "@ht6/shared";

// Dependency-free local vector scorer used only when ENGINEERING_MEMORY_EMBEDDINGS=local.
// It hashes character trigrams into a fixed vector. A production embedding provider can replace
// this function without changing retrieval orchestration.
export async function scoreByEmbeddingSimilarity(
  conventions: Convention[],
  query: string
): Promise<Map<string, number>> {
  const dimensions = 256;
  const embed = (value: string) => {
    const normalized = `  ${value.toLowerCase().replace(/\s+/g, " ")}  `;
    const vector = new Float64Array(dimensions);
    for (let index = 0; index < normalized.length - 2; index += 1) {
      const gram = normalized.slice(index, index + 3);
      let hash = 2166136261;
      for (const character of gram) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      vector[(hash >>> 0) % dimensions] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm) vector.forEach((value, index) => { vector[index] = value / norm; });
    return vector;
  };
  const queryVector = embed(query);
  return new Map(conventions.map((convention) => {
    const document = embed(`${convention.title} ${convention.rule} ${convention.rationale} ${convention.prohibitedSignals.join(" ")} ${convention.preferredSignals.join(" ")}`);
    return [convention.id, document.reduce((sum, value, index) => sum + value * queryVector[index], 0)];
  }));
}
