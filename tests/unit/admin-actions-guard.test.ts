import { beforeEach, describe, expect, test, vi } from "vitest";

// Every admin action must call requireAdmin() before it touches the DB, services or caches.

const guard = vi.hoisted(() => ({ mode: "forbidden" as "forbidden" | "anonymous" }));

vi.mock("@/server/auth/session", () => ({
  requireAdmin: vi.fn(async () => {
    throw new Error(guard.mode === "forbidden" ? "NEXT_FORBIDDEN" : "NEXT_REDIRECT:/login");
  }),
}));

// Any property access on the DB client fails the test loudly.
vi.mock("@/server/db", () => ({
  prisma: new Proxy(
    {},
    {
      get(_t, prop) {
        throw new Error(`prisma.${String(prop)} accessed before requireAdmin`);
      },
    },
  ),
}));

vi.mock("@/server/admin/catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/admin/catalog")>();
  return {
    CatalogError: real.CatalogError,
    createHouse: vi.fn(),
    updateHouse: vi.fn(),
    setHouseStatus: vi.fn(),
    deleteHouse: vi.fn(),
    createRoom: vi.fn(),
    updateRoom: vi.fn(),
    setRoomStatus: vi.fn(),
    deleteRoom: vi.fn(),
    createBlock: vi.fn(),
    deleteBlock: vi.fn(),
    getAdminHost: vi.fn(),
    listHousesForAdmin: vi.fn(),
  };
});

vi.mock("@/server/photos/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/photos/service")>();
  return { ...real, createPhotoUpload: vi.fn(), registerPhoto: vi.fn(), removePhoto: vi.fn(), reorderPhotos: vi.fn() };
});

const kakao = vi.hoisted(() => ({ geocodeAddress: vi.fn() }));
vi.mock("@/server/geo/kakao", () => kakao);

vi.mock("@/server/auth/supabase", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn() }));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as catalog from "@/server/admin/catalog";
import { createSupabaseAdminClient } from "@/server/auth/supabase";
import { requireAdmin } from "@/server/auth/session";
import * as photoService from "@/server/photos/service";
import * as catalogActions from "@/app/admin/actions/catalog";
import * as photoActions from "@/app/admin/actions/photos";
import * as geocodeActions from "@/app/admin/actions/geocode";

const ID = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

function formData() {
  const fd = new FormData();
  fd.set("name.en", "House");
  fd.set("status", "published");
  fd.append("files", new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" }));
  return fd;
}

// Plausible arguments for any of the signatures (bound ids, prevState, FormData, plain args).
const ARGS = [ID, ID, formData(), "published", [ID]];

const all = { ...catalogActions, ...photoActions, ...geocodeActions } as Record<string, (...a: unknown[]) => Promise<unknown>>;

const serviceMocks = [
  ...Object.values(catalog).filter((v) => vi.isMockFunction(v)),
  ...[photoService.createPhotoUpload, photoService.registerPhoto, photoService.removePhoto, photoService.reorderPhotos],
  createSupabaseAdminClient,
  revalidatePath,
  redirect,
  kakao.geocodeAddress,
];

beforeEach(() => vi.clearAllMocks());

test("action files export the planned actions", () => {
  expect(Object.keys(catalogActions).sort()).toEqual([
    "createBlockAction",
    "createHouseAction",
    "createRoomAction",
    "deleteBlockAction",
    "deleteHouseAction",
    "deleteRoomAction",
    "setHouseStatusAction",
    "setRoomStatusAction",
    "updateHouseAction",
    "updateRoomAction",
  ]);
  expect(Object.keys(photoActions).sort()).toEqual([
    "createPhotoUploadAction",
    "registerPhotoAction",
    "removePhotoAction",
    "reorderPhotosAction",
  ]);
  expect(Object.keys(geocodeActions).sort()).toEqual(["geocodeAction"]);
  for (const [name, fn] of Object.entries(all)) expect(typeof fn, name).toBe("function");
});

describe.each(["forbidden", "anonymous"] as const)("%s caller", (mode) => {
  test.each(Object.entries(all))("%s refuses before touching data", async (_name, action) => {
    guard.mode = mode;
    await expect(action(...ARGS)).rejects.toThrow(mode === "forbidden" ? "NEXT_FORBIDDEN" : "NEXT_REDIRECT");
    expect(requireAdmin).toHaveBeenCalledOnce();
    for (const m of serviceMocks) expect(m).not.toHaveBeenCalled();
  });
});
