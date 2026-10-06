export const REPO_URL = "https://github.com/atar4xis/acLife";
export const CHANGELOG_RELEASES = 3;

const RELEASES_API = "https://api.github.com/repos/atar4xis/acLife";
const COMMITS_CACHE_KEY = "acl-changelog-commits";

export type UpdateChannel = "stable" | "beta";

export interface Release {
  tag: string;
  version: string;
  date: string;
  url: string;
  prerelease: boolean;
}

export interface ChangelogEntry {
  release: Release;
  commits: string[];
}

interface ApiRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

const parseVersion = (version: string) => {
  const [core, pre] = version.split("-", 2);
  return { core: core.split(".").map(Number), pre: pre?.split(".") };
};

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (diff) return diff;
  }
  if (!x.pre || !y.pre) return Number(!x.pre) - Number(!y.pre);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const diff = Number(p) - Number(q);
    if (diff) return diff;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

async function github<T>(path: string): Promise<T> {
  const res = await fetch(`${RELEASES_API}/${path}`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub request failed: ${res.status}`);
  return res.json();
}

export async function fetchReleases(
  channel: UpdateChannel,
): Promise<Release[]> {
  const releases = await github<ApiRelease[]>("releases?per_page=30");
  return releases
    .filter((r) => !r.draft && (channel === "beta" || !r.prerelease))
    .map((r) => ({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ""),
      date: r.published_at,
      url: r.html_url,
      prerelease: r.prerelease,
    }));
}

// the commits between two published tags never change, so they are cached
export async function fetchChangelog(
  releases: Release[],
): Promise<ChangelogEntry[]> {
  const cache: Record<string, string[]> = JSON.parse(
    localStorage.getItem(COMMITS_CACHE_KEY) ?? "{}",
  );

  const entries = await Promise.all(
    releases.slice(0, CHANGELOG_RELEASES).map(async (release, i) => {
      const base = releases[i + 1];
      if (!base) return { release, commits: [] };
      const key = `${base.tag}...${release.tag}`;
      cache[key] ??= (
        await github<{ commits: { commit: { message: string } }[] }>(
          `compare/${key}`,
        )
      ).commits.map((c) => c.commit.message.split("\n")[0]);
      return { release, commits: cache[key] };
    }),
  );

  localStorage.setItem(COMMITS_CACHE_KEY, JSON.stringify(cache));
  return entries;
}
