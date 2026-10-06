import { describe, expect, it } from "vitest";
import { parseRegisterLink, sameServer } from "../../src/lib/registerLink";

const encode = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const link = { token: "a".repeat(64), email: "a@b.com", server: "https://s/api" };

describe("parseRegisterLink", () => {
  it("reads the token, email and server", () => {
    expect(parseRegisterLink(`#token=${encode(link)}`)).toEqual(link);
  });

  it("reads url safe base64 without padding", () => {
    const odd = { ...link, email: "??>>@b.com" };

    expect(parseRegisterLink(`#token=${encode(odd)}`)).toEqual(odd);
  });

  it.each([
    ["no token", ""],
    ["not base64", "#token=%%%"],
    ["not json", `#token=${btoa("nope")}`],
    ["missing token", `#token=${encode({ ...link, token: "" })}`],
    ["missing email", `#token=${encode({ token: link.token, server: link.server })}`],
    ["missing server", `#token=${encode({ token: link.token, email: link.email })}`],
    ["not an object", `#token=${encode("text")}`],
    ["null", `#token=${encode(null)}`],
    ["an array", `#token=${encode([link])}`],
    ["a non-string token", `#token=${encode({ ...link, token: 1 })}`],
    ["a non-string email", `#token=${encode({ ...link, email: {} })}`],
    ["a non-string server", `#token=${encode({ ...link, server: ["x"] })}`],
  ])("rejects %s", (_name, hash) => {
    expect(parseRegisterLink(hash)).toBeNull();
  });
});

describe("sameServer", () => {
  it("ignores trailing slashes", () => {
    expect(sameServer("https://s/api/", "https://s/api")).toBe(true);
  });

  it("tells servers apart", () => {
    expect(sameServer("https://s/api", "https://t/api")).toBe(false);
    expect(sameServer("https://s/api", "http://s/api")).toBe(false);
  });
});
