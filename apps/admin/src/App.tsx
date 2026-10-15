import { BrowserRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { PaginaNaoEncontrada } from "@/shell";
import Login from "@/pages/Login";
import Painel from "@/pages/Painel";
import EmConstrucao from "@/pages/EmConstrucao";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

// Telas do menu ainda não construídas — cada uma diz o que vai fazer.
const PENDENTES: { path: string; titulo: string; oQueFaz: string[] }[] = [
  {
    path: "/atendimentos",
    titulo: "Atendimentos",
    oQueFaz: [
      "Caixa de atendimentos abertos pelo cliente no Portal, separada por setor (Acordo, Cobrança, Monitoramento, Ouvidoria)",
      "Responder, ver mensagens não lidas e arquivar",
      "Atendimento arquivado fica só leitura, inclusive para o cliente",
    ],
  },
  {
    path: "/clientes",
    titulo: "Clientes",
    oQueFaz: [
      "Cadastro por CPF/CNPJ, com consultor e unidade",
      "Gerar e redefinir a senha de acesso ao Portal do Cliente",
    ],
  },
  {
    path: "/contratos",
    titulo: "Contratos",
    oQueFaz: [
      "Banco, linha de crédito, veículo/placa, consultor, unidade, data de aceite e cancelamento",
      "Histórico de ocorrências por departamento — o que o cliente lê na aba Histórico",
      "Registro urgente: não aparece na lista do cliente, gera o aviso de mensagem urgente",
    ],
  },
  {
    path: "/documentos",
    titulo: "Documentos para assinatura",
    oQueFaz: [
      "Pendências por contrato: termo, contrato, declaração e procuração (PF/PJ)",
      "Registro de quais já foram assinados",
    ],
  },
  { path: "/cadastros/bancos", titulo: "Bancos", oQueFaz: ["Bancos credores que aparecem nos contratos"] },
  { path: "/cadastros/linhas-de-credito", titulo: "Linhas de crédito", oQueFaz: ["Veicular, consignado, pessoal… — lista editável, sem deploy"] },
  { path: "/cadastros/unidades", titulo: "Unidades", oQueFaz: ["Unidades e parceiros (cidade, UF) exibidos no contrato"] },
  {
    path: "/cadastros/departamentos",
    titulo: "Departamentos e setores",
    oQueFaz: [
      "Departamentos que lançam histórico e setores que recebem atendimento",
      "Marcar quais departamentos geram aviso urgente ao cliente",
    ],
  },
  { path: "/cadastros/equipe", titulo: "Equipe", oQueFaz: ["Quem acessa o admin, papel (gestor/membro) e desativar sem apagar"] },
];

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Painel />} />
                {PENDENTES.map((p) => (
                  <Route key={p.path} path={p.path} element={<EmConstrucao titulo={p.titulo} oQueFaz={p.oQueFaz} />} />
                ))}
                <Route path="*" element={<PaginaNaoEncontrada />} />
              </Route>
            </Routes>
          </BrowserRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
