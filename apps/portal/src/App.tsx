import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessaoProvider } from "@/contexts/Sessao";
import { Layout } from "@/components/Layout";
import { Toaster } from "@/components/ui/sonner";
import Login from "@/pages/Login";
import Contratos from "@/pages/Contratos";
import Chat from "@/pages/Chat";
import Documento from "@/pages/Documento";
import Senha from "@/pages/Senha";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});

function NaoEncontrada() {
  return (
    <div className="py-16 text-center">
      <p className="text-5xl font-bold text-muted-foreground/40">404</p>
      <p className="mt-2 text-sm text-muted-foreground">Esta página não existe.</p>
      <Link to="/contratos" className="q-link mt-4 inline-block text-sm">Ir para Meus Contratos</Link>
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessaoProvider>
        <BrowserRouter basename="/portal">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/contratos" replace />} />
              <Route path="/contratos" element={<Contratos />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/senha" element={<Senha />} />
              <Route path="/chat/arquivado/:id" element={<Chat />} />
              <Route path="/documento/:id" element={<Documento />} />
              <Route path="*" element={<NaoEncontrada />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </SessaoProvider>
    </QueryClientProvider>
  );
}
