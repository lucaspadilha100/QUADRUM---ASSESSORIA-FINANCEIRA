import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Carregando, Falha, Vazio } from "@/components/Estados";
import { useAuth } from "@/contexts/AuthContext";

// ─────────────────────────────────────────────────────────────────────────────
// Cadastro curto (bancos, linhas de crédito, unidades): uma lista, um botão de
// novo, editar no clique e ATIVAR/DESATIVAR na própria linha. Nada se apaga:
// contrato antigo continua apontando para a linha desativada. Só o gestor
// grava (a RLS é a trava; a tela só esconde o botão).
// ─────────────────────────────────────────────────────────────────────────────

export interface CampoCadastro<T> {
  chave: keyof T & string;
  rotulo: string;
  tipo?: "texto" | "interruptor";
  placeholder?: string;
  ajuda?: string;
  maxLength?: number;
  maiusculo?: boolean;
  obrigatorio?: boolean;
  /** Como aparece na lista (padrão: o valor, ou "—"). */
  mostrar?: (linha: T) => ReactNode;
}

export function CadastroSimples<T extends { id: string; nome: string; ativo: boolean }>({
  titulo, descricao, singular, linhas, carregando, erro, campos, onSalvar, salvando, explicacao,
}: {
  titulo: string;
  descricao: string;
  singular: string;
  linhas: T[];
  carregando: boolean;
  erro: unknown;
  campos: CampoCadastro<T>[];
  onSalvar: (id: string | undefined, campos: Record<string, unknown>) => Promise<void>;
  salvando: boolean;
  explicacao?: ReactNode;
}) {
  const { isGestor } = useAuth();
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<T | "novo" | null>(null);
  const sem = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const filtradas = useMemo(() => {
    const t = sem(busca.trim());
    return linhas.filter((l) => !t || sem(Object.values(l).filter((v) => typeof v === "string").join(" ")).includes(t));
  }, [linhas, busca]);
  const colunas = campos.filter((c) => c.chave !== "nome");

  const alternar = async (l: T, chave: string, valor: boolean) => {
    try { await onSalvar(l.id, { [chave]: valor }); }
    catch (e) { toast.error("Não foi possível salvar.", { description: (e as Error).message }); }
  };

  return (
    <div>
      <PageHeader
        titulo={titulo}
        descricao={descricao}
        acoes={isGestor ? <Button onClick={() => setEditando("novo")}><Plus className="mr-1.5 h-4 w-4" /> Novo {singular}</Button> : undefined}
      />
      {explicacao && <div className="px-4 pt-4 text-xs text-muted-foreground sm:px-8">{explicacao}</div>}
      <div className="px-4 pt-4 sm:px-8">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" className="bg-card pl-9" />
        </div>
      </div>
      <div className="px-4 py-4 sm:px-8">
        {carregando ? <Carregando /> : erro ? <Falha erro={erro as Error} /> : filtradas.length === 0 ? (
          <Vazio texto={linhas.length === 0 ? `Nenhum ${singular} cadastrado ainda.${isGestor ? ` Use "Novo ${singular}".` : ""}` : "Nada com essa busca."} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  {colunas.map((c) => <th key={c.chave} className={`px-4 py-2.5 font-medium ${c.tipo === "interruptor" ? "text-center" : ""}`}>{c.rotulo}</th>)}
                  <th className="px-4 py-2.5 text-center font-medium">Ativo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtradas.map((l) => (
                  <tr key={l.id} className={l.ativo ? "" : "opacity-60"}>
                    <td className="px-4 py-3">
                      {isGestor
                        ? <button type="button" onClick={() => setEditando(l)} className="text-left font-medium text-foreground hover:underline">{l.nome}</button>
                        : <span className="font-medium">{l.nome}</span>}
                      {!l.ativo && <span className="ml-2 text-xs text-muted-foreground">(desativado)</span>}
                    </td>
                    {colunas.map((c) => (
                      <td key={c.chave} className={`px-4 py-3 ${c.tipo === "interruptor" ? "text-center" : "text-muted-foreground"}`}>
                        {c.tipo === "interruptor"
                          ? <Switch checked={!!l[c.chave]} disabled={!isGestor || salvando} onCheckedChange={(v) => alternar(l, c.chave, v)} aria-label={`${l.nome}: ${c.rotulo}`} />
                          : c.mostrar ? c.mostrar(l) : (String(l[c.chave] ?? "") || "—")}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      <Switch checked={l.ativo} disabled={!isGestor || salvando} onCheckedChange={(v) => alternar(l, "ativo", v)} aria-label={`${l.nome} ativo`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {isGestor ? "Desativar tira da lista de escolha sem apagar: contratos antigos continuam com o que tinham." : `Só um gestor altera ${titulo.toLowerCase()}.`}
        </p>
      </div>
      <Editar alvo={editando} campos={campos} singular={singular} onSalvar={onSalvar} salvando={salvando} onFechar={() => setEditando(null)} />
    </div>
  );
}

function Editar<T extends { id: string; nome: string; ativo: boolean }>({ alvo, campos, singular, onSalvar, salvando, onFechar }: {
  alvo: T | "novo" | null;
  campos: CampoCadastro<T>[];
  singular: string;
  onSalvar: (id: string | undefined, campos: Record<string, unknown>) => Promise<void>;
  salvando: boolean;
  onFechar: () => void;
}) {
  const novo = alvo === "novo";
  const linha = novo || !alvo ? null : alvo;
  const [valores, setValores] = useState<Record<string, unknown>>({});
  const [chave, setChave] = useState<string | null>(null);
  const atual = novo ? "novo" : linha?.id ?? null;
  if (atual !== chave) {
    setChave(atual);
    setValores(Object.fromEntries(campos.map((c) => [c.chave, linha ? linha[c.chave] ?? (c.tipo === "interruptor" ? false : "") : c.tipo === "interruptor" ? false : ""])));
  }

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const out: Record<string, unknown> = {};
    for (const c of campos) {
      const v = valores[c.chave];
      if (c.tipo === "interruptor") { out[c.chave] = !!v; continue; }
      let t = String(v ?? "").trim();
      if (c.maiusculo) t = t.toUpperCase();
      if (c.obrigatorio && !t) return toast.error(`Preencha ${c.rotulo.toLowerCase()}.`);
      out[c.chave] = t || null;
    }
    try {
      await onSalvar(linha?.id, out);
      toast.success(novo ? `${singular[0].toUpperCase()}${singular.slice(1)} cadastrado.` : "Salvo.");
      onFechar();
    } catch (err) {
      toast.error("Não foi possível salvar.", { description: (err as Error).message });
    }
  };

  return (
    <Dialog open={!!alvo} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{novo ? `Novo ${singular}` : `Editar ${singular}`}</DialogTitle>
          <DialogDescription>Ativar e desativar muda direto na lista.</DialogDescription>
        </DialogHeader>
        <form onSubmit={enviar} className="space-y-3">
          {campos.map((c) => c.tipo === "interruptor" ? (
            <label key={c.chave} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
              <Switch checked={!!valores[c.chave]} onCheckedChange={(v) => setValores((x) => ({ ...x, [c.chave]: v }))} />
              <span><span className="font-medium">{c.rotulo}</span>{c.ajuda && <span className="block text-[11px] text-muted-foreground">{c.ajuda}</span>}</span>
            </label>
          ) : (
            <div key={c.chave} className="space-y-1.5">
              <Label htmlFor={`cad-${c.chave}`}>{c.rotulo}</Label>
              <Input id={`cad-${c.chave}`} value={String(valores[c.chave] ?? "")} placeholder={c.placeholder} maxLength={c.maxLength}
                className={c.maiusculo ? "uppercase" : undefined} autoFocus={c.chave === "nome"}
                onChange={(e) => setValores((x) => ({ ...x, [c.chave]: e.target.value }))} />
              {c.ajuda && <p className="text-[11px] text-muted-foreground">{c.ajuda}</p>}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
