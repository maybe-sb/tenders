import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const resolveFromSrc = (...segments: string[]) => path.resolve(dirname, "src", ...segments);

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@/lib": resolveFromSrc("lib"),
      "@/handlers": resolveFromSrc("handlers"),
      "@/types": resolveFromSrc("types"),
    },
  },
});
