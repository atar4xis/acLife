import ScrollContainer from "@/components/ui/scroll-container";
import { DateTime } from "luxon";
import { useEffect, useRef, useState } from "react";
import FolderTargetLabel from "@/components/journal/FolderTargetLabel";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldTitle } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useJournal, useJournalItems } from "@/context/JournalContext";
import { useSettingsStore } from "@/context/SettingsStoreContext";
import { timeFormat } from "@/lib/calendar/date";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";
import { descendantIds, folderTargets, itemStyle } from "@/lib/journal/item";
import {
  applyInBatches,
  exportZip,
  FAILED_STATUSES,
  planImport,
  readFiles,
  readZip,
} from "@/lib/journal/importExport";
import type {
  ConflictChoice,
  ImportLogEntry,
  ImportStatus,
  ImportResolver,
  ImportSource,
} from "@/lib/journal/importExport";
import type { JournalItem } from "@/types/Journal";
import { SelectItem } from "@/components/ui/select";
import { settingLabel } from "../settingsData";
import SettingsSelect from "../SettingsSelect";
import { useTranslation } from "react-i18next";

type PendingConflict = {
  path: string;
  settle: (answer: { choice: ConflictChoice; all: boolean }) => void;
};

type ImportFormat = "zip" | "files" | "folder";

type ImportReport = {
  log: ImportLogEntry[];
  startedAt: number;
  endedAt: number;
};

const STATUS_CLASSES: Record<ImportStatus, string> = {
  imported: "text-foreground",
  replaced: "text-warning",
  renamed: "text-primary",
  skipped: "text-foreground/75",
  unsupported: "text-destructive",
  tooLarge: "text-destructive",
};

function ImportDetails({
  report,
  onClose,
}: {
  report: ImportReport;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const started = DateTime.fromMillis(report.startedAt);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("journal.transfer.detailsTitle")}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {t("journal.transfer.detailsTime", {
              start: started.toFormat(timeFormat(started)),
              seconds: new Intl.NumberFormat(i18n.language, {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              }).format((report.endedAt - report.startedAt) / 1000),
            })}
          </p>
        </DialogHeader>

        <ScrollContainer className="max-h-96">
          <ul className="flex flex-col">
            {report.log.map((entry, index) => (
              <li
                key={`${index}:${entry.path}`}
                className={cn(
                  "flex flex-col gap-0.5 border-b px-3 py-2 text-sm last:border-b-0",
                  STATUS_CLASSES[entry.status],
                )}
              >
                <div className="flex justify-between gap-2">
                  <span className="truncate font-medium">{entry.name}</span>
                  <span className="shrink-0">
                    {t(`journal.transfer.status.${entry.status}`)}
                  </span>
                </div>

                <span className="truncate text-xs opacity-80">
                  {entry.path} - {formatBytes(entry.size, i18n.language)}
                </span>
              </li>
            ))}
          </ul>
        </ScrollContainer>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const askConflict =
  (
    onConflict: (conflict: PendingConflict) => void,
    signal: AbortSignal,
  ): ImportResolver =>
  ({ path }) =>
    new Promise((settle) => {
      onConflict({ path, settle });
      signal.addEventListener(
        "abort",
        () => settle({ choice: "cancel", all: false }),
        { once: true },
      );
    });

function ImportField() {
  const { t } = useTranslation();
  const items = useJournalItems();
  const { importItems, loaded } = useJournal();
  const settingsStore = useSettingsStore();
  const [format, setFormat] = useState<ImportFormat>("zip");
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [conflict, setConflict] = useState<PendingConflict | null>(null);
  const [all, setAll] = useState(false);
  const failed =
    report?.log.filter(({ status }) => FAILED_STATUSES.includes(status))
      .length ?? 0;
  const controller = useRef<AbortController | null>(null);
  const inputs = {
    zip: useRef<HTMLInputElement>(null),
    files: useRef<HTMLInputElement>(null),
    folder: useRef<HTMLInputElement>(null),
  };

  useEffect(() => () => controller.current?.abort(), []);

  const run = async (read: () => Promise<ImportSource>) => {
    const startedAt = Date.now();
    const { signal } = (controller.current = new AbortController());

    setProgress(0);
    setMessage("");
    setReport(null);

    try {
      const style = (type: JournalItem["type"]) =>
        itemStyle(type, settingsStore.getSnapshot());
      const result = await planImport(
        items,
        await read(),
        askConflict(setConflict, signal),
        style,
        Date.now(),
      );

      if (!result) {
        setMessage(t("journal.transfer.cancelled"));
        return;
      }

      const applied = await applyInBatches(
        result.upserts,
        importItems,
        (count) => setProgress((count / result.upserts.length) * 100),
        signal,
      );

      if (applied < result.upserts.length) {
        setMessage(
          t("journal.transfer.stopped", {
            applied,
            total: result.upserts.length,
          }),
        );
        return;
      }

      setReport({ log: result.log, startedAt, endedAt: Date.now() });
    } catch {
      setMessage(t("journal.transfer.importFailed"));
    } finally {
      setProgress(null);
    }
  };

  const answer = (choice: ConflictChoice) => {
    conflict?.settle({ choice, all });
    setConflict(null);
    setAll(false);
  };

  const picked =
    (read: (files: File[]) => Promise<ImportSource>) =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";

      if (files.length > 0) void run(() => read(files));
    };

  return (
    <div className="flex flex-col gap-2">
      <Field orientation="responsive" className="min-h-9">
        <FieldTitle id="journal-import-label">
          {settingLabel("journal-import")}
        </FieldTitle>

        <SettingsSelect
          labelledBy="journal-import-label"
          triggerClassName="w-full @md:w-40"
          value={format}
          onValueChange={(value) => setFormat(value as ImportFormat)}
          action={
            <Button
              variant="outline"
              disabled={!loaded || progress !== null}
              onClick={() => inputs[format].current?.click()}
            >
              {t("journal.transfer.import")}
            </Button>
          }
        >
          <SelectItem value="zip">.zip</SelectItem>
          <SelectItem value="files">{t("journal.transfer.files")}</SelectItem>
          <SelectItem value="folder">{t("journal.transfer.folder")}</SelectItem>
        </SettingsSelect>
      </Field>

      <input
        ref={inputs.zip}
        type="file"
        accept=".zip,application/zip"
        hidden
        data-testid="import-zip"
        onChange={picked(([file]) => readZip(file))}
      />

      <input
        ref={inputs.files}
        type="file"
        accept=".md,.txt"
        multiple
        hidden
        data-testid="import-files"
        onChange={picked(readFiles)}
      />

      <input
        ref={inputs.folder}
        type="file"
        multiple
        hidden
        data-testid="import-folder"
        {...{ webkitdirectory: "" }}
        onChange={picked(readFiles)}
      />

      {(progress !== null || message || report) && (
        <div className="mt-3 mb-8 flex flex-col gap-1.5">
          {progress !== null && (
            <>
              <Progress
                value={progress}
                aria-label={settingLabel("journal-import")}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-start text-sm">
                  {t("journal.transfer.progress", {
                    percent: Math.round(progress),
                  })}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => controller.current?.abort()}
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}
          {message && (
            <p role="status" className="text-muted-foreground text-sm">
              {message}
            </p>
          )}
          {report && (
            <p
              role="status"
              className="text-muted-foreground flex items-center gap-2 text-sm"
            >
              {t("journal.transfer.done", {
                count: report.log.length - failed,
                failed,
              })}
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => setDetailsOpen(true)}
              >
                {t("journal.transfer.details")}
              </Button>
            </p>
          )}
        </div>
      )}
      {report && detailsOpen && (
        <ImportDetails report={report} onClose={() => setDetailsOpen(false)} />
      )}

      <AlertDialog open={conflict !== null}>
        <AlertDialogContent onEscapeKeyDown={() => answer("cancel")}>
          <AlertDialogTitle>
            {t("journal.transfer.conflictTitle")}
          </AlertDialogTitle>

          <AlertDialogDescription>
            {t("journal.transfer.conflictDescription", {
              path: conflict?.path,
            })}
          </AlertDialogDescription>

          <div className="flex items-center gap-2 my-2">
            <Checkbox
              id="import-all"
              checked={all}
              onCheckedChange={(checked) => setAll(checked === true)}
            />
            <Label htmlFor="import-all">
              {t("journal.transfer.applyToAll")}
            </Label>
          </div>

          <AlertDialogFooter>
            <div className="flex w-full justify-between">
              <Button variant="outline" onClick={() => answer("cancel")}>
                {t("common.cancel")}
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => answer("skip")}>
                  {t("journal.transfer.skip")}
                </Button>
                <Button variant="outline" onClick={() => answer("keep")}>
                  {t("journal.transfer.keepBoth")}
                </Button>
                <Button onClick={() => answer("replace")}>
                  {t("journal.transfer.replace")}
                </Button>
              </div>
            </div>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const items = useJournalItems();
  const { items: outline, sort } = useJournal();
  const targets = folderTargets(outline, sort);
  const folderRows = targets.flatMap(({ folder, depth }) =>
    folder ? [{ folder, depth }] : [],
  );
  const folderIds = new Set(folderRows.map(({ folder }) => folder.id));
  const [selected, setSelected] = useState(
    () => new Set<string | null>([null, ...folderIds]),
  );
  const allSelected = targets.every(({ folder }) =>
    selected.has(folder?.id ?? null),
  );

  const toggle = (ids: (string | null)[], checked: boolean) => {
    const next = new Set(selected);
    for (const id of ids) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    setSelected(next);
  };

  const download = async () => {
    await downloadBlob(
      new Blob([exportZip(items, selected)], { type: "application/zip" }),
      `aclife-journal-${DateTime.now().toISODate()}.zip`,
    );
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{t("journal.transfer.exportTitle")}</DialogTitle>
        </DialogHeader>

        <ScrollContainer className="flex max-h-72 flex-col rounded-md border p-1">
          <Label className="flex items-center gap-2 rounded px-2 py-1.5">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) =>
                toggle(
                  targets.map(({ folder }) => folder?.id ?? null),
                  checked === true,
                )
              }
            />
            {t("journal.transfer.all")}
          </Label>

          {folderRows.map(({ folder, depth }) => (
            <Label
              key={folder.id}
              className="flex items-center gap-2 rounded py-1.5 pe-2 [&_svg]:size-4"
              style={{ paddingInlineStart: `${depth * 12 - 4}px` }}
            >
              <Checkbox
                checked={selected.has(folder.id)}
                onCheckedChange={(checked) =>
                  toggle(
                    descendantIds(outline, folder.id).filter((id) =>
                      folderIds.has(id),
                    ),
                    checked === true,
                  )
                }
              />
              <FolderTargetLabel folder={folder} />
            </Label>
          ))}
        </ScrollContainer>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={selected.size === 0} onClick={download}>
            {t("journal.transfer.export")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExportField() {
  const { t } = useTranslation();
  const { loaded } = useJournal();
  const [open, setOpen] = useState(false);

  return (
    <Field orientation="responsive" className="min-h-9">
      <FieldTitle id="journal-export-label">
        {settingLabel("journal-export")}
      </FieldTitle>

      <Button
        variant="outline"
        aria-labelledby="journal-export-label"
        disabled={!loaded}
        onClick={() => setOpen(true)}
      >
        {t("journal.transfer.export")}
      </Button>

      {open && <ExportDialog onClose={() => setOpen(false)} />}
    </Field>
  );
}

export default function JournalImportExport() {
  return (
    <>
      <ImportField />
      <ExportField />
    </>
  );
}
