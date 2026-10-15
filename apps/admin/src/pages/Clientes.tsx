import { useEffect, useState } from "react";
import { Globe, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClienteForm } from "@/components/clientes/ClienteForm";
import { ClientePainel } from "@/components/clientes/ClientePainel";
import { ContratoPainel } from "@/components/pipeline/ContratoDetalhe";
import { Chips } from "@/components/Chips";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe } from "@/hooks/useCadastros";
import { clientePorDocumento, useClientesPagina, useCriarCliente } from "@/hooks/useClientes";
import { useAtrasado } from "@/hooks/usePagina";
import { useParamUrl } from "@/shell";
import { documentoValido, formatarDocumento, mascararDocumento, soDigitos } from "@/lib/formato";

const TODOS = "todos";

export default function Clientes() {
  const { isGestor } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [filtro, setFiltro] = useParamUrl("portal", "todos");
  const [consultor, setConsultor] = useParamUrl("consultor", TODOS);
  const [abertoId, setAbertoId] = useParamUrl("cliente", "");
  const pag = usePaginacaoUrl();
  const [novo, setNovo] = useState(false);

  const termo = useAtrasado(busca);
  const { data, isLoading, isFetching, error } = useClientesPagina({
    busca: termo, portal: filtro, consultor: consultor === TODOS ? null : consultor, pagina: pag.pagina, por: pag.por,
  });
  const lista = data?.linhas ?? [];
  const cont = data?.contagem ?? { todos: 0, com: 0, sem: 0 };
  const total = filtro === "com" ? cont.com : filtro === "sem" ? cont.sem : cont.todos;

  // Filtro novo, página 1 — senão "página 7" de uma busca que tem uma página.
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };

  return (
    <div>
      <PageHeader
        titulo="Clientes"
        descricao={isGestor ? "Todos os clientes da Quadrum." : "Os clientes da sua carteira."}
        acoes={<Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo cliente</Button>}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ, telefone ou e-mail" className="bg-card pl-9" />
          {isFetching && !isLoading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {isGestor && (
          <Select value={consultor} onValueChange={filtrar(setConsultor)}>
            <SelectTrigger className="w-full bg-card sm:w-56" aria-label="Consultor"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os consultores</SelectItem>
              {equipe.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Chips
          valor={filtro}
          onChange={filtrar(setFiltro)}
          opcoes={[
            { valor: "todos", rotulo: `Todos (${cont.todos.toLocaleString("pt-BR")})` },
            { valor: "com", rotulo: `Com acesso ao portal (${cont.com.toLocaleString("pt-BR")})` },
            { valor: "sem", rotulo: `Sem acesso (${cont.sem.toLocaleString("pt-BR")})` },
          ]}
        />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? (
          <Carregando />
        ) : error ? (
          <Falha erro={error as Error} />
        ) : lista.length === 0 ? (
          <Vazio texto={cont.todos === 0 && !termo && consultor === TODOS ? "Nenhum cliente cadastrado ainda." : "Nenhum cliente encontrado com esse filtro."} />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="hidden border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground md:table-header-group">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Cliente</th>
                    <th className="px-4 py-2.5 font-medium">Telefone</th>
                    <th className="px-4 py-2.5 font-medium">Consultor</th>
                    <th className="px-4 py-2.5 font-medium">Contratos</th>
                    <th className="px-4 py-2.5 font-medium">Portal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lista.map((c) => (
                    <tr key={c.id} onClick={() => setAbertoId(c.id)} className="block cursor-pointer hover:bg-accent/50 md:table-row">
                      <td className="block px-4 pt-3 md:table-cell md:py-3">
                        <p className="font-medium text-foreground">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">{formatarDocumento(c.documento)} · {c.tipo_pessoa}</p>
                      </td>
                      <td className="block px-4 text-xs text-muted-foreground md:table-cell md:text-sm">{c.telefone ?? "—"}</td>
                      <td className="block px-4 text-xs text-muted-foreground md:table-cell md:text-sm md:text-foreground">
                        <span className="md:hidden">Consultor: </span>{c.consultor_nome ?? "Sem consultor"}
                      </td>
                      <td className="inline-block px-4 pb-3 text-xs md:table-cell md:py-3 md:text-sm">
                        {c.contratos_ativos} ativo{c.contratos_ativos === 1 ? "" : "s"}
                        {c.contratos_perdidos > 0 && <span className="text-muted-foreground"> · {c.contratos_perdidos} perdido{c.contratos_perdidos === 1 ? "" : "s"}</span>}
                      </td>
                      <td className="inline-block px-4 pb-3 md:table-cell md:py-3">
                        {c.user_id ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-q-onix px-2 py-0.5 text-[11px] font-medium text-q-gold"><Globe className="h-3 w-3" /> Com acesso</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Sem acesso</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Paginacao pagina={pag.pagina} por={pag.por} total={total} onPagina={pag.irPara} onPor={pag.mudarPor} />
          </>
        )}
      </div>

      <NovoCliente aberto={novo} onFechar={() => setNovo(false)} onCriado={(id) => { setNovo(false); setAbertoId(id); }} />
      <ClienteDetalhe clienteId={abertoId || null} onFechar={() => setAbertoId("")} />
    </div>
  );
}

function NovoCliente({ aberto, onFechar, onCriado }: { aberto: boolean; onFechar: () => void; onCriado: (id: string) => void }) {
  const criar = useCriarCliente();
  const [doc, setDoc] = useState("");
  const [jaExiste, setJaExiste] = useState<{ id: string; nome: string } | null>(null);

  // Documento completo ⇒ pergunta ao BANCO se já existe (dentro do que a
  // pessoa vê), em vez de procurar numa lista baixada inteira.
  useEffect(() => {
    setJaExiste(null);
    if (!documentoValido(doc)) return;
    let vivo = true;
    clientePorDocumento(doc).then((c) => { if (vivo) setJaExiste(c); }).catch(() => {});
    return () => { vivo = false; };
  }, [doc]);

  const tipo = soDigitos(doc).length === 14 ? "PJ" : soDigitos(doc).length === 11 ? "PF" : null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) { onFechar(); setDoc(""); } }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo cliente</DialogTitle>
          <DialogDescription>O contrato do cliente se cria na Pipeline. O acesso ao portal, na ficha dele.</DialogDescription>
        </DialogHeader>
        <ClienteForm
          rotuloSalvar="Cadastrar cliente"
          salvando={criar.isPending}
          tipoPessoa={tipo}
          antes={
            <div className="space-y-1.5">
              <Label htmlFor="cli-doc">CPF ou CNPJ</Label>
              <Input id="cli-doc" inputMode="numeric" autoFocus value={doc} onChange={(e) => setDoc(mascararDocumento(e.target.value))} placeholder="000.000.000-00" />
              {jaExiste && (
                <p className="text-xs font-medium text-warning">
                  Já cadastrado: <button type="button" className="q-link" onClick={() => onCriado(jaExiste.id)}>{jaExiste.nome}</button>
                </p>
              )}
            </div>
          }
          onSalvar={async (d) => {
            if (!documentoValido(doc)) return toast.error("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).");
            if (jaExiste) return toast.error("Este CPF/CNPJ já está cadastrado.");
            try {
              const id = await criar.mutateAsync({ ...d, documento: doc });
              toast.success("Cliente cadastrado.");
              setDoc("");
              onCriado(id);
            } catch (e) {
              toast.error("Não foi possível cadastrar.", { description: (e as Error).message });
            }
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

// Uma barra lateral só: o cliente, e — clicando num contrato dele — o
// contrato NA MESMA barra, com "← Voltar para o cliente". Nada de abrir outra
// tela de onde não se volta. ⚠️ O contrato aberto aqui é estado do PAINEL, não
// da URL (ver ContratoDetalhe: entrada no histórico quebra o "Voltar fecha").
function ClienteDetalhe({ clienteId, onFechar }: { clienteId: string | null; onFechar: () => void }) {
  const [contratoId, setContratoId] = useState<string | null>(null);
  useEffect(() => setContratoId(null), [clienteId]);
  return (
    <Sheet open={!!clienteId} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {clienteId && (contratoId ? (
          <ContratoPainel contratoId={contratoId}
            voltar={{ rotulo: "Voltar para o cliente", onClick: () => setContratoId(null) }} />
        ) : (
          <ClientePainel clienteId={clienteId} onAbrirContrato={(id) => setContratoId(id)} />
        ))}
      </SheetContent>
    </Sheet>
  );
}
