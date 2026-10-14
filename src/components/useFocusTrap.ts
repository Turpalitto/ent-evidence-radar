"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Удерживает фокус внутри контейнера, пока он открыт, и возвращает фокус на элемент,
 * который был активен до открытия. Нужен для модалок и боковых панелей: без этого
 * Tab уводит фокус на контент за оверлеем, а после закрытия фокус теряется.
 *
 * Контейнеру желательно задать tabIndex={-1}, чтобы его можно было сфокусировать,
 * когда внутри нет фокусируемых элементов.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const el = ref.current;
    if (!el) return;

    const previouslyFocused = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;

    // Видимые фокусируемые элементы (скрытые ветки, например мобильная панель на десктопе, отсеиваются).
    const getFocusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );

    const first = getFocusable()[0];
    (first ?? el).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (!items.length) {
        e.preventDefault();
        el.focus();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const activeEl = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (activeEl === firstEl || !activeEl || !el.contains(activeEl)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (activeEl === lastEl || !activeEl || !el.contains(activeEl)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [ref, active]);
}
