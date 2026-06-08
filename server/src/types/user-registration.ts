export type RegisterUserType = "admin" | "vendor" | "rider";

export interface RegisterUserInput {
    type: RegisterUserType;

    fullName: string;
    email: string;
    phone: string;
    password: string;

    locationId?: string; // Optional for admin, required for vendor and rider
    joinedAt?: Date;

    //admin only
    position?: string;

    //vendor only
    clientName?: string;
    address?: string;
    businessName?: string;
}


