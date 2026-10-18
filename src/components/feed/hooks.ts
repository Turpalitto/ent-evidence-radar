"use client";

import { useSyncExternalStore } from "react";

/* ── Разрешение на уведомления: внешний стор поверх Permissions API ── */

function subscribeNotification(callback: () => void) {
  if (typeof window === "undefined" || !("navigator" in window) || !("permissions" in navigator)) return () => {};
  // `permissions.query()` асинхронный: если компонент размонтировался раньше, чем он разрешился,
  // слушатель не вешаем вовсе — иначе он остался бы навсегда (утечка + лишние вызовы после unmount).
  let disposed = false;
  let detach = () => {};
  navigator.permissions
    .query({ name: "notifications" as PermissionName })
    .then((status) => {
      if (disposed) return;
      status.addEventListener("change", callback);
      detach = () => status.removeEventListener("change", callback);
    })
    .catch(() => {});
  return () => {
    disposed = true;
    detach();
  };
}

function getNotificationSnapshot(): string {
  if (typeof window !== "undefined" && "Notification" in window) {
    return Notification.permission;
  }
  return "default";
}

function getServerNotificationSnapshot(): string {
  return "default";
}

/** Текущее состояние `Notification.permission` («default» на сервере и без поддержки API). */
export function useNotificationPermission(): string {
  return useSyncExternalStore(subscribeNotification, getNotificationSnapshot, getServerNotificationSnapshot);
}

/* ── navigator.onLine + события online/offline: баннер офлайн-режима без опроса сервера (SSR — «в сети») ── */

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}
