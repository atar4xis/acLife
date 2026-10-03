import { describe, expect, it } from "vitest";
import { languageCodes } from "../../src/i18n";

const bundles = import.meta.glob<{ default: Record<string, unknown> }>(
  "../../src/locales/*.json",
  { eager: true },
);

const flatten = (obj: Record<string, unknown>, prefix = ""): [string, string][] =>
  Object.entries(obj).flatMap(([key, value]) =>
    typeof value === "object" && value !== null
      ? flatten(value as Record<string, unknown>, `${prefix}${key}.`)
      : [[`${prefix}${key}`, String(value)] as [string, string]],
  );

const load = (code: string) =>
  new Map(flatten(bundles[`../../src/locales/${code}.json`].default));

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other|ordinal_\w+)$/;
const baseKey = (key: string) => key.replace(PLURAL_SUFFIX, "");
const tokens = (text: string) =>
  [...text.matchAll(/\{\{\s*\w+\s*\}\}|<\/?\w+>/g)].map((m) => m[0]).sort();

describe("locale files", () => {
  const english = load("en");
  const others = languageCodes.filter((code) => code !== "en");

  it("ships English plus at least one more language", () => {
    expect(others.length).toBeGreaterThan(0);
  });

  it.each(others)("%s has exactly the keys English has", (code) => {
    const keys = (map: Map<string, string>) =>
      new Set([...map.keys()].map(baseKey));
    expect(keys(load(code))).toEqual(keys(english));
  });

  it.each(others)("%s keeps the placeholders and tags of every string", (code) => {
    const translated = load(code);
    for (const [key, value] of english) {
      const match = translated.get(key) ?? translated.get(`${baseKey(key)}_other`);
      if (match === undefined) continue;
      expect(tokens(match), key).toEqual(tokens(value));
    }
  });
});
