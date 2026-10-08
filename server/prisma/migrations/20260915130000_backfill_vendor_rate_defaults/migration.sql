-- The Global Pricing screen is gone and the vendor form now requires every
-- rate, so fill each vendor's blank rate fields with exactly the value pricing
-- was already falling back to (pricing.service resolveBaseRate /
-- getReturnDeliveryQuote). No vendor's charge changes.
--
-- Not touched: extra_weight_percent (blank still means the network-wide value
-- on the Rates tab), and inside_valley_flat_rate (vendor-only, no default).

-- Return percents, every vendor. A branch-delivery return falls back to the
-- branch default, then the vendor's own return percent, then the home default.
UPDATE "vendors" v SET
  "return_inside_valley_percent" = COALESCE(v."return_inside_valley_percent", s."return_inside_valley_percent"),
  "return_outside_valley_percent" = COALESCE(v."return_outside_valley_percent", s."return_outside_valley_percent"),
  "branch_return_inside_valley_percent" = COALESCE(v."branch_return_inside_valley_percent", s."branch_return_inside_valley_percent", v."return_inside_valley_percent", s."return_inside_valley_percent"),
  "branch_return_outside_valley_percent" = COALESCE(v."branch_return_outside_valley_percent", s."branch_return_outside_valley_percent", v."return_outside_valley_percent", s."return_outside_valley_percent")
FROM (SELECT * FROM "pricing_settings" LIMIT 1) s;

-- Flat and zone rates, head-office vendors only. For a branch vendor (a hub
-- like Hetauda) a blank flat rate means "price off the branch route rate", so
-- filling it from the valley defaults would reprice them. Branch-delivery
-- rates fall back to the branch default, then the home default.
UPDATE "vendors" v SET
  "flat_inside_valley" = COALESCE(v."flat_inside_valley", s."flat_inside_valley"),
  "flat_outside_valley" = COALESCE(v."flat_outside_valley", s."flat_outside_valley"),
  "flat_outside_ring_road" = COALESCE(v."flat_outside_ring_road", s."flat_outside_ring_road"),
  "zone_major_cities" = COALESCE(v."zone_major_cities", s."zone_major_cities"),
  "zone_urban_areas" = COALESCE(v."zone_urban_areas", s."zone_urban_areas"),
  "zone_remote_areas" = COALESCE(v."zone_remote_areas", s."zone_remote_areas"),
  "zone_inside_valley" = COALESCE(v."zone_inside_valley", s."zone_inside_valley"),
  "branch_flat_inside_valley" = COALESCE(v."branch_flat_inside_valley", s."branch_flat_inside_valley", s."flat_inside_valley"),
  "branch_flat_outside_valley" = COALESCE(v."branch_flat_outside_valley", s."branch_flat_outside_valley", s."flat_outside_valley"),
  "branch_flat_outside_ring_road" = COALESCE(v."branch_flat_outside_ring_road", s."branch_flat_outside_ring_road", s."flat_outside_ring_road"),
  "branch_zone_major_cities" = COALESCE(v."branch_zone_major_cities", s."branch_zone_major_cities", s."zone_major_cities"),
  "branch_zone_urban_areas" = COALESCE(v."branch_zone_urban_areas", s."branch_zone_urban_areas", s."zone_urban_areas"),
  "branch_zone_remote_areas" = COALESCE(v."branch_zone_remote_areas", s."branch_zone_remote_areas", s."zone_remote_areas"),
  "branch_zone_inside_valley" = COALESCE(v."branch_zone_inside_valley", s."branch_zone_inside_valley", s."zone_inside_valley")
FROM (SELECT * FROM "pricing_settings" LIMIT 1) s
WHERE v."location_id" IS NULL
   OR v."location_id" IN (
     SELECT l."id" FROM "locations" l
     WHERE l."parent_id" IS NULL AND UPPER(TRIM(COALESCE(l."code", ''))) = 'IMADOL'
   );
