export type Locale = "ru" | "en";

export function localText(
  locale: Locale,
  russian: string,
  english: string,
) {
  return locale === "ru" ? russian : english;
}
