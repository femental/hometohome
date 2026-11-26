import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL } from "./env";
import { kstDate, seed, signIn } from "./helpers";

// Guest request → operator approval → (fake) card payment → confirmed → cancellation with refund.
test("guest books, pays and cancels a room", async ({ browser }) => {
  const { roomId } = seed();
  const guest = await browser.newPage();
  const guestEmail = `e2e-guest-${randomUUID().slice(0, 8)}@example.com`;

  // Sign in, back on the room page.
  await signIn(guest, guestEmail, `/en/rooms/${roomId}`);
  await expect(guest).toHaveURL(new RegExp(`/en/rooms/${roomId}`));
  await guest.waitForLoadState("networkidle"); // controlled inputs: fill only after hydration

  // Request: 2 months from two weeks out (full refund window still open when cancelling).
  await guest.getByLabel("Move-in date").fill(kstDate(14));
  await guest.getByLabel("Last night").fill(kstDate(14 + 70));
  await expect(guest.getByText("First payment (after approval)")).toBeVisible();
  await guest.getByLabel("Full name").fill("Erin Example");
  await guest.getByLabel("Nationality").fill("Canada");
  await guest.getByLabel("Gender").selectOption("female");
  await guest.getByLabel("Contact").fill("WhatsApp +1 555 0101");
  await guest.getByRole("button", { name: "Send request" }).click();
  await expect(guest).toHaveURL(/\/en\/bookings\/[0-9a-f-]{36}$/);
  const bookingId = guest.url().split("/").pop()!;
  await expect(guest.getByText("Requested").first()).toBeVisible();

  // Operator approves.
  const admin = await browser.newPage();
  await signIn(admin, ADMIN_EMAIL, `/admin/bookings/${bookingId}`);
  await expect(admin).toHaveURL(new RegExp(`/admin/bookings/${bookingId}`));
  await admin.getByRole("button", { name: "승인", exact: true }).click();
  await admin.getByRole("group").getByRole("button", { name: "승인", exact: true }).click();
  await expect(admin.getByRole("button", { name: "승인", exact: true })).toHaveCount(0);

  // Guest pays by card (fake PG in test mode) and the booking is confirmed.
  await guest.goto(`/en/bookings/${bookingId}/pay`);
  await expect(guest.getByText("Test mode: no real charge is made.")).toBeVisible();
  await guest.getByRole("button", { name: "Pay by card" }).click();
  await expect(guest).toHaveURL(/\/pay\/complete/);
  await guest.goto(`/en/bookings/${bookingId}`);
  await expect(guest.getByText("Confirmed").first()).toBeVisible();

  // Cancel before the deadline: everything is refunded through the (fake) PG.
  await guest.getByRole("button", { name: "Cancel booking" }).click();
  await guest.getByRole("button", { name: "Yes, cancel booking" }).click();
  await expect(guest.getByText("Cancelled").first()).toBeVisible();
  await guest.reload();
  await expect(guest.getByText(/Refund .*: completed/)).toBeVisible();
});
