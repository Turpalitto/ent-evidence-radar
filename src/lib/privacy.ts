import { checkApiAuth } from "@/lib/security";
import type { Article } from "@/db/schema";

/**
 * Личные поля статьи (аудит N-01). Заметки, закладка, «прочитано» и скрытие принадлежат
 * человеку, а не публичной карточке: при заданном `API_SECRET` анонимный читатель получает
 * значения по умолчанию, а персональные фильтры ленты игнорируются. Без `API_SECRET`
 * (локальная разработка / доверенная сеть) поведение прежнее — решение владельца.
 */
export type PersonalFields = Pick<Article, "notes" | "isBookmarked" | "isRead" | "isHidden">;

const REDACTED: PersonalFields = { notes: "", isBookmarked: false, isRead: false, isHidden: false };

/** Может ли запрос видеть личные поля: без `API_SECRET` — все, иначе только с токеном или сессией. */
export function canReadPersonal(req: { headers: { get(name: string): string | null }; method?: string }): boolean {
  return checkApiAuth(req).ok;
}

/** Копия статьи с обнулёнными личными полями (форма ответа не меняется — контракт стабилен). */
export function redactArticle<T extends PersonalFields>(a: T): T {
  return { ...a, ...REDACTED };
}

export function redactArticles<T extends PersonalFields>(items: T[]): T[] {
  return items.map(redactArticle);
}
