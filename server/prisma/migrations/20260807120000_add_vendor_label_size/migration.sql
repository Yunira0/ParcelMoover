-- Vendor-configurable sticker/label print size.
--
-- Printed labels were hardcoded to 100mm x 75mm (see printLabels.ts), but
-- vendors run their own thermal sticker printers loaded with whatever label
-- stock they actually have, so any vendor not on 100x75mm got a mismatched
-- printout. Unlike every other per-vendor override on this table (rates,
-- billing thresholds), this one is self-service - the vendor sets it, not
-- an admin - so it has no counterpart "global settings" row to fall back to;
-- the default lives in code (vendorPrintSettings.service.ts).
ALTER TABLE "vendors" ADD COLUMN "label_width_mm" INTEGER;
ALTER TABLE "vendors" ADD COLUMN "label_height_mm" INTEGER;
