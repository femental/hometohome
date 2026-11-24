"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { createSupabaseAdminClient } from "@/server/auth/supabase";
import { prisma } from "@/server/db";
import { photoBucket } from "@/lib/photo-url";
import { createPhotoUpload, registerPhoto, removePhoto, reorderPhotos, type PhotoOwnerKind } from "@/server/photos/service";
import { SupabasePhotoStorage } from "@/server/photos/storage";
import { attempt, PHOTO_ERROR_MESSAGES, type ActionResult } from "./messages";

const kindSchema = z.enum(["house", "room"]);
const idSchema = z.uuid();
const orderSchema = z.array(idSchema).min(1).max(100);

const notFound: ActionResult = { ok: false, error: PHOTO_ERROR_MESSAGES.NOT_FOUND };

function storage() {
  return new SupabasePhotoStorage(createSupabaseAdminClient(), photoBucket());
}

function revalidateOwner(kind: PhotoOwnerKind, ownerId?: string) {
  const base = kind === "house" ? "/admin/houses" : "/admin/rooms";
  if (ownerId) revalidatePath(`${base}/${ownerId}`);
  else revalidatePath(`${base}/[id]`, "page");
}

const uploadSchema = z.object({ contentType: z.string().max(100), size: z.number().int().nonnegative() });
const pathSchema = z.string().max(200);

/** Step 1 of a direct upload: a signed URL the browser puts the file to (no action body limit). */
export async function createPhotoUploadAction(
  kind: string,
  ownerId: string,
  file: { contentType: string; size: number },
): Promise<{ ok: true; path: string; token: string } | { ok: false; error?: string }> {
  await requireAdmin();
  const k = kindSchema.safeParse(kind);
  const id = idSchema.safeParse(ownerId);
  const f = uploadSchema.safeParse(file);
  if (!k.success || !id.success || !f.success) return { ok: false, error: PHOTO_ERROR_MESSAGES.NOT_FOUND };
  const r = await attempt(() => createPhotoUpload(prisma, storage(), { kind: k.data, id: id.data }, f.data));
  return r.ok ? { ok: true, path: r.value.path, token: r.value.token } : r;
}

/** Step 2: registers the uploaded object as a photo after checking its bytes. */
export async function registerPhotoAction(kind: string, ownerId: string, path: string): Promise<ActionResult> {
  await requireAdmin();
  const k = kindSchema.safeParse(kind);
  const id = idSchema.safeParse(ownerId);
  const p = pathSchema.safeParse(path);
  if (!k.success || !id.success || !p.success) return notFound;
  const r = await attempt(() => registerPhoto(prisma, storage(), { kind: k.data, id: id.data }, p.data));
  if (!r.ok) return r;
  revalidateOwner(k.data, id.data);
  return { ok: true };
}

export async function removePhotoAction(kind: string, photoId: string): Promise<ActionResult> {
  await requireAdmin();
  const k = kindSchema.safeParse(kind);
  const id = idSchema.safeParse(photoId);
  if (!k.success || !id.success) return notFound;
  const r = await attempt(() => removePhoto(prisma, storage(), k.data, id.data));
  if (!r.ok) return r;
  revalidateOwner(k.data);
  return { ok: true };
}

/** `orderedIds` must list every photo of the owner exactly once, first photo first. */
export async function reorderPhotosAction(kind: string, ownerId: string, orderedIds: string[]): Promise<ActionResult> {
  await requireAdmin();
  const k = kindSchema.safeParse(kind);
  const id = idSchema.safeParse(ownerId);
  const order = orderSchema.safeParse(orderedIds);
  if (!k.success || !id.success || !order.success) return notFound;
  const r = await attempt(() => reorderPhotos(prisma, k.data, id.data, order.data));
  if (!r.ok) return r;
  revalidateOwner(k.data, id.data);
  return { ok: true };
}
