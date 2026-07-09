import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/generated/**", "node_modules/**"],
    clearMocks: true,
  },
});
