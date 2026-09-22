/*
  Warnings:

  - You are about to drop the column `bufferMinutes` on the `MeetingType` table. All the data in the column will be lost.
  - You are about to drop the column `customQuestion` on the `MeetingType` table. All the data in the column will be lost.
  - You are about to drop the column `minNoticeHours` on the `MeetingType` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "WindowType" AS ENUM ('CALENDAR_DAYS', 'BUSINESS_DAYS', 'DATE_RANGE', 'INDEFINITE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledBy" TEXT,
ADD COLUMN     "guests" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "location" JSONB,
ADD COLUMN     "noShow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previousStartTime" TIMESTAMP(3),
ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "singleUseLinkId" TEXT,
ADD COLUMN     "utm" JSONB;

-- AlterTable
ALTER TABLE "Host" ADD COLUMN     "conflictCalendarIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pausedMessage" TEXT,
ADD COLUMN     "pausedUntil" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "MeetingType" ADD COLUMN     "allowGuests" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "brandId" TEXT,
ADD COLUMN     "bufferAfterMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bufferBeforeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancelCutoffHours" INTEGER,
ADD COLUMN     "confirmationNote" TEXT,
ADD COLUMN     "durationOptions" JSONB,
ADD COLUMN     "followUpMinutes" INTEGER,
ADD COLUMN     "locations" JSONB,
ADD COLUMN     "maxGuests" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "minNoticeMinutes" INTEGER NOT NULL DEFAULT 720,
ADD COLUMN     "policyText" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "redirectPassParams" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "refundPolicy" TEXT NOT NULL DEFAULT 'before_cutoff',
ADD COLUMN     "reminderMinutes" INTEGER[] DEFAULT ARRAY[1440, 60]::INTEGER[],
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "secret" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "startIncrementMinutes" INTEGER,
ADD COLUMN     "weeklyLimit" INTEGER,
ADD COLUMN     "windowEnd" TEXT,
ADD COLUMN     "windowStart" TEXT,
ADD COLUMN     "windowType" "WindowType" NOT NULL DEFAULT 'CALENDAR_DAYS',
ALTER COLUMN "weeklyHours" DROP NOT NULL;

-- Backfill v1 values before dropping the old columns.
UPDATE "MeetingType" SET
  "bufferBeforeMinutes" = "bufferMinutes",
  "bufferAfterMinutes"  = "bufferMinutes",
  "minNoticeMinutes"    = "minNoticeHours" * 60;

ALTER TABLE "MeetingType" DROP COLUMN "bufferMinutes",
DROP COLUMN "customQuestion",
DROP COLUMN "minNoticeHours";

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "logoUrl" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#FF6A00',
    "theme" TEXT NOT NULL DEFAULT 'auto',
    "websiteUrl" TEXT,
    "replyTo" TEXT,
    "showPoweredBy" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "weeklyHours" JSONB NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "bookingId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "lockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "doneAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "bookingId" TEXT,
    "openKey" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "notifiedAt" TIMESTAMP(3),
    "notifyError" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastDeliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SingleUseLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "meetingTypeId" TEXT NOT NULL,
    "label" TEXT,
    "durationMinutes" INTEGER,
    "priceCents" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SingleUseLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsDaily" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "meetingTypeId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnalyticsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_doneAt_deadAt_runAt_idx" ON "Job"("doneAt", "deadAt", "runAt");

-- CreateIndex
CREATE INDEX "Job_bookingId_idx" ON "Job"("bookingId");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_openKey_key" ON "Alert"("openKey");

-- CreateIndex
CREATE INDEX "Alert_resolvedAt_createdAt_idx" ON "Alert"("resolvedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hash_key" ON "ApiKey"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "SingleUseLink_token_key" ON "SingleUseLink"("token");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsDaily_day_meetingTypeId_metric_source_key" ON "AnalyticsDaily"("day", "meetingTypeId", "metric", "source");

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "Host"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingType" ADD CONSTRAINT "MeetingType_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SingleUseLink" ADD CONSTRAINT "SingleUseLink_meetingTypeId_fkey" FOREIGN KEY ("meetingTypeId") REFERENCES "MeetingType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
