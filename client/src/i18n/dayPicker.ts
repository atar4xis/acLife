import { ar, enUS, es, fr, hi, ja, pl, zhCN } from "react-day-picker/locale";

const locales: Record<string, typeof enUS> = {
  en: enUS,
  es,
  fr,
  ja,
  pl,
  zh: zhCN,
  hi,
  ar,
};

export const dayPickerLocale = (language: string) => locales[language] ?? enUS;
