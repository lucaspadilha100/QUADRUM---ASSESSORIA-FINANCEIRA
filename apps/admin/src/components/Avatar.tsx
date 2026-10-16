import { cn } from "@/lib/utils";

export const iniciais = (nome?: string | null) =>
  (nome ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";

export function Avatar({ nome, url, className }: { nome?: string | null; url?: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" loading="lazy" decoding="async" className={cn("h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border", className)} />
  ) : (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-q-onix font-titulo text-xs font-semibold text-q-gold ring-1 ring-border", className)}>
      {iniciais(nome)}
    </span>
  );
}
