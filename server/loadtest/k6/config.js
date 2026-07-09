// Shared config for all k6 scenarios. Override with -e KEY=value.
export const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
