/**
 * Общая подготовка тестов. Матчеры jest-dom подключаются только в среде jsdom
 * (файлы с `// @vitest-environment jsdom`), node-тестам они не нужны.
 */
import { afterEach } from "vitest";

if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  afterEach(() => {
    cleanup();
  });
}
