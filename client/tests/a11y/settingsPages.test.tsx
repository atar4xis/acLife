import { render } from "@testing-library/react";
import { useRef } from "react";
import { beforeEach, describe, it, vi } from "vitest";
import { expectNoViolations } from "./axe.ts";

const userMock = vi.hoisted(() => ({
  user: {
    type: "online",
    uuid: "u1",
    email: "a@b.c",
    envelopes: [],
  } as unknown,
  masterKey: null as unknown,
  bucketKey: null as unknown,
  checkLogin: vi.fn(),
}));

const storageMock = vi.hoisted(() => ({
  ready: true,
  get: (key: string) => (key === "unlockMethod" ? "password" : undefined),
  set: vi.fn(),
}));

vi.mock("../../src/context/StorageContext.tsx", () => ({
  useStorage: () => storageMock,
}));

vi.mock("../../src/lib/crypt.ts", () => ({}));
vi.mock("../../src/lib/unlockAccount.ts", () => ({}));

vi.mock("../../src/context/UserContext.tsx", () => ({
  useUser: () => userMock,
}));

vi.mock("../../src/hooks/usePushService.ts", () => ({
  usePushService: () => ({
    supported: true,
    enabled: false,
    enable: vi.fn(),
    disable: vi.fn(),
  }),
}));

vi.mock("../../src/context/ApiContext.tsx", () => ({
  useApi: () => ({
    get: vi.fn().mockResolvedValue({ data: [] }),
    post: vi.fn(),
    del: vi.fn(),
    serverMeta: null,
  }),
}));

import AppearancePage from "../../src/components/settings/pages/AppearancePage.tsx";
import CalendarPage from "../../src/components/settings/pages/CalendarPage.tsx";
import SecurityPage from "../../src/components/settings/pages/SecurityPage.tsx";
import SyncPage from "../../src/components/settings/pages/SyncPage.tsx";
import { ThemeProvider } from "../../src/components/ThemeProvider.tsx";
import { SecuritySettingsProvider } from "../../src/context/SecuritySettingsContext.tsx";
import { CalendarProvider } from "../../src/context/CalendarContext.tsx";
import { SettingsStoreProvider } from "../../src/context/SettingsStoreContext.tsx";
import type { SectionRefs } from "../../src/components/settings/SettingsSection.tsx";

type Page = React.ComponentType<{ sectionRefs: SectionRefs }>;

function Harness({ Page }: { Page: Page }) {
  const sectionRefs: SectionRefs = useRef(new Map());
  return <Page sectionRefs={sectionRefs} />;
}

const renderPage = (Page: Page) =>
  render(
    <SettingsStoreProvider>
      <ThemeProvider>
        <SecuritySettingsProvider>
          <CalendarProvider>
            <Harness Page={Page} />
          </CalendarProvider>
        </SecuritySettingsProvider>
      </ThemeProvider>
    </SettingsStoreProvider>,
  );

describe("settings pages a11y", () => {
  beforeEach(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.scrollIntoView = () => {};
  });

  it.each([
    ["Appearance", AppearancePage],
    ["Calendar", CalendarPage],
    ["Sync", SyncPage],
    ["Security", SecurityPage],
  ])("%s page has no axe violations", async (_name, Page) => {
    const { container } = renderPage(Page);
    await expectNoViolations(container);
  });
});
