import { it } from "vitest";

// Success criterion: another teammate can query persisted review comments without
// making GitHub API calls — i.e. ingest() then load from the Store returns the same data.
it.todo("ingest() persists RawReviewComment[] that a fresh Store.load() can read back");
it.todo("re-running ingest() for the same repo does not duplicate records (idempotent)");
