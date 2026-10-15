// Casca da aplicação (menu, título da página, diálogos que fecham com o Voltar).
// Portada de carbohub-gestao/packages/shell — só o que o Quadrum usa.
export { Sidebar } from "./Sidebar";
export { MobileDrawer } from "./MobileDrawer";
export { cn } from "./cn";
export { usePaginaAtual, PaginaNaoEncontrada, tituloDaRota } from "./pagina";
export { useParamUrl } from "./urlState";
export { useVoltarFecha, FecharComVoltar } from "./voltarFecha";
export { confirmar, pedirTexto } from "./confirmar";
export type { ShellNavItem, ShellNavSection, ShellBrand, SidebarProps } from "./types";
