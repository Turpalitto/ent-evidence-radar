import { describe, expect, it } from "vitest";
import { isBuildPhase } from "./phase";

const NODE = "/usr/local/bin/node";
const NEXT = "/app/node_modules/.bin/next";

describe("isBuildPhase", () => {
  it("сборка: next build", () => {
    expect(isBuildPhase([NODE, NEXT, "build"], {})).toBe(true);
    expect(isBuildPhase([NODE, "/app/node_modules/next/dist/bin/next", "build"], {})).toBe(true);
  });

  it("сборка: NEXT_PHASE production-build", () => {
    expect(isBuildPhase([NODE, NEXT, "start"], { NEXT_PHASE: "phase-production-build" })).toBe(true);
  });

  it("сборка: npm run build", () => {
    expect(isBuildPhase([NODE, "/app/server.js"], { npm_lifecycle_event: "build" })).toBe(true);
  });

  it("не сборка: путь к проекту содержит «build»", () => {
    // Регрессия: раньше эти команды считались сборкой, и файловый PGlite молча
    // заменялся in-memory — приложение работало, но ничего не сохраняло.
    const argv = [NODE, "/tmp/ent-build/node_modules/.bin/next", "start"];
    // Старая проверка `argv.some((a) => a.includes("build"))` давала здесь true:
    expect(argv.some((a) => a.includes("build"))).toBe(true);
    expect(isBuildPhase(argv, {})).toBe(false);
    expect(isBuildPhase([NODE, "/srv/build/app/server.js"], {})).toBe(false);
  });

  it("не сборка: посторонний скрипт с аргументом build", () => {
    expect(isBuildPhase([NODE, "/app/scripts/task.mjs", "build"], {})).toBe(false);
  });

  it("не сборка: пустой argv", () => {
    expect(isBuildPhase([], {})).toBe(false);
  });
});
