-- =====================================================================
-- SDR — v2: o que o envio, a leitura de respostas e a tela SDR precisam
-- Rodar DEPOIS do sdr_estetica.sql, no SQL Editor do projeto
-- hebwwsgowdnttdevgrmo. Pode rodar de novo sem erro.
-- Só mexe no schema "sdr".
-- =====================================================================

-- ---------- Empresas: campos do enriquecimento ----------
alter table sdr.empresas add column if not exists responsavel   text;
alter table sdr.empresas add column if not exists procedimentos text[] not null default '{}';
alter table sdr.empresas add column if not exists fato          text;   -- fato verificável para abrir o e-mail
alter table sdr.empresas add column if not exists enriquecido_em timestamptz;

-- ---------- Mensagens: rastreio de e-mail e respostas ----------
alter table sdr.mensagens add column if not exists para         text;
alter table sdr.mensagens add column if not exists de           text;
alter table sdr.mensagens add column if not exists message_id   text;   -- Message-ID do e-mail
alter table sdr.mensagens add column if not exists in_reply_to  text;
alter table sdr.mensagens add column if not exists resumo_ia    text;
alter table sdr.mensagens add column if not exists erro         text;
alter table sdr.mensagens add column if not exists aprovado_em  timestamptz;
alter table sdr.mensagens add column if not exists recebido_em  timestamptz;
alter table sdr.mensagens add column if not exists updated_at   timestamptz not null default now();

alter table sdr.mensagens drop constraint if exists mensagens_status_check;
alter table sdr.mensagens add constraint mensagens_status_check
  check (status in ('rascunho','aprovado','enviado','falhou','recebido','descartado'));

create unique index if not exists mensagens_message_id_uq
  on sdr.mensagens (message_id) where message_id is not null;
-- no máximo uma mensagem "viva" por inscrição e passo (evita rascunho duplicado)
drop index if exists sdr.mensagens_passo_uq;
create unique index mensagens_passo_uq
  on sdr.mensagens (inscricao_id, passo_id)
  where direcao = 'saida' and status in ('rascunho','aprovado','enviado','falhou');

drop trigger if exists t_mensagens_upd on sdr.mensagens;
create trigger t_mensagens_upd before update on sdr.mensagens
  for each row execute function sdr.tocar_updated_at();

-- ---------- Datas: dia útil, 08h de Brasília ----------
create or replace function sdr.proximo_horario(p_base timestamptz, p_dias int)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  d date := (p_base at time zone 'America/Sao_Paulo')::date + p_dias;
begin
  if extract(isodow from d) = 6 then d := d + 2; end if;   -- sábado -> segunda
  if extract(isodow from d) = 7 then d := d + 1; end if;   -- domingo -> segunda
  return (d + time '08:00') at time zone 'America/Sao_Paulo';
end $$;

-- Marca o passo atual como feito e agenda o próximo (dia do passo contado
-- a partir da inscrição; nunca antes de amanhã). Sem próximo = concluída.
create or replace function sdr.avancar(p_inscricao uuid)
returns sdr.inscricoes
language plpgsql set search_path = '' as $$
declare
  i sdr.inscricoes;
  prox sdr.cadencia_passos;
  quando timestamptz;
begin
  select * into i from sdr.inscricoes where id = p_inscricao for update;
  if not found then raise exception 'Inscrição não encontrada'; end if;
  if i.status <> 'ativa' then return i; end if;

  select * into prox from sdr.cadencia_passos
   where cadencia_id = i.cadencia_id and ordem > i.passo_atual
   order by ordem limit 1;

  if not found then
    update sdr.inscricoes set status = 'concluida', motivo_parada = 'cadência completa'
     where id = p_inscricao returning * into i;
    return i;
  end if;

  quando := greatest(sdr.proximo_horario(i.created_at, prox.dia), sdr.proximo_horario(now(), 1));
  update sdr.inscricoes set passo_atual = prox.ordem, proxima_acao_em = quando
   where id = p_inscricao returning * into i;
  return i;
end $$;

-- Inscreve uma empresa na cadência (começa no próximo dia útil às 08h, ou hoje se ainda for manhã)
create or replace function sdr.inscrever(p_empresa uuid, p_cadencia text default 'Estética — primeira abordagem')
returns sdr.inscricoes
language plpgsql set search_path = '' as $$
declare
  c_id uuid;
  e sdr.empresas;
  i sdr.inscricoes;
  inicio timestamptz;
begin
  select id into c_id from sdr.cadencias where nome = p_cadencia and ativo;
  if c_id is null then raise exception 'Cadência "%" não encontrada', p_cadencia; end if;
  select * into e from sdr.empresas where id = p_empresa;
  if not found then raise exception 'Empresa não encontrada'; end if;
  if e.status in ('opt_out','descartado','ganho','perdido') then
    raise exception 'Empresa com status "%" não pode entrar na cadência', e.status;
  end if;
  if exists (select 1 from sdr.opt_outs o
              where (e.email is not null and lower(o.email) = lower(e.email))
                 or (e.whatsapp is not null and o.telefone = e.whatsapp)
                 or (e.telefone is not null and o.telefone = e.telefone)) then
    raise exception 'Empresa está na lista de opt-out';
  end if;

  inicio := case
    when extract(isodow from (now() at time zone 'America/Sao_Paulo')) < 6
     and (now() at time zone 'America/Sao_Paulo')::time < time '12:00'
    then now()
    else sdr.proximo_horario(now(), 1)
  end;

  insert into sdr.inscricoes (empresa_id, cadencia_id, passo_atual, proxima_acao_em, created_at)
  values (p_empresa, c_id, 1, inicio, inicio)
  on conflict (empresa_id, cadencia_id) do nothing
  returning * into i;

  if i.id is null then
    select * into i from sdr.inscricoes where empresa_id = p_empresa and cadencia_id = c_id;
  else
    update sdr.empresas set status = 'em_cadencia'
     where id = p_empresa and status in ('novo','enriquecido');
  end if;
  return i;
end $$;

-- ---------- Fila do dia (com tudo que a IA e a tela precisam) ----------
drop view if exists sdr.vw_fila_hoje;
create view sdr.vw_fila_hoje with (security_invoker = true) as
select
  i.id as inscricao_id, i.proxima_acao_em, i.created_at as inscrita_em,
  (i.proxima_acao_em < sdr.proximo_horario(now(), 0)) as atrasada,
  p.id as passo_id, p.ordem, p.dia, p.canal, p.assunto_modelo, p.corpo_modelo, p.instrucao_ia,
  e.id as empresa_id, e.nome, e.cidade, e.prioridade, e.porte,
  e.email, e.whatsapp, e.telefone, e.instagram, e.site,
  e.responsavel, e.procedimentos, e.fato, e.gancho, e.dor_observada, e.notas,
  m.id as mensagem_id, m.status as mensagem_status,
  t.minutos_ate_resposta as oculto_minutos, t.passou_preco as oculto_passou_preco,
  t.followup_d3 as oculto_followup_d3, t.followup_d7 as oculto_followup_d7,
  (t.id is not null and t.primeira_resposta_em is null) as oculto_sem_resposta
from sdr.inscricoes i
join sdr.empresas e        on e.id = i.empresa_id
join sdr.cadencia_passos p on p.cadencia_id = i.cadencia_id and p.ordem = i.passo_atual
left join sdr.mensagens m  on m.inscricao_id = i.id and m.passo_id = p.id and m.direcao = 'saida'
                          and m.status in ('rascunho','aprovado','enviado','falhou')
left join lateral (
  select * from sdr.testes_atendimento ta where ta.empresa_id = e.id
  order by ta.enviado_em desc limit 1
) t on true
where i.status = 'ativa'
  and i.proxima_acao_em <= now()
  and e.status not in ('opt_out','descartado','perdido','ganho')
  and not exists (select 1 from sdr.opt_outs o
                   where (e.email is not null and lower(o.email) = lower(e.email))
                      or (e.whatsapp is not null and o.telefone = e.whatsapp))
order by e.prioridade, i.proxima_acao_em;

-- Funil
create or replace view sdr.vw_funil with (security_invoker = true) as
select status::text as status, prioridade, count(*)::int as empresas
from sdr.empresas group by 1, 2;

-- ---------- Segurança dos objetos novos ----------
revoke all on all tables in schema sdr from anon, authenticated;
revoke all on all functions in schema sdr from public, anon, authenticated;
grant all on all tables in schema sdr to service_role;
grant execute on all functions in schema sdr to service_role;
alter default privileges in schema sdr revoke execute on functions from public;
alter default privileges in schema sdr grant execute on functions to service_role;

-- =====================================================================
-- Enriquecimento das 24 clínicas (pesquisa pública de 26/09/2026)
-- Só preenche campos vazios: não sobrescreve o que você já editou.
-- =====================================================================
with d(place_id, site, instagram, email, whatsapp, responsavel, procedimentos, fato) as (values
  ('ChIJk8xvBRK22JQRmD9C0GOKpf0','https://clinicadzorzi.com.br/','@clinicadzorzi',null,'+55 47 99709-2987',null,
   array['estética facial avançada','estética corporal avançada','nutrologia e emagrecimento','medicina integrativa'],
   'Equipe com mais de 10 profissionais, unindo estética, nutrologia e medicina integrativa.'),
  ('ChIJSyUAYuC32JQRyQJxP9-Gvy0','https://virtuosaestetica.com.br/','@clinicavirtuosabalneario',null,'+55 47 99130-2466',null,
   array['depilação a laser','protocolos faciais','protocolos corporais'],
   'Unidade da rede Virtuosa em Balneário Camboriú (franquia).'),
  ('ChIJI6BI89y32JQRN5E-jtEta_k','https://clinicaartface.com.br/','@artface.bc','contato@clinicaartface.com.br','+55 47 2033-2021','Dr. Rafael Lucci',
   array['harmonização facial full face','toxina botulínica','preenchimento com ácido hialurônico','bioestimuladores','fios de PDO','harmonização masculina'],
   'Mais de 4.600 procedimentos e 6 anos dedicados só a harmonização facial.'),
  ('ChIJ-zniwTm32JQR1b7uAXtgthY','https://clinicayou.com/','@clinicayouu',null,'+55 47 99259-0331','Laiana Schneider',
   array['estética facial','estética corporal','depilação a laser'],
   'Clínica You, aberta em 2022, com convênio com a CAASC (advogados de SC).'),
  ('ChIJaWqtX3K22JQRhPNiV1sJGWg','https://esteticanovaforma.com.br/','@novaformaestetica',null,'+55 47 99605-0338','Ana Rúbia',
   array['microagulhamento com radiofrequência','toxina botulínica e preenchimentos','peelings e laser','drenagem e radiofrequência','ozonioterapia'],
   'Mais de 30 anos em Balneário Camboriú e mais de 10 mil clientes atendidas.'),
  ('ChIJX0GpXwe22JQRwDtlCXL29e8',null,null,null,'+55 47 99164-3811',null,
   '{}'::text[], null),
  ('ChIJ3UcswF-12JQRwHdAFOG19Gg','https://laisloraine.com.br/','@clinicalaisloraine',null,'+55 47 99650-2576','Laís Loraine',
   array['tratamentos capilares','preenchimento de olheiras','Ultraformer','harmonização facial'],
   'Tem tratamento capilar personalizado como carro-chefe, além da estética facial.'),
  ('ChIJhdIZkQq32JQR67ecuYAa66o',null,null,null,'+55 47 93382-3868','Letícia Setta',
   array['harmonização facial','harmonização corporal'], null),
  ('ChIJE6Xlbs632JQRimV1_I0ak1s',null,null,null,'+55 47 99281-3794','Dra. Samanta Capelossi',
   array['harmonização facial'], null),
  ('ChIJnXiAlf_J2JQRfcDbQMDjqy4','https://www.corpoeformabc.com.br/','@corpoeformabc',null,'+55 47 99600-0004','Dra. Glicéria Tarachuk',
   array['toxina botulínica','bioestimulador de colágeno','fios de PDO','ozonioterapia','PRP/PRF'],
   '26 anos na área, com estética facial, corporal e medicina integrativa.'),
  ('ChIJw8eFQr7J2JQRlGwH0HNf8ig',null,null,null,'+55 47 99758-3290','Milena Dallazem',
   array['tratamentos faciais','tratamentos corporais','secagem de vasinhos'],
   'Agenda online e avaliação gratuita; atende à tarde e sábado de manhã.'),
  ('ChIJ0eUrKU-32JQRkSFrm-jg9Ko',null,null,null,'+55 47 99615-1000','Dra. Auriane Froehner',
   array['harmonização facial','harmonização glútea'], null),
  ('ChIJIfMj_HjJ2JQRtyCI25KKKBg',null,'@dr.mateuswernz',null,'+55 47 92002-0956','Dr. Mateus Wernz',
   array['harmonização facial'], null),
  ('ChIJc-uknoLN2JQR-PpIqUNsxUg','https://virtuosaestetica.com.br/','@clinicavirtuosaitajai',null,'+55 47 99688-4837',null,
   array['depilação a laser','protocolos faciais','protocolos corporais'],
   'Unidade da rede Virtuosa em Itajaí (franquia).'),
  ('ChIJZXlPcJnN2JQRQjtHc9VKljs','https://clinicabiavatti.com.br/','@clinicabiavattiitajai',null,'+55 47 3048-8313',null,
   array['toxina botulínica','bioestimulador de colágeno','skinbooster','harmonização glútea','lipo de papada'],
   'Unidade de Itajaí da rede Biavatti (franquia com dezenas de unidades).'),
  ('ChIJmVRQcbvN2JQRjplYezNqL5Y',null,'@lunniclinic',null,null,'Alana Neves e Izabel Bastos',
   array['tratamentos faciais','tratamentos corporais','nutrição'],
   'Clínica nova, aberta em 2025, com estética e nutrição no mesmo lugar.'),
  ('ChIJJwS-XGPN2JQRG1RsD3ZDjPM',null,'@drajulisantana',null,'+55 47 98852-2022','Dra. Juli Santana',
   array['harmonização facial'], null),
  ('ChIJY9sfI6fN2JQRkMoC8R3Q78I','https://hamonir.com.br/clinica-de-estetica-em-itajai','@hamoniritajai',null,'+55 47 92002-9864',null,
   array['depilação a laser','toxina botulínica','preenchimentos','bioestimulador','fios de sustentação'],
   'Unidade de Itajaí da rede Hamonir (franquia), com planos de assinatura.'),
  ('ChIJHcqoXJTN2JQRdpeLdhSxtXA','https://www.clinicasanvitta.com.br/','@clinicasanvitta','contato@clinicasanvitta.com.br','+55 47 98806-0055','Dra. Eloise Petrelli',
   array['toxina botulínica','preenchimentos','intradermoterapia','microvasos','microagulhamento'],
   'Clínica integrada de saúde, estética e bem-estar, fundada por farmacêutica esteta com mestrado pela UFSC.'),
  ('ChIJb0o-yWnL2JQRJjjzjQR6D_E',null,null,null,'+55 47 99789-7253','Dra. Bruna Martins',
   array['harmonização facial'], null),
  ('ChIJd2OlJxLN2JQRXbWNYRLIVRY',null,'@dluxeclinica',null,'+55 47 99292-0000',null,
   array['drenagem e massagem','tratamento de estrias e flacidez','vasinhos','Ultraformer'], null),
  ('ChIJtbhgpcnN2JQR5E5zJ0yvUgw',null,null,null,'+55 31 98335-3819','Dra. Larissa Mennocchi',
   '{}'::text[], null),
  ('ChIJwwhwUUHN2JQRQBDwbt6Wcro',null,null,null,'+55 47 99199-3977','Dra. Andriele Souza',
   array['biomedicina estética','tratamentos capilares'], null)
)
update sdr.empresas e set
  site          = coalesce(e.site, d.site),
  instagram     = coalesce(e.instagram, d.instagram),
  email         = coalesce(e.email, d.email),
  whatsapp      = coalesce(e.whatsapp, d.whatsapp),
  responsavel   = coalesce(e.responsavel, d.responsavel),
  procedimentos = case when cardinality(e.procedimentos) = 0 then d.procedimentos else e.procedimentos end,
  fato          = coalesce(e.fato, d.fato),
  enriquecido_em = coalesce(e.enriquecido_em, now()),
  status        = case when e.status = 'novo' then 'enriquecido'::sdr.status_empresa else e.status end
from d
where e.google_place_id = d.place_id;

-- A "Clínica de Estética" sem nome (R. Arthur Max Doose) provavelmente é a
-- Le Berto Clinique, que mudou de endereço: fica como descartada até confirmar.
update sdr.empresas
   set status = 'descartado',
       notas = coalesce(notas || ' ', '') || 'Provável Le Berto Clinique (Dra. Joseane Berto), que parece ter mudado para Rua Miguel Matte, 687. Confirmar antes de abordar.'
 where google_place_id = 'ChIJQ_ppDIax2JQRK9SHUZfOR2A' and status = 'novo';
