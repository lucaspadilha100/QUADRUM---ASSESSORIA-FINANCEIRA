/** Filtro em pílulas: UMA escolha por vez (abas leves, sem mudar de tela). */
export function Chips({ valor, onChange, opcoes }: {
  valor: string;
  onChange: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.valor)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              ativo ? "border-q-onix bg-q-onix text-q-gold" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}
