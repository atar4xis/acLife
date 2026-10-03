import type { ReactNode, RefObject } from "react";

export type SectionRefs = RefObject<Map<string, HTMLDivElement>>;

export default function Section({
  id,
  label,
  labelAddon,
  action,
  sectionRefs,
  children,
}: {
  id: string;
  label: string;
  labelAddon?: ReactNode;
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
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium text-muted-foreground">{label}</h3>
          {labelAddon}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
