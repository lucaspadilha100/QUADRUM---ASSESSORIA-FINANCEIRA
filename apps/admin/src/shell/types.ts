import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface ShellNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** exact-match active (passed to NavLink `end`) */
  end?: boolean;
  /** trailing slot (e.g. unread count) — hidden in collapsed rail */
  badge?: ReactNode;
  /** non-clickable, lock icon, muted */
  locked?: boolean;
  /** title tooltip when locked */
  lockedHint?: string;
  /** nested sub-items (indented, thinner) */
  sub?: ShellNavItem[];
}

export interface ShellNavSection {
  /** uppercase section header; omit => ungrouped top items */
  label?: string;
  /** optional small icon before section label */
  icon?: LucideIcon;
  items: ShellNavItem[];
  /** section body can collapse/expand (chevron) */
  collapsible?: boolean;
  /** for collapsible sections */
  defaultOpen?: boolean;
  /** whole section locked/muted */
  locked?: boolean;
  lockedHint?: string;
}

export interface ShellBrand {
  appName: string;
  logoSrc: string;
  /** e.g. go to Hub */
  onLogoClick?: () => void;
  /**
   * Endereço do logo (ex.: o Hub). Com ele o logo vira LINK de verdade e abre
   * em nova guia (botão do meio, Ctrl+clique). Vence o `onLogoClick`.
   */
  href?: string;
}

export interface SidebarProps {
  brand: ShellBrand;
  sections: ShellNavSection[];
  /** desktop mini-rail on/off (app-owned state) */
  collapsed: boolean;
  /** clicking the rail toggle */
  onToggleCollapse: () => void;
  /** mobile drawer open (app-owned state) */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  /** optional footer (user card etc.) */
  footer?: ReactNode;
  /**
   * Modo imersivo (ex.: tela do Carbo Chat): NÃO ocupa espaço em nenhuma
   * largura — a rail de desktop some e a navegação vira uma gaveta sobreposta
   * (aberta pelo botão do topo) em qualquer tamanho de tela.
   */
  immersive?: boolean;
}
