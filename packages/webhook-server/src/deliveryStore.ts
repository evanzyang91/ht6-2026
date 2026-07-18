import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// GitHub redelivers webhooks (manual redelivery, transient failures, at-least-once delivery
// guarantees) with the same X-GitHub-Delivery id. Tracking seen ids lets the handler short-circuit
// a duplicate before touching GitHub's API or the comment store at all — cheaper and simpler than
// relying solely on comment-id dedup further downstream.
const MAX_TRACKED_DELIVERIES = 2000;

function deliveryStorePath(dataDirectory = process.env.DATA_DIR ?? "data"): string {
  return resolve(dataDirectory, "webhook-deliveries.json");
}

async function loadDeliveryIds(dataDirectory?: string): Promise<string[]> {
  try {
    return JSON.parse(await readFile(deliveryStorePath(dataDirectory), "utf8")) as string[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function hasSeenDelivery(deliveryId: string, dataDirectory?: string): Promise<boolean> {
  const ids = await loadDeliveryIds(dataDirectory);
  return ids.includes(deliveryId);
}

// Records a delivery id, evicting the oldest entries once the tracked set grows past
// MAX_TRACKED_DELIVERIES so this file doesn't grow unbounded over a long-running deployment.
export async function recordDelivery(deliveryId: string, dataDirectory?: string): Promise<void> {
  const ids = await loadDeliveryIds(dataDirectory);
  if (ids.includes(deliveryId)) return;
  const next = [...ids, deliveryId].slice(-MAX_TRACKED_DELIVERIES);

  const target = deliveryStorePath(dataDirectory);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temp, target);
}
