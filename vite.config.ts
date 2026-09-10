import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { app: "index.html", demo: "demo.html" } } },
  server: { host: "0.0.0.0" },
});
