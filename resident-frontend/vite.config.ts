import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteApiBaseUrlGuard } from "./src/config/apiBaseUrl";

export default defineConfig({
  plugins: [react(), viteApiBaseUrlGuard()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts"
  }
});
