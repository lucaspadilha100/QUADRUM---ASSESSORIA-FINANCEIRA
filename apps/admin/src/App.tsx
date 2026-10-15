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
import MeuPerfil from "@/pages/MeuPerfil";
import Pipeline from "@/pages/Pipeline";
import Clientes from "@/pages/Clientes";
import Contratos from "@/pages/Contratos";
import Atendimentos from "@/pages/Atendimentos";
import Documentos from "@/pages/Documentos";
import Departamentos from "@/pages/cadastros/Departamentos";
import Usuarios from "@/pages/cadastros/Usuarios";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

// Telas do menu ainda não construídas — cada uma diz o que vai fazer.
const PENDENTES: { path: string; titulo: string; oQueFaz: string[] }[] = [
  { path: "/cadastros/bancos", titulo: "Bancos", oQueFaz: ["Bancos credores que aparecem nos contratos"] },
  { path: "/cadastros/linhas-de-credito", titulo: "Linhas de crédito", oQueFaz: ["Veicular, consignado, pessoal… — lista editável, sem deploy"] },
  { path: "/cadastros/unidades", titulo: "Unidades", oQueFaz: ["Unidades e parceiros (cidade, UF) exibidos no contrato"] },
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
                <Route path="/perfil" element={<MeuPerfil />} />
                <Route path="/pipeline" element={<Pipeline />} />
                <Route path="/clientes" element={<Clientes />} />
                <Route path="/contratos" element={<Contratos />} />
                <Route path="/atendimentos" element={<Atendimentos />} />
                <Route path="/documentos" element={<Documentos />} />
                <Route path="/cadastros/departamentos" element={<Departamentos />} />
                <Route path="/cadastros/usuarios" element={<Usuarios />} />
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
