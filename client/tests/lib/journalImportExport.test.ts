import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyInBatches,
  exportZip,
  IMPORT_BATCH_INTERVAL_MS,
  planImport,
  readFiles,
  readZip,
} from "../../src/lib/journal/importExport.ts";
import {
  fitsUpload,
  MAX_ENCRYPTED_JOURNAL_BYTES,
} from "../../src/lib/journal/crypt.ts";
import type { ImportResolver } from "../../src/lib/journal/importExport.ts";
import type { JournalItem } from "../../src/types/Journal.ts";

vi.mock("../../src/lib/gzip.ts", () => ({
  compress: async (input: Uint8Array) => input,
  decompress: async (input: Uint8Array) => input,
}));

const item = (
  id: string,
  type: JournalItem["type"],
  name: string,
  parentId: string | null = null,
  content = "",
  createdAt = 1,
): JournalItem => ({
  id,
  type,
  name,
  parentId,
  content,
  createdAt,
  updatedAt: createdAt,
});

const never: ImportResolver = () => Promise.reject(new Error("no conflict"));
const answer =
  (choice: "cancel" | "skip" | "replace" | "keep", all = false): ImportResolver =>
  () =>
    Promise.resolve({ choice, all });

const run = (
  base: JournalItem[],
  entries: { path: string; content: string }[],
  resolve: ImportResolver = never,
) =>
  planImport(
    base,
    {
      entries: entries.map((e) => ({ ...e, size: e.content.length })),
      rejected: [],
    },
    resolve,
    () => ({}),
    100,
  );

const statuses = (result: { log: { status: string }[] }) =>
  result.log.map((entry) => entry.status);

const fakeFile = (data: string | Uint8Array, name: string) => {
  const bytes = typeof data === "string" ? strToU8(data) : data;
  return {
    name,
    size: bytes.length,
    text: () => Promise.resolve(strFromU8(bytes)),
    arrayBuffer: () => Promise.resolve(bytes.buffer),
  } as unknown as File;
};

const names = (items: JournalItem[]) => items.map((i) => i.name).sort();

describe("planImport", () => {
  it("names a file without a base name untitled", async () => {
    const result = (await run([], [{ path: "d/.md", content: "x" }]))!;

    expect(names(result.upserts)).toEqual(["Untitled", "d"]);
  });

  it("ignores dot segments in paths", async () => {
    const result = (await run([], [{ path: "../a/./n.md", content: "x" }]))!;

    expect(names(result.upserts)).toEqual(["a", "n"]);
  });

  it("keeps the directory structure and drops the extension", async () => {
    const result = (await run(
      [],
      [
        { path: "a/b/note.md", content: "x" },
        { path: "top.txt", content: "y" },
      ],
    ))!;
    const byName = new Map(result.upserts.map((i) => [i.name, i]));

    expect(statuses(result)).toEqual(["imported", "imported"]);
    expect(byName.get("b")!.parentId).toBe(byName.get("a")!.id);
    expect(byName.get("note")).toMatchObject({
      parentId: byName.get("b")!.id,
      content: "x",
      type: "note",
    });
    expect(byName.get("top")!.parentId).toBeNull();
  });

  it("merges into existing folders", async () => {
    const result = (await run(
      [item("f", "folder", "docs")],
      [{ path: "docs/n.md", content: "x" }],
    ))!;

    expect(result.upserts).toMatchObject([{ name: "n", parentId: "f" }]);
  });

  it("skips, replaces and keeps on conflict", async () => {
    const base = [item("n", "note", "a", null, "old")];
    const entries = [{ path: "a.md", content: "new" }];

    const skipped = (await run(base, entries, answer("skip")))!;
    expect(skipped.upserts).toEqual([]);
    expect(statuses(skipped)).toEqual(["skipped"]);

    const replaced = (await run(base, entries, answer("replace")))!;
    expect(statuses(replaced)).toEqual(["replaced"]);
    expect(replaced.upserts).toMatchObject([
      { id: "n", content: "new", updatedAt: 100 },
    ]);

    const kept = (await run(base, entries, answer("keep")))!;
    expect(kept.upserts).toMatchObject([{ name: "a (2)", content: "new" }]);
    expect(kept.log).toMatchObject([
      { name: "a (2)", path: "a.md", size: 3, status: "renamed" },
    ]);
  });

  it("returns null on cancel and applies a remembered choice to all", async () => {
    const base = [item("n", "note", "a"), item("m", "note", "b")];
    const entries = [
      { path: "a.md", content: "1" },
      { path: "b.md", content: "2" },
    ];
    expect(await run(base, entries, answer("cancel"))).toBeNull();

    const resolve = vi.fn(answer("skip", true));
    const result = (await run(base, entries, resolve))!;
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(statuses(result)).toEqual(["skipped", "skipped"]);
  });

  it("asks again for each conflict unless told to apply to all", async () => {
    const resolve = vi.fn(answer("skip"));
    await run(
      [item("n", "note", "a"), item("m", "note", "b")],
      [
        { path: "a.md", content: "1" },
        { path: "b.md", content: "2" },
      ],
      resolve,
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it("detects collisions between files of the same import", async () => {
    const resolve = vi.fn(answer("keep"));
    const result = (await run(
      [],
      [
        { path: "a.md", content: "1" },
        { path: "a.txt", content: "2" },
      ],
      resolve,
    ))!;

    expect(resolve).toHaveBeenCalledWith({ path: "a.txt" });
    expect(names(result.upserts)).toEqual(["a", "a (2)"]);
  });

  it("does not treat a folder and a note with the same name as a conflict", async () => {
    const result = (await run(
      [item("f", "folder", "a")],
      [{ path: "a.md", content: "x" }],
    ))!;
    expect(statuses(result)).toEqual(["imported"]);
  });

  it("replaces the first of several existing notes with the same name", async () => {
    const result = (await run(
      [item("1", "note", "a"), item("2", "note", "a")],
      [{ path: "a.md", content: "x" }],
      answer("replace"),
    ))!;
    expect(result.upserts.map((i) => i.id)).toEqual(["1"]);
  });

  it("numbers a kept copy past existing copies", async () => {
    const result = (await run(
      [item("1", "note", "a"), item("2", "note", "a (2)")],
      [{ path: "a.md", content: "x" }],
      answer("keep"),
    ))!;
    expect(names(result.upserts)).toEqual(["a (3)"]);
  });

  it("skips notes over the content limit", async () => {
    const result = (await run(
      [],
      [{ path: "dir/big.md", content: "x".repeat(128_001) }],
    ))!;
    expect(result.upserts).toEqual([]);
    expect(result.log).toMatchObject([
      { path: "dir/big.md", status: "tooLarge", size: 128_001 },
    ]);
  });
});

describe("upload size", () => {
  it("skips notes whose compressed item exceeds the upload limit", async () => {
    const result = (await run(
      [],
      [
        { path: "dir/wide.md", content: "あ".repeat(100_000) },
        { path: "dir/ok.md", content: "x" },
      ],
    ))!;

    expect(names(result.upserts)).toEqual(["dir", "ok"]);
    expect(result.log).toMatchObject([
      { path: "dir/wide.md", name: "wide", status: "tooLarge" },
      { path: "dir/ok.md", status: "imported" },
    ]);
  });

  it("creates no folders for a skipped note", async () => {
    const result = (await run(
      [],
      [{ path: "new/wide.md", content: "あ".repeat(100_000) }],
    ))!;

    expect(result.upserts).toEqual([]);
  });
});

describe("applyInBatches", () => {
  const notes = (count: number) =>
    Array.from({ length: count }, (_, i) => item(String(i), "note", String(i)));

  afterEach(() => vi.useRealTimers());

  it("applies batches of 20 spaced by the batch interval", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const onProgress = vi.fn();

    const done = applyInBatches(
      notes(45),
      apply,
      onProgress,
      new AbortController().signal,
    );
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toHaveLength(20);

    await vi.advanceTimersByTimeAsync(IMPORT_BATCH_INTERVAL_MS - 1);
    expect(apply).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(IMPORT_BATCH_INTERVAL_MS);
    expect(await done).toBe(45);
    expect(apply.mock.calls[2][0]).toHaveLength(5);
    expect(onProgress.mock.calls.map(([n]) => n)).toEqual([20, 40, 45]);
  });

  it("stops applying once aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const apply = vi.fn();

    const done = applyInBatches(notes(45), apply, vi.fn(), controller.signal);
    controller.abort();
    await vi.advanceTimersByTimeAsync(IMPORT_BATCH_INTERVAL_MS * 3);

    expect(await done).toBe(20);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("never exceeds the default journal rate limit", async () => {
    vi.useFakeTimers();
    const apply = vi.fn();

    void applyInBatches(
      notes(1000),
      apply,
      vi.fn(),
      new AbortController().signal,
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(apply.mock.calls.length).toBeLessThanOrEqual(30);
  });
});


describe("readFiles and readZip", () => {
  it("counts unsupported files and uses relative paths", async () => {
    const md = fakeFile("hi", "a.md");
    Object.defineProperty(md, "webkitRelativePath", { value: "dir/a.md" });
    const source = await readFiles([md, fakeFile("x", "pic.png")]);

    expect(source.rejected).toEqual([
      { path: "pic.png", size: 1, reason: "unsupported" },
    ]);
    expect(source.entries).toEqual([
      { path: "dir/a.md", content: "hi", size: 2 },
    ]);
  });

  it("silently drops macOS archive metadata", async () => {
    const zip = zipSync({
      "d/a.md": strToU8("hello"),
      "__MACOSX/d/._a.md": strToU8("junk"),
      "d/._b.md": strToU8("junk"),
    });
    const source = await readZip(fakeFile(zip, "x.zip"));

    expect(source.entries.map((entry) => entry.path)).toEqual(["d/a.md"]);
    expect(source.rejected).toEqual([]);
  });

  it("drops hidden and dependency folders", async () => {
    const zip = zipSync({
      "d/a.md": strToU8("hello"),
      ".git/notes.md": strToU8("junk"),
      "d/.obsidian/workspace.md": strToU8("junk"),
      "node_modules/x/readme.md": strToU8("junk"),
    });
    const source = await readZip(fakeFile(zip, "x.zip"));

    expect(source.entries.map((entry) => entry.path)).toEqual(["d/a.md"]);
    expect(source.rejected).toEqual([]);
  });

  it("silently drops macOS metadata from picked files", async () => {
    const source = await readFiles([fakeFile("x", "._a.md")]);

    expect(source).toEqual({ entries: [], rejected: [] });
  });

  it("rejects picked files over four bytes per allowed character", async () => {
    const big = fakeFile("x".repeat(512_001), "big.md");
    const source = await readFiles([big, fakeFile("ok", "ok.md")]);

    expect(source.rejected).toEqual([
      { path: "big.md", size: 512_001, reason: "tooLarge" },
    ]);
    expect(source.entries.map((entry) => entry.path)).toEqual(["ok.md"]);
  });

  it("rejects zip notes over four bytes per allowed character", async () => {
    const zip = zipSync({ "big.md": strToU8("x".repeat(512_001)) });
    const source = await readZip(fakeFile(zip, "x.zip"));

    expect(source.entries).toEqual([]);
    expect(source.rejected).toEqual([
      { path: "big.md", size: 512_001, reason: "tooLarge" },
    ]);
  });

  it("rejects a file that is not a zip", async () => {
    await expect(readZip(fakeFile("not a zip", "x.zip"))).rejects.toThrow();
  });

  it("reads notes and folders from a zip and skips the rest", async () => {
    const zip = zipSync({
      "d/": new Uint8Array(),
      "empty/": new Uint8Array(),
      "d/a.md": strToU8("hello"),
      "d/b.TXT": strToU8("world"),
      "d/img.png": strToU8("."),
    });
    const source = await readZip(fakeFile(zip, "x.zip"));

    expect(source.rejected).toEqual([
      { path: "d/img.png", size: 1, reason: "unsupported" },
    ]);
    expect(source.entries.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: "d/a.md", content: "hello", size: 5 },
      { path: "d/b.TXT", content: "world", size: 5 },
    ]);
  });
});

describe("exportZip", () => {
  const items = [
    item("f", "folder", "Work", null, "", 1),
    item("g", "folder", "Sub", "f", "", 2),
    item("1", "note", "Ideas", "f", "one", 3),
    item("2", "note", "Ideas", "f", "two", 4),
    item("3", "note", "a/b", "g", "deep", 5),
    item("4", "note", "root", null, "r", 6),
  ];
  const all = new Set([null, "f", "g"]);
  const entries = (selected: Set<string | null>) =>
    Object.fromEntries(
      Object.entries(unzipSync(exportZip(items, selected))).map(([k, v]) => [
        k,
        new TextDecoder().decode(v),
      ]),
    );

  it("preserves folders and appends _N to duplicate names", () => {
    expect(entries(all)).toEqual({
      "Work/": "",
      "Work/Sub/": "",
      "Work/Ideas.md": "one",
      "Work/Ideas_2.md": "two",
      "Work/Sub/a_b.md": "deep",
      "root.md": "r",
    });
  });

  it("exports only selected folders, with a selected subfolder at the top", () => {
    expect(entries(new Set(["g"]))).toEqual({
      "Sub/": "",
      "Sub/a_b.md": "deep",
    });
  });

  it("does not recurse forever on a parent cycle", () => {
    const cyclic = [
      item("x", "folder", "X", "y", "", 1),
      item("y", "folder", "Y", "x", "", 2),
      item("n", "note", "in x", "x", "c", 3),
    ];
    const files = Object.keys(
      unzipSync(exportZip(cyclic, new Set([null, "x", "y"]))),
    ).sort();

    expect(files).toEqual(["Y/", "Y/X/", "Y/X/in x.md"]);
  });

  it("exports items with a missing parent at the root", () => {
    const orphans = [
      item("f", "folder", "Lost", "gone", "", 1),
      item("n", "note", "orphan", "gone", "o", 2),
    ];
    const files = Object.keys(
      unzipSync(exportZip(orphans, new Set([null, "f"]))),
    ).sort();

    expect(files).toEqual(["Lost/", "orphan.md"]);
  });

  it("treats names that differ only by case as duplicates", () => {
    const cased = [
      item("1", "note", "Note", null, "a", 1),
      item("2", "note", "note", null, "b", 2),
    ];
    const files = Object.keys(
      unzipSync(exportZip(cased, new Set([null]))),
    ).sort();

    expect(files).toEqual(["Note.md", "note_2.md"]);
  });

  it("leaves out root notes unless the root is selected", () => {
    expect(Object.keys(entries(new Set(["f"])))).toEqual([
      "Work/",
      "Work/Ideas.md",
      "Work/Ideas_2.md",
    ]);
  });
});

describe("fitsUpload", () => {
  it("counts the iv and auth tag against the upload limit", async () => {
    const base = JSON.stringify(item("a", "note", "n")).length;
    const room = MAX_ENCRYPTED_JOURNAL_BYTES - 28 - base;

    expect(await fitsUpload(item("a", "note", "n", null, "x".repeat(room)))).toBe(
      true,
    );
    expect(
      await fitsUpload(item("a", "note", "n", null, "x".repeat(room + 1))),
    ).toBe(false);
  });
});
