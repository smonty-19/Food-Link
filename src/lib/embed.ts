import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/*
 * Local sentence embeddings (no paid API): Xenova/all-MiniLM-L6-v2,
 * 384 dimensions, mean pooling, L2-normalised so cosine = dot product.
 * The model takes a few seconds to load, so it is a process-wide singleton.
 */

export const EMBEDDING_DIM = 384;
const MODEL = "Xenova/all-MiniLM-L6-v2";

const g = globalThis as unknown as { __foodlinkEmbedder?: Promise<FeatureExtractionPipeline> };

function embedder() {
  return (g.__foodlinkEmbedder ??= pipeline("feature-extraction", MODEL, { dtype: "fp32" }));
}

export async function embed(text: string): Promise<number[]> {
  const extractor = await embedder();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/** The text we embed for a listing: what it is, what's in it, and its diet tags. */
export function donationText(d: { description: string; items: string | null; dietary_tags: string[] | null }) {
  const parts = [d.description];
  if (d.items) parts.push(`Items: ${d.items}`);
  if (d.dietary_tags?.length) parts.push(`Dietary: ${d.dietary_tags.join(", ").replaceAll("_", " ")}`);
  return parts.join(". ");
}
