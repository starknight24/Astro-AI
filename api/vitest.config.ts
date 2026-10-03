import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Modules validate their environment at import time (DATABASE_URL,
    // SCIENCE_URL). These are placeholders: pg.Pool connects lazily and every
    // test that would reach the network stubs fetch.
    env: {
      DATABASE_URL: "postgres://test:test@127.0.0.1:5432/test",
      SUPABASE_URL: "https://test.supabase.co",
      SCIENCE_URL: "http://127.0.0.1:8000",
      NASA_API_KEY: "TEST_KEY",
    },
  },
});
