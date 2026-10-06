import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  fetchChangelog,
  fetchReleases,
} from "../../src/lib/updates.ts";

const apiRelease = (tag: string, prerelease = false, draft = false) => ({
  tag_name: tag,
  published_at: "2026-01-01T00:00:00Z",
  html_url: `https://github.com/atar4xis/acLife/releases/tag/${tag}`,
  prerelease,
  draft,
});

const respond = (body: unknown, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 403, json: async () => body });

describe("compareVersions", () => {
  it.each([
    ["1.2.3", "1.2.3", 0],
    ["1.2.4", "1.2.3", 1],
    ["1.10.0", "1.9.0", 1],
    ["2.0.0", "1.99.99", 1],
    ["1.0.0", "1.0.0-beta.1", 1],
    ["1.0.0-beta.1", "1.0.0", -1],
    ["1.0.0-beta.2", "1.0.0-beta.1", 1],
    ["1.0.0-beta.10", "1.0.0-beta.9", 1],
    ["1.0.0-beta", "1.0.0-beta.1", -1],
    ["1.0.0-beta.1", "1.0.0-alpha.9", 1],
    ["1.1.0-beta.1", "1.0.0", 1],
  ])("%s vs %s", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

describe("releases", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hides prereleases and drafts on the stable channel", async () => {
    fetchMock.mockImplementation(() =>
      respond([
        apiRelease("v0.3.0-beta.1", true),
        apiRelease("v0.2.0", false, true),
        apiRelease("v0.1.0"),
      ]),
    );

    const releases = await fetchReleases("stable");

    expect(releases.map((r) => r.version)).toEqual(["0.1.0"]);
  });

  it("includes prereleases on the beta channel but not drafts", async () => {
    fetchMock.mockImplementation(() =>
      respond([
        apiRelease("v0.3.0-beta.1", true),
        apiRelease("v0.2.0", false, true),
        apiRelease("v0.1.0"),
      ]),
    );

    const releases = await fetchReleases("beta");

    expect(releases.map((r) => r.tag)).toEqual(["v0.3.0-beta.1", "v0.1.0"]);
    expect(releases[0]).toMatchObject({ version: "0.3.0-beta.1" });
  });

  it("throws when GitHub rejects the request", async () => {
    fetchMock.mockImplementation(() => respond({}, false));

    await expect(fetchReleases("stable")).rejects.toThrow();
  });

  it("lists commits between consecutive releases, newest first", async () => {
    const releases = await (async () => {
      fetchMock.mockImplementation(() =>
        respond(["v4", "v3", "v2", "v1"].map((tag) => apiRelease(tag))),
      );
      return fetchReleases("stable");
    })();
    fetchMock.mockImplementation((url: string) =>
      respond({
        commits: [
          { commit: { message: `first of ${url.split("/").pop()}\n\nbody` } },
          { commit: { message: "second" } },
        ],
      }),
    );

    const changelog = await fetchChangelog(releases);

    expect(changelog.map((e) => e.release.tag)).toEqual(["v4", "v3", "v2"]);
    expect(changelog[0].commits).toEqual(["first of v3...v4", "second"]);
    expect(changelog[2].commits[0]).toBe("first of v1...v2");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("has no commits for the oldest release and reuses cached ranges", async () => {
    fetchMock.mockImplementation(() =>
      respond({ commits: [{ commit: { message: "fix" } }] }),
    );
    const releases = [
      {
        tag: "v2",
        version: "2",
        date: "",
        url: "",
        prerelease: false,
      },
      { tag: "v1", version: "1", date: "", url: "", prerelease: false },
    ];

    const first = await fetchChangelog(releases);
    const second = await fetchChangelog(releases);

    expect(first[1].commits).toEqual([]);
    expect(second[0].commits).toEqual(["fix"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
