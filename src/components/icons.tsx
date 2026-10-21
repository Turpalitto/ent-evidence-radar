import type { ReactNode, SVGProps } from "react";

/**
 * Инлайновые иконки интерфейса (аудит V-09). Раньше роль иконок играли эмодзи и символы
 * Юникода (★ ☆ ✓ ↺ 💡 📝 ⚠): они по-разному выглядят в macOS/Windows/Android, читаются
 * скринридером как слова и ломают вертикальный ритм строки. Здесь — один стиль: сетка 24,
 * stroke currentColor 1.75, `aria-hidden` (смысл несёт текст или aria-label кнопки).
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, className, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ?? "h-4 w-4"}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Закладка: контур или заливка (проп `filled`). */
export function IconStar({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Icon {...props}>
      <path
        d="M12 3.6l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.62 6.9 19.3l.97-5.68L3.75 9.6l5.7-.83L12 3.6Z"
        fill={filled ? "currentColor" : "none"}
      />
    </Icon>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4.5 12.5 5 5 10-10" />
    </Icon>
  );
}

/** Двойная галочка — «прочитано всё». */
export function IconCheckDouble(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m2.5 12.5 4 4 8-8" />
      <path d="m11 16.5 1.5 1.5 8.5-9" />
    </Icon>
  );
}

/** «Пометить непрочитанным»: точка в круге. */
export function IconUnread(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <circle cx="12" cy="12" r="2.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconLightbulb(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 18h5M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.4 10.95c.55.38.9 1 .9 1.66V17h5v-1.39c0-.66.35-1.28.9-1.66A6 6 0 0 0 12 3Z" />
    </Icon>
  );
}

export function IconNote(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H14l5 5v11.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15Z" />
      <path d="M14 3v5.5h5M8.5 13h7M8.5 17h4.5" />
    </Icon>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 2.9 19.5a1 1 0 0 0 .87 1.5h16.46a1 1 0 0 0 .87-1.5L12 3.5Z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.9" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function IconX(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M3.4 12h17.2M12 3.25c2.4 2.4 3.6 5.35 3.6 8.75s-1.2 6.35-3.6 8.75c-2.4-2.4-3.6-5.35-3.6-8.75S9.6 5.65 12 3.25Z" />
    </Icon>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </Icon>
  );
}

export function IconLink(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.5 13.5a4.5 4.5 0 0 0 6.36 0l2.12-2.12a4.5 4.5 0 0 0-6.36-6.36l-1.06 1.06" />
      <path d="M13.5 10.5a4.5 4.5 0 0 0-6.36 0L5.02 12.6a4.5 4.5 0 0 0 6.36 6.36l1.06-1.06" />
    </Icon>
  );
}

export function IconPencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" />
      <path d="M13.4 6.4 17.6 10.6" />
    </Icon>
  );
}

/** Уведомления: `off` — перечёркнутый колокол. */
export function IconBell({ off = false, ...props }: IconProps & { off?: boolean }) {
  return (
    <Icon {...props}>
      <path d="M6.2 9.4a5.8 5.8 0 0 1 11.6 0c0 4.6 1.9 5.8 1.9 5.8H4.3s1.9-1.2 1.9-5.8Z" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
      {off && <path d="M4 4l16 16" />}
    </Icon>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11.5M7.5 10.5 12 15l4.5-4.5M4 20.5h16" />
    </Icon>
  );
}

export function IconUpload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16.5V5M7.5 9.5 12 5l4.5 4.5M4 20.5h16" />
    </Icon>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M12 7v5.3l3.4 2" />
    </Icon>
  );
}

/** Внешняя ссылка: рамка со стрелкой наружу (замена текстовому «↗»). */
export function IconExternal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 4.5H19.5V10.5" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
    </Icon>
  );
}
