/**
 * Признак фазы сборки Next.js.
 *
 * Во время `next build` Next.js запускает несколько параллельных воркеров, а файловый
 * PGlite нельзя открыть из нескольких процессов одновременно — поэтому сборка работает
 * на in-memory базе (см. `db/index.ts`).
 *
 * Раньше признаком сборки считался ЛЮБОЙ аргумент командной строки, содержащий подстроку
 * «build»: `process.argv.some((a) => a.includes("build"))`. Достаточно было запустить
 * приложение из каталога вида `/srv/build/app` или `/tmp/ent-build` — и путь к бинарю
 * `next` попадал под проверку, приложение молча переключалось на in-memory PGlite:
 * данные принимались, но не сохранялись, а после перезапуска исчезали (закладки, заметки,
 * темы). Ошибка воспроизведена на копии проекта в каталоге `/tmp/ent-build`.
 *
 * Теперь «сборка» — это либо явная фаза Next.js (`NEXT_PHASE`), либо `npm run build`,
 * либо команда `build` у самого CLI `next`. Путь к каталогу проекта больше ни при чём.
 */

const NEXT_BINARIES = new Set(["next", "next.js"]);

/** argv[1] — это CLI next (`…/node_modules/.bin/next`, `…/next/dist/bin/next`)? */
function isNextBinary(arg: string | undefined): boolean {
  if (!arg) return false;
  const base = arg.split(/[\\/]/).pop() ?? "";
  return NEXT_BINARIES.has(base);
}

/**
 * @param argv командная строка (по умолчанию `process.argv`)
 * @param env окружение (по умолчанию `process.env`)
 */
export function isBuildPhase(
  argv: readonly string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env.NEXT_PHASE === "phase-production-build") return true;
  if (env.npm_lifecycle_event === "build") return true;
  return isNextBinary(argv[1]) && argv.slice(2).includes("build");
}
