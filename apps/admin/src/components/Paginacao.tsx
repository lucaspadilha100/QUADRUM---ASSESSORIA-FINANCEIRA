import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useParamUrl } from "@/shell";

// Página e tamanho moram na URL (`?pagina=3&por=50`): F5 e link copiado
// voltam ao mesmo lugar. Trocar de filtro volta à página 1 (`voltarAoInicio`).

export const TAMANHOS = [20, 50, 100] as const;

export function usePaginacaoUrl() {
  const [p, setP] = useParamUrl("pagina", "1");
  const [por, setPor] = useParamUrl("por", "20");
  const pagina = Math.max(1, parseInt(p, 10) || 1);
  const porN = (TAMANHOS as readonly number[]).includes(Number(por)) ? Number(por) : 20;
  return {
    pagina,
    por: porN,
    irPara: (n: number) => setP(String(n)),
    mudarPor: (n: number) => { setPor(String(n)); setP(null); },
    voltarAoInicio: () => setP(null),
  };
}

export function Paginacao({ pagina, por, total, onPagina, onPor }: {
  pagina: number;
  por: number;
  total: number;
  onPagina: (n: number) => void;
  onPor: (n: number) => void;
}) {
  const paginas = Math.max(1, Math.ceil(total / por));

  // Filtro mudou e a página ficou além do fim: vai para a última que existe,
  // em vez de mostrar "nada encontrado" com resultado nas páginas anteriores.
  useEffect(() => {
    if (total > 0 && pagina > paginas) onPagina(paginas);
  }, [total, pagina, paginas]); // eslint-disable-line react-hooks/exhaustive-deps

  if (total === 0) return null;
  const de = (pagina - 1) * por + 1;
  const ate = Math.min(pagina * por, total);

  return (
    <nav aria-label="Paginação" className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {de.toLocaleString("pt-BR")}–{ate.toLocaleString("pt-BR")} de <strong className="text-foreground">{total.toLocaleString("pt-BR")}</strong>
      </span>
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">Por página</span>
        <Select value={String(por)} onValueChange={(v) => onPor(Number(v))}>
          <SelectTrigger className="h-10 w-[76px] bg-card sm:h-8" aria-label="Itens por página"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TAMANHOS.map((t) => <SelectItem key={t} value={String(t)}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0 sm:h-8 sm:w-8" disabled={pagina <= 1}
          onClick={() => onPagina(pagina - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[88px] text-center tabular-nums">Página {pagina} de {paginas.toLocaleString("pt-BR")}</span>
        <Button type="button" variant="outline" size="sm" className="h-10 w-10 p-0 sm:h-8 sm:w-8" disabled={pagina >= paginas}
          onClick={() => onPagina(pagina + 1)} aria-label="Próxima página">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
