import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "./log";

/**
 * Структурированный логгер (I-07): одна JSON-строка на событие, уровень по LOG_LEVEL,
 * ошибки сериализуются без стека, в тестах молчит без LOG_IN_TESTS.
 */
describe("log", () => {
  const saved = { LOG_LEVEL: process.env.LOG_LEVEL, LOG_IN_TESTS: process.env.LOG_IN_TESTS };
  let out: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;
  let err: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    out = vi.spyOn(console, "log").mockImplementation(() => {});
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    err = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.LOG_IN_TESTS = "1";
    delete process.env.LOG_LEVEL;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("пишет JSON с ts/level/event и полями; ошибки — только name и message", () => {
    log.info("refresh.done", { runId: 3, error: new RangeError("too far") });
    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(out.mock.calls[0]![0]));
    expect(line).toMatchObject({ level: "info", event: "refresh.done", runId: 3, error: { name: "RangeError", message: "too far" } });
    expect(line.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line.error).not.toHaveProperty("stack");
  });

  it("уровни: warn → console.warn, error → console.error; debug ниже порога по умолчанию", () => {
    log.debug("x.debug");
    log.warn("x.warn");
    log.error("x.error");
    expect(out).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(err.mock.calls[0]![0]))).toEqual(expect.objectContaining({ level: "error", event: "x.error" }));
  });

  it("LOG_LEVEL управляет порогом; неизвестное значение = info", () => {
    process.env.LOG_LEVEL = "error";
    log.warn("hidden");
    log.info("hidden");
    expect(warn).not.toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
    process.env.LOG_LEVEL = "debug";
    log.debug("shown");
    expect(out).toHaveBeenCalledTimes(1);
    process.env.LOG_LEVEL = "nonsense";
    log.debug("hidden");
    log.info("shown");
    expect(out).toHaveBeenCalledTimes(2);
  });

  it("в тестах без LOG_IN_TESTS молчит", () => {
    delete process.env.LOG_IN_TESTS;
    log.error("silent");
    expect(err).not.toHaveBeenCalled();
  });
});
