-- At most one default schedule per host. Keep the oldest if data already has several.
UPDATE "Schedule" s SET "isDefault" = false
WHERE s."isDefault" AND EXISTS (
  SELECT 1 FROM "Schedule" o
  WHERE o."hostId" = s."hostId" AND o."isDefault" AND o."createdAt" < s."createdAt"
);
CREATE UNIQUE INDEX "Schedule_one_default_per_host" ON "Schedule"("hostId") WHERE "isDefault";
