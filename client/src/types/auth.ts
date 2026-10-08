export interface LoginCredentials {
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    id: string;
    email: string;
    fullName: string;
    roles: string[];
    permissions?: string[];
    locationId?: string | null;
    locationName?: string | null;
    branchScoped?: boolean;
  };
}
