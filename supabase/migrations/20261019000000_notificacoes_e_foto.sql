-- ─────────────────────────────────────────────────────────────────────────────
-- NOTIFICAÇÕES (o sininho), DEPARTAMENTO no perfil e FOTO da equipe
--
-- Pedido do dono do processo (16/10/2026): barra no topo com sininho (equipe e
-- cliente), tema claro/escuro e a pessoa logada com papel, departamento e foto.
--
-- ⚠️ Quem cria notificação é o BANCO (gatilhos), nunca a tela: o aviso nasce
-- do fato (documento assinado, mensagem gravada), por qualquer caminho.
-- ⚠️ Ninguém tem policy na tabela: equipe e cliente leem e marcam como lida
-- pelas MESMAS funções, que olham só `auth.uid()` — o molde do portal.
-- ⚠️ Os gatilhos NUNCA derrubam o que os disparou: falha vira `warning`. Um
-- aviso que não saiu é ruim; uma assinatura recusada por causa dele é pior.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ BLOCO 1 · a tabela ═════════════════════════════════════════════════════
create table if not exists public.notificacoes (
  id              uuid primary key default gen_random_uuid(),
  destinatario    uuid not null references auth.users(id) on delete cascade,
  tipo            text not null,
  titulo          text not null,
  corpo           text,
  link            text,
  contrato_id     uuid references public.contratos(id),
  documento_id    uuid references public.contrato_documentos(id),
  atendimento_id  uuid references public.atendimentos(id),
  lida_em         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists notificacoes_destinatario_idx
  on public.notificacoes (destinatario, created_at desc, id desc);
create index if not exists notificacoes_nao_lidas_idx
  on public.notificacoes (destinatario) where lida_em is null;

alter table public.notificacoes enable row level security;
revoke all on public.notificacoes from anon, authenticated;


-- ═══ BLOCO 2 · criar (só o banco) ═══════════════════════════════════════════
-- Mensagem de chat AGRUPA: se a pessoa ainda não leu o aviso daquela conversa,
-- o aviso existente é atualizado em vez de nascer outro (30 mensagens = 1 aviso).
create or replace function public.q_notificar(
  p_destinatario uuid, p_tipo text, p_titulo text, p_corpo text, p_link text,
  p_contrato uuid default null, p_documento uuid default null, p_atendimento uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_destinatario is null then return; end if;
  if p_tipo in ('mensagem_cliente', 'mensagem_equipe') and p_atendimento is not null then
    update public.notificacoes
       set corpo = p_corpo, created_at = now()
     where destinatario = p_destinatario and tipo = p_tipo
       and atendimento_id = p_atendimento and lida_em is null;
    if found then return; end if;
  end if;
  insert into public.notificacoes (destinatario, tipo, titulo, corpo, link, contrato_id, documento_id, atendimento_id)
  values (p_destinatario, p_tipo, p_titulo, left(p_corpo, 240), p_link, p_contrato, p_documento, p_atendimento);
end $$;
revoke execute on function public.q_notificar(uuid, text, text, text, text, uuid, uuid, uuid) from public, anon, authenticated;

-- Quem da equipe recebe o que é de um contrato: o consultor; sem consultor
-- (ou consultor desativado), os gestores ativos.
create or replace function public.q_equipe_do_contrato(p_contrato uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from public.contratos k join public.perfis p on p.id = k.consultor_id and p.ativo
   where k.id = p_contrato
  union
  select p.id from public.perfis p
   where p.papel = 'gestor' and p.ativo
     and not exists (select 1 from public.contratos k join public.perfis c on c.id = k.consultor_id and c.ativo
                      where k.id = p_contrato)
$$;
revoke execute on function public.q_equipe_do_contrato(uuid) from public, anon, authenticated;


-- ═══ BLOCO 3 · os gatilhos ══════════════════════════════════════════════════

-- Documento assinado pelo cliente → equipe do contrato.
create or replace function public.q_notifica_assinatura()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d record;
  u uuid;
begin
  begin
    select cd.id, cd.contrato_id, coalesce(cd.titulo, t.nome) as titulo, k.numero
      into d
      from public.contrato_documentos cd
      join public.contratos k on k.id = cd.contrato_id
      left join public.documento_tipos t on t.codigo = cd.tipo
     where cd.id = new.documento_id;
    for u in select * from public.q_equipe_do_contrato(d.contrato_id) loop
      perform public.q_notificar(u, 'documento_assinado', 'Documento assinado',
        format('%s — %s · contrato #%s', new.signatario_nome, d.titulo, d.numero),
        '/documentos/' || d.id, d.contrato_id, d.id, null);
    end loop;
  exception when others then
    raise warning '[notificacoes] assinatura: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_assinatura() from public, anon, authenticated;
drop trigger if exists trg_notifica_assinatura on public.documento_assinaturas;
create trigger trg_notifica_assinatura after insert on public.documento_assinaturas
  for each row execute function public.q_notifica_assinatura();

-- Documento novo para assinar → cliente (se o contrato já está no portal).
create or replace function public.q_notifica_documento_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid; v_num bigint; v_aceite date; v_nome text;
begin
  begin
    select c.user_id, k.numero, k.data_aceite into v_user, v_num, v_aceite
      from public.contratos k join public.clientes c on c.id = k.cliente_id
     where k.id = new.contrato_id;
    if v_aceite is not null and new.assinado_em is null and new.cancelado_em is null then
      select coalesce(new.titulo, t.nome) into v_nome from public.documento_tipos t where t.codigo = new.tipo;
      perform public.q_notificar(v_user, 'documento_novo', 'Novo documento para assinar',
        format('%s · contrato #%s', coalesce(v_nome, new.tipo), v_num),
        case when new.conteudo is not null then '/documento/' || new.id else '/contratos' end,
        new.contrato_id, new.id, null);
    end if;
  exception when others then
    raise warning '[notificacoes] documento novo: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_documento_novo() from public, anon, authenticated;
drop trigger if exists trg_notifica_documento_novo on public.contrato_documentos;
create trigger trg_notifica_documento_novo after insert on public.contrato_documentos
  for each row execute function public.q_notifica_documento_novo();

-- Contrato aceito → cliente ("já está no portal").
create or replace function public.q_notifica_contrato_aceito()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  begin
    if old.data_aceite is null and new.data_aceite is not null then
      select user_id into v_user from public.clientes where id = new.cliente_id;
      perform public.q_notificar(v_user, 'contrato_aceito', format('Contrato #%s disponível', new.numero),
        null, '/contratos', new.id, null, null);
    end if;
  exception when others then
    raise warning '[notificacoes] contrato aceito: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_contrato_aceito() from public, anon, authenticated;
drop trigger if exists trg_notifica_contrato_aceito on public.contratos;
create trigger trg_notifica_contrato_aceito after update of data_aceite on public.contratos
  for each row execute function public.q_notifica_contrato_aceito();

-- Histórico lançado → cliente. ⚠️ Urgente: o TEXTO nunca sai daqui, só o aviso.
create or replace function public.q_notifica_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_num bigint; v_aceite date; v_urgente boolean;
begin
  begin
    select c.user_id, k.numero, k.data_aceite into v_user, v_num, v_aceite
      from public.contratos k join public.clientes c on c.id = k.cliente_id
     where k.id = new.contrato_id;
    select coalesce(urgente, false) into v_urgente from public.departamentos where id = new.departamento_id;
    if v_aceite is not null then
      if coalesce(v_urgente, false) then
        perform public.q_notificar(v_user, 'historico_urgente', 'Você tem uma mensagem urgente',
          format('Contrato #%s', v_num), '/contratos', new.contrato_id, null, null);
      else
        perform public.q_notificar(v_user, 'historico', format('Atualização no contrato #%s', v_num),
          new.texto, '/contratos', new.contrato_id, null, null);
      end if;
    end if;
  exception when others then
    raise warning '[notificacoes] histórico: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_historico() from public, anon, authenticated;
drop trigger if exists trg_notifica_historico on public.contrato_historico;
create trigger trg_notifica_historico after insert on public.contrato_historico
  for each row execute function public.q_notifica_historico();

-- Mensagem no chat: do cliente → responsável (ou equipe do contrato);
-- da equipe → cliente. O robô não avisa ninguém.
create or replace function public.q_notifica_mensagem()
returns trigger language plpgsql security definer set search_path = public as $$
declare a record; u uuid;
begin
  begin
    select at.id, at.numero, at.contrato_id, at.responsavel_id, c.user_id, c.nome
      into a
      from public.atendimentos at join public.clientes c on c.id = at.cliente_id
     where at.id = new.atendimento_id;
    if new.autor_tipo = 'cliente' then
      if a.responsavel_id is not null and exists (select 1 from public.perfis where id = a.responsavel_id and ativo) then
        perform public.q_notificar(a.responsavel_id, 'mensagem_cliente', 'Mensagem de ' || a.nome,
          new.corpo, '/atendimentos?atendimento=' || a.id, a.contrato_id, null, a.id);
      else
        for u in select * from public.q_equipe_do_contrato(a.contrato_id) loop
          perform public.q_notificar(u, 'mensagem_cliente', 'Mensagem de ' || a.nome,
            new.corpo, '/atendimentos?atendimento=' || a.id, a.contrato_id, null, a.id);
        end loop;
      end if;
    elsif new.autor_tipo = 'equipe' then
      perform public.q_notificar(a.user_id, 'mensagem_equipe', 'Nova mensagem no chat',
        new.corpo, '/chat', a.contrato_id, null, a.id);
    end if;
  exception when others then
    raise warning '[notificacoes] mensagem: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.q_notifica_mensagem() from public, anon, authenticated;
drop trigger if exists trg_notifica_mensagem on public.atendimento_mensagens;
create trigger trg_notifica_mensagem after insert on public.atendimento_mensagens
  for each row execute function public.q_notifica_mensagem();


-- ═══ BLOCO 4 · ler e marcar (equipe e cliente, a MESMA função) ══════════════
create or replace function public.q_minhas_notificacoes(p_limite int default 30)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nao_lidas', (select count(*) from public.notificacoes where destinatario = auth.uid() and lida_em is null),
    'itens', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc, x.id desc)
      from (select id, tipo, titulo, corpo, link, lida_em, created_at
              from public.notificacoes
             where destinatario = auth.uid()
             order by created_at desc, id desc
             limit least(greatest(coalesce(p_limite, 30), 1), 100)) x
    ), '[]'::jsonb))
$$;
revoke execute on function public.q_minhas_notificacoes(int) from public, anon;
grant execute on function public.q_minhas_notificacoes(int) to authenticated, service_role;

-- Nulo = todas.
create or replace function public.q_marcar_notificacoes_lidas(p_ids uuid[] default null)
returns void language sql security definer set search_path = public as $$
  update public.notificacoes set lida_em = now()
   where destinatario = auth.uid() and lida_em is null
     and (p_ids is null or id = any(p_ids))
$$;
revoke execute on function public.q_marcar_notificacoes_lidas(uuid[]) from public, anon;
grant execute on function public.q_marcar_notificacoes_lidas(uuid[]) to authenticated, service_role;

-- O sininho do admin é ao vivo SEM a tabela entrar no Realtime (sem policy,
-- ninguém receberia a linha): todo aviso nasce de uma mudança numa tabela que
-- o admin já escuta, e o useAoVivo relê o sininho junto.


-- ═══ BLOCO 5 · departamento no perfil ═══════════════════════════════════════
alter table public.perfis add column if not exists departamento_id uuid references public.departamentos(id);

-- O departamento é do GESTOR, como nível e unidade.
create or replace function public.q_perfil_protege_acesso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.q_e_gestor() then
    return new;
  end if;
  if new.papel is distinct from old.papel
     or new.ativo is distinct from old.ativo
     or new.unidade_id is distinct from old.unidade_id
     or new.departamento_id is distinct from old.departamento_id
     or new.email is distinct from old.email then
    raise exception 'Só um gestor muda nível, departamento, unidade, e-mail ou ativação de um perfil.'
      using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.q_perfil_protege_acesso() from public, anon;


-- ═══ BLOCO 6 · fotos da equipe (Storage) ════════════════════════════════════
-- Bucket público (a foto aparece no topo de todas as telas), arquivo pequeno:
-- a tela comprime para 256×256 WEBP antes de enviar (~15 KB). Cada um mexe só
-- na PRÓPRIA pasta (`<id>/...`), e só quem é da equipe.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 524288,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

-- Ler a própria pasta: o Storage relê o arquivo recém-gravado (RETURNING) e
-- sem isto o envio é recusado. A foto em si se vê pelo endereço público.
drop policy if exists avatares_le_o_proprio on storage.objects;
create policy avatares_le_o_proprio on storage.objects
  for select to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists avatares_envia_o_proprio on storage.objects;
create policy avatares_envia_o_proprio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text
              and (select public.q_e_equipe()));
drop policy if exists avatares_troca_o_proprio on storage.objects;
create policy avatares_troca_o_proprio on storage.objects
  for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.q_e_equipe()));
drop policy if exists avatares_apaga_o_proprio on storage.objects;
create policy avatares_apaga_o_proprio on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = (select auth.uid())::text
         and (select public.q_e_equipe()));
