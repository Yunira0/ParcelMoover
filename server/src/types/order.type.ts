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