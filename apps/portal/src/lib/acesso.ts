import { soDigitos } from "./formato";

/**
 * O Supabase Auth só conhece e-mail; o cliente entra com CPF/CNPJ. Cada
 * cliente tem um e-mail SINTÉTICO, montado do documento.
 *
 * ⚠️ É a MESMA regra de `public.q_portal_email()` (migração 20261015030000),
 * que cria a conta quando a equipe gera a senha. Mudou uma, mude a outra —
 * senão a conta existe e o login nunca a encontra, com "CPF ou senha
 * incorretos" para um cliente que digitou tudo certo.
 */
export const emailDoDocumento = (documento: string) => `${soDigitos(documento)}@portal.quadrum.example`;

/** Como o cliente obtém a senha (o portal não tem cadastro nem "esqueci a senha"). */
export const CONTATO_SENHA = "Para obter ou redefinir sua senha, fale com o seu consultor Quadrum.";
