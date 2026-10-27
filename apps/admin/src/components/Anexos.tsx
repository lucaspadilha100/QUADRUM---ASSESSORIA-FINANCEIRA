import { useRef, useState } from "react";
import { FileImage, FileText, Loader2, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { confirmar } from "@/shell";
import { abrirArquivo, useAnexoTipos, useAnexos, useDesativarAnexo, useEnviarAnexo, type AnexoTipo } from "@/hooks/useAnexos";
import { dataBR } from "@/lib/formato";

// Os arquivos de UMA seção (Identificação, Endereço, Veículo, Financiamento):
// o que foi anexado e o "Anexar" com os tipos daquela seção (cadastro
// `anexo_tipos`). O arquivo sobe na hora, sem esperar o Salvar do formulário.

export function Anexos({ secao, clienteId, contratoId }: { secao: string; clienteId?: string; contratoId?: string }) {
  const { data: todos = [] } = useAnexoTipos();
  const tipos = todos.filter((t) => t.secao === secao);
  const de = tipos[0]?.de;
  const alvo = de === "contrato" ? { contratoId } : { clienteId };
  const { data: anexos = [] } = useAnexos(de ? alvo : {});
  const enviar = useEnviarAnexo();
  const desativar = useDesativarAnexo();
  const campo = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<AnexoTipo | null>(null);

  if (!tipos.length || !(de === "contrato" ? contratoId : clienteId)) return null;
  const daSecao = anexos.filter((a) => tipos.some((t) => t.codigo === a.tipo));
  const nomeTipo = (c: string) => tipos.find((t) => t.codigo === c)?.nome ?? c;

  const escolher = (t: AnexoTipo) => { setTipo(t); campo.current?.click(); };
  const aoEscolher = async (arquivo: File | undefined) => {
    if (campo.current) campo.current.value = "";
    if (!arquivo || !tipo) return;
    try {
      await enviar.mutateAsync({ tipo, clienteId, contratoId, arquivo });
      toast.success(`${tipo.nome} anexado.`);
    } catch (e) {
      toast.error("Não foi possível anexar.", { description: (e as Error).message });
    }
  };
  const remover = async (id: string, nome: string) => {
    if (!(await confirmar({ titulo: `Remover ${nome}?`, mensagem: "Ele sai da lista; o arquivo continua guardado.", confirmar: "Remover", perigo: true }))) return;
    try { await desativar.mutateAsync(id); } catch (e) { toast.error("Não foi possível remover.", { description: (e as Error).message }); }
  };
  const ver = (path: string) => abrirArquivo("anexos", path).catch((e) => toast.error("Não foi possível abrir.", { description: (e as Error).message }));

  const botao = (
    <Button type="button" size="sm" variant="outline" disabled={enviar.isPending} onClick={tipos.length === 1 ? () => escolher(tipos[0]) : undefined}>
      {enviar.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1 h-3.5 w-3.5" />}
      {tipos.length === 1 ? `Anexar ${tipos[0].nome}` : "Anexar"}
    </Button>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <input ref={campo} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => aoEscolher(e.target.files?.[0])} />
      {daSecao.length > 0 && (
        <ul className="space-y-1.5">
          {daSecao.map((a) => (
            <li key={a.id} className="flex min-h-10 items-center gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
              {a.mime === "application/pdf" ? <FileText className="h-4 w-4 shrink-0 text-q-petrol" /> : <FileImage className="h-4 w-4 shrink-0 text-q-petrol" />}
              <button type="button" onClick={() => ver(a.path)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium text-foreground hover:underline">{nomeTipo(a.tipo)}</span>
                <span className="block truncate text-xs text-muted-foreground">{[a.nome, dataBR(a.created_at)].filter(Boolean).join(" · ")}</span>
              </button>
              <button type="button" aria-label={`Remover ${nomeTipo(a.tipo)}`} onClick={() => remover(a.id, nomeTipo(a.tipo))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive">
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {tipos.length === 1 ? botao : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{botao}</DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {tipos.map((t) => <DropdownMenuItem key={t.codigo} onSelect={() => escolher(t)}>{t.nome}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
