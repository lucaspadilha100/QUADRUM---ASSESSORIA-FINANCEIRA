-- ─────────────────────────────────────────────────────────────────────────────
-- O CONTRATO REAL (pedido do dono do processo, 23/10/2026): o contrato que a
-- Quadrum usa — vindo da Sete Capital, com a marca e os dados trocados por
-- campos — vira modelo, e os campos que ele pede passam a existir:
--
--   cliente    sexo
--   contrato   titular do financiamento (o próprio cliente ou outra pessoa),
--              RENAVAM, chassi, veículo no endereço, dados do financiamento
--              (saldo, parcela, balão, parcelas, última paga) e o PLANO
--              escolhido (valor do serviço, entrada, parcelas, vencimento,
--              forma de pagamento)
--   empresa    a CONTRATADA (nome, CNPJ, sede, telefones, e-mail) — cadastro
--              de UMA linha, que o gestor mantém
--
-- ⚠️ Campo vazio continua RECUSANDO a geração. Parcelas restantes e meses sem
-- pagar são CALCULADOS na geração (o texto é congelado ali).
-- ⚠️ Chaves novas entram no catálogo E nas variáveis (o teste confere).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ BLOCO 1 · os campos ════════════════════════════════════════════════════
alter table public.clientes add column if not exists sexo text
  check (sexo in ('Masculino', 'Feminino'));

alter table public.contratos
  add column if not exists titular_outro        boolean not null default false,
  add column if not exists titular_nome         text,
  add column if not exists titular_documento    text check (titular_documento ~ '^[0-9]{11}$'),
  add column if not exists titular_rg           text,
  add column if not exists titular_nascimento   date,
  add column if not exists titular_sexo         text check (titular_sexo in ('Masculino', 'Feminino')),
  add column if not exists titular_endereco     text,
  add column if not exists renavam              text,
  add column if not exists chassi               text,
  add column if not exists veiculo_no_endereco  boolean,
  add column if not exists saldo_devedor        numeric(14,2) check (saldo_devedor >= 0),
  add column if not exists valor_parcela        numeric(14,2) check (valor_parcela >= 0),
  add column if not exists parcela_balao        numeric(14,2) check (parcela_balao >= 0),
  add column if not exists qtd_parcelas         int check (qtd_parcelas >= 0),
  add column if not exists parcelas_pagas       int check (parcelas_pagas >= 0),
  add column if not exists parcelas_atrasadas   int check (parcelas_atrasadas >= 0),
  add column if not exists ultima_parcela_paga  date,
  add column if not exists plano_valor_total    numeric(14,2) check (plano_valor_total >= 0),
  add column if not exists plano_entrada        numeric(14,2) check (plano_entrada >= 0),
  add column if not exists plano_parcelas       int check (plano_parcelas >= 1),
  add column if not exists plano_valor_parcela  numeric(14,2) check (plano_valor_parcela >= 0),
  add column if not exists plano_primeiro_vencimento date,
  add column if not exists plano_forma          text;

alter table public.contratos drop constraint if exists contratos_parcelas_coerentes;
alter table public.contratos add constraint contratos_parcelas_coerentes
  check (qtd_parcelas is null or parcelas_pagas is null or parcelas_pagas <= qtd_parcelas);

-- A CONTRATADA: uma linha só (id = true), o gestor mantém, a equipe lê.
create table if not exists public.empresa (
  id          boolean primary key default true check (id),
  nome        text,
  cnpj        text check (cnpj ~ '^[0-9]{14}$'),
  endereco    text,
  telefones   text,
  email       text,
  updated_at  timestamptz not null default now()
);
drop trigger if exists trg_empresa_updated_at on public.empresa;
create trigger trg_empresa_updated_at before update on public.empresa
  for each row execute function public.q_tocar_updated_at();
alter table public.empresa enable row level security;
revoke all on public.empresa from anon;
grant select, update on public.empresa to authenticated;
drop policy if exists empresa_equipe_le on public.empresa;
create policy empresa_equipe_le on public.empresa
  for select to authenticated using ((select public.q_e_equipe()));
drop policy if exists empresa_gestor_altera on public.empresa;
create policy empresa_gestor_altera on public.empresa
  for update to authenticated using ((select public.q_e_gestor())) with check ((select public.q_e_gestor()));
insert into public.empresa (id, nome) values (true, 'QUADRUM ASSESSORIA FINANCEIRA') on conflict (id) do nothing;


-- ═══ BLOCO 2 · o catálogo e as variáveis ════════════════════════════════════
create or replace function public.q_moeda(p numeric)
returns text language sql immutable as $$
  select case when p is null then null
              else 'R$ ' || translate(to_char(p, 'FM999,999,999,990.00'), ',.', '.,') end;
$$;
revoke execute on function public.q_moeda(numeric) from public, anon;
grant execute on function public.q_moeda(numeric) to authenticated, service_role;

create or replace function public.q_mes_ano(p date)
returns text language sql immutable as $$
  select case when p is null then null else
    (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from p)::int]
    || '/' || extract(year from p)::int end;
$$;
revoke execute on function public.q_mes_ano(date) from public, anon;
grant execute on function public.q_mes_ano(date) to authenticated, service_role;

create or replace function public.q_documento_catalogo()
returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('chave', c, 'rotulo', r, 'grupo', g) order by o)
  from (values
    (1,  'cliente.qualificacao',   'Qualificação completa (nome, documento, RG, endereço…)', 'Cliente'),
    (2,  'cliente.nome',           'Nome / razão social', 'Cliente'),
    (3,  'cliente.documento',      'CPF/CNPJ', 'Cliente'),
    (4,  'cliente.tipo_documento', 'CPF ou CNPJ (a sigla)', 'Cliente'),
    (5,  'cliente.rg',             'RG', 'Cliente'),
    (6,  'cliente.rg_orgao',       'Órgão emissor do RG', 'Cliente'),
    (7,  'cliente.nacionalidade',  'Nacionalidade', 'Cliente'),
    (8,  'cliente.estado_civil',   'Estado civil', 'Cliente'),
    (9,  'cliente.profissao',      'Profissão', 'Cliente'),
    (10, 'cliente.data_nascimento','Data de nascimento', 'Cliente'),
    (11, 'cliente.email',          'E-mail', 'Cliente'),
    (12, 'cliente.telefone',       'Telefone', 'Cliente'),
    (13, 'cliente.endereco',       'Endereço completo', 'Cliente'),
    (14, 'cliente.cidade',         'Cidade', 'Cliente'),
    (15, 'cliente.uf',             'UF', 'Cliente'),
    (16, 'cliente.cep',            'CEP', 'Cliente'),
    (17, 'representante.nome',     'Representante legal (PJ)', 'Cliente'),
    (18, 'representante.cpf',      'CPF do representante (PJ)', 'Cliente'),
    (19, 'cliente.sexo',           'Sexo', 'Cliente'),
    (40, 'titular.nome',           'Nome do titular do financiamento', 'Titular do financiamento'),
    (41, 'titular.data_nascimento','Data de nascimento do titular', 'Titular do financiamento'),
    (42, 'titular.sexo',           'Sexo do titular', 'Titular do financiamento'),
    (43, 'titular.cpf',            'CPF do titular', 'Titular do financiamento'),
    (44, 'titular.rg',             'RG do titular (com órgão)', 'Titular do financiamento'),
    (45, 'titular.endereco',       'Endereço do titular', 'Titular do financiamento'),
    (20, 'contrato.numero',        'Número do contrato', 'Contrato'),
    (21, 'contrato.banco',         'Banco', 'Contrato'),
    (22, 'contrato.linha',         'Linha de crédito', 'Contrato'),
    (23, 'contrato.veiculo',       'Veículo', 'Contrato'),
    (24, 'contrato.ano_modelo',    'Ano/modelo', 'Contrato'),
    (25, 'contrato.placa',         'Placa', 'Contrato'),
    (26, 'contrato.consultor',     'Consultor', 'Contrato'),
    (27, 'contrato.unidade',       'Unidade (cidade, UF)', 'Contrato'),
    (50, 'contrato.renavam',       'RENAVAM', 'Veículo'),
    (51, 'contrato.chassi',        'Chassi', 'Veículo'),
    (52, 'contrato.veiculo_no_endereco', 'Veículo no endereço do financiamento (SIM/NÃO)', 'Veículo'),
    (60, 'contrato.saldo_devedor', 'Saldo devedor atual', 'Financiamento'),
    (61, 'contrato.valor_parcela', 'Valor original da parcela', 'Financiamento'),
    (62, 'contrato.parcela_balao', 'Parcela balão', 'Financiamento'),
    (63, 'contrato.qtd_parcelas',  'Quantidade de parcelas', 'Financiamento'),
    (64, 'contrato.parcelas_pagas','Parcelas pagas', 'Financiamento'),
    (65, 'contrato.parcelas_atrasadas', 'Parcelas atrasadas', 'Financiamento'),
    (66, 'contrato.parcelas_restantes', 'Parcelas restantes (calculado)', 'Financiamento'),
    (67, 'contrato.meses_sem_pagar', 'Meses desde o último pagamento (calculado)', 'Financiamento'),
    (68, 'contrato.ultima_parcela_paga', 'Vencimento da última parcela paga', 'Financiamento'),
    (70, 'contrato.plano',         'Plano escolhido (texto completo)', 'Plano'),
    (71, 'contrato.plano_valor_total', 'Valor total do serviço', 'Plano'),
    (72, 'contrato.plano_entrada', 'Entrada', 'Plano'),
    (73, 'contrato.plano_parcelas','Quantidade de parcelas do serviço', 'Plano'),
    (74, 'contrato.plano_valor_parcela', 'Valor da parcela do serviço', 'Plano'),
    (75, 'contrato.plano_primeiro_vencimento', 'Primeiro vencimento', 'Plano'),
    (76, 'contrato.plano_forma',   'Forma de pagamento', 'Plano'),
    (80, 'empresa.nome',           'Nome da empresa', 'Empresa'),
    (81, 'empresa.cnpj',           'CNPJ da empresa', 'Empresa'),
    (82, 'empresa.endereco',       'Sede da empresa', 'Empresa'),
    (83, 'empresa.telefones',      'Telefones da empresa', 'Empresa'),
    (84, 'empresa.email',          'E-mail da empresa', 'Empresa'),
    (30, 'data.hoje',              'Data de hoje (15/10/2026)', 'Data'),
    (31, 'data.extenso',           'Data de hoje por extenso (15 de outubro de 2026)', 'Data')
  ) as t(o, c, r, g)
  where public.q_e_equipe();
$$;
revoke execute on function public.q_documento_catalogo() from public, anon;
grant execute on function public.q_documento_catalogo() to authenticated, service_role;

create or replace function public.q_documento_variaveis(p_contrato uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  k public.contratos;
  c public.clientes;
  e public.empresa;
  v_banco text; v_linha text; v_consultor text; v_unidade text;
  v_endereco text; v_qualif text; v_doc text; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  vazio boolean;
  v_plano text; v_meses int;
begin
  select * into e from public.empresa where id;
  if p_contrato is not null then
    select * into k from public.contratos where id = p_contrato;
    select * into c from public.clientes where id = k.cliente_id;
    select nome into v_banco from public.bancos where id = k.banco_id;
    select nome into v_linha from public.linhas_credito where id = k.linha_credito_id;
    select nome into v_consultor from public.perfis where id = k.consultor_id;
    select coalesce(nullif(concat_ws(', ', nullif(u.cidade, ''), nullif(u.uf, '')), ''), u.nome)
      into v_unidade from public.unidades u where u.id = k.unidade_id;
  end if;

  v_doc := public.q_formatar_documento(c.documento);
  v_endereco := nullif(concat_ws(', ',
      nullif(trim(coalesce(c.logradouro, '') || coalesce(' ' || nullif(c.endereco_numero, ''), '')), ''),
      nullif(c.complemento, ''),
      nullif(c.bairro, ''),
      nullif(concat_ws('/', nullif(c.cidade, ''), nullif(c.uf, '')), ''),
      case when nullif(c.cep, '') is not null then 'CEP ' || c.cep end), '');

  -- A qualificação só sai INTEIRA: faltando uma parte, ela fica nula e a
  -- geração diz o que falta (em vez de sair "portador do RG nº , residente em").
  if c.id is not null and c.tipo_pessoa = 'PJ' then
    vazio := coalesce(c.nome, '') = '' or v_endereco is null
          or coalesce(c.representante_nome, '') = '' or coalesce(c.representante_documento, '') = '';
    v_qualif := case when not vazio then
      c.nome || ', pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ' || v_doc ||
      ', com sede em ' || v_endereco || ', neste ato representada por ' || c.representante_nome ||
      ', inscrito(a) no CPF sob o nº ' || public.q_formatar_documento(c.representante_documento) end;
  elsif c.id is not null then
    vazio := coalesce(c.nome, '') = '' or coalesce(c.nacionalidade, '') = '' or coalesce(c.estado_civil, '') = ''
          or coalesce(c.profissao, '') = '' or coalesce(c.rg, '') = '' or v_endereco is null;
    v_qualif := case when not vazio then
      c.nome || ', ' || c.nacionalidade || ', ' || c.estado_civil || ', ' || c.profissao ||
      ', portador(a) do RG nº ' || c.rg || coalesce(' ' || nullif(c.rg_orgao, ''), '') ||
      ', inscrito(a) no CPF sob o nº ' || v_doc || ', residente e domiciliado(a) em ' || v_endereco end;
  end if;

  -- O plano numa frase só (as partes também vão soltas, para outros modelos).
  if k.plano_valor_total is not null and k.plano_parcelas is not null and k.plano_valor_parcela is not null
     and k.plano_primeiro_vencimento is not null and nullif(trim(k.plano_forma), '') is not null then
    v_plano := 'Valor total de ' || public.q_moeda(k.plano_valor_total) ||
      case when coalesce(k.plano_entrada, 0) > 0
           then ', sendo entrada de ' || public.q_moeda(k.plano_entrada) || ' e ' else ', em ' end ||
      case when k.plano_parcelas = 1 then 'parcela única de ' else k.plano_parcelas || ' parcelas de ' end ||
      public.q_moeda(k.plano_valor_parcela) ||
      ', com primeiro vencimento em ' || to_char(k.plano_primeiro_vencimento, 'DD/MM/YYYY') ||
      ', por ' || lower(trim(k.plano_forma)) || '.';
  end if;

  if k.ultima_parcela_paga is not null then
    v_meses := greatest(0, (extract(year from age(v_hoje, k.ultima_parcela_paga)) * 12
                          + extract(month from age(v_hoje, k.ultima_parcela_paga)))::int);
  end if;

  -- (jsonb_build_object aceita até 100 argumentos: são três partes.)
  return jsonb_build_object(
    'cliente.qualificacao',    v_qualif,
    'cliente.nome',            c.nome,
    'cliente.documento',       v_doc,
    'cliente.tipo_documento',  case when c.documento is null then null when c.tipo_pessoa = 'PJ' then 'CNPJ' else 'CPF' end,
    'cliente.rg',              c.rg,
    'cliente.rg_orgao',        c.rg_orgao,
    'cliente.nacionalidade',   c.nacionalidade,
    'cliente.estado_civil',    c.estado_civil,
    'cliente.profissao',       c.profissao,
    'cliente.data_nascimento', to_char(c.data_nascimento, 'DD/MM/YYYY'),
    'cliente.email',           c.email,
    'cliente.telefone',        c.telefone,
    'cliente.endereco',        v_endereco,
    'cliente.cidade',          c.cidade,
    'cliente.uf',              c.uf,
    'cliente.cep',             c.cep,
    'representante.nome',      c.representante_nome,
    'representante.cpf',       public.q_formatar_documento(c.representante_documento),
    'cliente.sexo',            c.sexo
  ) || jsonb_build_object(
    -- O titular é o próprio cliente, salvo quando o contrato diz que é outro.
    'titular.nome',            case when k.titular_outro then k.titular_nome else c.nome end,
    'titular.data_nascimento', to_char(case when k.titular_outro then k.titular_nascimento else c.data_nascimento end, 'DD/MM/YYYY'),
    'titular.sexo',            case when k.titular_outro then k.titular_sexo else c.sexo end,
    'titular.cpf',             public.q_formatar_documento(case when k.titular_outro then k.titular_documento
                                                                when c.tipo_pessoa = 'PF' then c.documento end),
    'titular.rg',              case when k.titular_outro then nullif(trim(k.titular_rg), '')
                                    else nullif(trim(coalesce(c.rg, '') || coalesce(' ' || nullif(c.rg_orgao, ''), '')), '') end,
    'titular.endereco',        case when k.titular_outro then nullif(trim(k.titular_endereco), '') else v_endereco end,
    'contrato.numero',         k.numero::text,
    'contrato.banco',          v_banco,
    'contrato.linha',          v_linha,
    'contrato.veiculo',        k.veiculo,
    'contrato.ano_modelo',     k.ano_modelo,
    'contrato.placa',          k.placa,
    'contrato.consultor',      v_consultor,
    'contrato.unidade',        v_unidade,
    'contrato.renavam',        k.renavam,
    'contrato.chassi',         k.chassi,
    'contrato.veiculo_no_endereco', case k.veiculo_no_endereco when true then 'SIM' when false then 'NÃO' end
  ) || jsonb_build_object(
    'contrato.saldo_devedor',  public.q_moeda(k.saldo_devedor),
    'contrato.valor_parcela',  public.q_moeda(k.valor_parcela),
    'contrato.parcela_balao',  public.q_moeda(k.parcela_balao),
    'contrato.qtd_parcelas',   k.qtd_parcelas::text,
    'contrato.parcelas_pagas', k.parcelas_pagas::text,
    'contrato.parcelas_atrasadas', k.parcelas_atrasadas::text,
    'contrato.parcelas_restantes', (k.qtd_parcelas - k.parcelas_pagas)::text,
    'contrato.meses_sem_pagar', v_meses::text,
    'contrato.ultima_parcela_paga', public.q_mes_ano(k.ultima_parcela_paga),
    'contrato.plano',          v_plano,
    'contrato.plano_valor_total', public.q_moeda(k.plano_valor_total),
    'contrato.plano_entrada',  public.q_moeda(coalesce(k.plano_entrada, case when k.plano_valor_total is not null then 0 end)),
    'contrato.plano_parcelas', k.plano_parcelas::text,
    'contrato.plano_valor_parcela', public.q_moeda(k.plano_valor_parcela),
    'contrato.plano_primeiro_vencimento', to_char(k.plano_primeiro_vencimento, 'DD/MM/YYYY'),
    'contrato.plano_forma',    nullif(trim(k.plano_forma), ''),
    'empresa.nome',            nullif(trim(e.nome), ''),
    'empresa.cnpj',            public.q_formatar_documento(e.cnpj),
    'empresa.endereco',        nullif(trim(e.endereco), ''),
    'empresa.telefones',       nullif(trim(e.telefones), ''),
    'empresa.email',           nullif(trim(e.email), ''),
    'data.hoje',               to_char(v_hoje, 'DD/MM/YYYY'),
    'data.extenso',            public.q_data_extenso(v_hoje)
  );
end $$;
revoke execute on function public.q_documento_variaveis(uuid) from public, anon, authenticated;


-- ═══ BLOCO 3 · o contrato vira modelo ═══════════════════════════════════════
-- Ocupa o lugar do rascunho de partida ("Contrato de prestação de serviços",
-- ainda com "[completar"): editar o texto sobe a versão. Se o rascunho já foi
-- mexido, entra como modelo novo. Nasce ATIVO: é o contrato definitivo.
do $$
declare v_corpo text := $contrato$# CONTRATO DE PRESTAÇÃO DE SERVIÇO DE INTERMEDIAÇÃO E RENEGOCIAÇÃO DE DÍVIDA BANCÁRIA Nº {{contrato.numero}}

**1 - PARTES/DEFINIÇÃO DO SERVIÇO**

**1.1 CONTRATADA:**

**{{empresa.nome}}**, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº {{empresa.cnpj}}, com sede em {{empresa.endereco}}, telefone: {{empresa.telefones}}, consultor responsável: {{contrato.consultor}} - {{contrato.unidade}}

**1.2 CONTRATANTE E/OU RESPONSÁVEL:**

Nome: {{cliente.nome}}
Data de nascimento: {{cliente.data_nascimento}}
Sexo: {{cliente.sexo}}
Estado civil: {{cliente.estado_civil}}
Profissão: {{cliente.profissao}}
{{cliente.tipo_documento}}: {{cliente.documento}}
RG: {{cliente.rg}} {{cliente.rg_orgao}}
Telefones: {{cliente.telefone}}

**1.3 TITULAR DO FINANCIAMENTO:**

Nome: {{titular.nome}}
Data de nascimento: {{titular.data_nascimento}}
Sexo: {{titular.sexo}}
CPF: {{titular.cpf}}
RG: {{titular.rg}}
Endereço: {{titular.endereco}}

**1.4 PLANO ESCOLHIDO:**

{{contrato.plano}}

**1.5 DADOS VEÍCULO:**

Marca e modelo: {{contrato.veiculo}}
Ano, fabricação e modelo: {{contrato.ano_modelo}}
Placa: {{contrato.placa}}
RENAVAM: {{contrato.renavam}}
Chassi: {{contrato.chassi}}
Veículo se encontra no endereço do financiamento: {{contrato.veiculo_no_endereco}}

**1.6 DADOS DO FINANCIAMENTO:**

Banco: {{contrato.banco}}
Saldo devedor atual: {{contrato.saldo_devedor}}
Valor original da parcela: {{contrato.valor_parcela}}
Parcela balão: {{contrato.parcela_balao}}
Quantidade de parcelas: {{contrato.qtd_parcelas}}
Quantidade de parcelas pagas: {{contrato.parcelas_pagas}}
Quantidade de parcelas atrasadas: {{contrato.parcelas_atrasadas}}
Quantidade de parcelas restantes: {{contrato.parcelas_restantes}}
Quantidade de meses desde o último pagamento: {{contrato.meses_sem_pagar}}
Vencimento da última parcela paga: {{contrato.ultima_parcela_paga}}

**2 - DO OBJETO:**

2.1 O CONTRATANTE tem plena ciência que o OBJETO deste contrato é de PRESTAÇÃO DE SERVIÇO DE INTERMEDIAÇÃO E RENEGOCIAÇÃO DE DÍVIDA BANCÁRIA, junto a instituição bancária/CREDOR na qual este contrato se vincula, sendo papel da parte CONTRATADA representar o CONTRATANTE, com objetivo de obter o MELHOR DESCONTO para a quitação total do saldo devedor do contrato de financiamento, referente ao objeto descrito na cláusula 1.6 deste contrato.

2.2 Os serviços de conciliação bancária nos contratos de financiamento de veículo (LEASING e/ou CDC), empréstimo bancário, limite de conta corrente ou dívida de cartão de crédito, e todas as ações descritas no corpo deste contrato serão vinculadas a seu respectivo produto, listados neste contrato.

**3 - DA COBERTURA DESTE CONTRATO:**

3.1 O CONTRATANTE tem plena ciência que CONTRATADA desenvolve atividade meio e não atividade fim, sendo sua obrigação, a intermediação da tratativa de conciliação junto à instituição bancária, visando alcançar para o CONTRATANTE, o melhor desconto sobre o valor total da dívida, comprometendo-se a repassar integralmente o desconto concedido ao CONTRATANTE.

3.2 A cobertura deste contrato contempla a lista de procedimentos descritos na Cláusula Sétima, de acordo com a obrigação devidamente executada por ambas as partes, salvo hipótese de modificação da política de conciliação das instituições bancárias ou eventual alteração na legislação vigente, que inviabilize a celebração de acordos, sendo o principal responsável em conceder desconto o próprio CREDOR da dívida que é o banco ou instituição financeira vinculada no contrato da dívida do CONTRATANTE.

**4 - DA CAMPANHA DE DESCONTO:**

4.1 O CONTRATANTE tem plena ciência que das condições de descontos a serem almejados pela CONTRATADA, que buscará em primeiro lugar o melhor desconto para o CONTRATANTE, que depende do CREDOR e do transcurso de tempo da inadimplência. A CONTRATADA se compromete em buscar o melhor desconto junto ao CREDOR, alcançando o melhor resultado possível, zelando pela melhor política de negociação com o CREDOR da dívida.

4.2 O CONTRATANTE fica expressamente ciente de que a concessão do desconto é discricionariedade EXCLUSIVA do CREDOR da dívida, o prazo para a intermediação e negociação junto ao CREDOR, é de 12 (doze) a 18 (dezoito) meses a partir da data de assinatura deste contrato de prestação de serviço.

4.3 A CONTRATADA se empenhará, utilizando de toda sua expertise e know-how, para obter o melhor desconto durante todo o tempo do contrato, e alcançado o desconto máximo junto ao CREDOR, indicado pela CONTRATADA ao CONTRATANTE, caso este não efetue o pagamento da quitação com o desconto máximo apontado, e o CREDOR não valide mais campanhas de desconto, este contrato restará rescindido em sua totalidade, não haverá por parte da CONTRATADA qualquer obrigação de alcançar um novo desconto, uma vez que o CONTRATANTE não efetuou a quitação do débito no tempo hábil apontado pela CONTRATADA.

4.4 Fica consignado ainda, que todos os descontos obtidos serão repassados TOTALMENTE ao CONTRATANTE, ficando este, responsável pelo pagamento TOTAL referente a quitação do bem, com o desconto apontado pela CONTRATADA, só trabalhamos com contrato inadimplentes, em atraso junto ao CREDOR.

**5 - DAS OBRIGAÇÕES DA CONTRATADA:**

5.1 Disponibilizar ao CONTRATANTE acesso a plataforma de atendimento da CONTRATADA para o acompanhamento contratual, bem como acesso às tratativas conciliatórias com o CREDOR, com o intuito de obter o desconto pretendido, sem qualquer intervenção do CONTRATANTE junto ao CREDOR, sob pena de rescisão deste contrato.

5.2 Realizar o atendimento ao CONTRATANTE por meio dos canais de atendimento disponíveis, dentro do horário comercial, sendo ele, de segunda feira a sexta feira, das 08h às 18h, aos sábados das 8h às 12h, sendo o atendimento de forma prioritária feita pelo APP/CHAT da CONTRATADA, disponibilizada no ato da assinatura deste contrato.

5.3 Trabalhar com todo o rigor profissional para obtenção do melhor desconto em favor do CONTRATANTE, obrigando-se a CONTRATADA a repassar todo e qualquer desconto ao CONTRATANTE, não estando obrigada, naturalmente, com os resultados obtidos, à exceção das disposições presentes nas Cláusulas 4.1 e 7.6, deste contrato.

5.4 Realizar o atendimento especializado junto ao CREDOR, para intermediar e executar a homologação da quitação do débito referente a este contrato, com o pagamento do saldo devedor com o desconto máximo alcançado pela CONTRATADA, devendo tais valores serem pagos pelo CONTRATANTE.

5.5 A CONTRATADA é responsável pela intermediação e negociação do contrato de financiamento, empréstimo, limite de conta corrente ou cartão de crédito e não pelo bem alienado (se houver), uma vez que a posse permanece sob a responsabilidade EXCLUSIVA do CONTRATANTE.

5.6 Repassar as informações sobre o contrato ou as tratativas de negociações ao CONTRATANTE em intervalos não superiores a 15 (quinze) dias através da plataforma EXCLUSIVA de informações da empresa, que deverá ser acessada por ele.

5.7 Caso, se esgotem todas as tratativas de negociação, conforme disposto na cláusula 4.1, e o CONTRATANTE não esteja satisfeito com o desconto alcançado, para a liquidação da dívida, a CONTRATADA poderá rescindir o contrato, nessa hipótese o CONTRATANTE declara estar ciente de que os valores já pagos não serão devolvidos, desde que os serviços contratados tenham sidos prestados integralmente e conforme previsto neste contrato.

**6 - DAS OBRIGAÇÕES DO CONTRATANTE:**

6.1 Acessar periodicamente a plataforma de atendimento da CONTRATADA para o acompanhamento contratual, e atualização das informações relacionadas às tratativas conciliatórias junto ao CREDOR para a obtenção do desconto pretendido.

6.2 Fornecer e manter atualizados todos os meios de comunicação disponíveis, sejam eles contatos telefônicos e/ou digitais, inclusive e-mail sendo dado obrigatório, visando a prestação de serviço na íntegra, ficando sob a responsabilidade do CONTRATANTE, comunicar qualquer mudança que impossibilite a comunicação entre a CONTRATADA e o mesmo.

6.3 Seguir RIGOROSAMENTE todas as orientações repassadas pela CONTRATADA, com a finalidade de obter êxito nas negociações referentes o alcance dos descontos perseguidos.

6.4 Em caso de tratativas diretamente com o banco, a CONTRATADA deve ser informada de imediato, afim de evitar possíveis fraudes, que possam resultar em pagamentos indevidos e/ou perdas financeiras, e tornar-se-á este contrato cancelado automaticamente.

6.5 Em caso de contratos de financiamento de veículos, o CONTRATANTE tem plena ciência de que o veículo poderá sofrer a busca e apreensão, ficando sob sua responsabilidade ou escolha, utilizar o veículo ou não, ficando a CONTRATADA isenta de qualquer responsabilidade, no caso de apreensão do veículo objeto deste contrato.

6.6 Repassar TODAS as ligações de cobrança para a CONTRATADA, fornecendo todos os meios de contato com o CREDOR e/ou assessoria de cobrança, escritório de advocacia e/ou empresa que represente o CREDOR, inclusive, caso necessário, o comparecimento pessoal à instituição bancária para obtenção de informações necessárias às tratativas de acordo.

6.7 As consequências acarretadas pelo descumprimento das recomendações repassadas pela CONTRATADA, são de inteira responsabilidade da parte CONTRATANTE, que poderá ensejar a rescisão do contrato de prestação de serviço.

6.8 Em contrapartida aos serviços prestados, a parte CONTRATANTE deverá pagar as parcelas do contrato de prestação de serviços em dia, a fim de preservar a perfeita execução dos dispositivos contidos neste contrato.

6.9 Caso, o CREDOR realize PROTESTO do débito em aberto em cartório, caberá à parte CONTRATANTE arcar com o pagamento dos emolumentos cartorários, também todo e qualquer procedimento necessário, inclusive solicitação de carta de anuência, para as devidas baixas do protesto.

6.10 É obrigação do CONTRATANTE, manter em dia os pagamentos das parcelas do contrato de prestação do serviço, estando ciente de que, em caso do inadimplemento de qualquer parcela, de acordo com a cláusula 1.4, este poderá ser rescindido por inadimplemento contratual.

**7 - DOS PROCEDIMENTOS DO CONTRATO:**

7.1 A CONTRATADA dispõe de linha de trabalho EXCLUSIVA para negociação diretamente com os CREDORES, realizando periodicamente as tratativas conciliatórias, assim o setor de cobranças da instituição, irá ligar e informar a possibilidade de adesão às propostas para liquidação da dívida.

7.2 Caso o CONTRATANTE receba informações oriundas do CREDOR, deverá imediatamente comunicar à CONTRATADA, a fim de preservar total integridade do acordo, não tendo a CONTRATADA responsabilidade por acordos firmados sem o seu conhecimento entre o CONTRATANTE e o CREDOR, inclusive os que se comprovarem fraudados.

7.3 Em todo o período da vigência contratual, a negociação será realizada pela CONTRATADA, visando à segurança na negociação, o CREDOR da dívida, poderá entrar em contato com o CONTRATANTE, oferecendo outras opções, a exemplo: refinanciamento, atualização de parcelas, inclusão de parcela balão, unificação de dívidas ou até mesmo a entrega do veículo, ficando o CONTRATANTE ciente de que caso escolha qualquer destas opções, será de sua inteira responsabilidade as tratativas, ficando encerrado o contrato de prestação de serviços pela CONTRATADA.

7.4 A liquidação da dívida é de inteira responsabilidade EXCLUSIVA do CONTRATANTE, que deverá disponibilizar recursos financeiros, quando solicitado pela CONTRATADA, para a quitação integral do saldo devedor perante o CREDOR, com o devido desconto alcançado pelas negociações e autorizado pelo CONTRATANTE, nos termos da cláusula 4.1.

7.5 É de responsabilidade do CONTRATANTE pelo pagamento do boleto de quitação da dívida, não podendo ser transferido à CONTRATADA qualquer responsabilidade pelas consequências jurídicas do não pagamento do boleto de quitação.

7.6 Dentro desse procedimento para a obtenção de acordo, visando o desconto máximo para quitação do bem, o CONTRATANTE fica ciente e concorda em suportar os seguintes riscos e consequências:

a) O CONTRATANTE tem ciência de que o CREDOR da dívida, incluirá o nome do titular do financiamento e/ou fiador/avalista (se houver) nos órgãos de proteção ao crédito, e/ou protestar em cartório, até a liquidação integral da dívida;

b) O CONTRATANTE tem ciência de que haverá cobrança excessiva por parte do CREDOR da dívida, inclusive contra o fiador/avalista (se houver), utilizando de diversos mecanismos, seja notificação extrajudicial, SMS, contatos telefônicos, e-mails, whatsapp e em alguns casos, poderá ocorrer o comparecimento pessoal do representante do CREDOR à residência do cliente, e, durante a vigência deste contrato, todas as ligações do banco, deverão ser repassadas à CONTRATADA conforme a cláusula 6.6 deste contrato;

c) O CONTRATANTE tem ciência de que CREDOR, poderá, a qualquer momento, ingressar com ação de busca e apreensão, cobrança administrativa em cartório com busca e apreensão extrajudicial, execução, monitória ou reintegração de posse, em desfavor do titular do financiamento e/ou fiador/avalista (se houver), com todas as disposições contidas na Lei 911/69 na Lei 13.043/2014, na Lei 14.711/2023 e no Provimento nº 196 de 04/06/2025 da CNJ, com a possível expedição de liminar do mandado de busca e apreensão do bem alienado, e, eventualmente, em último caso, solicitar restrição judicial de transferência e/ou circulação junto ao DETRAN, caso seja deferido pelo juiz (se for financiamento de veículo);

d) O CONTRATANTE poderá solicitar a quitação do seu contrato junto ao CREDOR, por meio da CONTRATADA a qualquer momento, porém, para isso terá que pagar o valor solicitado no ato da emissão do boleto de quitação.

e) O CONTRATANTE declara estar ciente de que eventuais infortúnios ou dissabores decorrentes do período de inadimplência, são de SUA EXCLUSIVA RESPONSABILIDADE, não podendo a CONTRATADA ser responsabilizada, em nenhuma hipótese ou esfera, uma vez que não foi causadora de tais situações, A responsabilidade pelo veículo recai integralmente sobre o CONTRATANTE, inclusive nos casos de APREENSÃO DO BEM ALIENADO, bem como quanto à decisão de liquidar a dívida junto ao CREDOR.

7.7 Após alcançado o desconto almejado, caso o CONTRATANTE não disponha dos valores para quitação da dívida, com os descontos alcançados ou não, a CONTRATADA estará totalmente isenta de qualquer responsabilidade contratual, seja civilmente ou criminalmente e se reserva no direito de realizar o distrato do referido contrato de prestação de serviço, visando a preservação da qualidade dos seus serviços, pois, o objeto contratual resume-se na PRESTAÇÃO DE SERVIÇO DE INTERMEDIAÇÃO E RENEGOCIAÇÃO DE DÍVIDA BANCÁRIA e não na garantia da liquidação do débito, pois isso depende EXCLUSIVAMENTE do CONTRATANTE.

**8 - DO PREÇO E DAS CONDIÇÕES DE PAGAMENTO:**

8.1 O CONTRATANTE pagará, a título de remuneração pela prestação dos serviços à CONTRATADA, a importância citada na cláusula 1.4 podendo antecipar os pagamentos, sem qualquer direito a desconto, ante a negociação entabulada.

8.2 O CONTRATANTE está ciente que poderão ser emitidos boletos bancários referente as parcelas da prestação do serviço e ainda, declara ser responsável pelo pagamento integral do valor entabulado no contrato, confessando a dívida de acordo com a forma de pagamento escolhida, sendo a CONTRATADA credora da quantia líquida, certa e exigível, no caso de inadimplência.

**9 - DO INADIMPLEMENTO:**

9.1 O CONTRATANTE está ciente que, em caso de atraso no pagamento de quaisquer das parcelas, acarretará na suspensão do serviço prestado após 10 (dez) dias do vencimento, ocasionando a suspensão dos acompanhamentos contratuais e das notificações necessárias ao bom andamento da prestação de serviço contratada.

9.2 A reativação da prestação dos serviços ocorrerá imediatamente após a comprovante do pagamento da(s) parcela(s) vencida(s), e assinatura dos documentos necessários, ficando o CONTRATANTE responsável por todos os prejuízos ocorridos em decorrência da suspensão da prestação dos serviços por falta de pagamento de quaisquer das parcelas deste contrato.

9.3 Em caso de inadimplemento, sobre as parcelas vencidas, incidirão multa de 10% (dez por cento) pelo atraso a título de multa, bem como juros remuneratórios no percentual de 1% (um por cento) ao mês, estando ciente a parte CONTRATANTE que poderá ocorrer a propositura de ação de cobrança, inclusão do nome no SPC/SERASA, bem como nos demais órgãos de proteção ao crédito, bem como protesto em cartório.

9.4 O CONTRATANTE tem ciência ainda, que após 10 (dez) dias de atraso, a dívida será encaminhada ao departamento jurídico da empresa, para que seja iniciada a cobrança e em caso de pagamento extrajudicial, serão devidos honorários de cobrança no percentual de 10% (dez por cento) do valor da dívida atualizada e caso seja necessário a propositura de ação de cobrança, fica convencionado que os honorários advocatícios serão no percentual não inferior a 20% (vinte por cento) do valor atualizado da dívida.

9.5 O CONTRATANTE fica ciente que qualquer liberalidade da CONTRATADA não será considerada novação e não implica em renúncia dos direitos descritos neste contrato.

9.6 A parte CONTRATANTE tem ciência de que não haverá devolução de qualquer valor pago à CONTRATADA.

**10 - DA VIGÊNCIA CONTRATUAL:**

10.1 O contrato terá vigência a partir da sua assinatura e liberação do pós-venda da CONTRATADA, com duração de até 18 (dezoito) meses.

**11 - RESCISÃO CONTRATUAL:**

11.1 Este contrato poderá ser rescindido de pleno direito, no caso de inadimplemento de qualquer de suas cláusulas ou suas condições, sujeitando às penalidades previstas neste instrumento contratual.

11.2 Caso o CONTRATANTE solicitar o cancelamento do contrato, pagará uma multa correspondente a 10% (dez por cento) do valor total das parcelas em atraso.

11.3 Em caso de requerimento de cancelamento após o pagamento do valor total do serviço contratado, fica isento o CONTRATANTE da multa prevista, estando ciente que não haverá devolução de quaisquer valores.

11.4 Quando solicitado o cancelamento por parte do CONTRATANTE, considera-se o contrato rescindido somente após a assinatura do distrato contratual com o devido pagamento da multa rescisória, se houver. Caso tal procedimento não seja realizado, o contrato permanecerá ativo e será remetido ao setor de cobrança para o início das medidas necessárias para liquidação do débito vencido.

**12 - DIREITO DE IMAGEM:**

12.1 O CONTRATANTE de livre e espontânea vontade, cede e autoriza o uso do direito de imagem respeitando a redação do Artigo 5º, inciso X e seguintes, da Constituição Federal, através de vídeos gravados pelo próprio CONTRATANTE ou representante legal, que poderão ser utilizados pelos meios de comunicação e publicidade da CONTRATADA, seja via Facebook, Instagram, WhatsApp, Twitter, Linkedin, YouTube, TIKTOK, site da {{empresa.nome}}, e/ou, outras plataformas que surgirem posteriormente, por tempo indeterminado, abrindo mão de qualquer tipo de cobrança por tais veiculações de sua imagem.

12.2 Poderá o CONTRATANTE a qualquer momento, requerer a retirada de todo material vinculado, mediante comunicação prévia de no mínimo 30 (trinta) dias úteis, por escrito e endereçado à sede da matriz da CONTRATADA, via Correios, imprescindivelmente por AR (Aviso de Recebimento) com a devida confirmação de leitura, e/ou, por e-mail, no endereço eletrônico: {{empresa.email}}, obrigatoriamente com a devida confirmação de leitura do e-mail.

**13 - CONDIÇÕES GERAIS:**

13.1 O CONTRATANTE declara que assina o presente contrato sem nenhuma espécie de vício de consentimento, tais como coação, erro, dolo, simulação ou fraude, não restando assim, qualquer reclamação quanto à liberdade de suas manifestações de vontade, ora aduzidas neste contrato, visando a quitação do débito apontado com o auxílio da CONTRATADA.

13.2 As partes elegem como foro do domicílio, o do CONTRATANTE, ou em discordância de uma das partes, o foro do local onde o ato foi assinado, conforme legislação vigente, para conhecer das questões porventura emergentes da presente relação contratual. E, por estarem AJUSTADAS e ACORDADAS, as partes assinam o presente contrato de prestação de serviços em duas vias de igual teor e forma.

13.3 As partes concordam que este contrato seja assinado eletronicamente, por meio do Portal do Cliente da CONTRATADA, e reconhecem a validade dessa assinatura nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

{{contrato.unidade}}, {{data.extenso}}.

{{cliente.nome}}
{{cliente.tipo_documento}}: {{cliente.documento}}$contrato$;
        v_n int;
begin
  update public.documento_modelos
     set nome = 'Contrato de prestação de serviço (intermediação e renegociação)', corpo = v_corpo, ativo = true
   where tipo = 'contrato' and corpo like '%[completar%';
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.documento_modelos where corpo = v_corpo) then
    insert into public.documento_modelos (tipo, nome, corpo, ativo)
    values ('contrato', 'Contrato de prestação de serviço (intermediação e renegociação)', v_corpo, true);
  end if;
end $$;
