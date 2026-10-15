import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Falso enquanto o `.env` (ou as variáveis do Vercel) não existir. A tela de
 * login DIZ isso em vez de devolver "Failed to fetch" a cada tentativa — erro
 * de configuração que se disfarça de senha errada custa uma tarde.
 */
export const supabaseConfigurado = Boolean(url && anonKey);

/**
 * ⚠️ Admin e portal moram no MESMO endereço (admin em `/`, portal em
 * `/portal`), e o navegador guarda a sessão por endereço. Com a chave padrão
 * os dois disputariam o mesmo lugar: o cliente entrando no portal derrubaria
 * o login da equipe no admin, e vice-versa. Cada app declara a sua chave no
 * próprio `.env` (VITE_AUTH_STORAGE_KEY) — por isso este arquivo pode
 * continuar idêntico nos dois.
 */
const storageKey = (import.meta.env.VITE_AUTH_STORAGE_KEY as string | undefined) || undefined;

export const supabase = createClient(
  url ?? "http://localhost:54321",
  anonKey ?? "nao-configurado",
  { auth: { persistSession: true, autoRefreshToken: true, storageKey } },
);
