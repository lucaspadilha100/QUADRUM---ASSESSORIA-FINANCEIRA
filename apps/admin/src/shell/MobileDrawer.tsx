import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { Lock, X } from "lucide-react";
import { cn } from "./cn";
import type { ShellBrand, ShellNavItem, ShellNavSection } from "./types";

interface MobileDrawerProps {
  brand: ShellBrand;
  sections: ShellNavSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
  /** Disponível em qualquer largura (modo imersivo), não só no mobile. */
  fullWidth?: boolean;
}

/** Renders a single nav item (and its sub-items) in the full/expanded style. */
function DrawerItem({
  item,
  onNavigate,
  depth = 0,
}: {
  item: ShellNavItem;
  onNavigate: () => void;
  depth?: number;
}) {
  const Icon = item.icon;

  if (item.locked) {
    return (
      <div
        title={item.lockedHint}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium",
          "cursor-not-allowed text-muted-foreground/50",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate">{item.label}</span>
        <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" />
      </div>
    );
  }

  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            isActive
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge != null && (
              <span className="ml-auto shrink-0">{item.badge}</span>
            )}
          </>
        )}
      </NavLink>

      {item.sub && item.sub.length > 0 && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-1">
          {item.sub.map((s) => (
            <DrawerItem
              key={s.to + s.label}
              item={s}
              onNavigate={onNavigate}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </>
  );
}

function DrawerSection({
  section,
  onNavigate,
}: {
  section: ShellNavSection;
  onNavigate: () => void;
}) {
  const SectionIcon = section.icon;

  const header = section.label && (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 pb-1 pt-3",
        "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70",
        section.locked && "opacity-50",
      )}
      title={section.locked ? section.lockedHint : undefined}
    >
      {SectionIcon && <SectionIcon className="h-3 w-3" />}
      <span className="truncate">{section.label}</span>
      {section.locked && <Lock className="ml-auto h-3 w-3" />}
    </div>
  );

  return (
    <div className={cn(section.locked && "pointer-events-none opacity-60")}>
      {header}
      <div className="space-y-0.5">
        {section.items.map((item) => (
          <DrawerItem
            key={item.to + item.label}
            item={item}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

export function MobileDrawer({
  brand,
  sections,
  open,
  onOpenChange,
  footer,
  fullWidth,
}: MobileDrawerProps) {
  // Lock body scroll + Escape to close while open (guard document for SSR).
  useEffect(() => {
    if (!open) return;
    if (typeof document === "undefined") return;

    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const closeOnNavigate = () => onOpenChange(false);

  return (
    <div className={cn("fixed inset-0 z-50", !fullWidth && "md:hidden")} role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-300"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />

      {/* Panel */}
      <aside
        className={cn(
          "absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] flex-col",
          "q-escuro border-r border-border bg-card shadow-xl",
          "animate-in slide-in-from-left duration-300 ease-out",
        )}
      >
        {/* Brand header (no collapse toggle on mobile) */}
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border pl-4 pr-2">
          {brand.href ? (
            <a
              href={brand.href}
              onClick={() => onOpenChange(false)}
              className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left"
            >
              <img
                src={brand.logoSrc}
                alt={brand.appName}
                className="h-7 w-auto shrink-0"
              />
              <span className="truncate text-sm font-bold text-foreground">
                {brand.appName}
              </span>
            </a>
          ) : (
            <button
              type="button"
              onClick={() => {
                brand.onLogoClick?.();
                onOpenChange(false);
              }}
              className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left"
            >
              <img
                src={brand.logoSrc}
                alt={brand.appName}
                className="h-7 w-auto shrink-0"
              />
              <span className="truncate text-sm font-bold text-foreground">
                {brand.appName}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar menu"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
          {sections.map((section, i) => (
            <DrawerSection
              key={section.label ?? `section-${i}`}
              section={section}
              onNavigate={closeOnNavigate}
            />
          ))}
        </nav>

        {footer && (
          <div className="shrink-0 border-t border-border p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </aside>
    </div>
  );
}

export default MobileDrawer;
