-- At most one default schedule per host. Keep the oldest (id breaks createdAt ties).
UPDATE "Schedule" s SET "isDefault" = false
WHERE s."isDefault" AND EXISTS (
  SELECT 1 FROM "Schedule" o
  WHERE o."hostId" = s."hostId" AND o."isDefault"
    AND (o."createdAt", o.id) < (s."createdAt", s.id)
);
CREATE UNIQUE INDEX "Schedule_one_default_per_host" ON "Schedule"("hostId") WHERE "isDefault";
