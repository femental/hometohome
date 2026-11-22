-- AlterEnum
ALTER TYPE "RefundReason" ADD VALUE 'duplicate_payment_auto';

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "confirmed_payment_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookings_confirmed_payment_id_key" ON "bookings"("confirmed_payment_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_payment_id_fkey" FOREIGN KEY ("confirmed_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

