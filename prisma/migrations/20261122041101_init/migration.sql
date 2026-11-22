-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('guest', 'admin');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('draft', 'published', 'hidden');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('single', 'double');

-- CreateEnum
CREATE TYPE "GenderPolicy" AS ENUM ('male', 'female', 'any');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('requested', 'rejected', 'request_expired', 'withdrawn', 'awaiting_payment', 'payment_expired', 'confirmed', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('card', 'paypal', 'offline');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('KRW', 'USD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('guest_cancel_full', 'guest_cancel_deposit_only', 'admin_cancel', 'late_payment_auto');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'guest',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hosts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hosts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "houses" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "house_rules" JSONB NOT NULL,
    "address_ko" TEXT NOT NULL,
    "address_en" TEXT,
    "district" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "nearest_stations" JSONB NOT NULL DEFAULT '[]',
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_photos" (
    "id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "house_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "house_id" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'draft',
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "monthly_rent" INTEGER NOT NULL,
    "deposit" INTEGER NOT NULL,
    "available_from" DATE NOT NULL,
    "room_type" "RoomType" NOT NULL,
    "private_bathroom" BOOLEAN NOT NULL DEFAULT false,
    "gender_policy" "GenderPolicy" NOT NULL DEFAULT 'any',
    "max_occupants" INTEGER NOT NULL,
    "extra_person_monthly_fee" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_photos" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "room_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_blocks" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date_exclusive" DATE NOT NULL,
    "reason" TEXT,

    CONSTRAINT "room_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "room_id" TEXT NOT NULL,
    "guest_id" TEXT NOT NULL,
    "move_in" DATE NOT NULL,
    "move_out" DATE NOT NULL,
    "guest_name" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "contact" TEXT,
    "message" TEXT,
    "occupants" INTEGER NOT NULL DEFAULT 1,
    "co_occupant_name" TEXT,
    "co_occupant_gender" TEXT,
    "monthly_rent" INTEGER NOT NULL,
    "deposit" INTEGER NOT NULL,
    "full_months" INTEGER NOT NULL,
    "extra_days" INTEGER NOT NULL,
    "prorated_amount" INTEGER NOT NULL,
    "stay_total" INTEGER NOT NULL,
    "first_rent_amount" INTEGER NOT NULL,
    "first_payment_total" INTEGER NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'requested',
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_expires_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "hold_expires_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "rejected_reason" TEXT,
    "deposit_returned_at" TIMESTAMPTZ(3),
    "deposit_return_note" TEXT,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "offline_note" TEXT,
    "amount_krw" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'KRW',
    "amount_charged_minor" INTEGER NOT NULL,
    "fx_rate" DECIMAL(12,4),
    "fx_quoted_at" TIMESTAMPTZ(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "pg_tx_id" TEXT,
    "raw" JSONB,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "reason" "RefundReason" NOT NULL,
    "amount_krw" INTEGER NOT NULL,
    "amount_refunded_minor" INTEGER NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'pending',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "pg_refund_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_log" (
    "id" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "subject" TEXT,
    "booking_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "hosts_user_id_idx" ON "hosts"("user_id");

-- CreateIndex
CREATE INDEX "houses_host_id_idx" ON "houses"("host_id");

-- CreateIndex
CREATE INDEX "houses_district_idx" ON "houses"("district");

-- CreateIndex
CREATE INDEX "house_photos_house_id_idx" ON "house_photos"("house_id");

-- CreateIndex
CREATE INDEX "rooms_house_id_idx" ON "rooms"("house_id");

-- CreateIndex
CREATE INDEX "room_photos_room_id_idx" ON "room_photos"("room_id");

-- CreateIndex
CREATE INDEX "room_blocks_room_id_idx" ON "room_blocks"("room_id");

-- CreateIndex
CREATE INDEX "bookings_room_id_status_idx" ON "bookings"("room_id", "status");

-- CreateIndex
CREATE INDEX "bookings_guest_id_idx" ON "bookings"("guest_id");

-- CreateIndex
CREATE INDEX "bookings_status_request_expires_at_idx" ON "bookings"("status", "request_expires_at");

-- CreateIndex
CREATE INDEX "bookings_status_hold_expires_at_idx" ON "bookings"("status", "hold_expires_at");

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "email_log_booking_id_idx" ON "email_log"("booking_id");

-- AddForeignKey
ALTER TABLE "hosts" ADD CONSTRAINT "hosts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "houses" ADD CONSTRAINT "houses_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_photos" ADD CONSTRAINT "house_photos_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "houses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_house_id_fkey" FOREIGN KEY ("house_id") REFERENCES "houses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_photos" ADD CONSTRAINT "room_photos_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_blocks" ADD CONSTRAINT "room_blocks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
