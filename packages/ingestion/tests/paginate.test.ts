import { describe, expect, it } from "vitest";
import { paginateAll } from "../src/github/paginate.js";

describe("paginateAll", () => {
  it("walks multiple full pages and stops once a short page is returned", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => 100 + i),
      Array.from({ length: 40 }, (_, i) => 200 + i),
    ];
    let calls = 0;
    const result = await paginateAll(async (page) => {
      calls += 1;
      return pages[page - 1] ?? [];
    });
    expect(result).toHaveLength(240);
    expect(calls).toBe(3);
  });

  it("stops early once maxItems is reached, without over-fetching pages", async () => {
    let calls = 0;
    const result = await paginateAll(async (page) => {
      calls += 1;
      return Array.from({ length: 100 }, (_, i) => (page - 1) * 100 + i);
    }, 150);
    expect(result).toHaveLength(150);
    expect(calls).toBe(2);
  });

  it("returns an empty array when the first page is empty", async () => {
    const result = await paginateAll(async () => []);
    expect(result).toEqual([]);
  });
});
