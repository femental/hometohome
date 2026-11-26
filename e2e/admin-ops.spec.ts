import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./env";
import { kstDate, seed, signIn } from "./helpers";

// 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

// Operator: photo upload straight to Storage (signed URL) and a blocked period on the room.
test("operator uploads a room photo and blocks dates", async ({ page }) => {
  const { roomId } = seed();
  await signIn(page, ADMIN_EMAIL, `/admin/rooms/${roomId}`);
  await expect(page).toHaveURL(new RegExp(`/admin/rooms/${roomId}`));

  await page.getByLabel("사진 파일").setInputFiles({ name: "room.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "사진 올리기" }).click();
  await expect(page.getByRole("status")).toHaveText("1장을 올렸습니다.");
  await expect(page.getByAltText("사진 1")).toBeVisible();

  await page.getByLabel("시작일").fill(kstDate(200));
  await page.getByLabel(/^해제일/).fill(kstDate(210));
  await page.getByLabel("사유").fill("E2E 수리");
  await page.getByRole("button", { name: "차단 추가" }).click();
  await expect(page.getByText("E2E 수리")).toBeVisible();
});
