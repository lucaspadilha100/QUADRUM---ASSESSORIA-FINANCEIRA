import { useState } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useAtrasado, useRpcPagina } from "@/hooks/usePagina";
import { formatarDocumento } from "@/lib/formato";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Escolher um contrato digitando, nunca rolando uma lista com todos: com 50 mil
// contratos o dropdown seria uma bomba. A busca roda no BANCO (nome, CPF/CNPJ,
// placa ou nº, sem acento) e devolve só os 10 melhores — e só os que a pessoa
// pode ver.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContratoEscolhido {
  id: string;
  numero: number;
  cliente_id?: string | null;
  cliente_nome: string | null;
  cliente_documento?: string | null;
  data_aceite?: string | null;
}

export function BuscaContrato({ valor, onChange, placeholder = "Buscar contrato por nome, CPF/CNPJ, placa ou nº" }: {
  valor: ContratoEscolhido | null;
  onChange: (c: ContratoEscolhido | null) => void;
  placeholder?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState("");
  const busca = useAtrasado(termo, 250);
  const { data, isFetching, error } = useRpcPagina<ContratoEscolhido, { ativos: number }>(
    ["contratos", "busca"], "q_contratos_pagina",
    { p_busca: busca, p_situacao: "ativos", p_pagina: 1, p_por: 10 },
    { enabled: aberto },
  );
  const lista = data?.linhas ?? [];
  const total = data?.contagem.ativos ?? 0;

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={aberto}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring">
          <span className={cn("min-w-0 flex-1 truncate", !valor && "text-muted-foreground")}>
            {valor ? `#${valor.numero} · ${valor.cliente_nome ?? "Cliente de outra carteira"}` : "Escolha o contrato"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-[280px] p-0">
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {error ? (
            <p className="p-3 text-xs text-destructive">Não foi possível buscar: {(error as Error).message}</p>
          ) : isFetching && lista.length === 0 ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…</p>
          ) : lista.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">{busca ? "Nenhum contrato encontrado." : "Nenhum contrato ativo."}</p>
          ) : (
            <ul role="listbox">
              {lista.map((c) => (
                <li key={c.id}>
                  <button type="button" role="option" aria-selected={valor?.id === c.id}
                    onClick={() => { onChange(c); setAberto(false); }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent">
                    <Check className={cn("h-4 w-4 shrink-0", valor?.id === c.id ? "opacity-100" : "opacity-0")} />
                    <span className="font-titulo text-xs font-semibold text-muted-foreground">#{c.numero}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.cliente_nome ?? "Cliente de outra carteira"}</span>
                      {c.cliente_documento && <span className="block text-[11px] text-muted-foreground">{formatarDocumento(c.cliente_documento)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {total > lista.length && (
          <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            Mostrando {lista.length} de {total.toLocaleString("pt-BR")}. Digite mais para refinar.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
