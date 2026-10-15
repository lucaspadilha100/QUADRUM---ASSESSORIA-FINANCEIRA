import {
  LayoutDashboard, KanbanSquare, MessagesSquare, Users, FileText, PenLine,
  Landmark, CreditCard, Building2, Network, UserCog, FileSignature,
} from "lucide-react";
import type { ShellNavSection } from "@/shell";

// O menu é a lista de telas do admin. O título da guia sai DAQUI
// (`usePaginaAtual`): tela nova que entra no menu ganha título sozinha.
export const MENU: ShellNavSection[] = [
  {
    items: [
      { to: "/", label: "Painel", icon: LayoutDashboard, end: true },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
    ],
  },
  {
    label: "Atendimento",
    items: [{ to: "/atendimentos", label: "Atendimentos", icon: MessagesSquare }],
  },
  {
    label: "Carteira",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users },
      { to: "/contratos", label: "Contratos", icon: FileText },
      { to: "/documentos", label: "Documentos p/ assinar", icon: PenLine },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { to: "/cadastros/bancos", label: "Bancos", icon: Landmark },
      { to: "/cadastros/linhas-de-credito", label: "Linhas de crédito", icon: CreditCard },
      { to: "/cadastros/unidades", label: "Unidades", icon: Building2 },
      { to: "/cadastros/modelos", label: "Modelos de documento", icon: FileSignature },
      { to: "/cadastros/departamentos", label: "Departamentos e setores", icon: Network },
      { to: "/cadastros/usuarios", label: "Usuários", icon: UserCog },
    ],
  },
];
