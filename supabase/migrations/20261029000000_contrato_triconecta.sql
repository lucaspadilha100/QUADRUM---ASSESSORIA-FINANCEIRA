-- O contrato editado pela TriConecta (27/10/2026, contrato_triconecta.docx).
-- As cláusulas 2 a 13.2 são as MESMAS do modelo v2 (conferido linha a linha);
-- o que mudou foi a CONTRATADA (nome, CNPJ, sede) e a assinatura dela no fim.
--
-- Mantidos de propósito, e o dono do processo sabe:
--   · a 13.3 (aceite da assinatura eletrônica, MP 2.200-2/2001, art. 10 § 2º):
--     é a base da assinatura pelo portal; o .docx é para papel e não a traz;
--   · o título com o nº do contrato;
--   · três erros de digitação do .docx corrigidos ("al CONTRATANTE",
--     "CONTRADADA", "tiene ciência") e RENAVAM com M.

-- ═══ BLOCO 1 · Dados da empresa (como estão no contrato) ═══════════════════
-- Só preenche o que está vazio; o nome passa a "TRICONECTA" (como o contrato
-- escreve) só se ainda for o da 20261028.
update public.empresa
   set nome     = case when nome = 'TRICONECTA ASSESSORIA' then 'TRICONECTA' else nome end,
       cnpj     = coalesce(cnpj, '43082428000133'),
       endereco = coalesce(endereco, 'Rua Dr. Luiz Felipe Câmara, nº 55 – Natal/RN'),
       updated_at = now()
 where id;


-- ═══ BLOCO 2 · o modelo do contrato ════════════════════════════════════════
-- Troca dois trechos do texto do modelo (editar sobe a versão, v2 → v3).
-- Aborta se o modelo foi mexido na tela e os trechos não estão mais lá.
do $$
declare
  a1 text := 'inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.endereco}}, telefone:';
  b1 text := 'inscrita no CNPJ sob o nº {{empresa.cnpj}}, sediada na {{empresa.endereco}}, telefone:';
  a2 text := $a${{contrato.unidade}}, {{data.extenso}}.

{{cliente.nome}}
{{cliente.tipo_documento}}: {{cliente.documento}}$a$;
  b2 text := $b${{contrato.unidade}}, {{data.extenso}}.

**{{empresa.nome}}**
CNPJ: {{empresa.cnpj}}

**CONTRATANTE:** {{cliente.nome}}
{{cliente.tipo_documento}}: {{cliente.documento}}$b$;
  v_n int;
begin
  if exists (select 1 from public.documento_modelos
              where tipo = 'contrato' and ativo and position(b1 in corpo) > 0 and position(b2 in corpo) > 0) then
    return;  -- já aplicado
  end if;
  update public.documento_modelos
     set corpo = replace(replace(corpo, a1, b1), a2, b2)
   where tipo = 'contrato' and ativo and position(a1 in corpo) > 0 and position(a2 in corpo) > 0;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'Esperava UM contrato ativo com o texto da v2; achei %. Nada foi mudado.', v_n;
  end if;
end $$;
