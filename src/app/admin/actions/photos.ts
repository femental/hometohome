"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/server/auth/session";
import { createSupabaseAdminClient } from "@/server/auth/supabase";
import { prisma } from "@/server/db";
import { serverEnv } from "@/server/env";
import { addPhoto, removePhoto, reorderPhotos, type PhotoOwnerKind } from "@/server/photos/service";
import { SupabasePhotoStorage } from "@/server/photos/storage";
import { attempt, PHOTO_ERROR_MESSAGES, type ActionResult } from "./messages";

const kindSchema = z.enum(["house", "room"]);
const idSchema = z.uuid();
const orderSchema = z.array(idSchema).min(1).max(100);

const notFound: ActionResult = { ok: false, error: PHOTO_ERROR_MESSAGES.NOT_FOUND };

function storage() {
  return new SupabasePhotoStorage(createSupabaseAdminClient(), serverEnv().PHOTO_BUCKET);
}

function revalidateOwner(kind: PhotoOwnerKind, ownerId?: string) {
  const base = kind === "house" ? "/admin/houses" : "/admin/rooms";
  if (ownerId) revalidatePath(`${base}/${ownerId}`);
  else revalidatePath(`${base}/[id]`, "page");
}

/**
 * Uploads every `files` entry of the form, one addPhoto per file. The UI sends one file per
 * call (keeps each request under the body size limit), but several are accepted.
 * Failures are reported per file; successful files stay uploaded.
 */
export async function uploadPhotoAction(kind: string, ownerId: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin();
  const k = kindSchema.safeParse(kind);
  const id = idSchema.safeParse(ownerId);
  if (!k.success || !id.success) return notFound;

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: "올릴 사진을 선택해 주세요." };

  const store = storage();
  const failures: string[] = [];
  let uploaded = 0;
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await attempt(() => addPhoto(prisma, store, { kind: k.data, id: id.data }, { bytes, contentType: file.type }));
    if (r.ok) uploaded++;
    else failures.push(`${file.name}: ${r.error}`);
  }
  if (uploaded > 0) revalidateOwner(k.data, id.data);
  return failures.length === 0 ? { ok: true } : { ok: false, error: failures.join("\n") };
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
