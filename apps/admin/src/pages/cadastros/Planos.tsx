import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus, Star } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { Campo } from "@/components/Bloco";
import { useAuth } from "@/contexts/AuthContext";
import { usePlanosPagamento, useSalvarPlano } from "@/hooks/useCadastros";
import { lerMoeda, mostrarMoeda } from "@/hooks/useContratoDocumento";
import { soDigitos } from "@/lib/formato";
import { DIAS_VENCIMENTO, MAX_CARTAO, reais, type PlanoPagamento } from "@/lib/planos";

// A tabela de honorários (migração 20261103000000): cada plano tem até três
// preços — à vista, N boletos, N vezes no cartão. O gestor mantém; no
// contrato, escolhe-se o plano e a opção. Nada se apaga: desative. Um só é o
// padrão (o banco garante).

export default function Planos() {
  const { isGestor } = useAuth();
  const { data: planos = [], isLoading, error } = usePlanosPagamento();
  const salvar = useSalvarPlano();
  const [editando, setEditando] = useState<PlanoPagamento | "novo" | null>(null);

  const alternar = async (p: PlanoPagamento, campos: Partial<PlanoPagamento>) => {
    try { await salvar.mutateAsync({ id: p.id, campos }); }
    catch (e) { toast.error("Não foi possível salvar.", { description: (e as Error).message }); }
  };

  return (
    <div>
      <PageHeader
        titulo="Planos de pagamento"
        acoes={isGestor ? <Button onClick={() => setEditando("novo")}><Plus className="mr-1.5 h-4 w-4" /> Novo plano</Button> : undefined}
      />
      <div className="px-4 py-4 sm:px-8">
        {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : planos.length === 0 ? (
          <Vazio texto={`Nenhum plano cadastrado.${isGestor ? ' Use "Novo plano".' : ""}`} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Plano</th>
                  <th className="px-4 py-2.5 font-medium">À vista</th>
                  <th className="px-4 py-2.5 font-medium">Boleto</th>
                  <th className="px-4 py-2.5 font-medium">Cartão</th>
                  <th className="px-4 py-2.5 text-center font-medium">Padrão</th>
                  <th className="px-4 py-2.5 text-center font-medium">Ativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {planos.map((p) => (
                  <tr key={p.id} className={p.ativo ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      {isGestor
                        ? <button type="button" onClick={() => setEditando(p)} className="min-h-9 text-left font-medium text-foreground hover:underline sm:min-h-0">{p.nome}</button>
                        : <span className="font-medium">{p.nome}</span>}
                    </td>
                    <td className="px-4 py-3 font-semibold tabular-nums">{p.avista_valor ? reais(p.avista_valor) : "—"}</td>
                    <td className="px-4 py-3 tabular-nums"><Preco vezes={p.boleto_parcelas} valor={p.boleto_valor} /></td>
                    <td className="px-4 py-3 tabular-nums">
                      <Preco vezes={p.cartao_parcelas} valor={p.cartao_valor} />
                      {p.cartao_parcelas && p.cartao_sem_juros && p.cartao_sem_juros < p.cartao_parcelas && (
                        <span className="block text-xs text-muted-foreground">{p.cartao_sem_juros}x sem juros</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.padrao ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-q-gold/15 px-2 py-0.5 text-xs font-semibold text-foreground"><Star className="h-3 w-3 fill-q-gold text-q-gold" /> Padrão</span>
                      ) : isGestor && p.ativo ? (
                        <Button type="button" size="sm" variant="ghost" className="text-xs text-muted-foreground" disabled={salvar.isPending}
                          onClick={() => alternar(p, { padrao: true })}>Tornar padrão</Button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Switch checked={p.ativo} disabled={!isGestor || salvar.isPending || p.padrao}
                        onCheckedChange={(v) => alternar(p, { ativo: v })} aria-label={`${p.nome} ativo`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando === "novo" ? "Novo plano" : "Editar plano"}</DialogTitle>
            <DialogDescription className="sr-only">Plano de pagamento</DialogDescription>
          </DialogHeader>
          {editando && <FormPlano key={editando === "novo" ? "novo" : editando.id} plano={editando === "novo" ? null : editando} onFechar={() => setEditando(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Preco({ vezes, valor }: { vezes: number | null; valor: number | null }) {
  if (!vezes || !valor) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span className="font-semibold">{vezes}x de {reais(valor)}</span>
      <span className="block text-xs text-muted-foreground">total {reais(vezes * Number(valor))}</span>
    </>
  );
}

function Grupo({ titulo, ligado, onLigar, children }: { titulo: string; ligado: boolean; onLigar: (v: boolean) => void; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1">
        <label className="flex min-h-9 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Switch checked={ligado} onCheckedChange={onLigar} /> {titulo}
        </label>
      </legend>
      {ligado && children}
    </fieldset>
  );
}

function FormPlano({ plano, onFechar }: { plano: PlanoPagamento | null; onFechar: () => void }) {
  const salvar = useSalvarPlano();
  const [nome, setNome] = useState(plano?.nome ?? "");
  const [temAvista, setTemAvista] = useState(plano ? plano.avista_valor != null : true);
  const [avista, setAvista] = useState(mostrarMoeda(plano?.avista_valor));
  const [temBoleto, setTemBoleto] = useState(plano ? plano.boleto_parcelas != null : true);
  const [bVezes, setBVezes] = useState(String(plano?.boleto_parcelas ?? 6));
  const [bValor, setBValor] = useState(mostrarMoeda(plano?.boleto_valor));
  const [dia, setDia] = useState(String(plano?.dia_vencimento ?? 10));
  const [temCartao, setTemCartao] = useState(plano ? plano.cartao_parcelas != null : true);
  const [cVezes, setCVezes] = useState(String(plano?.cartao_parcelas ?? 8));
  const [cValor, setCValor] = useState(mostrarMoeda(plano?.cartao_valor));
  const [semJuros, setSemJuros] = useState(String(plano?.cartao_sem_juros ?? plano?.cartao_parcelas ?? 8));
  const [padrao, setPadrao] = useState(plano?.padrao ?? false);
  const nb = Number.parseInt(bVezes, 10) || 0;
  const nc = Number.parseInt(cVezes, 10) || 0;

  const valor = (s: string, rotulo: string) => {
    const v = lerMoeda(s);
    if (v == null || Number.isNaN(v) || v <= 0) throw new Error(`Informe ${rotulo}.`);
    return v;
  };

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    let campos: Partial<PlanoPagamento>;
    try {
      if (!nome.trim()) throw new Error("Dê um nome ao plano.");
      if (!temAvista && !temBoleto && !temCartao) throw new Error("Ligue ao menos uma opção.");
      if (temBoleto && (nb < 1 || nb > 120)) throw new Error("Boletos: de 1 a 120.");
      if (temCartao && (nc < 1 || nc > MAX_CARTAO)) throw new Error(`Cartão: de 1 a ${MAX_CARTAO} vezes.`);
      const sj = Math.min(Number(semJuros) || nc, nc);
      campos = {
        nome: nome.trim(),
        avista_valor: temAvista ? valor(avista, "o valor à vista") : null,
        boleto_parcelas: temBoleto ? nb : null, boleto_valor: temBoleto ? valor(bValor, "o valor do boleto") : null,
        cartao_parcelas: temCartao ? nc : null, cartao_valor: temCartao ? valor(cValor, "o valor da parcela no cartão") : null,
        cartao_sem_juros: temCartao && sj < nc ? sj : null,
        dia_vencimento: Number(dia),
        padrao, ...(padrao ? { ativo: true } : {}),
      };
    } catch (err) {
      return toast.error((err as Error).message);
    }
    try {
      await salvar.mutateAsync({ id: plano?.id, campos });
      toast.success(plano ? "Plano salvo." : "Plano cadastrado.");
      onFechar();
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  const total = (n: number, s: string) => {
    const v = lerMoeda(s);
    return n > 0 && v && !Number.isNaN(v) ? reais(n * v) : "—";
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Campo rotulo="Nome"><Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Nível Base" autoFocus /></Campo>

      <Grupo titulo="À vista" ligado={temAvista} onLigar={setTemAvista}>
        <Campo rotulo="Valor (R$)"><Input inputMode="decimal" value={avista} onChange={(e) => setAvista(e.target.value)} placeholder="0,00" /></Campo>
      </Grupo>

      <Grupo titulo="Boleto" ligado={temBoleto} onLigar={setTemBoleto}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo rotulo="Parcelas"><Input inputMode="numeric" value={bVezes} onChange={(e) => setBVezes(soDigitos(e.target.value).slice(0, 3))} /></Campo>
          <Campo rotulo="Valor (R$)"><Input inputMode="decimal" value={bValor} onChange={(e) => setBValor(e.target.value)} placeholder="0,00" /></Campo>
          <Campo rotulo="Vencem todo dia">
            <Select value={dia} onValueChange={setDia}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{DIAS_VENCIMENTO.map((x) => <SelectItem key={x} value={String(x)}>Dia {x}</SelectItem>)}</SelectContent>
            </Select>
          </Campo>
        </div>
        <p className="text-sm text-muted-foreground">Total {total(nb, bValor)}</p>
      </Grupo>

      <Grupo titulo="Cartão de crédito" ligado={temCartao} onLigar={setTemCartao}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo rotulo="Vezes"><Input inputMode="numeric" value={cVezes} onChange={(e) => setCVezes(soDigitos(e.target.value).slice(0, 2))} /></Campo>
          <Campo rotulo="Valor (R$)"><Input inputMode="decimal" value={cValor} onChange={(e) => setCValor(e.target.value)} placeholder="0,00" /></Campo>
          <Campo rotulo="Sem juros até">
            <Select value={String(Math.min(Number(semJuros) || nc, Math.max(nc, 1)))} onValueChange={setSemJuros}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: Math.max(1, Math.min(nc, MAX_CARTAO)) }, (_, i) => i + 1).map((x) => (
                  <SelectItem key={x} value={String(x)}>{x === 1 ? "1x" : `${x}x`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Campo>
        </div>
        <p className="text-sm text-muted-foreground">Total {total(nc, cValor)}</p>
      </Grupo>

      <label className="flex min-h-10 items-center gap-3 rounded-lg border border-border p-3 text-sm">
        <Switch checked={padrao} onCheckedChange={setPadrao} />
        <span className="font-medium">Plano padrão</span>
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
        <Button type="submit" disabled={salvar.isPending}>{salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
      </DialogFooter>
    </form>
  );
}
