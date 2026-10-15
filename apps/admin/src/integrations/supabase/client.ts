import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Falso enquanto o `.env` (ou as variáveis do Vercel) não existir. A tela de
 * login DIZ isso em vez de devolver "Failed to fetch" a cada tentativa — erro
 * de configuração que se disfarça de senha errada custa uma tarde.
 */
export const supabaseConfigurado = Boolean(url && anonKey);

export const supabase = createClient(
  url ?? "http://localhost:54321",
  anonKey ?? "nao-configurado",
  { auth: { persistSession: true, autoRefreshToken: true } },
);
