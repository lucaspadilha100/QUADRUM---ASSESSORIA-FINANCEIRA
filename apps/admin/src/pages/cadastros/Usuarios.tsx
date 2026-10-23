import { useState, type ComponentType, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Copy, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Power, Search, ShieldCheck, ShieldAlert, Users, UserRound } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Chips } from "@/components/Chips";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { confirmar } from "@/shell";
import { useAuth, PAPEL_LABEL } from "@/contexts/AuthContext";
import { gerarSenha } from "@/hooks/usePipeline";
import {
  useAtualizarUsuario, useCarteiraEquipe, useCriarUsuario, useRedefinirSenhaUsuario, useSenhasProvisorias, useUsuarios,
  type CarteiraPessoa, type Usuario,
} from "@/hooks/useUsuarios";
import { useParamUrl } from "@/shell";
import { Avatar } from "@/components/Avatar";
import { useDepartamentos } from "@/hooks/useCadastros";
import { dataBR, dataHoraBR } from "@/lib/formato";

// ─────────────────────────────────────────────────────────────────────────────
// A equipe. Sem matriz de telas: o NÍVEL decide (gestor vê e opera tudo;
// colaborador vê só a própria carteira). Só o gestor cria, muda nível,
// desativa e redefine senha — e quem garante é o banco, não esta tela.
// Desativar NÃO apaga: contratos, histórico e mensagens continuam com o nome.
// A carteira de cada um vem contada do banco (q_equipe_carteira).
// ─────────────────────────────────────────────────────────────────────────────

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const n = (v: number | undefined) => (v ?? 0).toLocaleString("pt-BR");
const TODOS = "todos";
type Credencial = { email: string; senha: string; titulo: string };

function haQuanto(iso: string | null | undefined) {
  if (!iso) return null;
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} dia${d === 1 ? "" : "s"}`;
}

export default function Usuarios() {
  const { isGestor, isAdmin, perfil } = useAuth();
  const { data: usuarios = [], isLoading, error } = useUsuarios();
  const { data: provisorias } = useSenhasProvisorias();
  const { data: deps = [] } = useDepartamentos();
  const { data: carteira = {} } = useCarteiraEquipe(isGestor);
  const nomeDep = (id?: string | null) => deps.find((d) => d.id === id)?.nome;
  const [filtro, setFiltro] = useParamUrl("situacao", "ativos");
  const [nivel, setNivel] = useParamUrl("nivel", TODOS);
  const [dep, setDep] = useParamUrl("departamento", TODOS);
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [abertoId, setAbertoId] = useParamUrl("usuario", "");
  const [novo, setNovo] = useState(false);
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const pag = usePaginacaoUrl();
  const atualizar = useAtualizarUsuario();
  const redefinir = useRedefinirSenhaUsuario();

  const ehGestor = (u: Usuario) => u.papel !== "colaborador";
  const ativosL = usuarios.filter((u) => u.ativo);
  const provisoriaAtivos = ativosL.filter((u) => provisorias?.has(u.id)).length;
  const t = semAcento(busca.trim());
  const porSituacao = (u: Usuario) =>
    filtro === "ativos" ? u.ativo : filtro === "desativados" ? !u.ativo : filtro === "provisoria" ? u.ativo && !!provisorias?.has(u.id) : true;
  const base = usuarios
    .filter((u) => dep === TODOS || (dep === "sem" ? !u.departamento_id : u.departamento_id === dep))
    .filter((u) => !t || semAcento(`${u.nome} ${u.email ?? ""} ${u.cargo ?? ""} ${nomeDep(u.departamento_id) ?? ""}`).includes(t))
    .filter(porSituacao);
  const lista = base.filter((u) => nivel === TODOS || (nivel === "gestor" ? ehGestor(u) : !ehGestor(u)));
  // A equipe é pequena (dezenas): lê-se inteira e pagina-se na tela.
  const pagina = lista.slice((pag.pagina - 1) * pag.por, pag.pagina * pag.por);
  const aberto = usuarios.find((u) => u.id === abertoId) ?? null;
  const filtrar = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); pag.voltarAoInicio(); };
  const cartao = (s: string, nv: string) => { setFiltro(s); setNivel(nv); pag.voltarAoInicio(); };

  const novaSenha = async (u: Usuario) => {
    if (!(await confirmar({ titulo: `Redefinir a senha de ${u.nome}?`, mensagem: "A senha atual deixa de valer na hora.", confirmar: "Redefinir" }))) return;
    const senha = gerarSenha();
    try {
      await redefinir.mutateAsync({ id: u.id, senha });
      setCredencial({ email: u.email ?? "", senha, titulo: `Nova senha de ${u.nome}` });
    } catch (err) {
      toast.error("Não foi possível redefinir.", { description: (err as Error).message });
    }
  };
  const alternarAtivo = async (u: Usuario) => {
    if (u.ativo && !(await confirmar({
      titulo: `Desativar ${u.nome}?`, mensagem: "A pessoa perde o acesso na hora. Dá para reativar depois.", confirmar: "Desativar", perigo: true,
    }))) return;
    try {
      await atualizar.mutateAsync({ id: u.id, campos: { ativo: !u.ativo } });
      toast.success(u.ativo ? "Usuário desativado." : "Usuário reativado.");
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  return (
    <div>
      <PageHeader
        titulo="Usuários"
        acoes={isGestor ? <Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo usuário</Button> : undefined}
      />

      <div className="space-y-6 px-4 py-6 sm:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Cartao icone={Users} rotulo="Equipe ativa" valor={ativosL.length} carregando={isLoading}
            detalhe={`${n(usuarios.length - ativosL.length)} desativado${usuarios.length - ativosL.length === 1 ? "" : "s"}`}
            ativo={filtro === "ativos" && nivel === TODOS} onClick={() => cartao("ativos", TODOS)} />
          <Cartao icone={ShieldCheck} rotulo="Gestores" valor={ativosL.filter(ehGestor).length} carregando={isLoading}
            ativo={filtro === "ativos" && nivel === "gestor"} onClick={() => cartao("ativos", "gestor")} />
          <Cartao icone={UserRound} rotulo="Colaboradores" valor={ativosL.filter((u) => !ehGestor(u)).length} carregando={isLoading}
            ativo={filtro === "ativos" && nivel === "colaborador"} onClick={() => cartao("ativos", "colaborador")} />
          <Cartao icone={ShieldAlert} rotulo="Com senha provisória" valor={provisoriaAtivos} carregando={isLoading} destaque={provisoriaAtivos > 0}
            ativo={filtro === "provisoria"} onClick={() => cartao(filtro === "provisoria" ? "ativos" : "provisoria", TODOS)} />
        </div>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={busca} onChange={(e) => filtrar(setBusca)(e.target.value)} placeholder="Buscar nome, e-mail, cargo ou departamento" className="bg-card pl-9" />
            </div>
            <Chips valor={filtro === "provisoria" ? "ativos" : filtro} onChange={filtrar(setFiltro)} opcoes={[
              { valor: "ativos", rotulo: `Ativos (${n(ativosL.length)})` },
              { valor: "desativados", rotulo: `Desativados (${n(usuarios.length - ativosL.length)})` },
            ]} />
            <Select value={nivel} onValueChange={filtrar(setNivel)}>
              <SelectTrigger className="h-10 w-full bg-card sm:h-9 sm:w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os níveis</SelectItem>
                <SelectItem value="gestor">Gestores</SelectItem>
                <SelectItem value="colaborador">Colaboradores</SelectItem>
              </SelectContent>
            </Select>
            <Select value={dep} onValueChange={filtrar(setDep)}>
              <SelectTrigger className="h-10 w-full bg-card sm:h-9 sm:w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todos os departamentos</SelectItem>
                {deps.filter((d) => d.ativo).map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                <SelectItem value="sem">Sem departamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : lista.length === 0 ? (
            <Vazio texto={usuarios.length === 0 ? "Nenhum usuário ainda." : "Ninguém com esse filtro."} />
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <table className="w-full text-sm">
                  <thead className="hidden border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground lg:table-header-group">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Pessoa</th>
                      <th className="px-4 py-2.5 font-medium">Nível</th>
                      <th className="px-4 py-2.5 font-medium">Departamento · cargo</th>
                      {isGestor && <th className="px-4 py-2.5 font-medium">Carteira</th>}
                      <th className="px-4 py-2.5 font-medium">{isAdmin ? "Último acesso" : "Desde"}</th>
                      {isGestor && <th className="w-12" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {pagina.map((u) => (
                      <Linha key={u.id} u={u} eu={u.id === perfil?.id} isGestor={isGestor} isAdmin={isAdmin}
                        provisoria={!!provisorias?.has(u.id)} dep={nomeDep(u.departamento_id)} carteira={carteira[u.id]}
                        onAbrir={() => setAbertoId(u.id)} onSenha={() => novaSenha(u)} onAtivo={() => alternarAtivo(u)} />
                    ))}
                  </tbody>
                </table>
              </div>
              <Paginacao pagina={pag.pagina} por={pag.por} total={lista.length} onPagina={pag.irPara} onPor={pag.mudarPor} />
            </>
          )}
        </section>
      </div>

      {isGestor && (
        <>
          <NovoUsuario aberto={novo} onFechar={() => setNovo(false)} onCriado={(c) => { setNovo(false); setCredencial(c); }} />
          <FichaUsuario usuario={aberto} euId={perfil?.id ?? ""} provisoria={!!(aberto && provisorias?.has(aberto.id))}
            carteira={aberto ? carteira[aberto.id] : undefined} isAdmin={isAdmin}
            onFechar={() => setAbertoId("")} onSenha={() => aberto && novaSenha(aberto)} />
          <CredencialDialog dados={credencial} onFechar={() => setCredencial(null)} />
        </>
      )}
    </div>
  );
}

function Cartao({ icone: Icone, rotulo, valor, detalhe, destaque, ativo, onClick, carregando }: {
  icone: ComponentType<{ className?: string }>; rotulo: string; valor: number; detalhe?: string;
  destaque?: boolean; ativo: boolean; onClick: () => void; carregando: boolean;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo}
      className={`flex flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent ${
        ativo ? "border-q-gold ring-1 ring-q-gold" : destaque ? "border-warning/60" : "border-border hover:border-q-gold/60"}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-q-onix text-q-gold"><Icone className="h-4 w-4" /></span>
      <span className="font-titulo text-2xl font-bold tabular-nums text-foreground">{carregando ? "—" : n(valor)}</span>
      <span className="text-xs leading-tight text-muted-foreground">{rotulo}{detalhe && !carregando ? ` · ${detalhe}` : ""}</span>
    </button>
  );
}

function Selo({ u, provisoria }: { u: Usuario; provisoria: boolean }) {
  return (
    <>
      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${u.papel !== "colaborador" ? "bg-q-onix text-q-gold" : "bg-muted text-muted-foreground"}`}>
        {PAPEL_LABEL[u.papel]}
      </span>
      {!u.ativo && <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium text-destructive">Desativado</span>}
      {u.ativo && provisoria && (
        <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-[11px] font-medium text-warning">Senha provisória</span>
      )}
    </>
  );
}

function Linha({ u, eu, isGestor, isAdmin, provisoria, dep, carteira, onAbrir, onSenha, onAtivo }: {
  u: Usuario; eu: boolean; isGestor: boolean; isAdmin: boolean; provisoria: boolean; dep?: string;
  carteira?: CarteiraPessoa; onAbrir: () => void; onSenha: () => void; onAtivo: () => void;
}) {
  const contratos = (carteira?.andamento ?? 0) + (carteira?.portal ?? 0);
  const quando = isAdmin ? haQuanto(carteira?.ultimo_acesso) : null;
  return (
    <tr onClick={isGestor ? onAbrir : undefined}
      className={`block lg:table-row ${isGestor ? "cursor-pointer hover:bg-accent/50" : ""} ${!u.ativo ? "opacity-60" : ""}`}>
      <td className="block px-4 pt-3 lg:table-cell lg:py-3">
        <div className="flex items-center gap-3">
          <Avatar nome={u.nome} url={u.avatar_url} className="h-10 w-10 text-sm" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground sm:truncate">
              {u.nome} {eu && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
            </p>
            <p className="break-all text-xs text-muted-foreground sm:truncate sm:break-normal">{u.email}</p>
          </div>
          {isGestor && <div className="lg:hidden" onClick={(e) => e.stopPropagation()}><Acoes u={u} eu={eu} onAbrir={onAbrir} onSenha={onSenha} onAtivo={onAtivo} /></div>}
        </div>
      </td>
      <td className="block px-4 pt-2 lg:table-cell lg:py-3">
        <div className="flex flex-wrap gap-1.5 pl-[52px] lg:pl-0"><Selo u={u} provisoria={provisoria} /></div>
      </td>
      <td className="block px-4 pt-1 text-xs text-muted-foreground lg:table-cell lg:py-3 lg:text-sm">
        <div className="pl-[52px] lg:pl-0">
          <span className="text-foreground">{dep ?? "Sem departamento"}</span>
          {u.cargo && <span className="block lg:mt-0.5 lg:text-xs">{u.cargo}</span>}
        </div>
      </td>
      {isGestor && (
        <td className="block px-4 pt-1 text-xs lg:table-cell lg:py-3">
          <div className="pl-[52px] lg:pl-0">
            {carteira ? (
              <span className="text-muted-foreground">
                <strong className="font-semibold tabular-nums text-foreground">{n(carteira.clientes)}</strong> cliente{carteira.clientes === 1 ? "" : "s"}
                {" · "}<strong className="font-semibold tabular-nums text-foreground">{n(contratos)}</strong> contrato{contratos === 1 ? "" : "s"}
                {carteira.atendimentos > 0 && <span className="block">{n(carteira.atendimentos)} atendimento{carteira.atendimentos === 1 ? "" : "s"} aberto{carteira.atendimentos === 1 ? "" : "s"}</span>}
              </span>
            ) : <span className="text-muted-foreground">—</span>}
          </div>
        </td>
      )}
      <td className="block px-4 pb-3 pt-1 text-xs text-muted-foreground lg:table-cell lg:py-3">
        <div className="pl-[52px] lg:pl-0">
          {isAdmin ? (quando ? <><span className="text-foreground">{quando}</span><span className="hidden lg:block">{dataHoraBR(carteira!.ultimo_acesso!)}</span></> : "Nunca entrou")
            : <>desde {dataBR(u.created_at)}</>}
        </div>
      </td>
      {isGestor && (
        <td className="hidden pr-3 lg:table-cell" onClick={(e) => e.stopPropagation()}>
          <Acoes u={u} eu={eu} onAbrir={onAbrir} onSenha={onSenha} onAtivo={onAtivo} />
        </td>
      )}
    </tr>
  );
}

function Acoes({ u, eu, onAbrir, onSenha, onAtivo }: { u: Usuario; eu: boolean; onAbrir: () => void; onSenha: () => void; onAtivo: () => void }) {
  const protegido = u.papel === "admin";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label={`Ações de ${u.nome}`}><MoreHorizontal className="h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onAbrir}><Pencil className="mr-2 h-4 w-4" /> Abrir ficha</DropdownMenuItem>
        <DropdownMenuItem onClick={onSenha}><KeyRound className="mr-2 h-4 w-4" /> Redefinir senha</DropdownMenuItem>
        {!eu && !protegido && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onAtivo} className={u.ativo ? "text-destructive focus:text-destructive" : ""}>
              <Power className="mr-2 h-4 w-4" /> {u.ativo ? "Desativar" : "Reativar"}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FichaUsuario({ usuario, euId, provisoria, carteira, isAdmin, onFechar, onSenha }: {
  usuario: Usuario | null; euId: string; provisoria: boolean; carteira?: CarteiraPessoa; isAdmin: boolean;
  onFechar: () => void; onSenha: () => void;
}) {
  const atualizar = useAtualizarUsuario();
  const [chave, setChave] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("");
  const [telefone, setTelefone] = useState("");
  const [papel, setPapel] = useState<Usuario["papel"]>("colaborador");
  const [ativo, setAtivo] = useState(true);
  const [dep, setDep] = useState(SEM_DEP);
  const { data: deps = [] } = useDepartamentos();
  if ((usuario?.id ?? null) !== chave) {
    setChave(usuario?.id ?? null);
    setNome(usuario?.nome ?? ""); setCargo(usuario?.cargo ?? ""); setTelefone(usuario?.telefone ?? "");
    setPapel(usuario?.papel ?? "colaborador"); setAtivo(usuario?.ativo ?? true);
    setDep(usuario?.departamento_id ?? SEM_DEP);
  }
  const souEu = usuario?.id === euId;
  const contratos = (carteira?.andamento ?? 0) + (carteira?.portal ?? 0);

  const salvar = async (e: FormEvent) => {
    e.preventDefault();
    if (!usuario) return;
    if (!ativo && usuario.ativo && !(await confirmar({
      titulo: `Desativar ${usuario.nome}?`,
      mensagem: "A pessoa perde o acesso na hora. Dá para reativar depois.",
      confirmar: "Desativar", perigo: true,
    }))) return;
    try {
      await atualizar.mutateAsync({ id: usuario.id, campos: {
        nome: nome.trim(), cargo: cargo.trim() || null, telefone: telefone.trim() || null, papel, ativo,
        // Só manda o departamento se o banco já tiver a coluna.
        ...("departamento_id" in usuario ? { departamento_id: dep === SEM_DEP ? null : dep } : {}),
      } });
      toast.success("Usuário salvo.");
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  return (
    <Sheet open={!!usuario} onOpenChange={(o) => !o && onFechar()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg" onOpenAutoFocus={(e) => e.preventDefault()}>
        {usuario && (
          <>
            <SheetHeader className="pr-8 text-left">
              <div className="flex items-center gap-4">
                <Avatar nome={usuario.nome} url={usuario.avatar_url} className="h-16 w-16 text-lg" />
                <div className="min-w-0">
                  <SheetTitle className="text-xl">{usuario.nome}</SheetTitle>
                  <SheetDescription className="break-all">{usuario.email}</SheetDescription>
                  <div className="mt-1.5 flex flex-wrap gap-1.5"><Selo u={usuario} provisoria={provisoria} /></div>
                </div>
              </div>
            </SheetHeader>

            {carteira && (
              <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini to={`/clientes?consultor=${usuario.id}`} rotulo="Clientes" valor={carteira.clientes} />
                <Mini to={`/contratos?consultor=${usuario.id}&situacao=andamento`} rotulo="Em andamento" valor={carteira.andamento} />
                <Mini to={`/contratos?consultor=${usuario.id}&situacao=portal`} rotulo="No portal" valor={carteira.portal} />
                <Mini rotulo="Atendimentos" valor={carteira.atendimentos} />
              </div>
            )}

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {usuario.created_at && <><dt className="text-muted-foreground">Na equipe desde</dt><dd className="text-right text-foreground">{dataBR(usuario.created_at)}</dd></>}
              {isAdmin && <><dt className="text-muted-foreground">Último acesso</dt>
                <dd className="text-right text-foreground">{carteira?.ultimo_acesso ? dataHoraBR(carteira.ultimo_acesso) : "Nunca entrou"}</dd></>}
              {contratos > 0 && !usuario.ativo && <><dt className="text-muted-foreground">Contratos ainda com ele</dt><dd className="text-right font-medium text-warning">{n(contratos)}</dd></>}
            </dl>

            <form onSubmit={salvar} className="mt-6 space-y-4">
              <fieldset className="space-y-3">
                <legend className="q-titulo-marca mb-2 text-[11px] text-muted-foreground">Perfil</legend>
                <div className="space-y-1.5"><Label htmlFor="e-nome">Nome</Label><Input id="e-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="e-cargo">Cargo</Label><Input id="e-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label htmlFor="e-tel">Telefone</Label><Input id="e-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="q-titulo-marca mb-2 text-[11px] text-muted-foreground">Acesso</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {usuario.papel === "admin"
                    ? <div className="space-y-1.5"><Label>Nível</Label><p className="flex h-10 items-center text-sm font-medium">{PAPEL_LABEL.admin}</p></div>
                    : <NivelSelect valor={papel} onChange={setPapel} />}
                  <div className="space-y-1.5">
                    <Label>Departamento</Label>
                    <Select value={dep} onValueChange={setDep}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_DEP}>Nenhum</SelectItem>
                        {deps.filter((d) => d.ativo || d.id === dep).map((d) => <SelectItem key={d.id} value={d.id}>{d.nome}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {!souEu && usuario.papel !== "admin" && (
                  <div className="flex min-h-12 items-center justify-between rounded-lg border border-border px-3">
                    <Label htmlFor="e-ativo" className="text-sm font-medium">Ativo</Label>
                    <Switch id="e-ativo" checked={ativo} onCheckedChange={setAtivo} />
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="q-titulo-marca mb-2 text-[11px] text-muted-foreground">Segurança</legend>
                <div className="flex min-h-12 items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                  <span className={`text-sm ${provisoria ? "text-warning" : "text-foreground"}`}>{provisoria ? "Senha provisória" : "Senha pessoal"}</span>
                  <Button type="button" size="sm" variant="outline" onClick={onSenha}><KeyRound className="mr-1.5 h-4 w-4" /> Redefinir senha</Button>
                </div>
              </fieldset>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={onFechar}>Fechar</Button>
                <Button type="submit" disabled={!nome.trim() || atualizar.isPending}>
                  {atualizar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
                </Button>
              </div>
            </form>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Mini({ to, rotulo, valor }: { to?: string; rotulo: string; valor: number }) {
  const corpo = (
    <>
      <span className="font-titulo text-xl font-bold tabular-nums text-foreground">{n(valor)}</span>
      <span className="text-[11px] leading-tight text-muted-foreground">{rotulo}</span>
    </>
  );
  const cls = "flex flex-col gap-0.5 rounded-lg border border-border bg-muted/30 p-3";
  return to ? <Link to={to} className={`${cls} transition-colors hover:border-q-gold/60 hover:bg-accent`}>{corpo}</Link> : <div className={cls}>{corpo}</div>;
}

function NovoUsuario({ aberto, onFechar, onCriado }: {
  aberto: boolean; onFechar: () => void; onCriado: (c: Credencial) => void;
}) {
  const criar = useCriarUsuario();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cargo, setCargo] = useState("");
  const [papel, setPapel] = useState<Usuario["papel"]>("colaborador");

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const senha = gerarSenha();
    try {
      await criar.mutateAsync({ nome: nome.trim(), email: email.trim(), cargo: cargo.trim(), papel, senha });
      onCriado({ email: email.trim().toLowerCase(), senha, titulo: `${nome.trim()} pode entrar no admin` });
      setNome(""); setEmail(""); setCargo(""); setPapel("colaborador");
    } catch (err) {
      toast.error("Não foi possível criar.", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo usuário</DialogTitle>
          <DialogDescription className="sr-only">Cria o login e o perfil. A senha é gerada e aparece uma vez, para você passar à pessoa.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="u-nome">Nome</Label><Input id="u-nome" value={nome} onChange={(e) => setNome(e.target.value)} required autoFocus /></div>
          <div className="space-y-1.5"><Label htmlFor="u-email">E-mail (login)</Label><Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="space-y-1.5"><Label htmlFor="u-cargo">Cargo</Label><Input id="u-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} placeholder="Ex.: Consultor" /></div>
          <NivelSelect valor={papel} onChange={setPapel} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={!nome.trim() || !email.trim() || criar.isPending}>
              {criar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const SEM_DEP = "nenhum";

function NivelSelect({ valor, onChange }: { valor: Usuario["papel"]; onChange: (v: Usuario["papel"]) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>Nível</Label>
      <Select value={valor} onValueChange={(v) => onChange(v as Usuario["papel"])}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="colaborador">Colaborador</SelectItem>
          <SelectItem value="gestor">Gestor</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// Login e senha aparecem UMA vez (o banco guarda só o hash).
function CredencialDialog({ dados, onFechar }: { dados: Credencial | null; onFechar: () => void }) {
  const endereco = window.location.origin;
  const copiar = async (t: string) => {
    try { await navigator.clipboard.writeText(t); toast.success("Copiado."); } catch { toast.error("Não foi possível copiar."); }
  };
  return (
    <Dialog open={!!dados} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dados?.titulo}</DialogTitle>
          <DialogDescription>A senha aparece só agora.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <p><span className="text-muted-foreground">Endereço:</span> {endereco}</p>
          <p><span className="text-muted-foreground">E-mail:</span> <strong>{dados?.email}</strong></p>
          <p className="flex items-center gap-2">
            <span className="text-muted-foreground">Senha:</span>
            <strong className="font-mono text-base tracking-wider">{dados?.senha}</strong>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => dados && copiar(dados.senha)} aria-label="Copiar senha"><Copy className="h-3.5 w-3.5" /></Button>
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => dados && copiar(`Quadrum Admin\n${endereco}\nE-mail: ${dados.email}\nSenha: ${dados.senha}`)}>Copiar tudo</Button>
          <Button type="button" onClick={onFechar}>Pronto</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
