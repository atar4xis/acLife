import type { EditorView } from "@codemirror/view";
import { Ellipsis, Heading } from "lucide-react";
import {
  type RefObject,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  primaryActions,
  secondaryActions,
} from "@/components/journal/formatActions";
import { Button } from "@/components/ui/button";
import { disabledFormats } from "@/lib/journal/activeFormats";
import { formatCommands, HEADING_LEVELS } from "@/lib/journal/formatKeymap";

export type ToolbarState = {
  center: number;
  top: number;
  bottom: number;
  formats: string[];
};

const GAP = 8;
const EDGE_PADDING = 8;

export default function FormatToolbar({
  viewRef,
  toolbar,
}: {
  viewRef: RefObject<EditorView | null>;
  toolbar: ToolbarState;
}) {
  const { t } = useTranslation();
  const disabled = disabledFormats(toolbar.formats);
  const [showMore, setShowMore] = useState(false);
  const [showHeadings, setShowHeadings] = useState(false);
  const [position, setPosition] = useState({
    left: toolbar.center,
    top: toolbar.bottom + GAP,
  });
  const container = useRef<HTMLDivElement>(null);

  const positionToolbar = useEffectEvent(() => {
    const { offsetHeight, offsetWidth } = container.current!;
    const wrapperRect =
      container.current!.parentElement!.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;

    const centeredLeft = wrapperRect.left + toolbar.center - offsetWidth / 2;
    const left =
      Math.max(
        EDGE_PADDING,
        Math.min(centeredLeft, viewportWidth - offsetWidth - EDGE_PADDING),
      ) - wrapperRect.left;

    const below = toolbar.bottom + GAP;
    if (wrapperRect.top + below + offsetHeight <= viewportHeight)
      return setPosition({ left, top: below });

    const above = toolbar.top - GAP - offsetHeight;
    if (wrapperRect.top + above >= 0) return setPosition({ left, top: above });

    setPosition({
      left,
      top: viewportHeight - wrapperRect.top - offsetHeight - GAP,
    });
  });

  useLayoutEffect(
    () => positionToolbar(),
    [toolbar.center, toolbar.top, toolbar.bottom, showMore, showHeadings],
  );

  useEffect(() => {
    const onViewportChange = () => positionToolbar();
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, []);

  const actionButtons = (actions: typeof primaryActions) =>
    actions.map(({ label, icon: Icon, command }) => (
      <Button
        key={label}
        variant={toolbar.formats.includes(label) ? "secondary" : "ghost"}
        size="icon"
        aria-label={t(`journal.format.${label}`)}
        aria-pressed={toolbar.formats.includes(label)}
        disabled={disabled.includes(label)}
        onClick={() => command(viewRef.current!)}
      >
        <Icon />
      </Button>
    ));

  return (
    <div
      ref={container}
      style={position}
      role="toolbar"
      aria-label={t("journal.format.toolbar")}
      className="bg-popover absolute z-10 flex max-w-[calc(100vw-1rem)] flex-col rounded-md border p-1 shadow-md"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center">
        {actionButtons(primaryActions)}
        <Button
          variant={showMore ? "secondary" : "ghost"}
          size="icon"
          aria-label={t("journal.more")}
          aria-expanded={showMore}
          onClick={() => setShowMore(!showMore)}
        >
          <Ellipsis />
        </Button>
      </div>
      {showMore && (
        <div className="flex items-center">
          <Button
            variant={
              showHeadings ||
              toolbar.formats.some((format) => format.startsWith("heading"))
                ? "secondary"
                : "ghost"
            }
            size="icon"
            aria-label={t("journal.format.heading")}
            aria-expanded={showHeadings}
            onClick={() => setShowHeadings(!showHeadings)}
          >
            <Heading />
          </Button>
          {actionButtons(secondaryActions)}
        </div>
      )}
      {showMore && showHeadings && (
        <div className="flex flex-col">
          {HEADING_LEVELS.map((level) => (
            <Button
              key={level}
              variant={
                toolbar.formats.includes(`heading${level}`)
                  ? "secondary"
                  : "ghost"
              }
              className="justify-start"
              onClick={() => formatCommands.heading(level)(viewRef.current!)}
            >
              {t("journal.format.headingLevel", { level })}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
