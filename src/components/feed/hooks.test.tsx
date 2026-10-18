// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNotificationPermission, useOnlineStatus } from "./hooks";

/**
 * Хуки ленты поверх браузерных API: `Notification.permission` через Permissions API
 * (подписка на change, корректная отписка, защита от позднего резолва после unmount)
 * и `navigator.onLine` с событиями online/offline. jsdom не реализует Notification и
 * permissions — подменяем их вручную.
 */

type FakeStatus = {
  listeners: Set<() => void>;
  addEventListener: (type: string, cb: () => void) => void;
  removeEventListener: (type: string, cb: () => void) => void;
  fire: () => void;
};

function makeStatus(): FakeStatus {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addEventListener: vi.fn((_t, cb) => void listeners.add(cb)),
    removeEventListener: vi.fn((_t, cb) => void listeners.delete(cb)),
    fire: () => listeners.forEach((cb) => cb()),
  };
}

function installNotification(permission: string) {
  const notification = { permission };
  Object.defineProperty(window, "Notification", { value: notification, configurable: true, writable: true });
  return notification;
}

function installPermissions(query: () => Promise<FakeStatus>) {
  Object.defineProperty(navigator, "permissions", { value: { query }, configurable: true });
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).Notification;
  delete (navigator as unknown as Record<string, unknown>).permissions;
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("useNotificationPermission", () => {
  it("без Notification API возвращает «default»", () => {
    const { result } = renderHook(() => useNotificationPermission());
    expect(result.current).toBe("default");
  });

  it("читает Notification.permission и обновляется по событию change из Permissions API, отписываясь при unmount", async () => {
    const notification = installNotification("default");
    const status = makeStatus();
    installPermissions(() => Promise.resolve(status));

    const { result, unmount } = renderHook(() => useNotificationPermission());
    expect(result.current).toBe("default");
    await act(async () => {}); // дожидаемся резолва permissions.query()
    expect(status.addEventListener).toHaveBeenCalledWith("change", expect.any(Function));

    notification.permission = "granted";
    act(() => status.fire());
    expect(result.current).toBe("granted");

    unmount();
    expect(status.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(status.listeners.size).toBe(0);
  });

  it("если компонент размонтирован до резолва permissions.query(), слушатель не вешается", async () => {
    installNotification("default");
    const status = makeStatus();
    let resolve: (s: FakeStatus) => void = () => {};
    installPermissions(() => new Promise<FakeStatus>((r) => (resolve = r)));

    const { unmount } = renderHook(() => useNotificationPermission());
    unmount();
    await act(async () => resolve(status));
    expect(status.addEventListener).not.toHaveBeenCalled();
  });

  it("отказ permissions.query() (API без поддержки «notifications») не ломает хук", async () => {
    installNotification("denied");
    installPermissions(() => Promise.reject(new TypeError("unsupported")));
    const { result } = renderHook(() => useNotificationPermission());
    await act(async () => {});
    expect(result.current).toBe("denied");
  });
});

describe("useOnlineStatus", () => {
  it("отражает navigator.onLine и реагирует на события offline/online", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(result.current).toBe(false);

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => void window.dispatchEvent(new Event("online")));
    expect(result.current).toBe(true);
  });
});
