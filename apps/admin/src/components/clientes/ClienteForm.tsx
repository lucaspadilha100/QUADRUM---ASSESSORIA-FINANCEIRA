import { useEffect, useState, type FormEvent } from "react";
import { FileSignature, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CampoData } from "@/components/CampoData";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useEquipe } from "@/hooks/useCadastros";
import { CAMPOS_DOCUMENTO, type DadosCliente, type DadosDocumento } from "@/hooks/useClientes";
import { soDigitos } from "@/lib/formato";

const NENHUM = "nenhum";
const ESTADOS_CIVIS = ["solteiro(a)", "casado(a)", "divorciado(a)", "viúvo(a)", "separado(a) judicialmente", "em união estável"];
type Doc = Record<keyof DadosDocumento, string>;

const docVazio = (): Doc => Object.fromEntries(CAMPOS_DOCUMENTO.map((k) => [k, ""])) as Doc;
const docDe = (d?: Partial<DadosDocumento> | null): Doc =>
  Object.fromEntries(CAMPOS_DOCUMENTO.map((k) => [k, (d?.[k] ?? "").toString()])) as Doc;

// O que os modelos pedem, por tipo de pessoa (é o que a `q_documento_variaveis`
// junta na qualificação). Contar o que falta AQUI evita descobrir na geração.
const PEDIDOS_PF: (keyof DadosDocumento)[] = ["nacionalidade", "estado_civil", "profissao", "rg", "logradouro", "cidade", "uf"];
const PEDIDOS_PJ: (keyof DadosDocumento)[] = ["representante_nome", "representante_documento", "logradouro", "cidade", "uf"];

/**
 * Os campos do cliente — o MESMO formulário no "Novo cliente" e na ficha.
 * Consultor: o gestor escolhe; o colaborador não vê o seletor (o cliente é
 * dele, e a RLS recusaria passar para outro).
 * "Dados para documentos": o que os modelos (procuração, contrato…) preenchem.
 */
export function ClienteForm({ inicial, inicialDocumento, tipoPessoa, consultorInicial, onSalvar, salvando, rotuloSalvar, antes }: {
  inicial?: Partial<DadosCliente>;
  inicialDocumento?: Partial<DadosDocumento> | null;
  tipoPessoa: "PF" | "PJ" | null;
  consultorInicial?: string | null;
  onSalvar: (d: DadosCliente) => void;
  salvando: boolean;
  rotuloSalvar: string;
  antes?: React.ReactNode;
}) {
  const { isGestor, perfil } = useAuth();
  const { data: equipe = [] } = useEquipe();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [telefone, setTelefone] = useState(inicial?.telefone ?? "");
  const [email, setEmail] = useState(inicial?.email ?? "");
  const [observacoes, setObservacoes] = useState(inicial?.observacoes ?? "");
  const [consultor, setConsultor] = useState(consultorInicial ?? perfil?.id ?? NENHUM);
  const [doc, setDoc] = useState<Doc>(() => docDe(inicialDocumento));
  const [cepMsg, setCepMsg] = useState("");
  const chaveDoc = JSON.stringify(inicialDocumento ?? null);

  useEffect(() => {
    setNome(inicial?.nome ?? ""); setTelefone(inicial?.telefone ?? ""); setEmail(inicial?.email ?? "");
    setObservacoes(inicial?.observacoes ?? ""); setConsultor(consultorInicial ?? perfil?.id ?? NENHUM);
    setDoc(inicialDocumento ? docDe(inicialDocumento) : docVazio());
  }, [inicial?.nome, inicial?.telefone, inicial?.email, inicial?.observacoes, consultorInicial, chaveDoc]); // eslint-disable-line react-hooks/exhaustive-deps

  const muda = (k: keyof DadosDocumento) => (v: string) => setDoc((d) => ({ ...d, [k]: v }));

  // CEP completo ⇒ preenche rua, bairro, cidade e UF (ViaCEP). Só completa o
  // que está VAZIO: não apaga o que alguém já digitou.
  const buscarCep = async (cep: string) => {
    const d = soDigitos(cep);
    if (d.length !== 8) return;
    setCepMsg("Buscando o CEP…");
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = await r.json();
      if (j.erro) { setCepMsg("CEP não encontrado — preencha o endereço à mão."); return; }
      setDoc((x) => ({
        ...x,
        logradouro: x.logradouro || j.logradouro || "",
        bairro: x.bairro || j.bairro || "",
        cidade: x.cidade || j.localidade || "",
        uf: x.uf || j.uf || "",
      }));
      setCepMsg("");
    } catch {
      setCepMsg("Não foi possível consultar o CEP — preencha o endereço à mão.");
    }
  };

  const pedidos = tipoPessoa === "PJ" ? PEDIDOS_PJ : PEDIDOS_PF;
  const faltam = tipoPessoa ? pedidos.filter((k) => !doc[k].trim()).length : 0;

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onSalvar({
      nome, telefone, email, observacoes,
      dadosDocumento: doc,
      ...(isGestor ? { consultorId: consultor === NENHUM ? null : consultor } : {}),
    });
  };

  const campo = (k: keyof DadosDocumento, rotulo: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`cli-${k}`}>{rotulo}</Label>
      <Input id={`cli-${k}`} value={doc[k]} onChange={(e) => muda(k)(e.target.value)} {...extra} />
    </div>
  );

  return (
    <form onSubmit={enviar} className="space-y-3">
      {antes}
      <div className="space-y-1.5">
        <Label htmlFor="cli-nome">{tipoPessoa === "PJ" ? "Razão social" : "Nome completo"}</Label>
        <Input id="cli-nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="cli-tel">Telefone</Label>
          <Input id="cli-tel" type="tel" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cli-mail">E-mail</Label>
          <Input id="cli-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      {isGestor && (
        <div className="space-y-1.5">
          <Label>Consultor (dono da carteira)</Label>
          <Select value={consultor} onValueChange={setConsultor}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NENHUM}>Sem consultor</SelectItem>
              {equipe.filter((p) => p.ativo || p.id === consultorInicial).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">O colaborador só enxerga os clientes de que é consultor.</p>
        </div>
      )}

      <details className="group rounded-lg border border-border" open={!!inicialDocumento && faltam < pedidos.length}>
        <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-semibold">
          <FileSignature className="h-4 w-4 text-q-petrol" />
          Dados para documentos
          <span className={`ml-auto text-xs font-normal ${faltam ? "text-warning" : "text-success"}`}>
            {tipoPessoa ? (faltam ? `faltam ${faltam}` : "completo") : ""}
          </span>
        </summary>
        <div className="space-y-3 border-t border-border p-3">
          <p className="text-[11px] text-muted-foreground">
            É o que preenche a procuração, o contrato e os demais modelos. Documento só é gerado com o que ele usa preenchido.
          </p>
          {tipoPessoa === "PJ" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {campo("representante_nome", "Representante legal")}
              {campo("representante_documento", "CPF do representante", { inputMode: "numeric" })}
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {campo("nacionalidade", "Nacionalidade", { placeholder: "brasileira" })}
                <div className="space-y-1.5">
                  <Label>Estado civil</Label>
                  <Select value={doc.estado_civil || NENHUM} onValueChange={(v) => muda("estado_civil")(v === NENHUM ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NENHUM}>Não informado</SelectItem>
                      {[...new Set([...ESTADOS_CIVIS, ...(doc.estado_civil ? [doc.estado_civil] : [])])].map((e) => (
                        <SelectItem key={e} value={e}>{e}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {campo("profissao", "Profissão")}
                <div className="space-y-1.5">
                  <Label htmlFor="cli-data_nascimento">Data de nascimento</Label>
                  <CampoData id="cli-data_nascimento" valor={doc.data_nascimento} onChange={muda("data_nascimento")} anoMax={new Date().getFullYear()} />
                </div>
                {campo("rg", "RG")}
                {campo("rg_orgao", "Órgão emissor", { placeholder: "SSP/RN" })}
              </div>
            </>
          )}
          <div className="grid gap-3 sm:grid-cols-[140px_1fr_100px]">
            <div className="space-y-1.5">
              <Label htmlFor="cli-cep">CEP</Label>
              <Input id="cli-cep" inputMode="numeric" value={doc.cep}
                onChange={(e) => { muda("cep")(e.target.value); buscarCep(e.target.value); }} placeholder="59000-000" />
            </div>
            {campo("logradouro", "Rua / avenida")}
            {campo("endereco_numero", "Número")}
          </div>
          {cepMsg && <p className="text-[11px] text-muted-foreground">{cepMsg}</p>}
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_70px]">
            {campo("complemento", "Complemento")}
            {campo("bairro", "Bairro")}
            {campo("cidade", "Cidade")}
            {campo("uf", "UF", { maxLength: 2, className: "uppercase" })}
          </div>
        </div>
      </details>

      <div className="space-y-1.5">
        <Label htmlFor="cli-obs">Observações internas (o cliente NÃO vê)</Label>
        <Textarea id="cli-obs" rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={salvando || !nome.trim()}>
          {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {rotuloSalvar}
        </Button>
      </div>
    </form>
  );
}
