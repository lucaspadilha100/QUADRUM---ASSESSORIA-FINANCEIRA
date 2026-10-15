import { CadastroSimples } from "@/components/CadastroSimples";
import { useBancos, useSalvarCadastro, type Banco } from "@/hooks/useCadastros";

// Os bancos credores dos contratos. Aparecem no card, no Portal do Cliente
// ("Banco") e preenchem {{contrato.banco}} nos documentos.
export default function Bancos() {
  const { data = [], isLoading, error } = useBancos();
  const salvar = useSalvarCadastro("bancos", "bancos");
  return (
    <CadastroSimples<Banco>
      titulo="Bancos" singular="banco"
      linhas={data} carregando={isLoading} erro={error} salvando={salvar.isPending}
      onSalvar={(id, campos) => salvar.mutateAsync({ id, campos })}
      campos={[
        { chave: "nome", rotulo: "Nome", obrigatorio: true, placeholder: "Ex.: Banco Pan" },
        { chave: "codigo", rotulo: "Código (COMPE)", placeholder: "Ex.: 623", maxLength: 3 },
      ]}
    />
  );
}
