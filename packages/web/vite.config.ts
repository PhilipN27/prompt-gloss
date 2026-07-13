import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    // The chat/card API is served by @prompt-gloss/server on 127.0.0.1:4319.
    proxy: {
      "/api": "http://127.0.0.1:4319"
    }
  }
});
