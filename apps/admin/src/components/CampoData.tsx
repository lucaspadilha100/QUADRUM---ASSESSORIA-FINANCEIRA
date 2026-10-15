import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Campo de data com a cara do sistema, no lugar do calendário do navegador
// (que muda de ano clicando mês a mês — inviável para data de nascimento).
//
//   digitar   DD/MM/AAAA, com a máscara montando as barras — o jeito mais
//             rápido para quem tem a data na mão (documento do cliente)
//   escolher  calendário com MÊS e ANO em listas: 1987 é um clique, não 400
//
// O valor que entra e sai é o mesmo do <input type="date">: "AAAA-MM-DD" ou "".
// ─────────────────────────────────────────────────────────────────────────────

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const DIAS = ["D", "S", "T", "Q", "Q", "S", "S"];

const doIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? { a: +m[1], m: +m[2] - 1, d: +m[3] } : null;
};
const paraIso = (a: number, m: number, d: number) =>
  `${a}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const paraTexto = (iso: string) => { const x = doIso(iso); return x ? `${String(x.d).padStart(2, "0")}/${String(x.m + 1).padStart(2, "0")}/${x.a}` : ""; };
const valida = (a: number, m: number, d: number) => {
  const dt = new Date(a, m, d);
  return dt.getFullYear() === a && dt.getMonth() === m && dt.getDate() === d;
};

function mascarar(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8);
  return d.length > 4 ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function CampoData({ id, valor, onChange, anoMin = 1920, anoMax, placeholder = "DD/MM/AAAA", disabled }: {
  id?: string;
  valor: string;
  onChange: (iso: string) => void;
  anoMin?: number;
  anoMax?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  const hoje = new Date();
  const fim = anoMax ?? hoje.getFullYear() + 5;
  const [texto, setTexto] = useState(paraTexto(valor));
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState(false);
  const atual = doIso(valor);
  const [vista, setVista] = useState({ a: atual?.a ?? hoje.getFullYear(), m: atual?.m ?? hoje.getMonth() });

  // O valor mudou por fora (outro cliente aberto, "Limpar"): o texto acompanha.
  useEffect(() => { setTexto(paraTexto(valor)); setErro(""); }, [valor]);
  useEffect(() => {
    if (aberto) { const x = doIso(valor); setVista({ a: x?.a ?? hoje.getFullYear(), m: x?.m ?? hoje.getMonth() }); }
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const digitar = (v: string) => {
    const t = mascarar(v);
    setTexto(t);
    setErro("");
    if (t === "") return onChange("");
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
    if (!m) return;
    const [d, mes, a] = [+m[1], +m[2] - 1, +m[3]];
    if (!valida(a, mes, d) || a < anoMin || a > fim) { setErro("Data inválida."); return; }
    onChange(paraIso(a, mes, d));
  };

  const anos = useMemo(() => Array.from({ length: fim - anoMin + 1 }, (_, i) => fim - i), [anoMin, fim]);
  const primeiroDia = new Date(vista.a, vista.m, 1).getDay();
  const diasNoMes = new Date(vista.a, vista.m + 1, 0).getDate();
  const casas: (number | null)[] = [...Array(primeiroDia).fill(null), ...Array.from({ length: diasNoMes }, (_, i) => i + 1)];
  const andar = (n: number) => setVista((v) => {
    const dt = new Date(v.a, v.m + n, 1);
    return dt.getFullYear() < anoMin || dt.getFullYear() > fim ? v : { a: dt.getFullYear(), m: dt.getMonth() };
  });
  const escolher = (d: number) => { onChange(paraIso(vista.a, vista.m, d)); setAberto(false); };
  const ehHoje = (d: number) => vista.a === hoje.getFullYear() && vista.m === hoje.getMonth() && d === hoje.getDate();
  const ehEscolhido = (d: number) => atual?.a === vista.a && atual?.m === vista.m && atual?.d === d;

  return (
    <div className="space-y-1">
      <div className={cn("flex h-10 w-full items-center rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring", erro && "border-destructive")}>
        <input id={id} inputMode="numeric" value={texto} onChange={(e) => digitar(e.target.value)} placeholder={placeholder}
          disabled={disabled} className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground" />
        <Popover open={aberto} onOpenChange={setAberto}>
          <PopoverTrigger asChild>
            <button type="button" disabled={disabled} aria-label="Abrir calendário"
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground">
              <CalendarDays className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[296px] p-3">
            <div className="mb-3 flex items-center gap-1.5">
              <button type="button" onClick={() => andar(-1)} aria-label="Mês anterior"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"><ChevronLeft className="h-4 w-4" /></button>
              <Select value={String(vista.m)} onValueChange={(v) => setVista((x) => ({ ...x, m: +v }))}>
                <SelectTrigger className="h-8 flex-1 px-2 text-sm capitalize" aria-label="Mês"><SelectValue /></SelectTrigger>
                <SelectContent>{MESES.map((n, i) => <SelectItem key={n} value={String(i)} className="capitalize">{n}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={String(vista.a)} onValueChange={(v) => setVista((x) => ({ ...x, a: +v }))}>
                <SelectTrigger className="h-8 w-[84px] px-2 text-sm" aria-label="Ano"><SelectValue /></SelectTrigger>
                <SelectContent>{anos.map((a) => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}</SelectContent>
              </Select>
              <button type="button" onClick={() => andar(1)} aria-label="Próximo mês"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {DIAS.map((d, i) => <span key={i} className="pb-1 text-[11px] font-semibold text-muted-foreground">{d}</span>)}
              {casas.map((d, i) => d == null ? <span key={`v${i}`} /> : (
                <button key={d} type="button" onClick={() => escolher(d)}
                  className={cn("h-9 rounded-md text-sm tabular-nums transition-colors",
                    ehEscolhido(d) ? "bg-q-gold font-semibold text-q-onix"
                      : ehHoje(d) ? "font-semibold text-q-petrol ring-1 ring-inset ring-q-petrol/40 hover:bg-accent"
                      : "text-foreground hover:bg-accent")}>
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border pt-2 text-xs">
              <button type="button" onClick={() => { onChange(""); setAberto(false); }} className="text-muted-foreground hover:text-foreground">Limpar</button>
              <button type="button" onClick={() => { setVista({ a: hoje.getFullYear(), m: hoje.getMonth() }); }} className="q-link">Ir para hoje</button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {erro && <p className="text-[11px] text-destructive">{erro}</p>}
    </div>
  );
}
