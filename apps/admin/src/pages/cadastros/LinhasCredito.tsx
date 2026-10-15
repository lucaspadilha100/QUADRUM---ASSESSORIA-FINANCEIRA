import { CadastroSimples } from "@/components/CadastroSimples";
import { useLinhasCredito, useSalvarCadastro, type LinhaCredito } from "@/hooks/useCadastros";

// As linhas de crédito (veicular, consignado, pessoal…). "Tem veículo" faz o
// contrato pedir veículo, ano e placa.
export default function LinhasCredito() {
  const { data = [], isLoading, error } = useLinhasCredito();
  const salvar = useSalvarCadastro("linhas_credito", "linhas");
  return (
    <CadastroSimples<LinhaCredito>
      titulo="Linhas de crédito" singular="linha de crédito"
      descricao="Veicular, consignado, pessoal… Aparecem no contrato e no Portal do Cliente."
      linhas={data} carregando={isLoading} erro={error} salvando={salvar.isPending}
      onSalvar={(id, campos) => salvar.mutateAsync({ id, campos })}
      campos={[
        { chave: "nome", rotulo: "Nome", obrigatorio: true, placeholder: "Ex.: Consignado" },
        { chave: "tem_veiculo", rotulo: "Tem veículo", tipo: "interruptor", ajuda: "O contrato desta linha pede veículo, ano/modelo e placa." },
      ]}
    />
  );
}
