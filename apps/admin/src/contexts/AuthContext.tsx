import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/** Linha de `public.equipe`: quem trabalha na Quadrum. */
export interface MembroEquipe {
  id: string;
  nome: string;
  email: string | null;
  papel: "gestor" | "membro";
  ativo: boolean;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  /**
   * `null` = logado SEM ser da equipe. O login é o mesmo Supabase Auth do
   * portal do cliente, então um cliente com senha do portal consegue se
   * autenticar aqui — e é esta linha (com `ativo`) que o barra na porta.
   * A trava de verdade é a RLS; isto é só a porta da tela.
   */
  membro: MembroEquipe | null;
  isGestor: boolean;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [membro, setMembro] = useState<MembroEquipe | null>(null);
  const [isLoading, setLoading] = useState(true);

  const carregarMembro = async (userId: string) => {
    const { data, error } = await supabase
      .from("equipe")
      .select("id, nome, email, papel, ativo")
      .eq("id", userId)
      .maybeSingle();
    // Falha de consulta NÃO vira "não é da equipe" calado: aparece no console.
    if (error) console.error("[auth] falha ao ler equipe:", error.message);
    setMembro((data as MembroEquipe | null) ?? null);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evento, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        // Fora do callback: chamar o Supabase DENTRO do onAuthStateChange
        // pode travar o cliente (documentado pelo próprio supabase-js).
        setTimeout(async () => {
          await carregarMembro(s.user.id);
          setLoading(false);
        }, 0);
      } else {
        setMembro(null);
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
    if (!error) return { error: null };
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
    setMembro(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        membro,
        isGestor: membro?.papel === "gestor",
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
