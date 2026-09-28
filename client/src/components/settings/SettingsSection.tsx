import type { ReactNode, RefObject } from "react";

export type SectionRefs = RefObject<Map<string, HTMLDivElement>>;

export default function Section({
  id,
  label,
  action,
  sectionRefs,
  children,
}: {
  id: string;
  label: string;
  action?: ReactNode;
  sectionRefs: SectionRefs;
  children: ReactNode;
}) {
  return (
    <div
      ref={(el) => {
        if (el) sectionRefs.current.set(id, el);
        else sectionRefs.current.delete(id);
      }}
      className="flex flex-col gap-4 scroll-mt-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
