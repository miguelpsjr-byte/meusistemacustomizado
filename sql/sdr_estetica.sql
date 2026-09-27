-- =====================================================================
-- Meu Sistema Customizado — SDR próprio (prospecção de clínicas de estética)
-- Rodar no SQL Editor do projeto do CRM (hebwwsgowdnttdevgrmo).
-- Tudo fica no schema "sdr", separado das tabelas do CRM de clientes.
-- O schema não é exposto na API pública: só o service role (funções da Vercel /
-- Edge Functions) lê e escreve. RLS ligado e sem policies = nada vaza pelo front.
-- =====================================================================

create schema if not exists sdr;
revoke all on schema sdr from anon, authenticated;

-- ---------- Tipos ----------
do $$ begin
  create type sdr.status_empresa as enum
    ('novo','enriquecido','em_cadencia','respondeu','interessado','reuniao','ganho','perdido','descartado','opt_out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sdr.canal as enum ('email','whatsapp_manual','ligacao','instagram_manual','tarefa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type sdr.classificacao_resposta as enum
    ('interessado','agora_nao','nao_quero','duvida','fora_do_escopo','resposta_automatica');
exception when duplicate_object then null; end $$;

-- ---------- updated_at ----------
create or replace function sdr.tocar_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

-- ---------- Empresas prospectadas ----------
create table if not exists sdr.empresas (
  id              uuid primary key default gen_random_uuid(),
  nome            text not null,
  segmento        text not null default 'estetica',
  cidade          text not null,
  endereco        text,
  telefone        text,
  whatsapp        text,
  email           text,
  site            text,
  instagram       text,
  google_place_id text unique,
  google_nota     numeric(2,1),
  google_avaliacoes int,
  porte           text check (porte in ('solo','equipe')),       -- profissional sozinha x clínica com recepção
  prioridade      char(1) not null default 'B' check (prioridade in ('A','B','C')),
  dor_observada   text,         -- sinal público de dor (ex.: avaliação citando demora) — usado para personalizar
  gancho          text,         -- frase de abertura sugerida pela IA / por você
  status          sdr.status_empresa not null default 'novo',
  motivo_perda    text,
  origem          text not null default 'google_maps',
  notas           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists empresas_status_idx on sdr.empresas (status, prioridade);
drop trigger if exists t_empresas_upd on sdr.empresas;
create trigger t_empresas_upd before update on sdr.empresas for each row execute function sdr.tocar_updated_at();

-- ---------- Pessoas dentro da empresa (decisor, recepção) ----------
create table if not exists sdr.contatos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references sdr.empresas(id) on delete cascade,
  nome        text,
  cargo       text,
  email       text,
  whatsapp    text,
  decisor     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists contatos_empresa_idx on sdr.contatos (empresa_id);

-- ---------- Lista de supressão (LGPD: quem pediu para sair nunca volta) ----------
-- Fica separada das empresas para sobreviver mesmo se o cadastro for apagado.
create table if not exists sdr.opt_outs (
  id         uuid primary key default gen_random_uuid(),
  email      text,
  telefone   text,
  motivo     text,
  created_at timestamptz not null default now(),
  check (email is not null or telefone is not null)
);
create unique index if not exists opt_outs_email_uq on sdr.opt_outs (lower(email)) where email is not null;
create unique index if not exists opt_outs_tel_uq   on sdr.opt_outs (telefone)    where telefone is not null;

-- ---------- Cadências e passos ----------
create table if not exists sdr.cadencias (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  segmento   text,
  ativo      boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists sdr.cadencia_passos (
  id             uuid primary key default gen_random_uuid(),
  cadencia_id    uuid not null references sdr.cadencias(id) on delete cascade,
  ordem          int  not null,
  dia            int  not null,          -- dias após a inscrição
  canal          sdr.canal not null,
  assunto_modelo text,
  corpo_modelo   text,                   -- aceita {{nome}}, {{cidade}}, {{gancho}}, {{dor}}
  instrucao_ia   text,                   -- como a IA deve personalizar este passo
  unique (cadencia_id, ordem)
);

-- ---------- Empresa inscrita numa cadência ----------
create table if not exists sdr.inscricoes (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references sdr.empresas(id) on delete cascade,
  cadencia_id      uuid not null references sdr.cadencias(id),
  passo_atual      int  not null default 1,
  proxima_acao_em  timestamptz not null default now(),
  status           text not null default 'ativa' check (status in ('ativa','pausada','concluida','interrompida')),
  motivo_parada    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (empresa_id, cadencia_id)
);
create index if not exists inscricoes_fila_idx on sdr.inscricoes (status, proxima_acao_em);
drop trigger if exists t_inscricoes_upd on sdr.inscricoes;
create trigger t_inscricoes_upd before update on sdr.inscricoes for each row execute function sdr.tocar_updated_at();

-- ---------- Mensagens (enviadas e recebidas) ----------
create table if not exists sdr.mensagens (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references sdr.empresas(id) on delete cascade,
  inscricao_id   uuid references sdr.inscricoes(id) on delete set null,
  passo_id       uuid references sdr.cadencia_passos(id) on delete set null,
  canal          sdr.canal not null,
  direcao        text not null check (direcao in ('saida','entrada')),
  assunto        text,
  corpo          text,
  status         text not null default 'rascunho'
                 check (status in ('rascunho','aprovado','enviado','falhou','recebido')),
  classificacao  sdr.classificacao_resposta,   -- preenchido pela IA nas respostas recebidas
  provedor_id    text,                         -- id do e-mail no Resend/Brevo, para rastrear
  enviado_em     timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists mensagens_empresa_idx on sdr.mensagens (empresa_id, created_at desc);
create index if not exists mensagens_pendentes_idx on sdr.mensagens (status) where status in ('rascunho','aprovado');

-- ---------- Teste "cliente oculto" do atendimento ----------
create table if not exists sdr.testes_atendimento (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references sdr.empresas(id) on delete cascade,
  canal                text not null check (canal in ('whatsapp','instagram','site','telefone')),
  enviado_em           timestamptz not null,
  primeira_resposta_em timestamptz,
  minutos_ate_resposta int generated always as
    (case when primeira_resposta_em is null then null
          else (extract(epoch from (primeira_resposta_em - enviado_em)) / 60)::int end) stored,
  passou_preco         boolean,
  followup_d3          boolean,
  followup_d7          boolean,
  notas                text,
  created_at           timestamptz not null default now()
);
create index if not exists testes_empresa_idx on sdr.testes_atendimento (empresa_id);

-- ---------- Views úteis ----------
-- O que precisa ser feito hoje (e-mail automático + tarefas manuais de WhatsApp/ligação)
create or replace view sdr.vw_fila_hoje with (security_invoker = true) as
select i.id as inscricao_id, e.id as empresa_id, e.nome, e.cidade, e.prioridade,
       p.ordem, p.dia, p.canal, p.assunto_modelo, i.proxima_acao_em
from sdr.inscricoes i
join sdr.empresas e       on e.id = i.empresa_id
join sdr.cadencia_passos p on p.cadencia_id = i.cadencia_id and p.ordem = i.passo_atual
where i.status = 'ativa'
  and i.proxima_acao_em <= now()
  and e.status not in ('opt_out','descartado','perdido','ganho')
order by e.prioridade, i.proxima_acao_em;

-- Ranking do cliente oculto (vira o relatório enviado para cada clínica)
create or replace view sdr.vw_ranking_atendimento with (security_invoker = true) as
select e.nome, e.cidade, t.canal, t.enviado_em, t.minutos_ate_resposta,
       t.followup_d3, t.followup_d7,
       rank() over (order by coalesce(t.minutos_ate_resposta, 999999)) as posicao
from sdr.testes_atendimento t
join sdr.empresas e on e.id = t.empresa_id;

-- ---------- Segurança ----------
alter table sdr.empresas            enable row level security;
alter table sdr.contatos            enable row level security;
alter table sdr.opt_outs            enable row level security;
alter table sdr.cadencias           enable row level security;
alter table sdr.cadencia_passos     enable row level security;
alter table sdr.inscricoes          enable row level security;
alter table sdr.mensagens           enable row level security;
alter table sdr.testes_atendimento  enable row level security;
revoke all on all tables in schema sdr from anon, authenticated;
grant usage on schema sdr to service_role;
grant all on all tables in schema sdr to service_role;
grant all on all sequences in schema sdr to service_role;
alter default privileges in schema sdr grant all on tables to service_role;

-- =====================================================================
-- CADÊNCIA INICIAL — Clínicas de estética (14 dias, 6 toques)
-- =====================================================================
insert into sdr.cadencias (nome, segmento) values ('Estética — primeira abordagem', 'estetica')
on conflict (nome) do nothing;

insert into sdr.cadencia_passos (cadencia_id, ordem, dia, canal, assunto_modelo, corpo_modelo, instrucao_ia)
select c.id, v.ordem, v.dia, v.canal::sdr.canal, v.assunto, v.corpo, v.instrucao
from sdr.cadencias c
cross join (values
  (1, 0, 'email',
   'Uma pergunta sobre os pacientes que chegam pelo Instagram da {{nome}}',
   E'Oi, tudo bem?\n\n{{gancho}}\n\nNas clínicas de estética, o paciente que manda mensagem à noite ou no fim de semana costuma fechar com quem responde primeiro. Montamos um atendente com IA que responde na hora pelo WhatsApp e Instagram, tira dúvidas sobre os procedimentos e já agenda a avaliação na sua agenda.\n\nPosso te mandar um vídeo de 2 minutos mostrando ele funcionando com os procedimentos da {{nome}}?\n\nMiguel\nMeu Sistema Customizado · Balneário Camboriú\n\nSe não quiser mais receber, é só responder "sair".',
   'Escreva o {{gancho}} em 1 frase, citando algo real e específico da clínica (procedimento carro-chefe, bairro, algo do Instagram ou site). Nunca invente dados. Se houver dor_observada, não cite a avaliação negativa diretamente no 1º contato.'),
  (2, 2, 'whatsapp_manual', null,
   'Oi! Aqui é o Miguel, de BC. Mandei um e-mail para a {{nome}} sobre responder automaticamente os pacientes que chamam fora do horário. Posso te mandar um vídeo rápido mostrando?',
   'Mensagem curta, sem link no primeiro envio. Você envia manualmente pelo WhatsApp Business.'),
  (3, 5, 'email',
   'Pacientes de botox que não voltaram',
   E'Oi,\n\nOutra coisa que costuma ficar parada nas clínicas: o paciente que fez toxina ou bioestimulador há 5–6 meses e ainda não reagendou. É receita que já é da clínica, só falta um lembrete no momento certo.\n\nNosso sistema envia esse lembrete sozinho, no mês certo de cada paciente. Faz sentido para a {{nome}}?\n\nMiguel\n\nPara não receber mais, responda "sair".',
   'Se a clínica vender planos ou pacotes (dor_observada/notas), adapte para "sessões de pacote que ficam sem agendar".'),
  (4, 8, 'email',
   'Fiz um teste com a {{nome}}',
   E'Oi,\n\nMontei uma demonstração do atendente já treinado com os procedimentos da {{nome}}. Leva 2 minutos: [link do vídeo]\n\nSe gostar, a implantação sai a partir de R$ 208/mês em 10x, sem mensalidade de licença.\n\nMiguel',
   'Só envie se o vídeo Loom personalizado estiver pronto; caso contrário, gere uma tarefa para o Miguel gravar.'),
  (5, 11, 'ligacao', null,
   'Ligar para a recepção, perguntar quem cuida do atendimento/agenda e pedir 10 minutos com o(a) responsável.',
   'Tarefa manual. Registrar o resultado em notas.'),
  (6, 14, 'email',
   'Encerro por aqui?',
   E'Oi,\n\nComo não tive retorno, imagino que não seja prioridade agora e não vou insistir. Se em algum momento quiser ver o atendente funcionando com os procedimentos da {{nome}}, é só responder este e-mail.\n\nMiguel',
   'E-mail de encerramento. Não repetir oferta nem preço.')
) as v(ordem, dia, canal, assunto, corpo, instrucao)
where c.nome = 'Estética — primeira abordagem'
on conflict (cadencia_id, ordem) do nothing;

-- =====================================================================
-- LISTA INICIAL — 24 clínicas de estética (Balneário Camboriú e Itajaí)
-- Fonte: Google Maps, 25/09/2026. Telefones comerciais públicos.
-- Prioridade A = clínica com equipe/recepção (dor de atendimento maior).
-- =====================================================================
insert into sdr.empresas
  (nome, cidade, endereco, telefone, google_place_id, google_nota, google_avaliacoes, porte, prioridade, dor_observada, notas)
values
-- Balneário Camboriú
('Clínica D''Zorzi Estética & Saúde','Balneário Camboriú','R. 916, 199 - Sl 08 - Centro','+55 47 99709-2987','ChIJk8xvBRK22JQRmD9C0GOKpf0',5.0,221,'equipe','A',null,'Clínica grande, com recepção e várias profissionais; atende também estrangeiros.'),
('Clínica Estética Virtuosa - Balneário Camboriú','Balneário Camboriú','Rua 2500, 930 - Centro','+55 47 99130-2466','ChIJSyUAYuC32JQRyQJxP9-Gvy0',4.2,174,'equipe','A','Avaliações recentes citam remarcações e falta de retorno após a compra de pacotes.','Parece rede (há unidade em Itajaí): decisor pode ser o franqueador.'),
('ArtFace Harmonização Facial Balneário Camboriú','Balneário Camboriú','Rua 1300, 25 - Centro','+55 47 2033-2021','ChIJI6BI89y32JQRN5E-jtEta_k',4.9,154,'equipe','A',null,'Capta pacientes de outras cidades pelo Instagram; tem recepção.'),
('Clínica Dra Laiana Schneider - Clínica You','Balneário Camboriú','R. 912, 110 - sala 07 - Centro','+55 47 99259-0331','ChIJ-zniwTm32JQR1b7uAXtgthY',5.0,106,'equipe','A',null,'Faz também depilação a laser (pacotes/sessões recorrentes).'),
('Nova Forma Estética Integrativa','Balneário Camboriú','Rua 2448, 398 - Centro','+55 47 99605-0338','ChIJaWqtX3K22JQRhPNiV1sJGWg',5.0,103,'equipe','A',null,'30 anos de mercado; base grande de pacientes antigos (reativação).'),
('NID - Estética Avançada','Balneário Camboriú','R. Panamá, 284 - Nações','+55 47 99164-3811','ChIJX0GpXwe22JQRwDtlCXL29e8',5.0,70,'equipe','A',null,'Tecnologias/equipamentos e atendimento a estrangeiros.'),
('Clínica Laís Loraine','Balneário Camboriú','Rua Miguel Matte, 687 - Centro','+55 47 99650-2576','ChIJ3UcswF-12JQRwHdAFOG19Gg',5.0,63,'equipe','A',null,'Estética facial e tratamentos capilares; aberta até 21h.'),
('Letícia Setta Harmonização Facial e Corporal','Balneário Camboriú','R. 2700, 212 - Sl 03 - Centro','+55 47 93382-3868','ChIJhdIZkQq32JQR67ecuYAa66o',5.0,95,'solo','B',null,null),
('Dra Samanta Capelossi - Harmonização Facial','Balneário Camboriú','Rua 1542, 344 - Centro','+55 47 99281-3794','ChIJE6Xlbs632JQRimV1_I0ak1s',4.9,25,'solo','B',null,'Atende só à tarde (13h–21h): perde contatos da manhã.'),
('Corpo & Forma Clínica de Estética Avançada','Balneário Camboriú','R. 1041, 177 - Centro','+55 47 3361-9105','ChIJnXiAlf_J2JQRfcDbQMDjqy4',5.0,24,'equipe','B',null,'Clientes muito fiéis (18+ anos); telefone fixo como contato principal.'),
('Estética Avançada - Milena Dallazem','Balneário Camboriú','R. 1101, 325 - Sala 01 - Centro','+55 47 99758-3290','ChIJw8eFQr7J2JQRlGwH0HNf8ig',5.0,23,'solo','B',null,'Atende só à tarde durante a semana.'),
('Clínica de Estética (R. Arthur Max Doose)','Balneário Camboriú','R. Arthur Max Doose, 153 - Pioneiros',null,'ChIJQ_ppDIax2JQRK9SHUZfOR2A',5.0,11,'solo','C',null,'Sem nome comercial e sem telefone no Google: enriquecer antes.'),
('Dra Auriane Froehner - Harmonização Facial e Glútea','Balneário Camboriú','R. 2950, 369 - Sl 04 - Centro','+55 47 99615-1000','ChIJ0eUrKU-32JQRkSFrm-jg9Ko',5.0,9,'solo','C',null,'Atende só à tarde.'),
('Dr Mateus Wernz Harmonização Facial','Balneário Camboriú','Rua Miguel Matte, 687 - Sl 1105 - Pioneiros','+55 47 92002-0956','ChIJIfMj_HjJ2JQRtyCI25KKKBg',5.0,9,'solo','C',null,null),
-- Itajaí
('Clínica Virtuosa - Itajaí','Itajaí','R. Dr. José Bonifácio Malburg, 517 - Centro','+55 47 99688-4837','ChIJc-uknoLN2JQR-PpIqUNsxUg',4.4,303,'equipe','A','Avaliações citam demora para agendar sessões de pacote já pagas.','Mesma rede da unidade de BC.'),
('Clínica Biavatti Itajaí','Itajaí','R. Samuel Heusi, 463 - Lj 1 - Centro','+55 47 3048-8313','ChIJZXlPcJnN2JQRQjtHc9VKljs',5.0,175,'equipe','A',null,'Recepção citada nas avaliações; atendimento online antes do presencial; abre sábado.'),
('Lunni Clinic - Estética Avançada','Itajaí','Rua XV de Novembro, 159 - Centro',null,'ChIJmVRQcbvN2JQRjplYezNqL5Y',5.0,124,'equipe','A',null,'Sem telefone no Google: buscar WhatsApp no Instagram. Tem nutricionista além da estética.'),
('Dra. Juli Santana - Harmonização Facial','Itajaí','R. Uruguai, 223 - Sl 1214 - Centro','+55 47 98852-2022','ChIJJwS-XGPN2JQRG1RsD3ZDjPM',5.0,111,'solo','B',null,'Faz retornos/retoques programados (bom gancho para lembrete automático).'),
('Clínica de Estética Hamonir','Itajaí','R. Dr. Pedro Ferreira, 190 - Centro','+55 47 3344-5626','ChIJY9sfI6fN2JQRkMoC8R3Q78I',4.7,77,'equipe','A','Avaliação relata avaliação inicial sem conversão por atendimento frio.','Vende planos (recorrência de botox).'),
('Clínica Sanvittá','Itajaí','Rua Brusque, 121 - Sl 01 - Centro','+55 47 2125-4555','ChIJHcqoXJTN2JQRdpeLdhSxtXA',5.0,69,'equipe','A',null,'Pacientes chegam pelo Instagram.'),
('Dra Bruna Martins Harmonização Facial','Itajaí','R. Dr. Nereu Ramos, 197 - Centro','+55 47 99789-7253','ChIJb0o-yWnL2JQRJjjzjQR6D_E',5.0,54,'solo','B',null,'Abre sábado.'),
('D''Luxe Clínica Biomédica Itajaí','Itajaí','R. Hercílio Luz, 338 - Centro','+55 47 99292-0000','ChIJd2OlJxLN2JQRXbWNYRLIVRY',5.0,35,'equipe','B',null,'Vende pacotes de drenagem/massagem (sessões recorrentes).'),
('Dra. Larissa Mennocchi Biomédica Esteta','Itajaí','Av. Cel. Marcos Konder, 1207 - Sl 117 - Centro','+55 31 98335-3819','ChIJtbhgpcnN2JQR5E5zJ0yvUgw',5.0,24,'solo','C',null,'WhatsApp com DDD 31.'),
('Clínica Aésse - Dra. Andriele Souza','Itajaí','Av. Cel. Marcos Konder, 1207 - Sala 120 - Centro','+55 47 99199-3977','ChIJwwhwUUHN2JQRQBDwbt6Wcro',5.0,17,'solo','C',null,'Harmonização e tratamentos capilares.')
on conflict (google_place_id) do nothing;
