import { useCallback, useEffect, useRef, useState } from "react";
import { Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FADE_DELAY_MS = 3000;

export default function UndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { t } = useTranslation();
  const [faded, setFaded] = useState(false);
  const timerRef = useRef<number | null>(null);
  const visible = canUndo || canRedo;

  const wake = useCallback(() => {
    setFaded(false);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setFaded(true), FADE_DELAY_MS);
  }, []);

  useEffect(() => {
    if (visible) wake();
  }, [visible, canUndo, canRedo, wake]);

  useEffect(() => {
    if (!visible) return;
    document.documentElement.toggleAttribute("data-has-undo-buttons", true);
    return () => {
      document.documentElement.toggleAttribute("data-has-undo-buttons", false);
    };
  }, [visible]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  if (!visible) return null;

  return (
    <div
      onPointerDown={wake}
      onPointerUp={wake}
      className={cn(
        "fixed bottom-4 inset-e-4 z-10 flex gap-2",
        faded ? "opacity-80" : "opacity-100",
      )}
    >
      <Button
        variant="secondary"
        size="icon-lg"
        className="rounded-full shadow-md"
        disabled={!canUndo}
        onClick={onUndo}
        aria-label={t("common.undo")}
      >
        <Undo2 />
      </Button>
      <Button
        variant="secondary"
        size="icon-lg"
        className="rounded-full shadow-md"
        disabled={!canRedo}
        onClick={onRedo}
        aria-label={t("common.redo")}
      >
        <Redo2 />
      </Button>
    </div>
  );
}
