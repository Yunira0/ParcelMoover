export type OrderType = "exchange" | "delivery" | "return";

export type ServiceType = "home_delivery" | "branch_delivery";

export interface OrderPartyInput {
  name: string;
  phone: string;
  alternatePhone?: string;
  email?: string;
  address?: string;
  locationId?: string;
}

export interface CreateOrderInput {
  vendorId?: string;

  sender: OrderPartyInput;
  receiver: OrderPartyInput;

  originLocationId?: string;
  destinationLocationId?: string;

  orderType?: OrderType;
  serviceType?: ServiceType;

  pieces?: number;
  weightKg?: number;

  codAmount?: number;
  /** Declared value of the items in the parcel. */
  itemValue?: number;
  /** Fallback only - used when origin/destination locations aren't both set, so no route rate can be looked up. */
  deliveryCharge?: number;

  packageType?: string;
  deliveryInstruction?: string;
  remarks?: string;

  pickupAddress?: string;
  scheduledPickupAt?: string;

  /**
   * Set true to bypass the same-day duplicate warning (same vendor + same
   * receiver phone/name/address created today). The client resends with this
   * after the user confirms the "create anyway" prompt.
   */
  confirmDuplicate?: boolean;

  /** Vendor-declared: this shipment may be accepted in part without failing the whole delivery. */
  allowPartialDelivery?: boolean;
  /**
   * Places the order even though the vendor's account balance is past its
   * block threshold. Honoured for super_admin only — see
   * assertVendorCanCreateOrder in billing.service.
   */
  overrideBillingBlock?: boolean;
}

export interface UpdateOrderDetailsInput {
  vendorId?: string;
  receiver?: OrderPartyInput;

  originLocationId?: string;
  destinationLocationId?: string;

  orderType?: OrderType;
  serviceType?: ServiceType;

  pieces?: number;
  weightKg?: number;
  codAmount?: number;
  itemValue?: number;

  packageType?: string;
  deliveryInstruction?: string;
}

/** Customer moved: point the parcel at a different destination branch/address. */
export interface RedirectOrderInput {
  destinationLocationId: string;
  address: string;
  reason: string;
  /** Diversion fee added on top of the parcel's existing delivery charge. */
  redirectCharge: number;
}

export type ParcelStatus =
  | "pickup_ordered"
  | "rider_assigned"
  | "picked_up"
  | "arrived"
  | "ready_to_deliver"
  | "sent_for_delivery"
  | "oov"
  | "dispatched"
  | "arrived_at_branch"
  | "hold"
  | "loss_and_damage"
  | "delivered"
  | "partially_delivered"
  | "failed_pickup"
  | "failed_delivery"
  | "cancelled"
  | "follow_up"
  | "ready_to_return"
  | "sent_to_vendor"
  | "returned_to_vendor";



export interface UpdateParcelStatusInput {
  status: ParcelStatus;
  locationId?: string;
  remarks?: string;
  /** Required when status is "rider_assigned" (pickup rider) or "sent_for_delivery" (delivery rider). */
  riderId?: string;
  /** Required when status is "partially_delivered". Amount of COD collected, cannot be negative or exceed parcel's total COD. */
  codCollected?: number;
  /** Rider confirmation that they received the customer's exchange/return parcel.
   * Required to deliver an exchange order; triggers auto-creation of the return. */
  exchangeReturnReceived?: boolean;
}

export const ORDER_SORT_FIELDS = ["createdAt", "codAmount", "deliveryCharge", "trackingId", "status"] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface ListOrdersQuery {
  status?: ParcelStatus[];
  orderType?: OrderType;
  search?: string;
  // Narrow the list to these vendors. Always intersected with the actor's own
  // scope, so it can only ever shrink what a vendor/sales actor already sees.
  vendorId?: string[];
  // Narrows the list to parcels carried by one delivery rider.
  deliveryRiderId?: string;
  // Display-only page hint echoed back in meta; the actual position comes
  // from the keyset cursor, never from a row offset.
  page?: number;
  pageSize?: number;
  // Opaque keyset cursor (base64url of the boundary row's sort value + id).
  // Omitted = first page ("next") or last page ("prev").
  cursor?: string;
  dir?: "next" | "prev";
  sortBy?: OrderSortField;
  sortDir?: "asc" | "desc";
  // Export-only: enrich each row with its first "arrived at origin" date via a
  // batched history query. Off by default to keep the list/table path lean.
  withArrival?: boolean;
  // Narrows to parcels delivered since local midnight. The "Delivered today"
  // dashboard card counts by delivered_at, so its drill-down needs the same
  // filter server-side to page and total consistently with the card.
  deliveredToday?: boolean;
  // Which date the day range below is compared against. Defaults to the
  // created date, matching the UI's own default.
  dateField?: "createdAt" | "lastUpdatedAt";
  // Inclusive Nepal-local day bounds, "YYYY-MM-DD".
  dateFrom?: string;
  dateTo?: string;
  // Lists trashed (soft-deleted) parcels instead of live ones. Deliberately
  // absent from listOrdersQuerySchema so ?trashed=true on the public list
  // endpoint is stripped before it reaches the service — only the admin-only
  // trash route sets it.
  trashed?: boolean;
}

export interface BulkUpdateParcelStatusInput {
  ids: string[];
  status: ParcelStatus;
  remarks?: string;
  /** Destination hub for the manifest. Required when status === "dispatched". */
  toLocationId?: string;
  /** Rider/vehicle carrying the manifest. Optional. */
  riderId?: string;
  /** Required when status is "partially_delivered". Amount of COD collected per parcel. */
  codCollected?: number;
  /**
   * The return manifest driving this transition, set only by
   * returnManifest.service - never accepted over HTTP.
   *
   * bulkUpdateOrderStatusSchema deliberately omits it, and validate() replaces
   * req.body with the parsed result of a z.object (which strips unknown keys),
   * so a client cannot inject it into PATCH /orders/bulk-status. Adding it to
   * that schema would let anyone close someone else's manifest.
   */
  returnManifestId?: string;
}

export interface BulkCreateOrderInput {
  /** Sender applied to every order that omits its own sender field. */
  defaultSender?: OrderPartyInput;
  orders: CreateOrderInput[];
}

export interface BulkCreateResult {
  created: number;
  failed: number;
  results: Array<
    | { index: number; success: true; trackingId: string }
    | { index: number; success: false; error: string }
  >;
}

/** Who is allowed to transition to each status */
export const STATUS_TRANSITIONS = {
  pickup_ordered:    ["rider_assigned", "cancelled"],
  rider_assigned:    ["picked_up", "failed_pickup", "cancelled"],
  picked_up:         ["arrived", "failed_pickup"],
  arrived:           ["ready_to_deliver", "oov"],
  // "follow_up" on these four is the exit for an NCM-carried parcel NCM is
  // returning to us (their "Sent to Vendor") - not reachable by an internal
  // rider, only by the NCM return action/reconcile sweep (see ncm.service.ts).
  dispatched:        ["arrived_at_branch", "follow_up"],
  arrived_at_branch: ["ready_to_deliver", "follow_up"],
  ready_to_deliver:  ["sent_for_delivery", "hold", "cancelled"],
  sent_for_delivery: ["delivered", "partially_delivered", "failed_delivery", "follow_up"],
  oov:               ["dispatched","hold", "follow_up"],
  hold:              ["ready_to_deliver","oov","loss_and_damage"],
  delivered:         [],
  // A partial delivery can be re-attempted, sent into NDR follow-up, or returned
  // straight away (Return-to-Origin) when recovery is clearly hopeless.
  partially_delivered: ["ready_to_deliver", "follow_up", "ready_to_return"],
  failed_pickup:     ["pickup_ordered", "cancelled"],
  // A failed delivery can be re-attempted, sent into NDR follow-up, or returned
  // straight away (Return-to-Origin) when recovery is clearly hopeless.
  failed_delivery:   ["ready_to_deliver", "follow_up", "ready_to_return"],
  cancelled:         [],
  loss_and_damage:   ["ready_to_deliver","arrived_at_branch"],
  // ── Return-to-Origin (RTO) workflow ───────────────────────────────────────
  follow_up:          ["ready_to_deliver", "ready_to_return"],
  ready_to_return:    ["sent_to_vendor"],
  sent_to_vendor:     ["returned_to_vendor"],
  returned_to_vendor: [],
};
