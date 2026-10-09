import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field";
import { SelectItem } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/context/ApiContext";
import { useCalendarSettings } from "@/context/CalendarSettingsContext";
import { useUpdater } from "@/context/UpdaterContext";
import { fmt } from "@/i18n";
import { cn } from "@/lib/utils";
import { isTauri, restartApp } from "@/lib/nativeUpdater";
import { REPO_URL } from "@/lib/updates";
import { sectionLabel, settingLabel, settingLabelId } from "../settingsData";
import type { SectionRefs } from "../SettingsSection";
import Section from "../SettingsSection";
import SettingsLabel from "../SettingsLabel";
import SettingsSelect from "../SettingsSelect";

const GithubMark = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    aria-hidden="true"
    className="size-7"
  >
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const VERSION = (
  <>
    {__APP_VERSION__}
    {__BUILD_NUMBER__ && (
      <span className="ms-1 text-xs">(build {__BUILD_NUMBER__})</span>
    )}
  </>
);

export default function ApplicationPage({
  sectionRefs,
}: {
  sectionRefs: SectionRefs;
}) {
  const { t } = useTranslation();
  const updater = useUpdater();
  const settings = useCalendarSettings();
  const { url: serverUrl } = useApi();
  const clientUrl = window.location.origin + import.meta.env.BASE_URL;

  const format = (date: DateTime, key: string) => date.toFormat(fmt(key));

  const status = t(`settings.updates.status.${updater.status}`, {
    version: updater.latest?.version,
  });

  return (
    <FieldGroup className="gap-8">
      <h2 className="text-lg font-semibold">
        {t("settings.categories.application")}
      </h2>

      <Section
        id="updates"
        label={sectionLabel("updates")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="responsive">
          <FieldContent>
            <div className="flex items-center gap-2">
              <FieldTitle>{settingLabel("updates-version")}</FieldTitle>
              {updater.status !== "idle" && (
                <span
                  className={cn(
                    "text-sm",
                    updater.status === "upToDate" && "text-success",
                    updater.status === "available" && "text-warning",
                  )}
                >
                  {status}
                </span>
              )}
            </div>
            <FieldDescription>{VERSION}</FieldDescription>
          </FieldContent>
          {updater.status === "available" && updater.canInstall && (
            <Button variant="outline" onClick={updater.install}>
              {t("settings.updates.install")}
            </Button>
          )}
          {updater.status === "available" && !updater.canInstall && (
            <Button variant="outline" asChild>
              <a href={updater.latest?.url} target="_blank" rel="noreferrer">
                {t("settings.updates.download")}
              </a>
            </Button>
          )}
          {updater.status === "ready" && (
            <Button variant="outline" onClick={restartApp}>
              {t("settings.updates.restart")}
            </Button>
          )}
        </Field>

        <Field orientation="responsive">
          <SettingsLabel settingKey="autoCheckUpdates" />
          <Switch
            aria-labelledby={settingLabelId("autoCheckUpdates")}
            checked={settings.autoCheckUpdates}
            onCheckedChange={(checked) =>
              settings.setSetting("autoCheckUpdates", checked)
            }
          />
        </Field>

        {isTauri && (
          <Field orientation="responsive">
            <SettingsLabel settingKey="autoInstallUpdates" />
            <Switch
              aria-labelledby={settingLabelId("autoInstallUpdates")}
              checked={settings.autoInstallUpdates}
              onCheckedChange={(checked) =>
                settings.setSetting("autoInstallUpdates", checked)
              }
            />
          </Field>
        )}

        <Field orientation="responsive">
          <FieldContent>
            <FieldTitle>{settingLabel("updates-check")}</FieldTitle>
            {updater.lastChecked && (
              <FieldDescription className="text-xs">
                {t("settings.updates.lastChecked", {
                  date: format(
                    DateTime.fromMillis(updater.lastChecked),
                    "dateTimeLong",
                  ),
                })}
              </FieldDescription>
            )}
          </FieldContent>
          <Button
            variant="outline"
            disabled={["checking", "downloading", "ready"].includes(
              updater.status,
            )}
            onClick={updater.check}
          >
            {t("settings.updates.check")}
          </Button>
        </Field>

        {isTauri && (
          <Field orientation="responsive">
            <SettingsLabel settingKey="updateChannel" />
            <SettingsSelect
              labelledBy={settingLabelId("updateChannel")}
              value={settings.updateChannel}
              onValueChange={(channel) =>
                settings.setSetting(
                  "updateChannel",
                  channel as typeof settings.updateChannel,
                )
              }
            >
              <SelectItem value="stable">
                {t("settings.updates.channelStable")}
              </SelectItem>
              <SelectItem value="beta">
                {t("settings.updates.channelBeta")}
              </SelectItem>
            </SettingsSelect>
          </Field>
        )}

        <div className="flex flex-col gap-3">
          <FieldTitle>{settingLabel("updates-changelog")}</FieldTitle>
          <div className="flex max-h-64 flex-col gap-3 overflow-y-auto rounded-lg border p-3">
            {updater.changelog.length === 0 && (
              <FieldDescription>
                {t("settings.updates.noChanges")}
              </FieldDescription>
            )}
            {updater.changelog.map(({ release, commits }) => (
              <div key={release.tag} className="flex flex-col gap-1">
                <a
                  href={release.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium hover:underline"
                >
                  {release.version}
                  <span className="ms-2 font-normal text-muted-foreground">
                    {format(DateTime.fromISO(release.date), "date")}
                  </span>
                </a>
                <ul className="list-disc ps-5 text-sm text-muted-foreground">
                  {commits.map((message, i) => (
                    <li key={i}>{message}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Separator />

      <Section
        id="about"
        label={sectionLabel("about")}
        sectionRefs={sectionRefs}
      >
        <Field orientation="horizontal">
          <div className="flex flex-auto items-center gap-2">
            <img
              src={`${import.meta.env.BASE_URL}app-icon.png`}
              alt=""
              className="size-8"
            />
            <span className="font-medium">acLife</span>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label={t("settings.about.repository")}
            className="flex size-11 items-center justify-center opacity-80 hover:opacity-100"
          >
            <GithubMark />
          </a>
        </Field>

        <Field orientation="responsive">
          <FieldTitle>{settingLabel("about-version")}</FieldTitle>
          <span className="text-sm">{VERSION}</span>
        </Field>

        {!isTauri && (
          <Field orientation="responsive">
            <FieldTitle>{settingLabel("about-website")}</FieldTitle>
            <a href={clientUrl} className="text-sm hover:underline">
              {clientUrl}
            </a>
          </Field>
        )}

        <Field orientation="responsive">
          <FieldTitle>{settingLabel("about-server")}</FieldTitle>
          <span className="text-sm">{serverUrl}</span>
        </Field>
      </Section>
    </FieldGroup>
  );
}
