import { QdrantClient } from "@qdrant/js-client-rest";
import { EMBEDDING_DIM } from "./embed";

/*
 * Thin-vector pattern: Qdrant stores ONLY { id: donation_id, vector }.
 * No payload (status, quantity, expiry, tags, location). Those change far
 * faster than an index can be kept consistent, so PostgreSQL re-validates
 * every candidate Qdrant returns. A stale vector is harmless by design.
 */

export const COLLECTION = "donations";

const g = globalThis as unknown as { __foodlinkQdrant?: QdrantClient };
export const qdrant = (g.__foodlinkQdrant ??= new QdrantClient({
  url: process.env.QDRANT_URL ?? "http://localhost:6333",
  checkCompatibility: false,
}));

export async function ensureCollection(recreate = false) {
  const { exists } = await qdrant.collectionExists(COLLECTION);
  if (exists && recreate) await qdrant.deleteCollection(COLLECTION);
  if (!exists || recreate) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
    });
  }
}

export async function upsertVector(donationId: string, vector: number[]) {
  await qdrant.upsert(COLLECTION, { wait: true, points: [{ id: donationId, vector }] });
}

export async function deleteVector(donationId: string) {
  await qdrant.delete(COLLECTION, { wait: true, points: [donationId] });
}

/** Stage 1 of matching: semantic recall. Returns donation IDs, best first. */
export async function nearestDonationIds(vector: number[], limit: number): Promise<string[]> {
  const res = await qdrant.query(COLLECTION, { query: vector, limit, with_payload: false });
  return res.points.map((p) => String(p.id));
}
