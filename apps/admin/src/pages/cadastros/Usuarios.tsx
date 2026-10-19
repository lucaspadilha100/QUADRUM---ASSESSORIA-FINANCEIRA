import { useState, type FormEvent } from "react";
import { Copy, KeyRound, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Chips } from "@/components/Chips";
import { Paginacao, usePaginacaoUrl } from "@/components/Paginacao";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { confirmar } from "@/shell";
import { useAuth, PAPEL_LABEL } from "@/contexts/AuthContext";
import { gerarSenha } from "@/hooks/usePipeline";
import { useAtualizarUsuario, useCriarUsuario, useRedefinirSenhaUsuario, useSenhasProvisorias, useUsuarios, type Usuario } from "@/hooks/useUsuarios";
import { useParamUrl } from "@/shell";
import { Avatar } from "@/components/Avatar";
import { useDepartamentos } from "@/hooks/useCadastros";

// ─────────────────────────────────────────────────────────────────────────────
// A equipe. Sem matriz de telas: o NÍVEL decide (gestor vê e opera tudo;
// colaborador vê só a própria carteira). Só o gestor cria, muda nível,
// desativa e redefine senha — e quem garante é o banco, não esta tela.
// Desativar NÃO apaga: contratos, histórico e mensagens continuam com o nome.
// ─────────────────────────────────────────────────────────────────────────────

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export default function Usuarios() {
  const { isGestor, perfil } = useAuth();
  const { data: usuarios = [], isLoading, error } = useUsuarios();
  const { data: provisorias } = useSenhasProvisorias();
  const { data: deps = [] } = useDepartamentos();
  const nomeDep = (id?: string | null) => deps.find((d) => d.id === id)?.nome;
  const [filtro, setFiltro] = useParamUrl("situacao", "ativos");
  const [busca, setBusca] = useParamUrl("busca", "", { replace: true });
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [novo, setNovo] = useState(false);
  const [credencial, setCredencial] = useState<{ email: string; senha: string; titulo: string } | null>(null);
  const pag = usePaginacaoUrl();

  const ativos = usuarios.filter((u) => u.ativo).length;
  const t = semAcento(busca.trim());
  const lista = usuarios
    .filter((u) => (filtro === "ativos" ? u.ativo : !u.ativo))
    .filter((u) => !t || semAcento(`${u.nome} ${u.email ?? ""} ${u.cargo ?? ""}`).includes(t));
  // A equipe é pequena (dezenas): lê-se inteira e pagina-se na tela.
  const pagina = lista.slice((pag.pagina - 1) * pag.por, pag.pagina * pag.por);

  return (
    <div>
      <PageHeader
        titulo="Usuários"
        acoes={isGestor ? <Button onClick={() => setNovo(true)}><Plus className="mr-1.5 h-4 w-4" /> Novo usuário</Button> : undefined}
      />

      <div className="flex flex-wrap items-center gap-2 px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => { setBusca(e.target.value); pag.voltarAoInicio(); }} placeholder="Buscar nome, e-mail ou cargo" className="bg-card pl-9" />
        </div>
        <Chips valor={filtro} onChange={(v) => { setFiltro(v); pag.voltarAoInicio(); }} opcoes={[
          { valor: "ativos", rotulo: `Ativos (${ativos})` },
          { valor: "desativados", rotulo: `Desativados (${usuarios.length - ativos})` },
        ]} />
      </div>

      <div className="px-4 py-4 sm:px-8">
        {isLoading ? <Carregando /> : error ? <Falha erro={error as Error} /> : lista.length === 0 ? (
          <Vazio texto={filtro === "ativos" ? "Nenhum usuário ativo com esse filtro." : "Ninguém desativado."} />
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {pagina.map((u) => (
                <li key={u.id} className="flex items-center gap-3 p-4">
                  <Avatar nome={u.nome} url={u.avatar_url} className="h-10 w-10 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-foreground sm:truncate">
                      {u.nome} {u.id === perfil?.id && <span className="text-xs font-normal text-muted-foreground">(você)</span>}
                    </p>
                    <p className="break-all text-xs text-muted-foreground sm:truncate sm:break-normal">{[u.email, nomeDep(u.departamento_id), u.cargo, u.telefone].filter(Boolean).join(" · ")}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${u.papel !== "colaborador" ? "bg-q-onix text-q-gold" : "bg-muted text-muted-foreground"}`}>
                        {PAPEL_LABEL[u.papel]}
                      </span>
                      {provisorias?.has(u.id) && (
                        <span className="rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-medium text-warning">Senha provisória</span>
                      )}
                    </div>
                  </div>
                  {isGestor && (
                    <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditando(u)}>Editar</Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <Paginacao pagina={pag.pagina} por={pag.por} total={lista.length} onPagina={pag.irPara} onPor={pag.mudarPor} />
      </div>

      {isGestor && (
        <>
          <NovoUsuario aberto={novo} onFechar={() => setNovo(false)} onCriado={(c) => { setNovo(false); setCredencial(c); }} />
          <EditarUsuario usuario={editando} euId={perfil?.id ?? ""} onFechar={() => setEditando(null)} onSenha={(c) => setCredencial(c)} />
          <Credencial dados={credencial} onFechar={() => setCredencial(null)} />
        </>
      )}
    </div>
  );
}

function NovoUsuario({ aberto, onFechar, onCriado }: {
  aberto: boolean; onFechar: () => void; onCriado: (c: { email: string; senha: string; titulo: string }) => void;
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

function EditarUsuario({ usuario, euId, onFechar, onSenha }: {
  usuario: Usuario | null; euId: string; onFechar: () => void;
  onSenha: (c: { email: string; senha: string; titulo: string }) => void;
}) {
  const atualizar = useAtualizarUsuario();
  const redefinir = useRedefinirSenhaUsuario();
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
      onFechar();
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  const novaSenha = async () => {
    if (!usuario) return;
    if (!(await confirmar({ titulo: `Redefinir a senha de ${usuario.nome}?`, mensagem: "A senha atual deixa de valer na hora.", confirmar: "Redefinir" }))) return;
    const senha = gerarSenha();
    try {
      await redefinir.mutateAsync({ id: usuario.id, senha });
      onSenha({ email: usuario.email ?? "", senha, titulo: `Nova senha de ${usuario.nome}` });
    } catch (err) {
      toast.error("Não foi possível redefinir.", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={!!usuario} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>{usuario?.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={salvar} className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="e-nome">Nome</Label><Input id="e-nome" value={nome} onChange={(e) => setNome(e.target.value)} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="e-cargo">Cargo</Label><Input id="e-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="e-tel">Telefone</Label><Input id="e-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {usuario?.papel === "admin"
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
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Ativo</p>
              {souEu && <p className="text-[11px] text-muted-foreground">Você não pode se desativar.</p>}
            </div>
            <Switch checked={ativo} onCheckedChange={setAtivo} disabled={souEu} aria-label="Ativo" />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={novaSenha} disabled={redefinir.isPending}>
              <KeyRound className="mr-1.5 h-4 w-4" /> Redefinir senha
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
              <Button type="submit" disabled={!nome.trim() || atualizar.isPending}>
                {atualizar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar
              </Button>
            </div>
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
function Credencial({ dados, onFechar }: { dados: { email: string; senha: string; titulo: string } | null; onFechar: () => void }) {
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
