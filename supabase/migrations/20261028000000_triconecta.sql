-- A empresa passou a se chamar TRICONECTA ASSESSORIA (27/10/2026). Troca o
-- NOME onde ele mora no banco; nada de chave interna (o e-mail sintético do
-- portal, <doc>@portal.quadrum.example, é o LOGIN de quem já tem acesso).
--
-- O que NÃO muda, de propósito:
--   · documento já GERADO: o texto é congelado com hash; errou, cancela e gera
--     outro (é a regra de sempre);
--   · conversa já gravada: mensagem não se reescreve;
--   · versão de termo de privacidade: o texto de uma versão nunca muda — entra
--     uma versão NOVA (rascunho), e o gestor publica quando quiser.

-- ═══ BLOCO 1 · a CONTRATADA dos documentos ═════════════════════════════════
-- Só troca o nome de partida; se alguém já escreveu outro, fica o dele.
update public.empresa set nome = 'TRICONECTA ASSESSORIA', updated_at = now()
 where nome = 'QUADRUM ASSESSORIA FINANCEIRA';


-- ═══ BLOCO 2 · as falas do robô (gravadas pelo banco) ══════════════════════
-- Troca no texto VIVO da função, não numa cópia do repositório; aborta se não
-- achar exatamente as duas falas. `create or replace` mantém os grants.
do $$
declare
  v_def text := pg_get_functiondef('public.portal_abrir_atendimento(uuid, uuid, text)'::regprocedure);
  v_novo text;
begin
  if v_def not like '%atendimento da Quadrum.%' or v_def not like '%contato com a Quadrum.%' then
    if v_def like '%TriConecta%' then return; end if;  -- já trocado
    raise exception 'portal_abrir_atendimento não tem as falas esperadas; nada foi mudado.';
  end if;
  v_novo := replace(replace(v_def,
    'atendimento da Quadrum.', 'atendimento da TriConecta.'),
    'contato com a Quadrum.', 'contato com a TriConecta.');
  execute v_novo;
end $$;


-- ═══ BLOCO 3 · senha fraca: o nome da empresa entra na lista ═══════════════
do $$
declare
  v_def text := pg_get_functiondef('public.q_senha_fraca(text, text)'::regprocedure);
begin
  if v_def like '%triconecta1%' then return; end if;
  if v_def not like '%''quadrum1'', ''quadrum123'',%' then
    raise exception 'q_senha_fraca não tem a lista esperada; nada foi mudado.';
  end if;
  execute replace(v_def, '''quadrum1'', ''quadrum123'',',
                         '''quadrum1'', ''quadrum123'', ''triconecta1'', ''triconecta123'',');
end $$;


-- ═══ BLOCO 4 · modelos de partida (procuração, termo, declaração) ══════════
-- A contratada deixa de ser texto fixo e passa a vir de Dados da empresa,
-- como no contrato real. Editar o texto sobe a versão (gatilho). Só mexe no
-- que ainda tem o nome antigo.
update public.documento_modelos
   set corpo = replace(replace(corpo,
         'QUADRUM ASSESSORIA FINANCEIRA, [CNPJ e endereço da Quadrum]',
         '{{empresa.nome}}, inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.endereco}}'),
         'Portal do Cliente da Quadrum', 'Portal do Cliente da {{empresa.nome}}')
 where corpo like '%Quadrum%' or corpo like '%QUADRUM%';


-- ═══ BLOCO 5 · termo de privacidade: versão NOVA com o nome novo ═══════════
-- Parte da versão mais recente; entra como RASCUNHO (inativa). Se a mais
-- recente já não cita a Quadrum, não faz nada.
insert into public.privacidade_termos (titulo, texto)
select t.titulo,
       replace(replace(replace(t.texto,
         'QUADRUM ASSESSORIA FINANCEIRA', 'TRICONECTA ASSESSORIA'),
         '("Quadrum")', '("TriConecta")'),
         'Quadrum', 'TriConecta')
  from public.privacidade_termos t
 where t.versao = (select max(versao) from public.privacidade_termos)
   and (t.texto like '%Quadrum%' or t.texto like '%QUADRUM%');
