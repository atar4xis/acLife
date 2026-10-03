import { afterEach, describe, expect, it } from "vitest";
import { DateTime, Settings } from "luxon";
import i18n, {
  applyFormats,
  applyLanguage,
  fmt,
  isLanguage,
  languageCodes,
  t,
} from "../../src/i18n";
import { dayPickerLocale } from "../../src/i18n/dayPicker";
import { describeFullDay } from "../../src/lib/calendar/a11y";
import { getRelativeDays, timeFormat } from "../../src/lib/calendar/date";
import { monthlyOptions } from "../../src/lib/calendar/repeatOptions";
import { getFriendlyName } from "../../src/lib/calendar/timezone";
import { localizeReply } from "../../src/lib/serverErrors";

afterEach(() => {
  applyLanguage("en");
  applyFormats({});
});

const monday = DateTime.fromISO("2026-10-05T09:00:00", { zone: "utc" });

describe("applyLanguage", () => {
  it("switches translations, luxon names and the document language", () => {
    applyLanguage("es");

    expect(t("common.cancel")).toBe("Cancelar");
    expect(describeFullDay(monday)).toBe("lunes 5 de octubre de 2026");
    expect(Settings.defaultLocale).toBe("es");
    expect(document.documentElement.lang).toBe("es");
  });

  it("flips the document direction for right-to-left languages", () => {
    applyLanguage("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(t("events.tooLargeMany", { count: 2 })).toContain("حدثان");

    applyLanguage("zh");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("falls back to the browser language for the system setting", () => {
    applyLanguage("es");
    applyLanguage("system");

    expect(i18n.language).toBe("en");
  });

  it("ignores unknown languages", () => {
    applyLanguage("xx");

    expect(i18n.language).toBe("en");
    expect(isLanguage("xx")).toBe(false);
    expect(isLanguage("es")).toBe(true);
  });

  it("translates relative day labels", () => {
    applyLanguage("es");

    expect(getRelativeDays(monday, 2).map((d) => d.label)).toEqual([
      "Hoy",
      "Mañana",
    ]);
  });

  it("uses plural and ordinal rules of the active language", () => {
    expect(monthlyOptions(monday.set({ day: 22 }))[0].label).toBe("on the 22nd");

    applyLanguage("es");

    expect(monthlyOptions(monday.set({ day: 22 }))[0].label).toBe("el día 22");
    expect(t("move.minutes", { count: 1 })).toBe("1 minuto");
    expect(t("move.minutes", { count: 5 })).toBe("5 minutos");
  });
});

describe("localizeReply", () => {
  it("translates a reply that carries an error code", () => {
    applyLanguage("es");

    expect(
      localizeReply({ success: false, message: "Bad request.", code: "bad_request" })
        .message,
    ).toBe("Solicitud no válida.");
  });

  it("interpolates params and picks the plural form", () => {
    const reply = {
      success: false,
      message: "Too many attempts. Try again in 1 minute.",
      code: "too_many_attempts_minutes",
      params: { count: 1 },
    };

    expect(localizeReply({ ...reply }).message).toBe(
      "Too many attempts. Try again in 1 minute.",
    );
    expect(localizeReply({ ...reply, params: { count: 3 } }).message).toBe(
      "Too many attempts. Try again in 3 minutes.",
    );
  });

  it("keeps the server message for unknown codes or no code", () => {
    expect(
      localizeReply({ success: false, message: "Boom.", code: "new_code" }).message,
    ).toBe("Boom.");
    expect(localizeReply({ success: false, message: "Boom." }).message).toBe("Boom.");
  });
});

describe("time zone names", () => {
  it("names countries in the active language", () => {
    expect(getFriendlyName("Europe/Berlin")).toBe("Berlin, Germany");

    applyLanguage("es");

    expect(getFriendlyName("Europe/Berlin")).toBe("Berlin, Alemania");
  });
});

describe.each([
  ["fr", "lundi 5 octobre 2026", "le 22", "1 minute", "5 minutes", "Annuler"],
  ["pl", "poniedziałek, 5 października 2026", "22. dnia miesiąca", "1 minuta", "5 minut", "Anuluj"],
  ["ja", "2026年10月5日 月曜日", "22日", "1分", "5分", "キャンセル"],
])("%s", (code, fullDay, ordinal, oneMinute, fiveMinutes, cancel) => {
  it("translates, formats dates and applies plural and ordinal rules", () => {
    applyLanguage(code);

    expect(t("common.cancel")).toBe(cancel);
    expect(describeFullDay(monday)).toBe(fullDay);
    expect(monthlyOptions(monday.set({ day: 22 }))[0].label).toBe(ordinal);
    expect(t("move.minutes", { count: 1 })).toBe(oneMinute);
    expect(t("move.minutes", { count: 5 })).toBe(fiveMinutes);
  });
});

describe("language specifics", () => {
  it("uses Polish few and many plural forms", () => {
    applyLanguage("pl");

    expect(t("move.minutes", { count: 2 })).toBe("2 minuty");
    expect(t("move.minutes", { count: 12 })).toBe("12 minut");
    expect(t("move.minutes", { count: 22 })).toBe("22 minuty");
  });

  it("uses the French ordinal for the first", () => {
    applyLanguage("fr");

    expect(monthlyOptions(monday.set({ day: 1 }))[0].label).toBe("le 1er");
  });

  it("formats Japanese dates with literal characters", () => {
    applyLanguage("ja");

    expect(monday.toFormat(t("fmt.dateTimeLong"))).toBe("2026年10月5日(月) 9:00");
  });
});

describe("day picker locales", () => {
  it.each(languageCodes)("has a day picker locale for %s", (code) => {
    expect(dayPickerLocale(code).code.split("-")[0]).toBe(code);
  });

  it("falls back to English for unknown languages", () => {
    expect(dayPickerLocale("xx").code).toBe("en-US");
  });
});

describe("time format", () => {
  const threePm = DateTime.fromISO("2026-10-05T15:00:00", { zone: "utc" });
  const threeTen = threePm.set({ minute: 10 });

  it("follows the language until a format is chosen", () => {
    expect(threePm.toFormat(timeFormat(threePm))).toBe("3 PM");
    expect(threeTen.toFormat(timeFormat(threeTen))).toBe("3:10 PM");

    applyLanguage("fr");
    expect(threePm.toFormat(timeFormat(threePm))).toBe("15:00");
  });

  it("uses a 24-hour pattern for every variant", () => {
    applyFormats({ time: "HH:mm" });

    expect(threePm.toFormat(timeFormat(threePm))).toBe("15:00");
    expect(threePm.toFormat(timeFormat(threePm, false))).toBe("15:00");
    expect(threeTen.toFormat(timeFormat(threeTen))).toBe("15:10");
  });

  it("drops the minutes on the hour and the meridiem when it is shared", () => {
    applyFormats({ time: "h.mm a" });

    expect(fmt("timeHour")).toBe("h a");
    expect(fmt("timeNoMeridiem")).toBe("h.mm");
    expect(fmt("timeHourNoMeridiem")).toBe("h");
  });

  it("leaves quoted text alone", () => {
    applyFormats({ time: "h:mm 'a' a" });

    expect(fmt("timeNoMeridiem")).toBe("h:mm 'a'");
  });

  it("changes the time in the date and time patterns too", () => {
    applyFormats({ time: "HH:mm" });

    expect(fmt("dateTimeLong")).toBe("EEE, MMM d yyyy, HH:mm");
    expect(fmt("dateTimeShort")).toBe("EEE, MMM d, HH:mm");
  });

  it("lets a date and time format win over the time format", () => {
    applyFormats({ time: "HH:mm", dateTimeLong: "yyyy-MM-dd HH:mm:ss" });

    expect(fmt("dateTimeLong")).toBe("yyyy-MM-dd HH:mm:ss");
  });

  it("keeps the language's date and time patterns when cleared", () => {
    applyFormats({ time: "HH:mm" });
    applyFormats({ time: "" });

    expect(fmt("time")).toBe("h:mm a");
    expect(fmt("dateTimeLong")).toBe("EEE, MMM d yyyy, h:mm a");
  });
});
