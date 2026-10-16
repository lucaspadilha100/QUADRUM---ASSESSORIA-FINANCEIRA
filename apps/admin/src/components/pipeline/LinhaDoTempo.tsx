import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CirclePlus, RotateCcw, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEquipe, useEtapas } from "@/hooks/useCadastros";
import { dataHoraBR } from "@/lib/formato";

// Quem moveu o card, de onde para onde, quando — e quanto tempo ficou em cada
// etapa. Quem grava é o banco (contrato_movimentos, migração 20261020000000).

interface Movimento {
  id: string; tipo: "criado" | "etapa" | "perdido" | "reaberto";
  de_etapa_id: string | null; para_etapa_id: string | null; autor_id: string | null;
  motivo: string | null; reconstituido: boolean; created_at: string;
}

function duracao(ms: number) {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`;
  if (h < 24) return `${Math.round(h)} h`;
  const d = Math.round(h / 24);
  return `${d} dia${d === 1 ? "" : "s"}`;
}

export function LinhaDoTempo({ contratoId }: { contratoId: string }) {
  const { data: etapas = [] } = useEtapas();
  const { data: equipe = [] } = useEquipe();
  const { data = [], error } = useQuery({
    queryKey: ["contrato", contratoId, "movimentos"],
    queryFn: async () => {
      const { data, error } = await supabase.from("contrato_movimentos")
        .select("id, tipo, de_etapa_id, para_etapa_id, autor_id, motivo, reconstituido, created_at")
        .eq("contrato_id", contratoId).order("created_at", { ascending: true }).order("id", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Movimento[];
    },
  });
  const etapa = (id: string | null) => etapas.find((e) => e.id === id)?.nome ?? "—";
  const pessoa = (id: string | null) => (id ? equipe.find((p) => p.id === id)?.nome ?? "Equipe" : null);

  if (error) return <p className="text-sm text-destructive">Não foi possível carregar a linha do tempo.</p>;
  if (data.length === 0) return null;

  const itens = data.map((m, i) => ({ m, ficou: i > 0 && m.tipo === "etapa" ? new Date(m.created_at).getTime() - new Date(data[i - 1].created_at).getTime() : null })).reverse();
  const ultimo = [...data].reverse().find((m) => m.tipo !== "perdido") ?? data[data.length - 1];

  return (
    <section className="border-t border-border pt-4">
      <h3 className="mb-3 text-sm font-semibold text-foreground">Linha do tempo</h3>
      <p className="mb-3 text-xs text-muted-foreground">Na etapa atual há {duracao(Date.now() - new Date(ultimo.created_at).getTime())}</p>
      <ol className="space-y-3 border-l border-border pl-4">
        {itens.map(({ m, ficou }) => {
          const Icone = m.tipo === "criado" ? CirclePlus : m.tipo === "perdido" ? XCircle : m.tipo === "reaberto" ? RotateCcw : ArrowRight;
          const cor = m.tipo === "perdido" ? "text-destructive" : m.tipo === "criado" ? "text-q-gold" : "text-q-petrol";
          return (
            <li key={m.id} className="relative">
              <span className={`absolute -left-[25px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card ${cor}`}><Icone className="h-4 w-4" /></span>
              <p className="text-sm text-foreground">
                {m.tipo === "criado" && <>Criado em <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>}
                {m.tipo === "etapa" && <>{etapa(m.de_etapa_id)} → <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>}
                {m.tipo === "perdido" && <>Perdido{m.motivo ? `: ${m.motivo}` : ""}</>}
                {m.tipo === "reaberto" && <>Reaberto em <strong className="font-medium">{etapa(m.para_etapa_id)}</strong></>}
              </p>
              <p className="text-xs text-muted-foreground">
                {[pessoa(m.autor_id), dataHoraBR(m.created_at) + (m.reconstituido ? " (aprox.)" : ""), ficou != null ? `${duracao(ficou)} em ${etapa(m.de_etapa_id)}` : null].filter(Boolean).join(" · ")}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
