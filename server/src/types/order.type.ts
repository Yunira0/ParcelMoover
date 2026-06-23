export type OrderType = "exchange" | "delivery" | "return";

export type ServiceType = "dtd" | "btd" | "btb" | "dtb";

export interface OrderPartyInput {
  name: string;
  phone: string;
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
  deliveryCharge?: number;

  pickupAddress?: string;
  scheduledPickupAt?: string;
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
  | "failed_pickup"
  | "failed_delivery"
  | "cancelled";



export interface UpdateParcelStatusInput {
  status: ParcelStatus;
  locationId?: string;
  remarks?: string;
  /** Required when status is "rider_assigned" (pickup rider) or "sent_for_delivery" (delivery rider). */
  riderId?: string;
}

export interface ListOrdersQuery {
  status?: ParcelStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface BulkUpdateParcelStatusInput {
  ids: string[];
  status: ParcelStatus;
  remarks?: string;
  /** Destination hub for the manifest. Required when status === "dispatched". */
  toLocationId?: string;
  /** Rider/vehicle carrying the manifest. Optional. */
  riderId?: string;
}

/** Who is allowed to transition to each status */
export const STATUS_TRANSITIONS = {
  pickup_ordered:    ["rider_assigned", "cancelled"],
  rider_assigned:    ["picked_up", "failed_pickup", "cancelled"],
  picked_up:         ["arrived"],
  arrived:           ["ready_to_deliver", "oov"],
  dispatched:        ["arrived_at_branch"],
  arrived_at_branch: ["ready_to_deliver"],
  ready_to_deliver:  ["sent_for_delivery", "hold"],
  sent_for_delivery: ["delivered", "failed_delivery"],
  oov:               ["dispatched","hold"],
  hold:              ["ready_to_deliver","oov","loss_and_damage"],
  delivered:         [],
  failed_pickup:     [],
  failed_delivery:   [],
  cancelled:         [],
  loss_and_damage:   ["ready_to_deliver","arrived_at_branch"],
};
