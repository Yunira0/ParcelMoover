-- Return-to-Origin (RTO) workflow statuses for a failed delivery that goes back
-- to the vendor: follow_up (NDR resolution) → ready_to_return → sent_to_vendor →
-- returned_to_vendor (terminal).
ALTER TYPE "parcel_status" ADD VALUE IF NOT EXISTS 'follow_up';
ALTER TYPE "parcel_status" ADD VALUE IF NOT EXISTS 'ready_to_return';
ALTER TYPE "parcel_status" ADD VALUE IF NOT EXISTS 'sent_to_vendor';
ALTER TYPE "parcel_status" ADD VALUE IF NOT EXISTS 'returned_to_vendor';
