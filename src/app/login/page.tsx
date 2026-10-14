import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";
import { pageMetadata } from "@/lib/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Вход",
    description: "Вход в режим редактирования ENT Evidence Radar.",
    path: "/login",
  }),
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md space-y-5">
      <div className="rise-in">
        <p className="eyebrow">Доступ</p>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-[color:var(--ink)]">Вход</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-muted)]">
          Чтение ленты открыто всем. Изменение настроек, тем, заметок и запуск обновления требуют входа.
        </p>
      </div>
      <Suspense fallback={<div className="skeleton h-40 rounded-2xl" />}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
