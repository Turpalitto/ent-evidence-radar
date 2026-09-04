"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RefreshButton } from "./RefreshButton";

const links = [
  { href: "/", label: "Лента" },
  { href: "/topics", label: "Темы" },
  { href: "/stats", label: "Аналитика" },
  { href: "/runs", label: "Журнал запусков" },
  { href: "/settings", label: "Настройки" },
];

export function AppNav() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-4 py-2.5 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
            </svg>
          </span>
          <span className="leading-tight">
            <span className="block text-sm font-semibold tracking-tight text-slate-900">ENT Evidence Radar</span>
            <span className="block text-[11px] text-slate-500">Доказательная оториноларингология · мировые источники</span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {links.map((l) => {
            const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-teal-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <RefreshButton />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5 md:hidden">
        {links.map((l) => {
          const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-medium transition ${active ? "bg-teal-600 text-white" : "text-slate-600 bg-slate-100"}`}>
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
