                                    -- CreateEnum
                                    CREATE TYPE "exception_status" AS ENUM ('open', 'resolved', 'closed');

                                    -- CreateEnum
                                    CREATE TYPE "order_type" AS ENUM ('exchange', 'delivery', 'return');

                                    -- CreateEnum
                                    CREATE TYPE "parcel_status" AS ENUM ('pickup_ordered', 'rider_assigned', 'picked_up', 'arrived', 'ready_to_deliver', 'oov', 'dispatched', 'arrived_at_branch', 'hold', 'loss_and_damage', 'delivered', 'failed', 'cancelled');

                                    -- CreateEnum
                                    CREATE TYPE "payment_status" AS ENUM ('pending', 'paid');

                                    -- CreateEnum
                                    CREATE TYPE "service_type" AS ENUM ('dtd', 'btd', 'btb', 'dtb');

                                    -- CreateEnum
                                    CREATE TYPE "settlement_status" AS ENUM ('pending', 'settled');

                                    -- CreateEnum
                                    CREATE TYPE "ticket_status" AS ENUM ('open', 'in_progress', 'resolved', 'closed', 'pending');

                                    -- CreateEnum
                                    CREATE TYPE "user_status" AS ENUM ('active', 'inactive');

                                    -- CreateTable
                                    CREATE TABLE "admins" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "user_id" UUID NOT NULL,
                                        "location_id" UUID,
                                        "position" TEXT,
                                        "joined_at" DATE,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "audit_logs" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "actor_id" UUID,
                                        "entity_type" TEXT NOT NULL,
                                        "entity_id" UUID,
                                        "action" TEXT NOT NULL,
                                        "old_data" JSONB,
                                        "new_data" JSONB,
                                        "ip_address" INET,
                                        "user_agent" TEXT,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "cod_collections" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parcel_id" UUID NOT NULL,
                                        "vendor_id" UUID,
                                        "rider_id" UUID,
                                        "cod_amount" DECIMAL(12,2) NOT NULL,
                                        "collected_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
                                        "remitted_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
                                        "pending_amount" DECIMAL(12,2) GENERATED ALWAYS AS (cod_amount - remitted_amount) STORED,
                                        "payment_status" "payment_status" NOT NULL DEFAULT 'pending',
                                        "collected_at" TIMESTAMPTZ(6),
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "cod_collections_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "dispatch_parcels" (
                                        "dispatch_id" UUID NOT NULL,
                                        "parcel_id" UUID NOT NULL,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "dispatch_parcels_pkey" PRIMARY KEY ("dispatch_id","parcel_id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "dispatches" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "dispatch_no" TEXT NOT NULL,
                                        "from_location_id" UUID,
                                        "to_location_id" UUID,
                                        "delivery_rider_id" UUID,
                                        "dispatched_by" UUID,
                                        "dispatched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "arrived_at" TIMESTAMPTZ(6),
                                        "remarks" TEXT,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "dispatches_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "locations" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parent_id" UUID,
                                        "name" TEXT NOT NULL,
                                        "code" TEXT,
                                        "province" TEXT,
                                        "district" TEXT,
                                        "city" TEXT,
                                        "address_line" TEXT,
                                        "latitude" DECIMAL(10,7),
                                        "longitude" DECIMAL(10,7),
                                        "is_hub" BOOLEAN NOT NULL DEFAULT false,
                                        "is_active" BOOLEAN NOT NULL DEFAULT true,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "notifications" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "user_id" UUID NOT NULL,
                                        "title" TEXT NOT NULL,
                                        "body" TEXT,
                                        "read_at" TIMESTAMPTZ(6),
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "parcel_exceptions" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parcel_id" UUID NOT NULL,
                                        "exception_type" TEXT NOT NULL,
                                        "previous_status" "parcel_status",
                                        "reason" TEXT,
                                        "age_days" INTEGER,
                                        "package_condition" TEXT,
                                        "reported_by" UUID,
                                        "resolved_by" UUID,
                                        "reported_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "resolved_at" TIMESTAMPTZ(6),
                                        "status" "exception_status" NOT NULL DEFAULT 'open',

                                        CONSTRAINT "parcel_exceptions_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "parcel_remarks" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parcel_id" UUID NOT NULL,
                                        "user_id" UUID,
                                        "location_id" UUID,
                                        "remark" TEXT NOT NULL,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "parcel_remarks_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "parcel_status_history" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parcel_id" UUID NOT NULL,
                                        "old_status" "parcel_status",
                                        "new_status" "parcel_status" NOT NULL,
                                        "location_id" UUID,
                                        "changed_by" UUID,
                                        "remarks" TEXT,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "parcel_status_history_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "parcels" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "tracking_id" TEXT NOT NULL,
                                        "vendor_id" UUID,
                                        "sender_id" UUID NOT NULL,
                                        "receiver_id" UUID NOT NULL,
                                        "pickup_rider_id" UUID,
                                        "delivery_rider_id" UUID,
                                        "origin_location_id" UUID,
                                        "current_location_id" UUID,
                                        "destination_location_id" UUID,
                                        "order_type" "order_type" NOT NULL DEFAULT 'delivery',
                                        "service_type" "service_type" NOT NULL DEFAULT 'dtd',
                                        "status" "parcel_status" NOT NULL DEFAULT 'pickup_ordered',
                                        "pieces" INTEGER NOT NULL DEFAULT 1,
                                        "weight_kg" DECIMAL(10,3),
                                        "cod_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
                                        "delivery_charge" DECIMAL(12,2) NOT NULL DEFAULT 0,
                                        "attempt_count" INTEGER NOT NULL DEFAULT 0,
                                        "created_by" UUID,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "picked_up_at" TIMESTAMPTZ(6),
                                        "delivered_at" TIMESTAMPTZ(6),
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "deleted_at" TIMESTAMPTZ(6),

                                        CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "parties" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "name" TEXT NOT NULL,
                                        "phone" TEXT NOT NULL,
                                        "email" TEXT,
                                        "address" TEXT,
                                        "location_id" UUID,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "pickup_tasks" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "parcel_id" UUID NOT NULL,
                                        "rider_id" UUID,
                                        "pickup_address" TEXT,
                                        "scheduled_at" TIMESTAMPTZ(6),
                                        "completed_at" TIMESTAMPTZ(6),
                                        "status" "parcel_status" NOT NULL DEFAULT 'pickup_ordered',
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "pickup_tasks_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "riders" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "user_id" UUID,
                                        "name" TEXT NOT NULL,
                                        "phone" TEXT NOT NULL,
                                        "location_id" UUID,
                                        "status" "user_status" NOT NULL DEFAULT 'active',
                                        "joined_at" DATE,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "deleted_at" TIMESTAMPTZ(6),

                                        CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "roles" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "code" TEXT NOT NULL,
                                        "name" TEXT NOT NULL,
                                        "description" TEXT,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "settlement_items" (
                                        "settlement_id" UUID NOT NULL,
                                        "cod_collection_id" UUID NOT NULL,
                                        "amount" DECIMAL(12,2) NOT NULL,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("settlement_id","cod_collection_id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "settlements" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "statement_id" TEXT NOT NULL,
                                        "payee_type" TEXT NOT NULL,
                                        "rider_id" UUID,
                                        "vendor_id" UUID,
                                        "amount" DECIMAL(12,2) NOT NULL,
                                        "payable_amount" DECIMAL(12,2),
                                        "settlement_date" DATE,
                                        "status" "settlement_status" NOT NULL DEFAULT 'pending',
                                        "remark" TEXT,
                                        "approved_by" UUID,
                                        "settled_by" UUID,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "support_tickets" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "ticket_no" TEXT NOT NULL,
                                        "parcel_id" UUID,
                                        "customer_name" TEXT,
                                        "customer_phone" TEXT,
                                        "issue_type" TEXT NOT NULL,
                                        "description" TEXT,
                                        "status" "ticket_status" NOT NULL DEFAULT 'open',
                                        "assigned_to" UUID,
                                        "created_by" UUID,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "closed_at" TIMESTAMPTZ(6),

                                        CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "user_roles" (
                                        "user_id" UUID NOT NULL,
                                        "role_id" UUID NOT NULL,
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

                                        CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "users" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "full_name" TEXT NOT NULL,
                                        "email" TEXT,
                                        "phone" TEXT,
                                        "password_hash" TEXT,
                                        "status" "user_status" NOT NULL DEFAULT 'active',
                                        "last_login_at" TIMESTAMPTZ(6),
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "deleted_at" TIMESTAMPTZ(6),

                                        CONSTRAINT "users_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateTable
                                    CREATE TABLE "vendors" (
                                        "id" UUID NOT NULL DEFAULT gen_random_uuid(),
                                        "user_id" UUID,
                                        "client_name" TEXT NOT NULL,
                                        "business_name" TEXT,
                                        "phone" TEXT NOT NULL,
                                        "email" TEXT,
                                        "location_id" UUID,
                                        "address" TEXT,
                                        "status" "user_status" NOT NULL DEFAULT 'active',
                                        "joined_at" DATE,
                                        "last_ordered_at" TIMESTAMPTZ(6),
                                        "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                        "deleted_at" TIMESTAMPTZ(6),

                                        CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
                                    );

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "admins_user_id_key" ON "admins"("user_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_admins_location_id" ON "admins"("location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");

                                    -- CreateIndex
                                    CREATE INDEX "idx_audit_logs_actor_id" ON "audit_logs"("actor_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at" DESC);

                                    -- CreateIndex
                                    CREATE INDEX "idx_audit_logs_entity" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "cod_collections_parcel_id_key" ON "cod_collections"("parcel_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_cod_collections_rider_status" ON "cod_collections"("rider_id", "payment_status");

                                    -- CreateIndex
                                    CREATE INDEX "idx_cod_collections_vendor_status" ON "cod_collections"("vendor_id", "payment_status");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatch_parcels_parcel_id" ON "dispatch_parcels"("parcel_id");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "dispatches_dispatch_no_key" ON "dispatches"("dispatch_no");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatches_delivery_rider" ON "dispatches"("delivery_rider_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatches_dispatched_at" ON "dispatches"("dispatched_at");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatches_dispatched_by" ON "dispatches"("dispatched_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatches_locations" ON "dispatches"("from_location_id", "to_location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_dispatches_to_location" ON "dispatches"("to_location_id");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "locations_code_key" ON "locations"("code");

                                    -- CreateIndex
                                    CREATE INDEX "idx_locations_parent_id" ON "locations"("parent_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_exceptions_parcel_id" ON "parcel_exceptions"("parcel_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_exceptions_reported_by" ON "parcel_exceptions"("reported_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_exceptions_resolved_by" ON "parcel_exceptions"("resolved_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_exceptions_type_status" ON "parcel_exceptions"("exception_type", "status");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_remarks_location_id" ON "parcel_remarks"("location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_remarks_parcel_id" ON "parcel_remarks"("parcel_id", "created_at" DESC);

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_remarks_user_id" ON "parcel_remarks"("user_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_status_history_changed_by" ON "parcel_status_history"("changed_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_status_history_location_id" ON "parcel_status_history"("location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcel_status_history_parcel_id" ON "parcel_status_history"("parcel_id", "created_at" DESC);

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "parcels_tracking_id_key" ON "parcels"("tracking_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_created_at" ON "parcels"("created_at" DESC);

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_created_by" ON "parcels"("created_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_current_location" ON "parcels"("current_location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_delivered_at" ON "parcels"("delivered_at" DESC);

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_delivery_rider" ON "parcels"("delivery_rider_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_destination_location" ON "parcels"("destination_location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_origin_location" ON "parcels"("origin_location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_pickup_rider" ON "parcels"("pickup_rider_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_receiver_id" ON "parcels"("receiver_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_sender_id" ON "parcels"("sender_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parcels_vendor_id" ON "parcels"("vendor_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parties_location_id" ON "parties"("location_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_parties_phone" ON "parties"("phone");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "pickup_tasks_parcel_id_key" ON "pickup_tasks"("parcel_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_pickup_tasks_rider_status" ON "pickup_tasks"("rider_id", "status");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "riders_phone_key" ON "riders"("phone");

                                    -- CreateIndex
                                    CREATE INDEX "idx_riders_location_id" ON "riders"("location_id");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "settlements_statement_id_key" ON "settlements"("statement_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_settlements_approved_by" ON "settlements"("approved_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_settlements_settled_by" ON "settlements"("settled_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_settlements_settlement_date" ON "settlements"("settlement_date");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "support_tickets_ticket_no_key" ON "support_tickets"("ticket_no");

                                    -- CreateIndex
                                    CREATE INDEX "idx_support_tickets_assigned_to" ON "support_tickets"("assigned_to");

                                    -- CreateIndex
                                    CREATE INDEX "idx_support_tickets_created_by" ON "support_tickets"("created_by");

                                    -- CreateIndex
                                    CREATE INDEX "idx_support_tickets_parcel_id" ON "support_tickets"("parcel_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_support_tickets_status" ON "support_tickets"("status", "created_at" DESC);

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

                                    -- CreateIndex
                                    CREATE UNIQUE INDEX "vendors_user_id_key" ON "vendors"("user_id");

                                    -- CreateIndex
                                    CREATE INDEX "idx_vendors_location_id" ON "vendors"("location_id");

                                    -- AddForeignKey
                                    ALTER TABLE "admins" ADD CONSTRAINT "admins_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "cod_collections" ADD CONSTRAINT "cod_collections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatch_parcels" ADD CONSTRAINT "dispatch_parcels_dispatch_id_fkey" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatch_parcels" ADD CONSTRAINT "dispatch_parcels_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_delivery_rider_id_fkey" FOREIGN KEY ("delivery_rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_dispatched_by_fkey" FOREIGN KEY ("dispatched_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_from_location_id_fkey" FOREIGN KEY ("from_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_to_location_id_fkey" FOREIGN KEY ("to_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "locations" ADD CONSTRAINT "locations_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_exceptions" ADD CONSTRAINT "parcel_exceptions_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_exceptions" ADD CONSTRAINT "parcel_exceptions_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_exceptions" ADD CONSTRAINT "parcel_exceptions_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_remarks" ADD CONSTRAINT "parcel_remarks_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_remarks" ADD CONSTRAINT "parcel_remarks_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_remarks" ADD CONSTRAINT "parcel_remarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_status_history" ADD CONSTRAINT "parcel_status_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_status_history" ADD CONSTRAINT "parcel_status_history_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcel_status_history" ADD CONSTRAINT "parcel_status_history_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_current_location_id_fkey" FOREIGN KEY ("current_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_delivery_rider_id_fkey" FOREIGN KEY ("delivery_rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_destination_location_id_fkey" FOREIGN KEY ("destination_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_origin_location_id_fkey" FOREIGN KEY ("origin_location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_pickup_rider_id_fkey" FOREIGN KEY ("pickup_rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parcels" ADD CONSTRAINT "parcels_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "parties" ADD CONSTRAINT "parties_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "pickup_tasks" ADD CONSTRAINT "pickup_tasks_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "pickup_tasks" ADD CONSTRAINT "pickup_tasks_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "riders" ADD CONSTRAINT "riders_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_cod_collection_id_fkey" FOREIGN KEY ("cod_collection_id") REFERENCES "cod_collections"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlements" ADD CONSTRAINT "settlements_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlements" ADD CONSTRAINT "settlements_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlements" ADD CONSTRAINT "settlements_settled_by_fkey" FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "settlements" ADD CONSTRAINT "settlements_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_parcel_id_fkey" FOREIGN KEY ("parcel_id") REFERENCES "parcels"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "vendors" ADD CONSTRAINT "vendors_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

                                    -- AddForeignKey
                                    ALTER TABLE "vendors" ADD CONSTRAINT "vendors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
