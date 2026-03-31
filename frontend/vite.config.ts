import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("pdfmake/build/pdfmake")) {
            return "pdfmake-runtime";
          }

          if (
            id.includes("@foliojs-fork/pdfkit")
            || id.includes("fontkit")
            || id.includes("linebreak")
            || id.includes("unicode-properties")
            || id.includes("unicode-trie")
            || id.includes("brotli")
            || id.includes("jpeg-exif")
          ) {
            return "pdfmake-engine";
          }

          if (id.includes("@react-three/drei")) {
            return "three-drei";
          }

          if (id.includes("@react-three/fiber")) {
            return "three-fiber";
          }

          if (id.includes("\\node_modules\\three\\") || id.includes("/node_modules/three/")) {
            return "three-core";
          }

          if (id.includes("react-grid-layout") || id.includes("react-resizable")) {
            return "layout-editor";
          }

          if (id.includes("@mui/x-data-grid")) {
            return "mui-data-grid";
          }

          if (id.includes("@mui/x-charts")) {
            return "mui-charts";
          }

          if (id.includes("@mui/icons-material")) {
            return "mui-icons";
          }

          if (
            id.includes("@mui/material")
            || id.includes("@emotion")
            || id.includes("react")
            || id.includes("scheduler")
          ) {
            return "framework-core";
          }

          if (id.includes("pdfmake") || id.includes("@foliojs-fork/pdfkit")) {
            return "pdf-export";
          }
        }
      }
    }
  },
  server: {
    host: true,
    port: 5173
  }
});
