-- Shared sequential employee id across admins and riders (displayed as
-- "PM-1001", "PM-1002", ... - the "PM-" prefix is applied at the app layer,
-- not stored). One sequence so an admin and a rider never collide on the
-- same number, starting where the business asked it to start.
CREATE SEQUENCE IF NOT EXISTS employee_number_seq START WITH 1001;

-- Volatile defaults (nextval) force Postgres to backfill every existing row
-- with a real value as part of the ALTER, not just future inserts.
ALTER TABLE "admins" ADD COLUMN "employee_number" INTEGER DEFAULT nextval('employee_number_seq');
ALTER TABLE "riders" ADD COLUMN "employee_number" INTEGER DEFAULT nextval('employee_number_seq');

CREATE UNIQUE INDEX "admins_employee_number_key" ON "admins"("employee_number");
CREATE UNIQUE INDEX "riders_employee_number_key" ON "riders"("employee_number");
