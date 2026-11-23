"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createBlock,
  createHouse,
  createRoom,
  deleteBlock,
  deleteHouse,
  deleteRoom,
  getAdminHost,
  setHouseStatus,
  setRoomStatus,
  updateHouse,
  updateRoom,
} from "@/server/admin/catalog";
import { parseBlockForm, parseHouseForm, parseRoomForm } from "@/server/admin/schemas";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { attempt, CATALOG_ERROR_MESSAGES, INVALID_FORM, type ActionResult } from "./messages";

// Every action starts with requireAdmin(): the page that renders a form is not a security boundary.
// Ids arrive from the client (bound arguments are serialized), so they are validated like form data.

const idSchema = z.uuid();
const statusSchema = z.enum(["draft", "published", "hidden"]);

const notFound: ActionResult = { ok: false, error: CATALOG_ERROR_MESSAGES.NOT_FOUND };
const invalid = (fieldErrors: Record<string, string>): ActionResult => ({ ok: false, error: INVALID_FORM, fieldErrors });

function revalidateHouse(houseId: string) {
  revalidatePath("/admin/houses");
  revalidatePath(`/admin/houses/${houseId}`);
}

function revalidateRoom(houseId: string, roomId: string) {
  revalidateHouse(houseId);
  revalidatePath(`/admin/rooms/${roomId}`);
}

// ---------------------------------------------------------------------------
// Houses

export async function createHouseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = parseHouseForm(formData);
  if (!parsed.ok) return invalid(parsed.errors);
  const host = await getAdminHost(prisma, admin.id);
  const house = await createHouse(prisma, host.id, parsed.data);
  revalidatePath("/admin/houses");
  redirect(`/admin/houses/${house.id}`);
}

export async function updateHouseAction(
  houseId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(houseId);
  if (!id.success) return notFound;
  const parsed = parseHouseForm(formData);
  if (!parsed.ok) return invalid(parsed.errors);
  const r = await attempt(() => updateHouse(prisma, id.data, parsed.data));
  if (!r.ok) return r;
  revalidateHouse(id.data);
  return { ok: true };
}

export async function setHouseStatusAction(houseId: string, status: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(houseId);
  const s = statusSchema.safeParse(status);
  if (!id.success) return notFound;
  if (!s.success) return { ok: false, error: "알 수 없는 상태입니다." };
  const r = await attempt(() => setHouseStatus(prisma, id.data, s.data));
  if (!r.ok) return r;
  revalidateHouse(id.data);
  return { ok: true };
}

export async function deleteHouseAction(houseId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(houseId);
  if (!id.success) return notFound;
  const r = await attempt(() => deleteHouse(prisma, id.data));
  if (!r.ok) return r;
  revalidatePath("/admin/houses");
  redirect("/admin/houses");
}

// ---------------------------------------------------------------------------
// Rooms

export async function createRoomAction(
  houseId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(houseId);
  if (!id.success) return notFound;
  const parsed = parseRoomForm(formData);
  if (!parsed.ok) return invalid(parsed.errors);
  const r = await attempt(() => createRoom(prisma, id.data, parsed.data));
  if (!r.ok) return r;
  revalidateRoom(id.data, r.value.id);
  redirect(`/admin/rooms/${r.value.id}`);
}

export async function updateRoomAction(
  roomId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(roomId);
  if (!id.success) return notFound;
  const parsed = parseRoomForm(formData);
  if (!parsed.ok) return invalid(parsed.errors);
  const r = await attempt(() => updateRoom(prisma, id.data, parsed.data));
  if (!r.ok) return r;
  revalidateRoom(r.value.houseId, r.value.id);
  return { ok: true };
}

export async function setRoomStatusAction(roomId: string, status: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(roomId);
  const s = statusSchema.safeParse(status);
  if (!id.success) return notFound;
  if (!s.success) return { ok: false, error: "알 수 없는 상태입니다." };
  const r = await attempt(() => setRoomStatus(prisma, id.data, s.data));
  if (!r.ok) return r;
  revalidateRoom(r.value.houseId, r.value.id);
  return { ok: true };
}

export async function deleteRoomAction(roomId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(roomId);
  if (!id.success) return notFound;
  const room = await prisma.room.findUnique({ where: { id: id.data }, select: { houseId: true } });
  if (!room) return notFound;
  const r = await attempt(() => deleteRoom(prisma, id.data));
  if (!r.ok) return r;
  revalidateHouse(room.houseId);
  redirect(`/admin/houses/${room.houseId}`);
}

// ---------------------------------------------------------------------------
// Blocks

export async function createBlockAction(
  roomId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(roomId);
  if (!id.success) return notFound;
  const parsed = parseBlockForm(formData);
  if (!parsed.ok) return invalid(parsed.errors);
  const r = await attempt(() => createBlock(prisma, id.data, parsed.data, new Date()));
  if (!r.ok) return r;
  revalidatePath(`/admin/rooms/${id.data}`);
  return { ok: true };
}

export async function deleteBlockAction(blockId: string): Promise<ActionResult> {
  await requireAdmin();
  const id = idSchema.safeParse(blockId);
  if (!id.success) return notFound;
  const r = await attempt(() => deleteBlock(prisma, id.data));
  if (!r.ok) return r;
  revalidatePath("/admin/rooms/[id]", "page");
  return { ok: true };
}
