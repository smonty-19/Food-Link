/*
 * (Re)create the Qdrant collection and embed every live listing.
 *   npm run qdrant:init            -> create if missing, then backfill
 *   (package script passes --recreate, which drops the collection first)
 */
import "dotenv/config";
import { ensureCollection, qdrant, COLLECTION } from "../src/lib/qdrant";
import { backfillVectors } from "../src/lib/vector-sync";
import { webPool, adminPool } from "../src/lib/db";

async function main() {
  const recreate = process.argv.includes("--recreate");
  await ensureCollection(recreate);
  console.log(`Collection "${COLLECTION}" ready${recreate ? " (recreated)" : ""}.`);

  const n = await backfillVectors();
  const info = await qdrant.getCollection(COLLECTION);
  console.log(`Embedded ${n} live listings. Qdrant now holds ${info.points_count} points.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([webPool.end(), adminPool.end()]));
