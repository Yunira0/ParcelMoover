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
    sales?: string;
    salesUserId?: string; // sales user (account) that owns this client, for scoped access
    rateType?: string; // per_destination | zone | flat — the vendor's delivery rate model
    // Per-vendor rate overrides (strings over multipart). Empty/undefined → use defaults.
    flatInsideValley?: string | number;
    flatOutsideValley?: string | number;
    zoneMajorCities?: string | number;
    zoneUrbanAreas?: string | number;
    zoneRemoteAreas?: string | number;
    zoneInsideValley?: string | number;
    insideValleyFlatRate?: string | number;
    extraWeightPercent?: string | number;
    returnInsideValleyPercent?: string | number;
    returnOutsideValleyPercent?: string | number;
    branchFlatInsideValley?: string | number;
    branchFlatOutsideValley?: string | number;
    branchZoneMajorCities?: string | number;
    branchZoneUrbanAreas?: string | number;
    branchZoneRemoteAreas?: string | number;
    branchZoneInsideValley?: string | number;

    // --- Shared profile / bank fields (optional, persisted when provided) ---
    pan?: string;
    citizenshipNo?: string;
    bankName?: string;
    bankAccountNo?: string;
    bankAccountHolder?: string;

    // --- Admin profile ---
    department?: string;
    idDocumentType?: string;
    idDocumentNumber?: string;
    fatherName?: string;
    motherName?: string;
    grandfatherName?: string;
    permanentAddress?: string;
    currentAddress?: string;
    experience?: string;

    // --- Rider profile ---
    riderLocation?: string;
    licenceNo?: string;
    vehicleNo?: string;
    salaryCommission?: string;

    // --- Vendor profile ---
    pickupLandmark?: string;
    billingBusinessName?: string;
    registrationNo?: string;
    panVatNo?: string;

    // --- Document paths (set by the controller from uploaded files) ---
    idDocumentPath?: string;        // admin (type chosen via idDocumentType)
    citizenshipDocPath?: string;
    panDocPath?: string;            // admin
    panVatDocPath?: string;         // rider, vendor
    experienceLetterDocPath?: string; // admin
    licenceDocPath?: string;        // rider
    bluebookDocPath?: string;       // rider
    businessCertDocPath?: string;   // vendor
}
