import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Linha de `public.perfis`: o perfil de quem trabalha na Quadrum.
 * GESTOR vê e opera tudo; COLABORADOR vê só a própria carteira — quem garante
 * isso é a RLS, a tela só acompanha.
 */
export interface Perfil {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cargo: string | null;
  avatar_url: string | null;
  papel: "admin" | "gestor" | "colaborador";
  ativo: boolean;
  departamento_id?: string | null;
  departamento_nome?: string | null;
}

export const PAPEL_LABEL: Record<Perfil["papel"], string> = {
  admin: "Administrador",
  gestor: "Gestor",
  colaborador: "Colaborador",
};

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /**
   * `null` = logado SEM ser da equipe. O login é o mesmo Supabase Auth do
   * portal do cliente, então um cliente com senha do portal consegue se
   * autenticar aqui — e é esta linha (com `ativo`) que o barra na porta.
   * A trava de verdade é a RLS; isto é só a porta da tela.
   */
  perfil: Perfil | null;
  /** Gestor ou administrador: vê e opera tudo. */
  isGestor: boolean;
  /** O administrador (criador do sistema): telas de administração. */
  isAdmin: boolean;
  /** A senha foi gerada por outra pessoa: só entra depois de criar a própria. */
  senhaProvisoria: boolean;
  senhaCriada: () => void;
  /** Relê o perfil depois de uma edição (ex.: Meu perfil). */
  recarregarPerfil: () => Promise<void>;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [senhaProvisoria, setSenhaProvisoria] = useState(false);
  const [isLoading, setLoading] = useState(true);

  const carregarPerfil = async (userId: string) => {
    const { data, error } = await supabase
      .from("perfis")
      .select("id, nome, email, telefone, cargo, avatar_url, papel, ativo")
      .eq("id", userId)
      .maybeSingle();
    // Falha de consulta NÃO vira "não é da equipe" calado: aparece no console.
    if (error) console.error("[auth] falha ao ler o perfil:", error.message);
    let p = (data as Perfil | null) ?? null;
    // Departamento à parte: se a coluna ainda não existir no banco, o perfil
    // continua entrando (só sem o departamento no topo).
    if (p) {
      const dep = await supabase.from("perfis").select("departamento_id, departamento:departamentos(nome)").eq("id", userId).maybeSingle();
      if (!dep.error && dep.data) {
        const d = dep.data as unknown as { departamento_id: string | null; departamento: { nome: string } | null };
        p = { ...p, departamento_id: d.departamento_id, departamento_nome: d.departamento?.nome ?? null };
      }
    }
    setPerfil(p);
    const prov = await supabase.rpc("q_senha_provisoria");
    if (prov.error) console.error("[auth] falha ao ler a senha provisória:", prov.error.message);
    setSenhaProvisoria(prov.data === true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Fora do callback: chamar o Supabase DENTRO do onAuthStateChange
        // pode travar o cliente (documentado pelo próprio supabase-js).
        setTimeout(async () => {
          await carregarPerfil(s.user.id);
          setLoading(false);
        }, 0);
      } else {
        setPerfil(null);
        setLoading(false);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!s) setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) {
      // Registro do acesso (Últimos acessos). Falha aqui não impede de entrar.
      supabase.rpc("q_registrar_acesso", { p_app: "admin" }).then(({ error: e }) => { if (e) console.warn("[auth] registro de acesso:", e.message); });
      return { error: null };
    }
    const codigo = (error as { code?: string }).code ?? "";
    const texto = `${codigo} ${error.message}`;
    if (/banned/i.test(texto)) return { error: new Error("Usuário bloqueado. Fale com um gestor.") };
    if (/invalid.*credentials/i.test(texto)) return { error: new Error("E-mail ou senha incorretos.") };
    return { error: new Error(error.message) };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setPerfil(null);
    setSenhaProvisoria(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        perfil,
        isGestor: perfil?.papel === "gestor" || perfil?.papel === "admin",
        isAdmin: perfil?.papel === "admin",
        senhaProvisoria,
        senhaCriada: () => setSenhaProvisoria(false),
        recarregarPerfil: async () => { if (user) await carregarPerfil(user.id); },
        isLoading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
