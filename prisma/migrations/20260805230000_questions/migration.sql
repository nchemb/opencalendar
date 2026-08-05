-- Multiple custom questions per meeting type; structured answers per booking.
ALTER TABLE "MeetingType" ADD COLUMN "questions" JSONB;
ALTER TABLE "Booking" ADD COLUMN "answers" JSONB;

-- Backfill: promote the legacy single question into the list.
UPDATE "MeetingType"
SET "questions" = jsonb_build_array(jsonb_build_object('label', "customQuestion", 'required', false))
WHERE "customQuestion" IS NOT NULL AND btrim("customQuestion") <> '';
