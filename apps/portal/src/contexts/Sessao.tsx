import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { emailDoDocumento } from "@/lib/acesso";
import type { ClienteSessao } from "@/lib/portal";

interface SessaoCtx {
  user: User | null;
  /** `null` com `user` = logado mas NÃO é cliente (ex.: alguém da equipe). */
  cliente: ClienteSessao | null;
  carregando: boolean;
  /** Senha gerada pela equipe: só entra depois de criar a própria. */
  senhaProvisoria: boolean;
  senhaCriada: () => void;
  entrar: (documento: string, senha: string) => Promise<string | null>;
  sair: () => Promise<void>;
}

const Ctx = createContext<SessaoCtx | undefined>(undefined);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [cliente, setCliente] = useState<ClienteSessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [senhaProvisoria, setSenhaProvisoria] = useState(false);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
      setUser(s?.user ?? null);
      if (!s?.user) { setCliente(null); setCarregando(false); return; }
      // Fora do callback: chamar o Supabase dentro dele pode travar o cliente.
      setTimeout(async () => {
        const { data, error } = await supabase.rpc("portal_eu");
        if (error) console.error("[portal] falha ao ler o cliente:", error.message);
        setCliente((data as ClienteSessao | null) ?? null);
        const prov = await supabase.rpc("q_senha_provisoria");
        if (prov.error) console.error("[portal] falha ao ler a senha provisória:", prov.error.message);
        setSenhaProvisoria(prov.data === true);
        setCarregando(false);
      }, 0);
    });
    supabase.auth.getSession().then(({ data: { session } }) => { if (!session) setCarregando(false); });
    return () => subscription.unsubscribe();
  }, []);

  const entrar = async (documento: string, senha: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: emailDoDocumento(documento), password: senha });
    if (!error) {
      // Registro do acesso (o administrador vê). Falha aqui não impede de entrar.
      supabase.rpc("q_registrar_acesso", { p_app: "portal" }).then(({ error: e }) => { if (e) console.warn("[portal] registro de acesso:", e.message); });
      return null;
    }
    const txt = `${(error as { code?: string }).code ?? ""} ${error.message}`;
    if (/invalid.*credentials/i.test(txt)) return "CPF/CNPJ ou senha incorretos.";
    if (/banned/i.test(txt)) return "Acesso bloqueado. Fale com o seu consultor.";
    return error.message;
  };

  const sair = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setCliente(null);
    setSenhaProvisoria(false);
  };

  return <Ctx.Provider value={{ user, cliente, carregando, entrar, sair, senhaProvisoria, senhaCriada: () => setSenhaProvisoria(false) }}>{children}</Ctx.Provider>;
}

export function useSessao() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSessao fora do SessaoProvider");
  return c;
}
