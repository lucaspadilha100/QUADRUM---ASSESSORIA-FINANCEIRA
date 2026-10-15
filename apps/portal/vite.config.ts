import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// O portal sai no MESMO deploy do admin, em /portal (vercel.json da raiz).
// `base` faz os arquivos (JS, CSS, imagens) serem pedidos em /portal/...
export default defineConfig({
  base: "/portal/",
  server: { host: "::", port: 8091 },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // Bibliotecas num arquivo próprio: elas quase nunca mudam, então o navegador
  // as guarda de um deploy para o outro e só baixa de novo o código do app.
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          dados: ["@supabase/supabase-js", "@tanstack/react-query"],
        },
      },
    },
  },
});
