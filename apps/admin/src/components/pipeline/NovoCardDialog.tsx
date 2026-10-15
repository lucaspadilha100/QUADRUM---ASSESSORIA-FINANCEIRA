import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useBancos, useEquipe, useEtapas, useLinhasCredito } from "@/hooks/useCadastros";
import { buscarClientePorDocumento, useCriarCard } from "@/hooks/usePipeline";
import { documentoValido, mascararDocumento, soDigitos } from "@/lib/formato";

// Radix Select não aceita item de valor vazio: "nenhum" é a ausência.
const NENHUM = "nenhum";

type ClienteAchado = { id: string; nome: string } | null;

export function NovoCardDialog({ aberto, etapaInicial, onFechar }: {
  aberto: boolean;
  etapaInicial: string | null;
  onFechar: () => void;
}) {
  const { perfil, isGestor } = useAuth();
  const { data: etapas = [] } = useEtapas();
  const { data: bancos = [] } = useBancos();
  const { data: linhas = [] } = useLinhasCredito();
  const { data: equipe = [] } = useEquipe();
  const criar = useCriarCard();

  const [documento, setDocumento] = useState("");
  const [achado, setAchado] = useState<ClienteAchado>(null);
  const [procurando, setProcurando] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [etapaId, setEtapaId] = useState("");
  const [bancoId, setBancoId] = useState(NENHUM);
  const [linhaId, setLinhaId] = useState(NENHUM);
  const [veiculo, setVeiculo] = useState("");
  const [anoModelo, setAnoModelo] = useState("");
  const [placa, setPlaca] = useState("");
  const [consultorId, setConsultorId] = useState("");

  useEffect(() => {
    if (!aberto) return;
    setDocumento(""); setAchado(null); setNome(""); setTelefone(""); setEmail("");
    setBancoId(NENHUM); setLinhaId(NENHUM); setVeiculo(""); setAnoModelo(""); setPlaca("");
    setEtapaId(etapaInicial ?? etapas.find((e) => e.ativo)?.id ?? "");
    setConsultorId(perfil?.id ?? "");
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  // Documento completo ⇒ procura o cliente. Achou: o contrato entra nele, sem
  // cadastrar de novo. A busca respeita a RLS: colaborador só acha os SEUS.
  useEffect(() => {
    setAchado(null);
    if (!documentoValido(documento)) return;
    let vivo = true;
    setProcurando(true);
    buscarClientePorDocumento(documento)
      .then((c) => { if (vivo) setAchado(c ? { id: c.id, nome: c.nome } : null); })
      .catch((e: Error) => toast.error("Não foi possível procurar o cliente.", { description: e.message }))
      .finally(() => { if (vivo) setProcurando(false); });
    return () => { vivo = false; };
  }, [documento]);

  const linha = linhas.find((l) => l.id === linhaId);
  const ativos = <T extends { ativo: boolean }>(l: T[]) => l.filter((x) => x.ativo);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!documentoValido(documento)) return toast.error("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
    if (!achado && !nome.trim()) return toast.error("Informe o nome do cliente.");
    if (!etapaId) return toast.error("Escolha a etapa.");
    try {
      await criar.mutateAsync({
        clienteId: achado?.id ?? null,
        documento: soDigitos(documento),
        nome, telefone, email,
        etapaId,
        bancoId: bancoId === NENHUM ? null : bancoId,
        linhaId: linhaId === NENHUM ? null : linhaId,
        veiculo: linha?.tem_veiculo ? veiculo : "",
        anoModelo: linha?.tem_veiculo ? anoModelo : "",
        placa: linha?.tem_veiculo ? placa : "",
        // Colaborador: sempre ele mesmo (a RLS recusaria outro).
        consultorId: isGestor ? consultorId || null : perfil?.id ?? null,
      });
      toast.success("Contrato criado.");
      onFechar();
    } catch (err) {
      toast.error("Não foi possível criar.", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo contrato</DialogTitle>
          <DialogDescription>O cliente só vê o contrato no portal quando ele chega à etapa de aceite.</DialogDescription>
        </DialogHeader>

        <form onSubmit={salvar} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cliente</legend>
            <div className="space-y-1.5">
              <Label htmlFor="doc">CPF ou CNPJ</Label>
              <Input id="doc" inputMode="numeric" autoFocus value={documento}
                onChange={(e) => setDocumento(mascararDocumento(e.target.value))} placeholder="000.000.000-00" />
              {procurando && <p className="text-xs text-muted-foreground">Procurando…</p>}
              {achado && (
                <p className="inline-flex items-center gap-1 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Cliente já cadastrado: {achado.nome}
                </p>
              )}
            </div>
            {!achado && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="nome">Nome</Label>
                  <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="tel">Telefone</Label>
                    <Input id="tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mail">E-mail</Label>
                    <Input id="mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contrato</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Etapa</Label>
                <Select value={etapaId} onValueChange={setEtapaId}>
                  <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                  <SelectContent>
                    {ativos(etapas).map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Consultor</Label>
                {isGestor ? (
                  <Select value={consultorId} onValueChange={setConsultorId}>
                    <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
                    <SelectContent>
                      {ativos(equipe).map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={perfil?.nome ?? ""} disabled />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Banco</Label>
                <Select value={bancoId} onValueChange={setBancoId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Não informado</SelectItem>
                    {ativos(bancos).map((b) => <SelectItem key={b.id} value={b.id}>{b.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
                {ativos(bancos).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">Nenhum banco cadastrado ainda.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Linha de crédito</Label>
                <Select value={linhaId} onValueChange={setLinhaId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NENHUM}>Não informada</SelectItem>
                    {ativos(linhas).map((l) => <SelectItem key={l.id} value={l.id}>{l.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {linha?.tem_veiculo && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-1">
                  <Label htmlFor="vei">Veículo</Label>
                  <Input id="vei" value={veiculo} onChange={(e) => setVeiculo(e.target.value)} placeholder="Ex.: Onix 1.0" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ano">Ano/modelo</Label>
                  <Input id="ano" value={anoModelo} onChange={(e) => setAnoModelo(e.target.value)} placeholder="2021/2022" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="placa">Placa</Label>
                  <Input id="placa" value={placa} onChange={(e) => setPlaca(e.target.value.toUpperCase())} placeholder="ABC1D23" />
                </div>
              </div>
            )}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={criar.isPending}>
              {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar contrato
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
