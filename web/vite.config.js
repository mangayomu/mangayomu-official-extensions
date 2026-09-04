import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  server: {
    host: "0.0.0.0",
    port: 18763,
  },
  preview: {
    host: "0.0.0.0",
    port: 18764,
  },
});