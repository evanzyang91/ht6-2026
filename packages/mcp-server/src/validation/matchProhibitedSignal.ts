import type { Convention } from "@ht6/shared";

// Matches normalized detected code signals against historically prohibited signals.
export function matchesProhibitedSignal(convention: Convention, signals: string[]): boolean {
  return convention.prohibitedSignals.some((prohibited) => {
    const needle = prohibited.toLowerCase();
    return needle.length >= 3 && signals.some((signal) => signal.toLowerCase().includes(needle));
  });
}
