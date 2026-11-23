import { beforeEach, expect, test, vi } from "vitest";

const db = vi.hoisted(() => ({ room: { findUnique: vi.fn() } }));

vi.mock("@/server/auth/session", () => ({
  requireAdmin: vi.fn(async () => ({ id: "admin-1", email: "boss@example.com", role: "admin" })),
}));
vi.mock("@/server/db", () => ({ prisma: db }));
vi.mock("@/server/admin/catalog", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/admin/catalog")>();
  return {
    CatalogError: real.CatalogError,
    createHouse: vi.fn(),
    updateHouse: vi.fn(),
    deleteHouse: vi.fn(),
    deleteRoom: vi.fn(),
    createBlock: vi.fn(),
    getAdminHost: vi.fn(async () => ({ id: "host-1" })),
  };
});
vi.mock("@/server/photos/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/photos/service")>();
  return { ...real, addPhoto: vi.fn() };
});
vi.mock("@/server/auth/supabase", () => ({ createSupabaseAdminClient: vi.fn(() => ({})) }));
vi.mock("@/server/env", () => ({ serverEnv: vi.fn(() => ({ PHOTO_BUCKET: "photos" })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

import { revalidatePath } from "next/cache";
import { CatalogError, createBlock, createHouse, deleteHouse, deleteRoom, updateHouse } from "@/server/admin/catalog";
import { addPhoto, PhotoError } from "@/server/photos/service";
import {
  createBlockAction,
  createHouseAction,
  deleteHouseAction,
  deleteRoomAction,
  updateHouseAction,
} from "@/app/admin/actions/catalog";
import { uploadPhotoAction } from "@/app/admin/actions/photos";

const ID = "6f1c1c7e-2f7a-4c55-9b44-2f1f0f4b8a11";

function houseForm(): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    "name.en": "Mapo House",
    "description.en": "Near Hongdae",
    "houseRules.en": "No smoking",
    addressKo: "서울 마포구 양화로 45",
    district: "mapo",
    lat: "37.5559",
    lng: "126.9019",
  }))
    fd.set(k, v);
  fd.append("amenities", "wifi");
  return fd;
}

beforeEach(() => vi.clearAllMocks());

test("createHouseAction returns field errors without calling the service", async () => {
  const r = await createHouseAction(null, new FormData());
  expect(r).toMatchObject({ ok: false, error: "입력값을 확인해 주세요." });
  expect(r.ok === false && r.fieldErrors?.["name.en"]).toBeTruthy();
  expect(createHouse).not.toHaveBeenCalled();
});

test("createHouseAction creates under the admin's host and redirects to the edit page", async () => {
  vi.mocked(createHouse).mockResolvedValueOnce({ id: ID } as never);
  await expect(createHouseAction(null, houseForm())).rejects.toThrow(`NEXT_REDIRECT:/admin/houses/${ID}`);
  expect(createHouse).toHaveBeenCalledWith(db, "host-1", expect.objectContaining({ district: "mapo", amenities: ["wifi"] }));
  expect(revalidatePath).toHaveBeenCalledWith("/admin/houses");
});

test("updateHouseAction rejects a malformed id without calling the service", async () => {
  const r = await updateHouseAction("not-a-uuid", null, houseForm());
  expect(r).toEqual({ ok: false, error: "대상을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다." });
  expect(updateHouse).not.toHaveBeenCalled();
});

test("updateHouseAction revalidates the list and the house page", async () => {
  vi.mocked(updateHouse).mockResolvedValueOnce({ id: ID } as never);
  expect(await updateHouseAction(ID, null, houseForm())).toEqual({ ok: true });
  expect(revalidatePath).toHaveBeenCalledWith("/admin/houses");
  expect(revalidatePath).toHaveBeenCalledWith(`/admin/houses/${ID}`);
});

test("deleteHouseAction shows HAS_BOOKINGS in Korean", async () => {
  vi.mocked(deleteHouse).mockRejectedValueOnce(new CatalogError("HAS_BOOKINGS"));
  expect(await deleteHouseAction(ID)).toEqual({
    ok: false,
    error: "예약 이력이 있어 삭제할 수 없습니다. 숨김으로 바꿔주세요.",
  });
  expect(revalidatePath).not.toHaveBeenCalled();
});

test("deleteRoomAction redirects to the parent house", async () => {
  db.room.findUnique.mockResolvedValueOnce({ houseId: "h-1" });
  vi.mocked(deleteRoom).mockResolvedValueOnce(undefined);
  await expect(deleteRoomAction(ID)).rejects.toThrow("NEXT_REDIRECT:/admin/houses/h-1");
});

test("unexpected errors are not swallowed", async () => {
  vi.mocked(deleteHouse).mockRejectedValueOnce(new Error("db down"));
  await expect(deleteHouseAction(ID)).rejects.toThrow("db down");
});

test("createBlockAction maps BLOCK_CONFLICT and passes the parsed dates", async () => {
  vi.mocked(createBlock).mockRejectedValueOnce(new CatalogError("BLOCK_CONFLICT"));
  const fd = new FormData();
  fd.set("startDate", "2027-03-01");
  fd.set("endDateExclusive", "2027-03-10");
  fd.set("reason", "수리");
  expect(await createBlockAction(ID, null, fd)).toEqual({
    ok: false,
    error: "이 기간에 진행 중인 예약이 있어 차단할 수 없습니다.",
  });
  expect(createBlock).toHaveBeenCalledWith(
    db,
    ID,
    { startDate: "2027-03-01", endDateExclusive: "2027-03-10", reason: "수리" },
    expect.any(Date),
  );
});

test("uploadPhotoAction uploads each file and reports per-file failures", async () => {
  vi.mocked(addPhoto)
    .mockResolvedValueOnce({ id: "p1" } as never)
    .mockRejectedValueOnce(new PhotoError("BAD_TYPE"));
  const fd = new FormData();
  fd.append("files", new File([new Uint8Array([1, 2, 3])], "a.jpg", { type: "image/jpeg" }));
  fd.append("files", new File([new Uint8Array([4, 5])], "b.gif", { type: "image/gif" }));

  const r = await uploadPhotoAction("room", ID, fd);
  expect(r).toEqual({ ok: false, error: "b.gif: JPG, PNG, WEBP 이미지만 올릴 수 있습니다." });
  expect(addPhoto).toHaveBeenCalledTimes(2);
  expect(vi.mocked(addPhoto).mock.calls[0][2]).toEqual({ kind: "room", id: ID });
  expect(vi.mocked(addPhoto).mock.calls[0][3]).toEqual({ bytes: new Uint8Array([1, 2, 3]), contentType: "image/jpeg" });
  expect(revalidatePath).toHaveBeenCalledWith(`/admin/rooms/${ID}`);
});

test("uploadPhotoAction asks for a file when none is chosen", async () => {
  expect(await uploadPhotoAction("house", ID, new FormData())).toEqual({ ok: false, error: "올릴 사진을 선택해 주세요." });
  expect(addPhoto).not.toHaveBeenCalled();
});
