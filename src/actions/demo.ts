"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { runRace, type RaceResult } from "@/lib/race";

export type RaceState = { result?: RaceResult; error?: string } | undefined;

const Schema = z.object({
  mode: z.enum(["safe", "unsafe"]),
  n: z.coerce.number().int().min(2).max(12),
});

export async function runRaceDemo(_prev: RaceState, formData: FormData): Promise<RaceState> {
  await requireRole("admin");
  const parsed = Schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Choose a mode and between 2 and 12 claimers." };
  try {
    const result = await runRace(parsed.data.mode, parsed.data.n);
    revalidatePath("/admin");
    return { result };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
