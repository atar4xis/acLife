import { t as translate } from "@/i18n";
import {
  MAX_JOURNAL_CONTENT_LENGTH,
  MAX_JOURNAL_NAME_LENGTH,
} from "@/lib/journal/item";
import { fitsUpload } from "@/lib/journal/crypt";
import { CHUNK_ITEMS } from "@/lib/journal/sync";
import { sleep } from "@/lib/utils";
import type { ItemStyle, JournalItem } from "@/types/Journal";
import { strFromU8, strToU8, unzip, zipSync } from "fflate";
import type { Unzipped } from "fflate";

export type ImportEntry = { path: string; content: string; size: number };

export type ImportRejection = {
  path: string;
  size: number;
  reason: "unsupported" | "tooLarge";
};

export type ImportSource = {
  entries: ImportEntry[];
  rejected: ImportRejection[];
};

export type ImportStatus =
  "imported" | "replaced" | "renamed" | "skipped" | "unsupported" | "tooLarge";

export type ImportLogEntry = {
  path: string;
  name: string;
  size: number;
  status: ImportStatus;
};

export type ConflictChoice = "cancel" | "skip" | "replace" | "keep";

export type ImportResolver = (conflict: {
  path: string;
}) => Promise<{ choice: ConflictChoice; all: boolean }>;

export type ImportResult = {
  upserts: JournalItem[];
  log: ImportLogEntry[];
};

export const FAILED_STATUSES: ImportStatus[] = [
  "skipped",
  "unsupported",
  "tooLarge",
];

export const IMPORT_BATCH_INTERVAL_MS = 1400;

const EXTENSION = /\.(md|txt)$/i;
const SKIP = /(^|\/)(__MACOSX\/|node_modules\/|\.[^/]+\/|\._[^/]*$)/;

const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

const rejection = (
  path: string,
  size: number,
): ImportRejection["reason"] | null => {
  if (!EXTENSION.test(path)) return "unsupported";
  return size > MAX_JOURNAL_CONTENT_LENGTH * 4 ? "tooLarge" : null;
};

export const readZip = async (file: File): Promise<ImportSource> => {
  const rejected: ImportRejection[] = [];
  const data = new Uint8Array(await file.arrayBuffer());
  const files = await new Promise<Unzipped>((resolve, reject) =>
    unzip(
      data,
      {
        filter: ({ name, originalSize }) => {
          if (name.endsWith("/") || SKIP.test(name)) return false;
          const reason = rejection(name, originalSize);
          if (reason) rejected.push({ path: name, size: originalSize, reason });
          return !reason;
        },
      },
      (error, unzipped) => (error ? reject(error) : resolve(unzipped)),
    ),
  );

  return {
    rejected,
    entries: Object.entries(files).map(([path, data]) => ({
      path,
      content: strFromU8(data),
      size: data.length,
    })),
  };
};

export const readFiles = async (files: File[]): Promise<ImportSource> => {
  const path = (file: File) => file.webkitRelativePath || file.name;
  const rejected: ImportRejection[] = [];
  const accepted: File[] = [];

  for (const file of files) {
    if (SKIP.test(path(file))) continue;
    const reason = rejection(file.name, file.size);
    if (reason) rejected.push({ path: path(file), size: file.size, reason });
    else accepted.push(file);
  }

  return {
    rejected,
    entries: await Promise.all(
      accepted.map(async (file) => ({
        path: path(file),
        content: await file.text(),
        size: file.size,
      })),
    ),
  };
};

const clampName = (name: string) => name.slice(0, MAX_JOURNAL_NAME_LENGTH);

const siblingKey = (parentId: string | null, name: string) =>
  `${parentId}:${name}`;

export const planImport = async (
  base: JournalItem[],
  { entries, rejected }: ImportSource,
  resolve: ImportResolver,
  style: (type: JournalItem["type"]) => ItemStyle,
  now: number,
): Promise<ImportResult | null> => {
  const log: ImportLogEntry[] = rejected.map(({ path, size, reason }) => ({
    path,
    name: path.split("/").at(-1)!,
    size,
    status: reason,
  }));

  const touched = new Map<string, JournalItem>();
  const notes = new Map<string, JournalItem>();
  const folders = new Map<string, JournalItem>();

  let remembered: Exclude<ConflictChoice, "cancel"> | null = null;

  for (const item of base) {
    const siblings = item.type === "note" ? notes : folders;
    const key = siblingKey(item.parentId, item.name);
    if (!siblings.has(key)) siblings.set(key, item);
  }

  const build = (
    type: JournalItem["type"],
    parentId: string | null,
    name: string,
    content = "",
  ): JournalItem => ({
    id: crypto.randomUUID(),
    parentId,
    type,
    name,
    content,
    createdAt: now,
    updatedAt: now,
    ...style(type),
  });

  const register = (item: JournalItem) => {
    touched.set(item.id, item);
    (item.type === "note" ? notes : folders).set(
      siblingKey(item.parentId, item.name),
      item,
    );
    return item;
  };

  const folderFor = (parentId: string | null, name: string) =>
    (
      folders.get(siblingKey(parentId, name)) ??
      register(build("folder", parentId, name))
    ).id;

  const decide = async (conflict: { path: string }) => {
    if (remembered) return remembered;
    const { choice, all } = await resolve(conflict);
    if (choice !== "cancel" && all) remembered = choice;
    return choice;
  };

  for (const { path, content, size } of entries) {
    const segments = path
      .split("/")
      .filter((segment) => segment && segment !== "." && segment !== "..");
    const cleanPath = segments.join("/");
    const leaf = segments.pop()!;
    const record = (name: string, status: ImportStatus) =>
      log.push({ path: cleanPath, name, size, status });

    const name =
      clampName(leaf.replace(EXTENSION, "")) ||
      translate("journal.untitledNote");

    if (
      content.length > MAX_JOURNAL_CONTENT_LENGTH ||
      !(await fitsUpload(build("note", PLACEHOLDER_ID, name, content)))
    ) {
      record(name, "tooLarge");
      continue;
    }

    let parentId: string | null = null;
    for (const segment of segments) {
      parentId = folderFor(parentId, clampName(segment));
    }

    const existing = notes.get(siblingKey(parentId, name));

    if (!existing) {
      register(build("note", parentId, name, content));
      record(name, "imported");
      continue;
    }

    const choice = await decide({ path: cleanPath });
    if (choice === "cancel") return null;

    if (choice === "skip") {
      record(name, "skipped");
    } else if (choice === "keep") {
      let n = 2;
      while (notes.has(siblingKey(parentId, `${name} (${n})`))) n++;
      const renamed = `${name} (${n})`;
      register(build("note", parentId, renamed, content));
      record(renamed, "renamed");
    } else {
      const replaced = { ...existing, content, updatedAt: now };
      touched.set(replaced.id, replaced);
      record(name, "replaced");
    }
  }

  return { log, upserts: [...touched.values()] };
};

export const applyInBatches = async (
  upserts: JournalItem[],
  apply: (batch: JournalItem[]) => void,
  onProgress: (applied: number) => void,
  signal: AbortSignal,
) => {
  let applied = 0;

  while (applied < upserts.length) {
    if (applied > 0) await sleep(IMPORT_BATCH_INTERVAL_MS);
    if (signal.aborted) break;
    const batch = upserts.slice(applied, applied + CHUNK_ITEMS);
    apply(batch);
    applied += batch.length;
    onProgress(applied);
  }

  return applied;
};

const fileSafe = (name: string) => {
  const safe = name.replace(/[/\\:*?"<>|]/g, "_").trim();
  return /^\.*$/.test(safe) ? "_" : safe;
};

export const exportZip = (
  items: JournalItem[],
  selected: ReadonlySet<string | null>,
): Uint8Array<ArrayBuffer> => {
  const files: Record<string, Uint8Array> = {};
  const folderPaths = new Map<string, string>();
  const placing = new Set<string>();
  const used = new Map<string, Set<string>>();
  const included = (id: string | null) => selected.has(id);

  const ordered = items.toSorted(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const folders = new Map(
    ordered.filter((item) => item.type === "folder").map((f) => [f.id, f]),
  );
  const parentOf = ({ parentId }: JournalItem) =>
    parentId !== null && folders.has(parentId) ? parentId : null;
  const pathOf = (parentId: string | null) =>
    (parentId !== null && folderPaths.get(parentId)) || "";

  const allocate = (
    prefix: string,
    type: JournalItem["type"],
    name: string,
  ) => {
    const key = `${prefix}:${type}`;
    const taken = used.get(key) ?? new Set<string>();
    used.set(key, taken);
    const base = fileSafe(name);
    let candidate = base;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++)
      candidate = `${base}_${n}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };

  const placeFolder = (folder: JournalItem) => {
    if (
      folderPaths.has(folder.id) ||
      placing.has(folder.id) ||
      !included(folder.id)
    )
      return;

    placing.add(folder.id);

    const parentId = parentOf(folder);
    const parent = parentId !== null && folders.get(parentId);

    if (parent) placeFolder(parent);

    const prefix = included(parentId) ? pathOf(parentId) : "";
    const path = `${prefix}${allocate(prefix, "folder", folder.name)}/`;

    folderPaths.set(folder.id, path);
    files[path] = new Uint8Array();
  };

  for (const folder of folders.values()) placeFolder(folder);

  for (const note of ordered) {
    const parentId = parentOf(note);
    if (note.type !== "note" || !included(parentId)) continue;

    const prefix = pathOf(parentId);
    files[`${prefix}${allocate(prefix, "note", note.name)}.md`] = strToU8(
      note.content,
    );
  }

  return zipSync(files) as Uint8Array<ArrayBuffer>;
};
