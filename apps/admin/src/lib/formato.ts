// Formatos de tela. Um lugar só: CPF mascarado de dois jeitos em duas telas é
// como nasce a busca que acha num lugar e não acha no outro.

/** Só os dígitos — é assim que o documento é GRAVADO (o banco recusa o resto). */
export const soDigitos = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

/** 12345678901 → 123.456.789-01 · 12345678000199 → 12.345.678/0001-99 */
export function formatarDocumento(v: string | null | undefined) {
  const d = soDigitos(v);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return v ?? "";
}

/** Máscara enquanto digita: CPF até 11 dígitos, CNPJ a partir do 12º. */
export function mascararDocumento(v: string) {
  const d = soDigitos(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

export const documentoValido = (v: string) => [11, 14].includes(soDigitos(v).length);

/** Dias inteiros desde um instante (0 = hoje). */
export function diasDesde(iso: string | null | undefined) {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * "2026-10-15" (DATE) → 15/10/2026. Montado componente a componente: `new
 * Date("2026-10-15")` é lido como UTC e, no fuso do Brasil, volta um dia.
 */
export function dataBR(iso: string | null | undefined) {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR");
}

/** timestamptz → "15/10/2026 às 14:32" (o rodapé do histórico no portal). */
export function dataHoraBR(iso: string | null | undefined) {
  if (!iso) return "";
  const dt = new Date(iso);
  return `${dt.toLocaleDateString("pt-BR")} às ${dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export const iniciais = (nome: string | null | undefined) =>
  (nome ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "?";

/** Erro do Supabase em português, para os casos que a tela sabe explicar. */
export function mensagemDeErro(error: { code?: string; message: string; details?: string | null } | null) {
  if (!error) return "";
  if (error.code === "23505" && /documento/.test(`${error.message} ${error.details ?? ""}`)) {
    return "Este CPF/CNPJ já está cadastrado na carteira de outro consultor. Peça a um gestor para abrir o contrato ou transferir o cliente.";
  }
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return "Você não tem permissão para isso. Se precisar, fale com um gestor.";
  }
  return error.message;
}
