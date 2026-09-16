// Projeto: formulário de novo projeto e visão detalhada (abas Geral, Comercial, Serviço, Resumo, SLA, Histórico, Financeiro, Contrato).
import { sb, q } from '../core/supabase.js';
import { apoio, ehAdmin, emitir } from '../core/store.js';
import { html, raw, mount, $, $$, brl, data, dataHora, duracao, hojeISO, addDiasISO, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro,
  comBotao, opcoes, opcoesLista, FORMAS_PAGAMENTO, PERIODICIDADES, PRIORIDADES, STATUS_PROJETO, STATUS_CONTRATO, slaBadge, prioridadeBadge,
  parseValor, valorInput, plural } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { renderParcelas } from './parcelas.js';

async function listaClientes() {
  return q(sb.from('clientes').select('id,nome,empresa').is('deleted_at', null).order('nome').limit(2000));
}
const rotuloCliente = (c) => (c.empresa ? `${c.nome} — ${c.empresa}` : c.nome);

// ================= NOVO PROJETO =================
export async function novoProjeto({ clienteId } = {}) {
  let clientes, servicos, equipe;
  try { [clientes, servicos, equipe] = await Promise.all([listaClientes(), apoio('servicos'), apoio('equipe')]); }
  catch (e) { return toastErro(e); }
  const servAtivos = servicos.filter((s) => s.ativo);

  const m = abrirModal({
    titulo: 'Novo projeto', tamanho: 'l',
    corpo: html`<form class="grade-2" novalidate>
      <div class="campo col-toda"><span>Cliente</span>
        <div class="inline-add"><label class="campo"><span class="sr-only">Cliente</span><select name="cliente_id" required>${opcoesLista(clientes, clienteId, 'Selecione o cliente', { texto: rotuloCliente })}</select></label>
        <button type="button" class="btn btn-secundario" data-novo-cliente>${raw(icon('plus', 16))}Novo cliente</button></div>
        ${clientes.length ? '' : html`<small>Nenhum cliente cadastrado ainda. Crie o primeiro pelo botão ao lado.</small>`}
      </div>
      <label class="campo"><span>Serviço</span><select name="servico_id">${opcoesLista(servAtivos, '', 'Selecione o serviço')}</select></label>
      <label class="campo"><span>Nome do projeto</span><input name="titulo" maxlength="140" required placeholder="Ex.: CRM customizado"></label>
      <label class="campo"><span>Valor total (R$)</span><input name="valor_total" inputmode="decimal" placeholder="0,00"></label>
      <label class="campo"><span>Desconto (R$)</span><input name="desconto" inputmode="decimal" placeholder="0,00"></label>
      <label class="campo"><span>Forma de pagamento</span><select name="forma_pagamento">${opcoes(FORMAS_PAGAMENTO, 'pix', 'Não definida')}</select></label>
      <label class="campo"><span>Periodicidade</span><select name="periodicidade">${opcoes(PERIODICIDADES, 'mensal')}</select></label>
      <label class="campo"><span>Número de parcelas</span><input name="num_parcelas" type="number" min="1" max="120" value="1"></label>
      <label class="campo"><span>Primeira parcela</span><input name="primeira_parcela" type="date" value="${hojeISO()}"></label>
      <label class="campo"><span>Início do projeto</span><input name="data_inicio" type="date" value="${hojeISO()}"></label>
      <label class="campo"><span>SLA (dias)</span><input name="sla_dias" type="number" min="1" placeholder="Ex.: 20"><small data-limite></small></label>
      <label class="campo"><span>Responsável</span><select name="responsavel_id">${opcoesLista(equipe.filter((u) => u.ativo), '', 'Sem responsável', { texto: (u) => u.nome || u.email })}</select></label>
      <label class="campo"><span>Prioridade</span><select name="prioridade">${opcoes(PRIORIDADES, 'media')}</select></label>
      <label class="campo col-toda"><span>Resumo do projeto</span><textarea name="resumo" rows="4" maxlength="8000" placeholder="O que será desenvolvido, principais entregas e combinados."></textarea></label>
      <p class="col-toda aviso aviso-neutro">${raw(icon('kanban', 16))}O projeto entra automaticamente na primeira etapa do CRM (Diagnóstico). Se houver valor, as parcelas são geradas pelas condições acima.</p>
    </form>`,
    rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>Criar projeto</button>`
  });
  const f = $('form', m.el);
  const atualizarLimite = () => {
    const d = f.data_inicio.value, s = parseInt(f.sla_dias.value, 10);
    $('[data-limite]', f).textContent = d && s > 0 ? `Entrega prevista: ${data(addDiasISO(d, s))}` : '';
  };
  f.servico_id.addEventListener('change', () => {
    const s = servAtivos.find((x) => x.id === f.servico_id.value);
    if (s?.sla_padrao_dias && !f.sla_dias.value) { f.sla_dias.value = s.sla_padrao_dias; atualizarLimite(); }
    if (s && !f.titulo.value) f.titulo.value = s.nome;
  });
  f.periodicidade.addEventListener('change', () => { if (f.periodicidade.value === 'unica') f.num_parcelas.value = 1; });
  f.sla_dias.addEventListener('input', atualizarLimite); f.data_inicio.addEventListener('input', atualizarLimite);
  $('[data-novo-cliente]', f).addEventListener('click', async () => {
    const { formCliente } = await import('./clientes.js');
    formCliente({ aoSalvar: async (novo) => {
      const lista = await listaClientes();
      mount(f.cliente_id, opcoesLista(lista, novo.id, 'Selecione o cliente', { texto: rotuloCliente }));
    } });
  });

  $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const valor_total = parseValor(f.valor_total.value), desconto = parseValor(f.desconto.value);
    const erros = [];
    if (!f.cliente_id.value) erros.push('Selecione o cliente.');
    if (!f.titulo.value.trim()) erros.push('Informe o nome do projeto.');
    if (!Number.isFinite(valor_total) || valor_total < 0) erros.push('Valor total inválido.');
    if (!Number.isFinite(desconto) || desconto < 0 || desconto > valor_total) erros.push('O desconto deve ficar entre zero e o valor total.');
    const num = parseInt(f.num_parcelas.value, 10) || 1;
    if (num < 1 || num > 120) erros.push('Número de parcelas deve ficar entre 1 e 120.');
    const sla = f.sla_dias.value ? parseInt(f.sla_dias.value, 10) : null;
    if (sla !== null && !(sla > 0)) erros.push('SLA deve ser um número de dias maior que zero.');
    if (erros.length) return toast(erros[0], 'erro');
    const reg = {
      cliente_id: f.cliente_id.value, servico_id: f.servico_id.value || null, titulo: f.titulo.value.trim(),
      valor_total, desconto, forma_pagamento: f.forma_pagamento.value || null, periodicidade: f.periodicidade.value,
      num_parcelas: f.periodicidade.value === 'unica' ? 1 : num, primeira_parcela: f.primeira_parcela.value || null,
      data_inicio: f.data_inicio.value || null, sla_dias: sla, responsavel_id: f.responsavel_id.value || null,
      prioridade: f.prioridade.value, resumo: f.resumo.value.trim() || null
    };
    try {
      const novo = await q(sb.from('projetos').insert(reg).select('id,codigo').single());
      if (valor_total - desconto > 0) {
        try { await q(sb.rpc('gerar_parcelas', { p_projeto_id: novo.id })); }
        catch (e) { toast(`Projeto criado, mas as parcelas não foram geradas: ${e.message}`, 'erro'); }
      }
      toast(`Projeto #${novo.codigo} criado em Diagnóstico.`);
      m.fechar(); emitir('dados-alterados');
      abrirProjeto(novo.id);
    } catch (e) { toastErro(e); }
  }));
}

// ================= DETALHE DO PROJETO =================
const ABAS = [['geral', 'Geral'], ['comercial', 'Comercial'], ['servico', 'Serviço'], ['resumo', 'Resumo'], ['sla', 'SLA'], ['historico', 'Histórico'], ['financeiro', 'Financeiro'], ['contrato', 'Contrato']];

export async function abrirProjeto(id, { aba = 'geral' } = {}) {
  const m = abrirModal({ titulo: 'Projeto', tamanho: 'xl', corpo: carregando() });
  let p, etapas, servicos, equipe, contratos, historico, abaAtual = ABAS.some(([k]) => k === aba) ? aba : 'geral';
  let alterou = false;
  const marcarAlteracao = () => { alterou = true; emitir('dados-alterados'); };

  async function carregar() {
    [p, etapas, servicos, equipe, contratos, historico] = await Promise.all([
      q(sb.from('vw_projetos').select('*').eq('id', id).maybeSingle()),
      apoio('etapas'), apoio('servicos'), apoio('equipe'),
      q(sb.from('contratos').select('id,numero,status,versao_atual,updated_at,valor').eq('projeto_id', id).is('deleted_at', null).order('created_at', { ascending: false })),
      q(sb.from('projeto_historico').select('*').eq('projeto_id', id).order('movido_em'))
    ]);
  }
  try { await carregar(); } catch (e) { return mount(m.corpo, erroBox(e)); }
  if (!p) return mount(m.corpo, vazio({ titulo: 'Projeto não encontrado', texto: 'Ele pode ter sido excluído.' }));

  const nomeUsuario = (uid) => { const u = equipe.find((x) => x.id === uid); return u ? (u.nome || u.email) : '—'; };

  function renderTudo() {
    $('.modal-topo h2', m.el).textContent = `#${p.codigo} · ${p.titulo}`;
    const contratoAtual = contratos.find((c) => c.status !== 'cancelado');
    mount(m.corpo, html`
      <div class="projeto-cabecalho">
        <span><b>${p.cliente_nome}</b>${p.cliente_empresa ? html` <span style="color:var(--texto-3)">· ${p.cliente_empresa}</span>` : ''}</span>
        <label class="campo" style="flex-direction:row;align-items:center;gap:8px"><span>Etapa</span>
          <select class="entrada" data-etapa style="width:auto;padding:6px 10px">${opcoesLista(etapas.filter((e) => e.ativo || e.id === p.etapa_id), p.etapa_id)}</select></label>
        <label class="campo" style="flex-direction:row;align-items:center;gap:8px"><span>Status</span>
          <select class="entrada" data-status style="width:auto;padding:6px 10px">${opcoes(STATUS_PROJETO, p.status)}</select></label>
        ${prioridadeBadge(p.prioridade)} ${slaBadge(p)}
        ${p.parado ? html`<span class="badge badge-alerta">${raw(icon('history', 12))}Parado há ${plural(p.dias_na_etapa, 'dia', 'dias')}</span>` : ''}
      </div>
      <div class="resumo-faixa">
        <div><span>Valor final</span><b>${brl(p.valor_final)}</b></div>
        <div><span>Recebido</span><b>${brl(p.valor_recebido)}</b></div>
        <div><span>A receber</span><b>${brl(p.valor_a_receber)}</b></div>
        <div><span>Entrega</span><b>${p.data_limite ? data(p.data_limite) : '—'}</b></div>
        <div><span>Contrato</span><b>${contratoAtual ? `${STATUS_CONTRATO[contratoAtual.status]} · v${contratoAtual.versao_atual}` : 'Não gerado'}</b></div>
      </div>
      <nav class="abas" role="tablist">${ABAS.map(([k, t]) => html`<button role="tab" data-aba="${k}" aria-selected="${k === abaAtual}">${t}</button>`)}</nav>
      <div class="aba-conteudo" role="tabpanel"></div>`);
    mount(m.rodape || criarRodape(), html`
      ${ehAdmin() ? html`<button class="btn btn-fantasma btn-texto-perigo" data-excluir style="margin-right:auto">${raw(icon('trash', 16))}Excluir projeto</button>` : ''}
      <button class="btn btn-secundario" data-fechar>Fechar</button>`);
    $('[data-etapa]', m.corpo).addEventListener('change', (ev) => moverEtapa(ev.target.value));
    $('[data-status]', m.corpo).addEventListener('change', (ev) => salvar({ status: ev.target.value }, 'Status atualizado.'));
    $('.abas', m.corpo).addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-aba]'); if (!b) return;
      abaAtual = b.dataset.aba;
      $$('.abas [data-aba]', m.corpo).forEach((x) => x.setAttribute('aria-selected', x === b));
      renderAba();
    });
    $('[data-excluir]', m.el)?.addEventListener('click', excluir);
    renderAba();
  }
  function criarRodape() {
    const f = document.createElement('footer'); f.className = 'modal-rodape'; m.el.appendChild(f); m.rodape = f; return f;
  }

  async function recarregar() { await carregar(); renderTudo(); }
  async function salvar(campos, msg = 'Alterações salvas.') {
    try {
      await q(sb.from('projetos').update(campos).eq('id', id));
      toast(msg); marcarAlteracao(); await recarregar();
      return true;
    } catch (e) { toastErro(e); await recarregar(); return false; }
  }
  async function moverEtapa(etapaId) {
    const destino = etapas.find((e) => e.id === etapaId);
    await salvar({ etapa_id: etapaId }, `Projeto movido para ${destino?.nome}.`);
  }
  async function excluir() {
    if (!(await confirmar({ titulo: 'Excluir projeto', mensagem: `O projeto #${p.codigo} sairá do CRM, do financeiro e do forecast. O histórico fica guardado na auditoria.`, confirmar: 'Excluir projeto', perigo: true }))) return;
    try {
      await q(sb.from('projetos').update({ deleted_at: new Date().toISOString() }).eq('id', id));
      toast('Projeto excluído.'); emitir('dados-alterados'); m.fechar();
    } catch (e) { toastErro(e); }
  }

  function renderAba() {
    const box = $('.aba-conteudo', m.corpo);
    const fn = { geral: abaGeral, comercial: abaComercial, servico: abaServico, resumo: abaResumo, sla: abaSla, historico: abaHistorico, financeiro: abaFinanceiro, contrato: abaContrato }[abaAtual];
    fn(box);
  }

  function abaGeral(box) {
    const ultimas = historico.slice(-3).reverse();
    const contrato = contratos.find((c) => c.status !== 'cancelado');
    mount(box, html`
      <div class="visao-geral">
        <section class="bloco-info"><h3>Cliente</h3><dl class="dl">
          <dt>Nome</dt><dd><button class="btn-link" data-cliente style="all:unset;cursor:pointer;color:var(--laranja);font-weight:700">${p.cliente_nome}</button></dd>
          <dt>Empresa</dt><dd>${p.cliente_empresa || '—'}</dd>
          <dt>CPF/CNPJ</dt><dd>${p.cliente_documento || '—'}</dd>
          <dt>Telefone</dt><dd>${p.cliente_telefone || '—'}</dd>
          <dt>WhatsApp</dt><dd>${p.cliente_whatsapp ? html`<a href="https://wa.me/55${p.cliente_whatsapp.replace(/\D/g, '').replace(/^55/, '')}" target="_blank" rel="noopener noreferrer">${p.cliente_whatsapp}</a>` : '—'}</dd>
          <dt>E-mail</dt><dd>${p.cliente_email ? html`<a href="mailto:${p.cliente_email}">${p.cliente_email}</a>` : '—'}</dd></dl></section>
        <section class="bloco-info"><h3>Projeto e SLA</h3><dl class="dl">
          <dt>Serviço</dt><dd>${p.servico_nome || '—'}</dd>
          <dt>Responsável</dt><dd>${p.responsavel_nome || '—'}</dd>
          <dt>Etapa</dt><dd>${p.etapa_nome} · há ${plural(p.dias_na_etapa, 'dia', 'dias')}</dd>
          <dt>Início</dt><dd>${data(p.data_inicio)}</dd>
          <dt>SLA</dt><dd>${p.sla_dias ? plural(p.sla_dias, 'dia', 'dias') : '—'}</dd>
          <dt>Entrega</dt><dd>${data(p.data_limite)}</dd>
          <dt>Em execução</dt><dd>${p.dias_em_execucao != null ? plural(p.dias_em_execucao, 'dia', 'dias') : '—'}</dd></dl></section>
        <section class="bloco-info"><h3>Financeiro e contrato</h3><dl class="dl">
          <dt>Valor total</dt><dd>${brl(p.valor_total)}</dd>
          <dt>Desconto</dt><dd>${brl(p.desconto)}</dd>
          <dt>Pagamento</dt><dd>${FORMAS_PAGAMENTO[p.forma_pagamento] || '—'} · ${PERIODICIDADES[p.periodicidade]}</dd>
          <dt>Parcelas</dt><dd>${p.parcelas_pagas}/${p.parcelas_qtd} pagas</dd>
          <dt>Vencido</dt><dd style="${Number(p.valor_vencido) > 0 ? 'color:var(--erro)' : ''}">${brl(p.valor_vencido)}</dd>
          <dt>Contrato</dt><dd>${contrato ? `${contrato.numero} · ${STATUS_CONTRATO[contrato.status]}` : 'Não gerado'}</dd></dl></section>
      </div>
      ${p.resumo ? html`<section class="bloco-info" style="margin-top:18px"><h3>Resumo</h3><p style="white-space:pre-wrap;color:var(--texto-2)">${p.resumo}</p></section>` : ''}
      ${ultimas.length ? html`<section class="bloco-info" style="margin-top:18px"><h3>Últimas movimentações</h3>
        <ul class="linha-tempo">${ultimas.map((hh) => html`<li style="--cor:${etapas.find((e) => e.id === hh.etapa_para_id)?.cor || '#F59E0B'}"><b>${hh.etapa_para_nome}</b><span>${dataHora(hh.movido_em)} · ${nomeUsuario(hh.movido_por)}</span></li>`)}</ul></section>` : ''}
      <form class="painel" style="margin-top:18px;box-shadow:none" novalidate>
        <div class="painel-topo"><h2>Dados do projeto</h2></div>
        <div class="grade-2">
          <label class="campo"><span>Nome do projeto</span><input name="titulo" value="${p.titulo}" maxlength="140" required></label>
          <label class="campo"><span>Cliente</span><select name="cliente_id" data-lista-clientes><option value="${p.cliente_id}">${p.cliente_nome}</option></select></label>
          <label class="campo"><span>Responsável</span><select name="responsavel_id">${opcoesLista(equipe.filter((u) => u.ativo || u.id === p.responsavel_id), p.responsavel_id, 'Sem responsável', { texto: (u) => u.nome || u.email })}</select></label>
          <label class="campo"><span>Prioridade</span><select name="prioridade">${opcoes(PRIORIDADES, p.prioridade)}</select></label>
        </div>
        <div class="form-acoes"><button class="btn btn-primario" data-salvar>Salvar dados</button></div>
      </form>`);
    listaClientes().then((l) => { const s = $('[data-lista-clientes]', box); if (s) mount(s, opcoesLista(l, p.cliente_id, undefined, { texto: rotuloCliente })); }).catch(() => {});
    $('[data-cliente]', box).addEventListener('click', async () => (await import('./clientes.js')).abrirCliente(p.cliente_id));
    $('[data-salvar]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const f = $('form', box);
      if (!f.titulo.value.trim()) return toast('Informe o nome do projeto.', 'erro');
      await salvar({ titulo: f.titulo.value.trim(), cliente_id: f.cliente_id.value, responsavel_id: f.responsavel_id.value || null, prioridade: f.prioridade.value });
    }); });
  }

  function abaComercial(box) {
    mount(box, html`<form class="grade-2" novalidate>
      <label class="campo col-toda"><span>Informações da negociação</span><textarea name="info_comercial" rows="4" maxlength="8000" placeholder="Como chegou, o que foi proposto, objeções, combinados comerciais.">${p.info_comercial || ''}</textarea></label>
      <label class="campo"><span>Valor total (R$)</span><input name="valor_total" inputmode="decimal" value="${valorInput(p.valor_total)}"></label>
      <label class="campo"><span>Desconto (R$)</span><input name="desconto" inputmode="decimal" value="${valorInput(p.desconto)}"></label>
      <div class="campo"><span>Valor final</span><b data-final style="font-size:20px;padding:6px 0">${brl(p.valor_final)}</b></div>
      <label class="campo"><span>Forma de pagamento</span><select name="forma_pagamento">${opcoes(FORMAS_PAGAMENTO, p.forma_pagamento, 'Não definida')}</select></label>
      <label class="campo"><span>Periodicidade</span><select name="periodicidade">${opcoes(PERIODICIDADES, p.periodicidade)}</select></label>
      <label class="campo"><span>Número de parcelas</span><input name="num_parcelas" type="number" min="1" max="120" value="${p.num_parcelas}"></label>
      <label class="campo"><span>Primeira parcela</span><input name="primeira_parcela" type="date" value="${p.primeira_parcela || ''}"></label>
      <div class="col-toda form-acoes"><button class="btn btn-primario" data-salvar>Salvar condições</button></div>
    </form>`);
    const f = $('form', box);
    const calc = () => { const v = parseValor(f.valor_total.value), d = parseValor(f.desconto.value); $('[data-final]', box).textContent = Number.isFinite(v - d) ? brl(v - d) : '—'; };
    f.valor_total.addEventListener('input', calc); f.desconto.addEventListener('input', calc);
    f.periodicidade.addEventListener('change', () => { if (f.periodicidade.value === 'unica') f.num_parcelas.value = 1; });
    $('[data-salvar]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const valor_total = parseValor(f.valor_total.value), desconto = parseValor(f.desconto.value);
      if (!Number.isFinite(valor_total) || valor_total < 0) return toast('Valor total inválido.', 'erro');
      if (!Number.isFinite(desconto) || desconto < 0 || desconto > valor_total) return toast('O desconto deve ficar entre zero e o valor total.', 'erro');
      const num = f.periodicidade.value === 'unica' ? 1 : parseInt(f.num_parcelas.value, 10);
      if (!(num >= 1 && num <= 120)) return toast('Número de parcelas deve ficar entre 1 e 120.', 'erro');
      const novo = { info_comercial: f.info_comercial.value.trim() || null, valor_total, desconto, forma_pagamento: f.forma_pagamento.value || null,
        periodicidade: f.periodicidade.value, num_parcelas: num, primeira_parcela: f.primeira_parcela.value || null };
      const mudouCondicoes = ['valor_total', 'desconto', 'periodicidade', 'num_parcelas', 'primeira_parcela', 'forma_pagamento']
        .some((k) => String(novo[k] ?? '') !== String(k === 'valor_total' || k === 'desconto' ? Number(p[k]) : (p[k] ?? '')));
      const ok = await salvar(novo, 'Condições comerciais salvas.');
      if (ok && mudouCondicoes && valor_total - desconto > 0 && p.parcelas_pagas === 0) {
        const texto = p.parcelas_qtd ? 'As condições mudaram. Deseja substituir as parcelas pendentes pelas novas condições?' : 'Deseja gerar as parcelas com essas condições?';
        if (await confirmar({ titulo: 'Atualizar parcelas', mensagem: texto, confirmar: 'Gerar parcelas' })) {
          try { await q(sb.rpc('gerar_parcelas', { p_projeto_id: id })); toast('Parcelas atualizadas.'); marcarAlteracao(); await recarregar(); } catch (e) { toastErro(e); }
        }
      } else if (ok && mudouCondicoes && p.parcelas_pagas > 0) {
        toast('Há parcelas pagas: ajuste as pendentes na aba Financeiro.', 'erro');
      }
    }); });
  }

  function abaServico(box) {
    const ativos = servicos.filter((s) => s.ativo || s.id === p.servico_id);
    const atual = servicos.find((s) => s.id === p.servico_id);
    mount(box, html`<form class="grade-2" novalidate>
      <label class="campo"><span>Tipo de serviço contratado</span><select name="servico_id">${opcoesLista(ativos, p.servico_id, 'Não definido')}</select>
        <small>Novos tipos podem ser cadastrados em Configurações › Serviços.</small></label>
      <div class="campo"><span>SLA padrão do serviço</span><b data-sla style="padding:8px 0">${atual?.sla_padrao_dias ? plural(atual.sla_padrao_dias, 'dia', 'dias') : '—'}</b></div>
      <p class="col-toda" data-desc style="color:var(--texto-2)">${atual?.descricao || ''}</p>
      <div class="col-toda form-acoes">
        <button class="btn btn-secundario" data-aplicar-sla>Salvar e aplicar SLA padrão</button>
        <button class="btn btn-primario" data-salvar>Salvar serviço</button></div>
    </form>`);
    const f = $('form', box);
    f.servico_id.addEventListener('change', () => {
      const s = servicos.find((x) => x.id === f.servico_id.value);
      $('[data-sla]', box).textContent = s?.sla_padrao_dias ? plural(s.sla_padrao_dias, 'dia', 'dias') : '—';
      $('[data-desc]', box).textContent = s?.descricao || '';
    });
    $('[data-salvar]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, () => salvar({ servico_id: f.servico_id.value || null }, 'Serviço salvo.')); });
    $('[data-aplicar-sla]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const s = servicos.find((x) => x.id === f.servico_id.value);
      if (!s?.sla_padrao_dias) return toast('Esse serviço não tem SLA padrão.', 'erro');
      await salvar({ servico_id: s.id, sla_dias: s.sla_padrao_dias, data_inicio: p.data_inicio || hojeISO() }, 'Serviço e SLA aplicados.');
    }); });
  }

  function abaResumo(box) {
    mount(box, html`<form novalidate>
      <label class="campo"><span>Resumo do projeto</span>
        <textarea name="resumo" rows="14" maxlength="8000" style="min-height:280px" placeholder="Descreva livremente o que está sendo desenvolvido: escopo, entregas, integrações, combinados.">${p.resumo || ''}</textarea>
        <small>Esse texto também entra no contrato gerado, na cláusula de escopo.</small></label>
      <div class="form-acoes"><button class="btn btn-primario" data-salvar>Salvar resumo</button></div>
    </form>`);
    $('[data-salvar]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, () => salvar({ resumo: $('textarea', box).value.trim() || null }, 'Resumo salvo.')); });
  }

  function abaSla(box) {
    const pct = p.sla_dias && p.dias_decorridos != null ? Math.min(100, Math.max(0, (p.dias_decorridos / p.sla_dias) * 100)) : 0;
    const tom = { atrasado: 'erro', proximo: 'alerta', no_prazo: 'ok', entregue_no_prazo: 'ok', entregue_com_atraso: 'alerta' }[p.sla_status] || '';
    const restante = p.sla_status === 'atrasado' ? `Atrasado há ${plural(-p.dias_restantes, 'dia', 'dias')}` : p.dias_restantes != null ? plural(p.dias_restantes, 'dia', 'dias') : p.data_entrega_real ? 'Entregue' : '—';
    mount(box, html`
      <div class="sla-medidor">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">${slaBadge(p)}<span style="color:var(--texto-3);font-size:13px">Tempo na etapa atual: ${plural(p.dias_na_etapa, 'dia', 'dias')}</span></div>
        ${p.sla_dias ? html`<div class="barra ${tom}" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do prazo"><i style="width:${pct}%"></i></div>` : ''}
        <div class="numeros-sla">
          <div><span>SLA</span><b>${p.sla_dias ?? '—'}</b> <small>dias</small></div>
          <div><span>Decorridos</span><b>${p.dias_decorridos ?? '—'}</b> <small>dias</small></div>
          <div><span>Restantes</span><b style="${p.sla_status === 'atrasado' ? 'color:var(--erro);font-size:15px' : ''}">${restante}</b></div>
          <div><span>Em execução</span><b>${p.dias_em_execucao ?? '—'}</b> <small>dias</small></div>
        </div>
      </div>
      <form class="grade" style="margin-top:20px" novalidate>
        <label class="campo"><span>Data de início</span><input type="date" name="data_inicio" value="${p.data_inicio || ''}"></label>
        <label class="campo"><span>Prazo (dias)</span><input type="number" min="1" name="sla_dias" value="${p.sla_dias ?? ''}"></label>
        <div class="campo"><span>Data limite calculada</span><b data-limite style="padding:9px 0">${data(p.data_limite)}</b></div>
        <label class="campo"><span>Data real de entrega</span><input type="date" name="data_entrega_real" value="${p.data_entrega_real || ''}"><small>Preenchida ao mover para Entrega; pode ajustar.</small></label>
        <div class="col-toda form-acoes"><button class="btn btn-primario" data-salvar>Salvar SLA</button></div>
      </form>`);
    const f = $('form', box);
    const calc = () => { const d = f.data_inicio.value, s = parseInt(f.sla_dias.value, 10); $('[data-limite]', box).textContent = d && s > 0 ? data(addDiasISO(d, s)) : '—'; };
    f.data_inicio.addEventListener('input', calc); f.sla_dias.addEventListener('input', calc);
    $('[data-salvar]', box).addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const sla = f.sla_dias.value ? parseInt(f.sla_dias.value, 10) : null;
      if (sla !== null && !(sla > 0)) return toast('Prazo deve ser maior que zero.', 'erro');
      if (sla && !f.data_inicio.value) return toast('Informe a data de início para calcular o prazo.', 'erro');
      await salvar({ data_inicio: f.data_inicio.value || null, sla_dias: sla, data_entrega_real: f.data_entrega_real.value || null }, 'SLA salvo.');
    }); });
  }

  function abaHistorico(box) {
    if (!historico.length) return mount(box, vazio({ titulo: 'Sem movimentações', texto: 'As mudanças de etapa aparecem aqui.' }));
    const agora = Date.now();
    const itens = historico.map((hh, i) => {
      const fim = historico[i + 1] ? new Date(historico[i + 1].movido_em).getTime() : agora;
      return { ...hh, seg: Math.max(0, (fim - new Date(hh.movido_em).getTime()) / 1000), atual: !historico[i + 1] };
    });
    const porEtapa = {};
    itens.forEach((it) => { porEtapa[it.etapa_para_nome] = (porEtapa[it.etapa_para_nome] || 0) + it.seg; });
    const total = (agora - new Date(historico[0].movido_em).getTime()) / 1000;
    mount(box, html`<div class="metade" style="margin-top:0">
      <section><h3 class="rotulo" style="margin-bottom:12px">Movimentações</h3>
        <ul class="linha-tempo">${[...itens].reverse().map((it) => html`<li style="--cor:${etapas.find((e) => e.id === it.etapa_para_id)?.cor || '#F59E0B'}">
          <b>${it.etapa_para_nome}${it.atual ? ' (atual)' : ''}</b>
          <span>${dataHora(it.movido_em)} · ${nomeUsuario(it.movido_por)}</span><br>
          <span>${it.atual ? 'Nesta etapa há ' : 'Ficou '}${duracao(it.seg)}${it.etapa_de_nome ? ` · veio de ${it.etapa_de_nome}` : ' · entrada no CRM'}</span></li>`)}</ul></section>
      <section><h3 class="rotulo" style="margin-bottom:12px">Tempo por etapa</h3>
        <ul class="lista">${Object.entries(porEtapa).map(([nome, seg]) => html`<li><div class="principal-l"><b>${nome}</b></div><span class="tabular">${duracao(seg)}</span></li>`)}
          <li><div class="principal-l"><b>Tempo total no CRM</b></div><b class="tabular">${duracao(total)}</b></li></ul></section>
    </div>`);
  }

  function abaFinanceiro(box) {
    mount(box, html`<div class="kpis kpis-4" style="margin-bottom:16px">
      <div class="kpi"><span class="kpi-topo">Valor total</span><span class="kpi-valor">${brl(p.valor_total)}</span><span class="kpi-sub">desconto ${brl(p.desconto)}</span></div>
      <div class="kpi"><span class="kpi-topo">Recebido</span><span class="kpi-valor">${brl(p.valor_recebido)}</span><span class="kpi-sub">${p.parcelas_pagas} de ${p.parcelas_qtd} parcelas</span></div>
      <div class="kpi"><span class="kpi-topo">A receber</span><span class="kpi-valor">${brl(p.valor_a_receber)}</span></div>
      <div class="kpi ${Number(p.valor_vencido) > 0 ? 'kpi-alerta' : ''}"><span class="kpi-topo">Vencido</span><span class="kpi-valor">${brl(p.valor_vencido)}</span></div>
    </div><div data-parcelas></div>`);
    renderParcelas($('[data-parcelas]', box), p, { aoMudar: async () => { alterou = true; try { await carregar(); } catch (e) { toastErro(e); } renderTudo(); } });
  }

  function abaContrato(box) {
    mount(box, html`
      <div class="painel-topo"><div><h2 style="font-size:15px">Contratos do projeto</h2><p>O contrato usa os dados do cliente, do projeto, das condições e do resumo.</p></div>
        <button class="btn btn-primario" data-gerar>${raw(icon('contratos', 16))}Gerar contrato</button></div>
      ${contratos.length ? html`<ul class="lista lista-clicavel">${contratos.map((c) => html`<li data-contrato="${c.id}">
          <div class="principal-l"><b>${c.numero}</b><span>Versão ${c.versao_atual} · atualizado em ${dataHora(c.updated_at)}</span></div>
          <span class="badge ${c.status === 'finalizado' ? 'badge-ok' : c.status === 'cancelado' ? 'badge-apagado' : 'badge-laranja'}">${STATUS_CONTRATO[c.status]}</span>${raw(icon('chevronRight', 16))}</li>`)}</ul>`
        : vazio({ titulo: 'Nenhum contrato gerado', texto: 'Clique em Gerar contrato para montar a partir do modelo.' })}`);
    box.onclick = async (ev) => {
      const li = ev.target.closest('[data-contrato]');
      if (li) { m.fechar(); location.hash = `#/contratos/${li.dataset.contrato}`; return; }
      const g = ev.target.closest('[data-gerar]');
      if (g) comBotao(g, async () => {
        const { gerarContrato } = await import('./contratos.js');
        const idContrato = await gerarContrato(id);
        if (idContrato) { m.fechar(); location.hash = `#/contratos/${idContrato}`; }
      });
    };
  }

  renderTudo();
  return { fechar: () => m.fechar(), alterou: () => alterou };
}
