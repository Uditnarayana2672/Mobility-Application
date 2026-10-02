import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import basicSsl from "@vitejs/plugin-basic-ssl";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { indoreServer } from "./server/vite-plugin";
import { loadCerts } from "./server/net";

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const root = __dirname;
  const certs = loadCerts(root);
  if (command === "serve" && !certs) {
    console.warn("\n[indore] certs/ missing: using a throwaway self-signed cert. Run `npm run certs` (docs/https-on-phone.md) for a phone-trusted one.\n");
  }
  return {
    server: {
      host: "::",
      port: 8080,
      https: certs ?? undefined,
    },
    plugins: [
      react(),
      !certs && command === "serve" && basicSsl(),
      indoreServer(process.env.INDORE_ROOT ?? root),
      mode === "development" && componentTagger(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(root, "./src"),
      },
    },
  };
});
