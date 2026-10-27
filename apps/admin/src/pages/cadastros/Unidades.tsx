import { CadastroSimples } from "@/components/CadastroSimples";
import { useSalvarCadastro, useUnidades, type Unidade } from "@/hooks/useCadastros";

// Unidades e parceiros. No Portal do Cliente o contrato mostra "Unidade"
// como "cidade, UF".
export default function Unidades() {
  const { data = [], isLoading, error } = useUnidades();
  const salvar = useSalvarCadastro("unidades", "unidades");
  return (
    <CadastroSimples<Unidade>
      titulo="Unidades" singular="unidade"
      linhas={data} carregando={isLoading} erro={error} salvando={salvar.isPending}
      onSalvar={(id, campos) => salvar.mutateAsync({ id, campos })}
      campos={[
        { chave: "nome", rotulo: "Nome", obrigatorio: true, placeholder: "Ex.: TriConecta Natal" },
        { chave: "cidade", rotulo: "Cidade", placeholder: "Natal" },
        { chave: "uf", rotulo: "UF", placeholder: "RN", maxLength: 2, maiusculo: true },
      ]}
    />
  );
}
