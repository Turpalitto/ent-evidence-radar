import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // tsconfig Next держит jsx: preserve — для компонентных тестов (.tsx, среда jsdom) нужен automatic runtime.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    coverage: { include: ["src/lib/evidence/**"] },
  },
});
