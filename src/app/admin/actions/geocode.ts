"use server";

import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { geocodeAddress, type LatLng } from "@/server/geo/kakao";

const addressSchema = z.string().trim().min(1).max(200);

export async function geocodeAction(address: string): Promise<LatLng | null> {
  await requireAdmin();
  const parsed = addressSchema.safeParse(address);
  if (!parsed.success) return null;
  return geocodeAddress(parsed.data, { apiKey: serverEnv().KAKAO_REST_API_KEY });
}
