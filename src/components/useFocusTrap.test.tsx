// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { useRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap";

/**
 * Ловушка фокуса для модалок и нижних листов: фокус уходит внутрь при открытии, Tab/Shift+Tab
 * зацикливаются, при закрытии фокус возвращается на прежний элемент.
 * В jsdom нет раскладки (`offsetParent` всегда null) — подменяем геттер, чтобы элементы считались видимыми.
 */

function Harness({ active, empty = false }: { active: boolean; empty?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active);
  return (
    <>
      <button>outside</button>
      <div ref={ref} tabIndex={-1} data-testid="trap">
        {!empty && (
          <>
            <button>first</button>
            <input aria-label="mid" />
            <button disabled>disabled</button>
            <button>last</button>
          </>
        )}
      </div>
    </>
  );
}

const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return (this as HTMLElement).parentElement; } });
});
afterAll(() => {
  if (offsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent);
});

describe("useFocusTrap", () => {
  it("переводит фокус внутрь, зацикливает Tab/Shift+Tab (пропуская disabled) и возвращает фокус при закрытии", () => {
    const { rerender } = render(<Harness active={false} />);
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<Harness active />);
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });
    expect(document.activeElement).toBe(first);

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Внутри списка Tab не перехватывается — браузер двигает фокус сам.
    const mid = screen.getByLabelText("mid");
    mid.focus();
    const ev = fireEvent.keyDown(mid, { key: "Tab" });
    expect(ev).toBe(true); // preventDefault не вызван
    expect(document.activeElement).toBe(mid);

    // Фокус снаружи ловушки (например, после клика по оверлею) возвращается к первому элементу.
    outside.focus();
    fireEvent.keyDown(screen.getByTestId("trap"), { key: "Tab" });
    expect(document.activeElement).toBe(first);

    rerender(<Harness active={false} />);
    expect(document.activeElement).toBe(outside);
  });

  it("без фокусируемых элементов фокус держится на самом контейнере", () => {
    render(<Harness active empty />);
    const trap = screen.getByTestId("trap");
    expect(document.activeElement).toBe(trap);
    const ev = fireEvent.keyDown(trap, { key: "Tab" });
    expect(ev).toBe(false); // preventDefault вызван
    expect(document.activeElement).toBe(trap);
  });
});
