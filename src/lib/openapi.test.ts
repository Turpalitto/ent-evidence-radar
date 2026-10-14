/**
 * Контракт A-14: docs/openapi.yaml не должен расходиться с реальными маршрутами.
 * Каждый `route.ts` в src/app/api (и /feed.xml) обязан быть описан с теми же HTTP-методами,
 * и наоборот — в спецификации нет «мёртвых» путей. Плюс минимальная структурная проверка.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

const ROOT = join(__dirname, "..", "..");
const HTTP = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

function routesFromCode(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const files = [...routeFiles(join(ROOT, "src/app/api")), join(ROOT, "src/app/feed.xml/route.ts")];
  for (const f of files) {
    const rel = relative(join(ROOT, "src/app"), f).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
    const path = "/" + rel.replace(/\[([^\]]+)\]/g, "{$1}");
    const src = readFileSync(f, "utf8");
    const methods = new Set<string>();
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)) methods.add(m[1].toLowerCase());
    map.set(path, methods);
  }
  return map;
}

type Spec = { openapi: string; paths: Record<string, Record<string, unknown>>; components: Record<string, Record<string, unknown>> };
const spec = parse(readFileSync(join(ROOT, "docs/openapi.yaml"), "utf8")) as Spec;

describe("docs/openapi.yaml", () => {
  it("описывает каждый маршрут кода с теми же методами, и не содержит лишних путей", () => {
    const code = routesFromCode();
    expect(code.size).toBeGreaterThan(20);
    const specPaths = new Map(Object.entries(spec.paths).map(([p, ops]) => [p, new Set(HTTP.filter((m) => m in ops))]));
    const missingInSpec = [...code.keys()].filter((p) => !specPaths.has(p));
    const extraInSpec = [...specPaths.keys()].filter((p) => !code.has(p));
    expect(missingInSpec, "маршруты без описания в OpenAPI").toEqual([]);
    expect(extraInSpec, "пути в OpenAPI, которых нет в коде").toEqual([]);
    for (const [p, methods] of code) {
      expect([...specPaths.get(p)!].sort(), `методы для ${p}`).toEqual([...methods].sort());
    }
  });

  it("структурно корректен: версия 3.1, у операций есть summary и responses, все $ref разрешаются", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    const refs: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
          if (k === "$ref" && typeof v === "string") refs.push(v);
          else walk(v);
        }
      }
    };
    walk(spec);
    expect(refs.length).toBeGreaterThan(20);
    for (const ref of refs) {
      expect(ref.startsWith("#/components/"), ref).toBe(true);
      const [, , group, name] = ref.split("/");
      expect(spec.components[group]?.[name], `не найден ${ref}`).toBeDefined();
    }
    for (const [p, ops] of Object.entries(spec.paths)) {
      for (const m of HTTP) {
        const op = ops[m] as { summary?: string; responses?: Record<string, unknown> } | undefined;
        if (!op) continue;
        expect(op.summary, `${m.toUpperCase()} ${p}: нет summary`).toBeTruthy();
        expect(Object.keys(op.responses ?? {}).length, `${m.toUpperCase()} ${p}: нет responses`).toBeGreaterThan(0);
      }
    }
  });
});
