import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Тест service worker (public/sw.js, аудит A-15): файл исполняется в изолированном контексте
 * с поддельными `caches`/`fetch`/`self`, затем обработчику fetch скармливаются запросы разных типов.
 * Так проверяются стратегии кэширования, не требуя браузера.
 */

const ORIGIN = "https://radar.test";

class FakeCache {
  store = new Map<string, Response>();
  async match(req: Request | string) {
    const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
    const hit = this.store.get(url);
    return hit ? hit.clone() : undefined;
  }
  async put(req: Request | string, res: Response) {
    const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
    this.store.delete(url); // переставляем в конец — порядок вставки = порядок keys()
    this.store.set(url, res);
  }
  async add(req: Request) {
    const res = await (globalThis as unknown as { __swFetch: (r: Request) => Promise<Response> }).__swFetch(req);
    if (!res.ok) throw new Error("add failed");
    await this.put(req, res);
  }
  async delete(req: Request | string) {
    const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
    return this.store.delete(url);
  }
  async keys() {
    return [...this.store.keys()].map((u) => new Request(u));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();
  async open(name: string) {
    let c = this.caches.get(name);
    if (!c) {
      c = new FakeCache();
      this.caches.set(name, c);
    }
    return c;
  }
  async keys() {
    return [...this.caches.keys()];
  }
  async delete(name: string) {
    return this.caches.delete(name);
  }
  async match(req: Request | string) {
    for (const c of this.caches.values()) {
      const hit = await c.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

type Listener = (event: never) => void;

function boot() {
  const listeners = new Map<string, Listener>();
  const fetchMock = vi.fn<(req: Request) => Promise<Response>>();
  (globalThis as unknown as { __swFetch: typeof fetchMock }).__swFetch = fetchMock;
  const cacheStorage = new FakeCacheStorage();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  };
  const sandbox = {
    self,
    caches: cacheStorage,
    fetch: (req: Request) => fetchMock(req),
    Request,
    Response,
    Headers,
    URL,
    setTimeout,
    clearTimeout,
    console,
    Promise,
    Error,
    Date,
  };
  const code = readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(code, sandbox, { filename: "sw.js" });

  const dispatchFetch = async (req: Request): Promise<Response | undefined> => {
    let promised: Promise<Response> | undefined;
    const event = { request: req, respondWith: (p: Promise<Response>) => (promised = p), waitUntil: () => {} };
    listeners.get("fetch")!(event as never);
    return promised ? await promised : undefined;
  };
  const dispatchLifecycle = async (type: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
  };
  const dispatchMessage = async (data: unknown) => {
    const waits: Promise<unknown>[] = [];
    listeners.get("message")!({ data, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits);
  };
  return { fetchMock, cacheStorage, self, dispatchFetch, dispatchLifecycle, dispatchMessage };
}

const req = (p: string, init: RequestInit & { mode?: RequestMode } = {}) => {
  // Node не даёт создать Request с mode "navigate" — подменяем свойство после создания.
  const { mode, ...rest } = init;
  const r = new Request(new URL(p, ORIGIN).href, rest);
  if (mode === "navigate") Object.defineProperty(r, "mode", { value: "navigate" });
  return r;
};
const ok = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers: { "content-type": "application/json", ...headers } });
const offline = () => Promise.reject(new TypeError("Failed to fetch"));

describe("public/sw.js", () => {
  let sw: ReturnType<typeof boot>;
  beforeEach(() => {
    sw = boot();
  });

  it("install кладёт /offline в shell-кэш и вызывает skipWaiting; activate удаляет старые radar-кэши", async () => {
    sw.fetchMock.mockImplementation(async (r) => (new URL(r.url).pathname === "/offline" ? ok("<h1>offline</h1>") : ok("x")));
    await sw.cacheStorage.open("radar-api-v0"); // кэш прежней версии
    await sw.cacheStorage.open("other-app"); // чужой кэш — не трогаем
    await sw.dispatchLifecycle("install");
    expect(sw.self.skipWaiting).toHaveBeenCalled();
    expect(await sw.cacheStorage.match("/offline")).toBeDefined();
    await sw.dispatchLifecycle("activate");
    expect(await sw.cacheStorage.keys()).not.toContain("radar-api-v0");
    expect(await sw.cacheStorage.keys()).toContain("other-app");
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it("не вмешивается в POST/PATCH, чужие домены и некэшируемые маршруты (auth, admin, ai, runs)", async () => {
    expect(await sw.dispatchFetch(req("/api/articles/1", { method: "PATCH" }))).toBeUndefined();
    expect(await sw.dispatchFetch(new Request("https://api.crossref.org/works"))).toBeUndefined();
    for (const p of ["/api/auth", "/api/admin/diagnostics", "/api/ai?articleId=1", "/api/runs", "/api/health", "/api/export", "/api/backup"]) {
      expect(await sw.dispatchFetch(req(p)), p).toBeUndefined();
    }
    expect(sw.fetchMock).not.toHaveBeenCalled();
  });

  it("/api/articles: сеть → кэш; без сети — кэш с пометкой x-sw-cache: hit и датой сохранения", async () => {
    sw.fetchMock.mockResolvedValueOnce(ok('{"items":[1]}'));
    const first = (await sw.dispatchFetch(req("/api/articles?page=1")))!;
    expect(await first.json()).toEqual({ items: [1] });
    expect(first.headers.get("x-sw-cache")).toBeNull();

    sw.fetchMock.mockImplementationOnce(offline);
    const second = (await sw.dispatchFetch(req("/api/articles?page=1")))!;
    expect(second.headers.get("x-sw-cache")).toBe("hit");
    expect(second.headers.get("x-sw-cached-at")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await second.json()).toEqual({ items: [1] });

    // Другие параметры запроса — другая запись кэша: без сети и без копии — сетевая ошибка наружу
    sw.fetchMock.mockImplementationOnce(offline);
    await expect(sw.dispatchFetch(req("/api/articles?page=2"))).rejects.toThrow();
  });

  it("ответы с ошибкой не кэшируются", async () => {
    sw.fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));
    const r = (await sw.dispatchFetch(req("/api/stats")))!;
    expect(r.status).toBe(500);
    sw.fetchMock.mockImplementationOnce(offline);
    await expect(sw.dispatchFetch(req("/api/stats"))).rejects.toThrow();
  });

  it("статика /_next/static — cache-first: второй запрос не ходит в сеть", async () => {
    sw.fetchMock.mockResolvedValueOnce(ok("console.log(1)", { "content-type": "text/javascript" }));
    await sw.dispatchFetch(req("/_next/static/chunks/app.js"));
    const again = (await sw.dispatchFetch(req("/_next/static/chunks/app.js")))!;
    expect(await again.text()).toBe("console.log(1)");
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("навигация: сеть, затем кэш той же страницы; незнакомая страница без сети → /offline; /login не кэшируется", async () => {
    sw.fetchMock.mockImplementation(async (r) => ok(`<html>${new URL(r.url).pathname}</html>`, { "content-type": "text/html" }));
    await sw.dispatchLifecycle("install");
    await sw.dispatchFetch(req("/", { mode: "navigate" }));
    await sw.dispatchFetch(req("/login", { mode: "navigate" }));

    sw.fetchMock.mockImplementation(offline);
    const home = (await sw.dispatchFetch(req("/", { mode: "navigate" })))!;
    expect(await home.text()).toBe("<html>/</html>");
    const login = (await sw.dispatchFetch(req("/login", { mode: "navigate" })))!;
    expect(await login.text()).toBe("<html>/offline</html>"); // не кэшировалась → заглушка
    const unknown = (await sw.dispatchFetch(req("/stats?x=1", { mode: "navigate" })))!;
    expect(await unknown.text()).toBe("<html>/offline</html>");
  });

  it("кэш API ограничен 80 записями (старые вытесняются), сообщение clear-cache очищает его", async () => {
    sw.fetchMock.mockImplementation(async () => ok("{}"));
    for (let i = 0; i < 85; i++) await sw.dispatchFetch(req(`/api/articles?page=${i}`));
    const api = await sw.cacheStorage.open("radar-api-v1");
    expect((await api.keys()).length).toBe(80);
    expect(await api.match(req("/api/articles?page=0"))).toBeUndefined();
    expect(await api.match(req("/api/articles?page=84"))).toBeDefined();

    await sw.dispatchMessage({ type: "clear-cache" });
    expect(await sw.cacheStorage.keys()).not.toContain("radar-api-v1");
  });
});
