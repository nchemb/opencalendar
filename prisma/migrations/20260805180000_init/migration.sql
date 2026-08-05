-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DisplayMode" AS ENUM ('popup', 'inline');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'EXPIRED', 'CANCELLED', 'FAILED_NEEDS_INTERVENTION');

-- CreateTable
CREATE TABLE "Host" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Chicago',
    "googleRefreshToken" TEXT,
    "googleAccessToken" TEXT,
    "googleTokenExpiresAt" TIMESTAMP(3),
    "googleCalendarId" TEXT NOT NULL DEFAULT 'primary',
    "googleConnectedAt" TIMESTAMP(3),
    "googleAuthError" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Host_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingType" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "priceCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "color" TEXT NOT NULL DEFAULT '#FF6A00',
    "weeklyHours" JSONB NOT NULL,
    "daysInAdvance" INTEGER NOT NULL DEFAULT 30,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 12,
    "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
    "dailyLimit" INTEGER,
    "customQuestion" TEXT,
    "redirectUrl" TEXT,
    "displayMode" "DisplayMode" NOT NULL DEFAULT 'popup',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "meetingTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "customAnswer" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "stripeSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripePaymentStatus" TEXT,
    "stripePaidAt" TIMESTAMP(3),
    "amountCents" INTEGER,
    "webhookProcessedAt" TIMESTAMP(3),
    "googleEventId" TEXT,
    "googleEventAt" TIMESTAMP(3),
    "googleSyncError" TEXT,
    "meetLink" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "confirmationEmailSentAt" TIMESTAMP(3),
    "confirmationEmailError" TEXT,
    "webhookDeliveredAt" TIMESTAMP(3),
    "cancelToken" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Host_email_key" ON "Host"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingType_slug_key" ON "MeetingType"("slug");

-- CreateIndex
CREATE INDEX "MeetingType_active_idx" ON "MeetingType"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_stripeSessionId_key" ON "Booking"("stripeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_googleEventId_key" ON "Booking"("googleEventId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");

-- CreateIndex
CREATE INDEX "Booking_hostId_status_startTime_endTime_idx" ON "Booking"("hostId", "status", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "Booking_status_expiresAt_idx" ON "Booking"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Booking_meetingTypeId_startTime_idx" ON "Booking"("meetingTypeId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_email_idx" ON "Booking"("email");

-- AddForeignKey
ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_meetingTypeId_fkey" FOREIGN KEY ("meetingTypeId") REFERENCES "MeetingType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Belt-and-braces: exactly one *live* booking may own a given exact slot.
-- Partial (unlike a plain UNIQUE) so a cancelled/expired booking does not burn the slot forever.
-- Real overlap safety (different durations) comes from the advisory-locked booking transaction.
CREATE UNIQUE INDEX "Booking_live_slot_key"
  ON "Booking" ("hostId", "startTime", "endTime")
  WHERE "status" IN ('CONFIRMED', 'PENDING_PAYMENT');
