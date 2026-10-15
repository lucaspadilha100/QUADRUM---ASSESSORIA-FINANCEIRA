import { useState } from "react";
import { NavLink } from "react-router-dom";
import {
  ChevronDown,
  Lock,
  PanelLeft,
  PanelLeftClose,
} from "lucide-react";
import { cn } from "./cn";
import { MobileDrawer } from "./MobileDrawer";
import type { ShellNavItem, ShellNavSection, SidebarProps } from "./types";

/* ------------------------------------------------------------------ */
/* Nav item                                                            */
/* ------------------------------------------------------------------ */

function NavItem({
  item,
  collapsed,
  depth = 0,
}: {
  item: ShellNavItem;
  collapsed: boolean;
  depth?: number;
}) {
  const Icon = item.icon;

  // Locked → non-clickable div
  if (item.locked) {
    return (
      <div
        title={item.lockedHint ?? item.label}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium",
          "cursor-not-allowed text-muted-foreground/50",
          collapsed
            ? "h-9 w-9 justify-center"
            : "gap-2.5 px-3 py-2",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <NavLink
        to={item.to}
        end={item.end}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          cn(
            "group relative flex items-center rounded-lg text-sm font-medium transition-colors",
            collapsed ? "h-9 w-9 justify-center" : "gap-2.5 px-3 py-2",
            isActive
              ? "bg-primary font-semibold text-primary-foreground"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge != null && (
                  <span className="ml-auto shrink-0">{item.badge}</span>
                )}
              </>
            )}
          </>
        )}
      </NavLink>

      {/* Sub-items — only when expanded */}
      {!collapsed && item.sub && item.sub.length > 0 && (
        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-border pl-1">
          {item.sub.map((s) => (
            <NavItem
              key={s.to + s.label}
              item={s}
              collapsed={collapsed}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Section                                                             */
/* ------------------------------------------------------------------ */

function NavSection({
  section,
  collapsed,
}: {
  section: ShellNavSection;
  collapsed: boolean;
}) {
  const [open, setOpen] = useState(section.defaultOpen ?? true);
  const SectionIcon = section.icon;
  const isCollapsible = !!section.collapsible;

  // Collapsed rail: flatten to icon rows, grouped by a thin divider.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-0.5 border-t border-border/60 py-1 first:border-t-0">
        {section.items.map((item) => (
          <NavItem
            key={item.to + item.label}
            item={item}
            collapsed
          />
        ))}
      </div>
    );
  }

  const bodyVisible = !isCollapsible || open;

  const header = section.label && (
    isCollapsible ? (
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={section.locked}
        title={section.locked ? section.lockedHint : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 pb-1 pt-3",
          "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70",
          "transition-colors hover:text-muted-foreground",
          section.locked && "cursor-not-allowed opacity-50 hover:text-muted-foreground/70",
        )}
      >
        {SectionIcon && <SectionIcon className="h-3 w-3" />}
        <span className="truncate">{section.label}</span>
        {section.locked ? (
          <Lock className="ml-auto h-3 w-3" />
        ) : (
          <ChevronDown
            className={cn(
              "ml-auto h-3.5 w-3.5 transition-transform duration-200",
              open ? "rotate-0" : "-rotate-90",
            )}
          />
        )}
      </button>
    ) : (
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
    )
  );

  return (
    <div className={cn(section.locked && "pointer-events-none opacity-60")}>
      {header}
      <div
        className={cn(
          "space-y-0.5 overflow-hidden transition-all duration-300 ease-suave",
          bodyVisible ? "max-h-[2000px] opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {section.items.map((item) => (
          <NavItem key={item.to + item.label} item={item} collapsed={false} />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                             */
/* ------------------------------------------------------------------ */

export function Sidebar({
  brand,
  sections,
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onMobileOpenChange,
  footer,
  immersive,
}: SidebarProps) {
  return (
    <>
      {/* ---------------- Desktop aside ----------------
          Em modo imersivo (ex.: chat) a rail NÃO é renderizada em
          nenhuma largura — o conteúdo ocupa a tela toda e a navegação fica
          disponível pela gaveta sobreposta (abaixo). */}
      {!immersive && (
      <aside
        className={cn(
          "hidden h-full min-h-0 shrink-0 flex-col border-r border-border bg-card md:flex q-escuro",
          // Abre/fecha com curva suave e mais lenta (sensação natural, não "seco").
          "transition-[width] duration-300 ease-suave",
          collapsed ? "w-[68px]" : "w-64",
        )}
      >
        {/* Brand header */}
        <div
          className={cn(
            "flex h-14 shrink-0 items-center border-b border-border",
            collapsed ? "flex-col justify-center gap-1 px-0" : "gap-2.5 px-4",
          )}
        >
          {(() => {
            const cls = cn(
              "flex items-center overflow-hidden text-left",
              collapsed ? "justify-center" : "flex-1 gap-2.5",
            );
            const miolo = (
              <>
                <img
                  src={brand.logoSrc}
                  alt={brand.appName}
                  className="h-7 w-auto shrink-0"
                />
                {!collapsed && (
                  <span className="truncate text-sm font-bold text-foreground">
                    {brand.appName}
                  </span>
                )}
              </>
            );
            // Link de verdade quando há endereço: abre em nova guia.
            return brand.href ? (
              <a href={brand.href} title={brand.appName} className={cls}>{miolo}</a>
            ) : (
              <button type="button" onClick={brand.onLogoClick} title={brand.appName} className={cls}>
                {miolo}
              </button>
            );
          })()}

          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>

        {/* Nav */}
        <nav
          className={cn(
            "flex-1 space-y-1 overflow-y-auto overflow-x-hidden py-3",
            collapsed ? "px-2.5" : "px-3",
          )}
        >
          {sections.map((section, i) => (
            <NavSection
              key={section.label ?? `section-${i}`}
              section={section}
              collapsed={collapsed}
            />
          ))}
        </nav>

        {/* Footer */}
        {footer && (
          <div
            className={cn(
              "shrink-0 border-t border-border",
              collapsed ? "flex justify-center p-2" : "p-3",
            )}
          >
            {footer}
          </div>
        )}
      </aside>
      )}

      {/* ---------------- Gaveta sobreposta ----------------
          Sempre disponível no mobile; e em qualquer largura quando imersivo. */}
      <MobileDrawer
        brand={brand}
        sections={sections}
        open={mobileOpen}
        onOpenChange={onMobileOpenChange}
        footer={footer}
        fullWidth={immersive}
      />
    </>
  );
}

export default Sidebar;
