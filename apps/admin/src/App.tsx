import { lazy, Suspense } from "react";
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
const MeuPerfil = lazy(() => import("@/pages/MeuPerfil"));
const Pipeline = lazy(() => import("@/pages/Pipeline"));
const Clientes = lazy(() => import("@/pages/Clientes"));
const Contratos = lazy(() => import("@/pages/Contratos"));
const Atendimentos = lazy(() => import("@/pages/Atendimentos"));
const Documentos = lazy(() => import("@/pages/Documentos"));
const Departamentos = lazy(() => import("@/pages/cadastros/Departamentos"));
const Usuarios = lazy(() => import("@/pages/cadastros/Usuarios"));
const Modelos = lazy(() => import("@/pages/cadastros/Modelos"));
const Bancos = lazy(() => import("@/pages/cadastros/Bancos"));
const LinhasCredito = lazy(() => import("@/pages/cadastros/LinhasCredito"));
const Unidades = lazy(() => import("@/pages/cadastros/Unidades"));
const DocumentoVer = lazy(() => import("@/pages/DocumentoVer"));
const DocumentoImprimir = lazy(() => import("@/pages/DocumentoImprimir"));

// Cada tela é baixada quando é aberta (code splitting): o primeiro acesso não
// carrega o app inteiro. O <Suspense> mora no Layout, em volta do <Outlet>,
// para o menu continuar na tela enquanto a página chega.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});


export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              {/* A folha de impressão fica FORA do layout: só o documento. */}
              <Route path="/documentos/:id/imprimir" element={<ProtectedRoute><Suspense fallback={null}><DocumentoImprimir /></Suspense></ProtectedRoute>} />
              <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                <Route index element={<Painel />} />
                <Route path="/perfil" element={<MeuPerfil />} />
                <Route path="/pipeline" element={<Pipeline />} />
                <Route path="/clientes" element={<Clientes />} />
                <Route path="/contratos" element={<Contratos />} />
                <Route path="/atendimentos" element={<Atendimentos />} />
                <Route path="/documentos" element={<Documentos />} />
                <Route path="/documentos/:id" element={<DocumentoVer />} />
                <Route path="/cadastros/departamentos" element={<Departamentos />} />
                <Route path="/cadastros/usuarios" element={<Usuarios />} />
                <Route path="/cadastros/modelos" element={<Modelos />} />
                <Route path="/cadastros/bancos" element={<Bancos />} />
                <Route path="/cadastros/linhas-de-credito" element={<LinhasCredito />} />
                <Route path="/cadastros/unidades" element={<Unidades />} />
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
