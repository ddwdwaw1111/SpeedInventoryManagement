import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-portal",
    rollupOptions: {
      input: {
        portal: "portal.html"
      }
    }
  },
  server: {
    host: true,
    port: 5174
  },
  preview: {
    host: true,
    port: 4174
  }
});
