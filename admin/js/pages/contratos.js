// Contratos: geração a partir do modelo, edição, sugestões por IA, versões e PDF.
import { sb, q, qc, api } from '../core/supabase.js';
import { apoio, emitir, ao } from '../core/store.js';
import { html, raw, mount, $, $$, esc, brl, data, dataHora, carregando, erroBox, vazio, confirmar, toast, toastErro, comBotao,
  STATUS_CONTRATO, FORMAS_PAGAMENTO, MESES, termoBusca, debounce, num } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { CDN } from '../config.js';

const POR_PAGINA = 20;
const TAGS = ['h1', 'h2', 'h3', 'p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'div', 'span', 'section', 'mark', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'blockquote'];
let purify;
async function sanitizar(htmlBruto) {
  if (!purify) purify = (await import(CDN.dompurify)).default;
  return purify.sanitize(String(htmlBruto || ''), { ALLOWED_TAGS: TAGS, ALLOWED_ATTR: ['class'], KEEP_CONTENT: true });
}
const badgeStatus = (s) => html`<span class="badge ${s === 'finalizado' ? 'badge-ok' : s === 'cancelado' ? 'badge-apagado' : s === 'em_revisao' ? 'badge-alerta' : 'badge-laranja'}">${STATUS_CONTRATO[s]}</span>`;
const revisar = (txt) => `<mark class="revisar">[A DEFINIR: ${esc(txt)}]</mark>`;

// ================= GERAÇÃO =================
async function montarDocumento(projetoId, numero) {
  const [p, config, modelos, parcelas] = await Promise.all([
    q(sb.from('vw_projetos').select('*').eq('id', projetoId).single()),
    apoio('config', true),
    q(sb.from('contrato_modelos').select('*').eq('ativo', true).order('padrao', { ascending: false }).limit(1)),
    q(sb.from('parcelas').select('numero,valor,vencimento,status').eq('projeto_id', projetoId).neq('status', 'cancelado').order('numero'))
  ]);
  if (!modelos.length) throw new Error('Nenhum modelo de contrato ativo. Cadastre um em Configurações › Modelos de contrato.');
  const cliente = await q(sb.from('clientes').select('endereco').eq('id', p.cliente_id).single());
  const emp = config.empresa || {};
  const hoje = new Date();
  const v = (valor, rotulo) => (valor === null || valor === undefined || valor === '' ? revisar(rotulo) : esc(valor));
  let parcelasTxt;
  if (parcelas.length === 1) parcelasTxt = `pagamento único de ${esc(brl(parcelas[0].valor))}, com vencimento em ${esc(data(parcelas[0].vencimento))}.`;
  else if (parcelas.length > 1) parcelasTxt = `${parcelas.length} parcelas: ${parcelas.map((x) => `${x.numero}ª de ${brl(x.valor)} com vencimento em ${data(x.vencimento)}`).map(esc).join('; ')}.`;
  else parcelasTxt = revisar('parcelas e vencimentos');
  const resumo = p.resumo ? p.resumo.split(/\n{2,}/).map((par) => `<p>${esc(par).replace(/\n/g, '<br>')}</p>`).join('') : `<p>${revisar('escopo do projeto (preencha o Resumo do projeto)')}</p>`;
  const dados = {
    contrato_numero: esc(numero || ''),
    data_extenso: esc(`${hoje.getDate()} de ${MESES[hoje.getMonth()].toLowerCase()} de ${hoje.getFullYear()}`),
    empresa_nome_fantasia: v(emp.nome_fantasia, 'nome fantasia'), empresa_razao_social: v(emp.razao_social, 'razão social'),
    empresa_cnpj: v(emp.cnpj, 'CNPJ da empresa'), empresa_endereco: v(emp.endereco, 'endereço da empresa'),
    empresa_email: v(emp.email, 'e-mail da empresa'), empresa_cidade: v(emp.cidade, 'cidade'), empresa_uf: v(emp.uf, 'UF'),
    cliente_nome: v(p.cliente_nome, 'nome do cliente'),
    cliente_empresa_trecho: p.cliente_empresa ? `, representando a empresa ${esc(p.cliente_empresa)}` : '',
    cliente_documento: v(p.cliente_documento, 'CPF/CNPJ do cliente'), cliente_endereco: v(cliente.endereco, 'endereço do cliente'),
    cliente_email: v(p.cliente_email, 'e-mail do cliente'), cliente_telefone: v(p.cliente_whatsapp || p.cliente_telefone, 'telefone do cliente'),
    servico: v(p.servico_nome, 'serviço'), projeto_titulo: esc(p.titulo), resumo,
    data_inicio: p.data_inicio ? esc(data(p.data_inicio)) : revisar('data de início'),
    sla_dias: v(p.sla_dias, 'prazo em dias'), data_limite: p.data_limite ? esc(data(p.data_limite)) : revisar('data de entrega'),
    valor_total: esc(brl(p.valor_total)),
    desconto_trecho: Number(p.desconto) > 0 ? `, com desconto de ${esc(brl(p.desconto))}` : '',
    valor_final: Number(p.valor_final) > 0 ? esc(brl(p.valor_final)) : revisar('valor do projeto'),
    forma_pagamento: p.forma_pagamento ? esc(FORMAS_PAGAMENTO[p.forma_pagamento]) : revisar('forma de pagamento'),
    parcelas_descricao: parcelasTxt
  };
  const conteudo = modelos[0].conteudo_html.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => (k in dados ? dados[k] : revisar(k)));
  return { conteudo: await sanitizar(conteudo), projeto: p, modeloId: modelos[0].id };
}

export async function gerarContrato(projetoId) {
  try {
    const existentes = await q(sb.from('contratos').select('id,numero,status').eq('projeto_id', projetoId).is('deleted_at', null).in('status', ['rascunho', 'em_revisao']));
    if (existentes.length) {
      toast(`O contrato ${existentes[0].numero} ainda está em edição. Abrindo ele.`);
      return existentes[0].id;
    }
    const p = await q(sb.from('vw_projetos').select('id,cliente_id,titulo,valor_final').eq('id', projetoId).single());
    const contrato = await q(sb.from('contratos').insert({ projeto_id: p.id, cliente_id: p.cliente_id, titulo: `Contrato — ${p.titulo}`, valor: p.valor_final }).select('id,numero').single());
    const { conteudo, modeloId } = await montarDocumento(projetoId, contrato.numero);
    await q(sb.from('contratos').update({ modelo_id: modeloId }).eq('id', contrato.id));
    await q(sb.from('contrato_versoes').insert({ contrato_id: contrato.id, versao: 0, conteudo_html: conteudo, origem: 'modelo' }));
    toast(`Contrato ${contrato.numero} gerado.`);
    emitir('dados-alterados');
    return contrato.id;
  } catch (e) { toastErro(e); return null; }
}

// ================= ROTA =================
export async function render(view, params) {
  if (params[0]) return editor(view, params[0]);
  return lista(view);
}

async function lista(view) {
  const f = { status: 'todos', texto: '', pagina: 0 };
  mount(view, html`
    <div class="pagina-topo"><div><h1>Contratos</h1><p>Gere contratos a partir de um projeto, pela aba Contrato.</p></div>
      <div class="acoes"><a class="btn btn-secundario" href="#/projetos">Escolher projeto</a></div></div>
    <section class="painel">
      <div class="filtros">
        <div class="segmentado" role="group" aria-label="Status">${[['todos', 'Todos'], ['rascunho', 'Rascunho'], ['em_revisao', 'Em revisão'], ['finalizado', 'Finalizados'], ['cancelado', 'Cancelados']].map(([k, t]) => html`<button data-status="${k}" aria-pressed="${k === f.status}">${t}</button>`)}</div>
        <input class="entrada" type="search" placeholder="Número ou título" aria-label="Buscar contratos">
      </div>
      <div data-tabela>${carregando()}</div>
    </section>`);
  const box = $('[data-tabela]', view);
  async function carregar() {
    try {
      let c = sb.from('contratos').select('id,numero,titulo,status,versao_atual,valor,created_at,updated_at,clientes(nome,empresa),projetos(codigo,titulo)', { count: 'exact' }).is('deleted_at', null);
      if (f.status !== 'todos') c = c.eq('status', f.status);
      const t = termoBusca(f.texto); if (t) c = c.or(`numero.ilike.*${t}*,titulo.ilike.*${t}*`);
      const { data: itens, count } = await qc(c.order('created_at', { ascending: false }).range(f.pagina * POR_PAGINA, (f.pagina + 1) * POR_PAGINA - 1));
      if (!itens.length) return mount(box, vazio(t || f.status !== 'todos' ? { titulo: 'Nenhum contrato com esses filtros' } : { titulo: 'Nenhum contrato gerado', texto: 'Abra um projeto e use o botão Gerar contrato.' }));
      const paginas = Math.ceil(count / POR_PAGINA);
      mount(box, html`<div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Número</th><th>Cliente</th><th>Projeto</th><th class="num">Valor</th><th>Versão</th><th>Status</th><th>Data</th></tr></thead>
        <tbody>${itens.map((k) => html`<tr class="clicavel" data-id="${k.id}" tabindex="0">
          <td><b>${k.numero}</b></td><td data-r="Cliente">${k.clientes?.nome || '—'}<span class="sub">${k.clientes?.empresa || ''}</span></td>
          <td data-r="Projeto">${k.projetos ? `#${k.projetos.codigo} ${k.projetos.titulo}` : '—'}</td>
          <td class="num" data-r="Valor">${brl(k.valor)}</td><td data-r="Versão">v${k.versao_atual}</td><td>${badgeStatus(k.status)}</td><td data-r="Data">${data(k.created_at)}</td></tr>`)}</tbody></table></div>
        <div class="paginacao"><span>${num(count)} contrato(s)</span><div class="acoes">
          <button class="btn btn-secundario btn-p" data-pag="-1" ${f.pagina === 0 ? raw('disabled') : ''}>Anterior</button>
          <button class="btn btn-secundario btn-p" data-pag="1" ${f.pagina + 1 >= paginas ? raw('disabled') : ''}>Próxima</button></div></div>`);
    } catch (e) { mount(box, erroBox(e)); }
  }
  view.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-status]'); if (s) { f.status = s.dataset.status; f.pagina = 0; $$('[data-status]', view).forEach((x) => x.setAttribute('aria-pressed', x === s)); return carregar(); }
    const pg = ev.target.closest('[data-pag]'); if (pg) { f.pagina += Number(pg.dataset.pag); return carregar(); }
    const tr = ev.target.closest('tr[data-id]'); if (tr) location.hash = `#/contratos/${tr.dataset.id}`;
  });
  view.addEventListener('keydown', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr && ev.key === 'Enter') location.hash = `#/contratos/${tr.dataset.id}`; });
  $('input[type=search]', view).addEventListener('input', debounce((ev) => { f.texto = ev.target.value; f.pagina = 0; carregar(); }, 300));
  await carregar();
  const off = ao('dados-alterados', carregar);
  return { destruir: off };
}

// ================= EDITOR =================
async function editor(view, id) {
  let contrato, versoes, projeto, sujo = false, origemPendente = 'manual', sugestoesPendentes = null;
  mount(view, carregando('Abrindo contrato…'));

  async function carregar() {
    contrato = await q(sb.from('contratos').select('*, clientes(nome,empresa)').eq('id', id).is('deleted_at', null).maybeSingle());
    if (!contrato) return false;
    [versoes, projeto] = await Promise.all([
      q(sb.from('contrato_versoes').select('id,versao,origem,sugestoes,created_at,created_by').eq('contrato_id', id).order('versao', { ascending: false })),
      q(sb.from('vw_projetos').select('id,codigo,titulo').eq('id', contrato.projeto_id).maybeSingle())
    ]);
    return true;
  }
  try { if (!(await carregar())) return mount(view, vazio({ titulo: 'Contrato não encontrado' })); }
  catch (e) { return mount(view, erroBox(e)); }

  const equipe = await apoio('equipe').catch(() => []);
  const nome = (uid) => equipe.find((u) => u.id === uid)?.nome || '—';
  const editavel = () => ['rascunho', 'em_revisao'].includes(contrato.status);

  async function conteudoVersao(versao) {
    const v = await q(sb.from('contrato_versoes').select('conteudo_html').eq('contrato_id', id).eq('versao', versao).maybeSingle());
    return sanitizar(v?.conteudo_html || '');
  }

  function renderizar(conteudo) {
    document.title = `${contrato.numero} · Admin`;
    const origemTxt = { modelo: 'Gerada pelo modelo', ia: 'Ajustada com IA', manual: 'Edição manual' };
    mount(view, html`
      <div class="pagina-topo">
        <div><a href="#/contratos" class="btn btn-fantasma btn-p" style="margin-left:-12px">${raw(icon('chevronLeft', 14))}Contratos</a>
          <h1>${contrato.numero}</h1>
          <p>${contrato.clientes?.nome || ''}${projeto ? ` · projeto #${projeto.codigo} ${projeto.titulo}` : ''} · ${brl(contrato.valor)} · versão ${contrato.versao_atual} · ${data(contrato.created_at)}</p></div>
        <div class="acoes">${badgeStatus(contrato.status)}
          <button class="btn btn-secundario" data-pdf>${raw(icon('printer', 16))}Gerar PDF</button>
          ${editavel() ? html`<button class="btn btn-primario" data-salvar disabled>${raw(icon('check', 16))}Salvar nova versão</button>` : ''}
        </div>
      </div>
      ${!editavel() ? html`<div class="aviso aviso-neutro" style="margin-bottom:14px">${raw(icon('lock', 16))}Contrato ${STATUS_CONTRATO[contrato.status].toLowerCase()}: o documento não pode mais ser alterado.${contrato.finalizado_em ? ` Finalizado em ${dataHora(contrato.finalizado_em)}.` : ''}</div>` : ''}
      <div class="contrato-layout">
        <div class="contrato-papel"><article class="contrato-doc" ${editavel() ? raw('contenteditable="true" spellcheck="true"') : ''} aria-label="Documento do contrato">${raw(conteudo)}</article></div>
        <aside class="lateral">
          ${editavel() ? html`<section class="painel">
            <div class="painel-topo" style="margin-bottom:8px"><h2>Sugestões / alterações no contrato</h2></div>
            <label class="campo"><span class="sr-only">Sugestões</span><textarea data-sugestoes rows="5" maxlength="2000" placeholder="Ex.: Adicionar cláusula de suporte por 30 dias após a entrega."></textarea></label>
            <div class="acoes" style="margin-top:10px"><button class="btn btn-escuro" data-ia>${raw(icon('sparkles', 16))}Aplicar sugestões</button></div>
            <p style="font-size:12px;color:var(--texto-3);margin-top:10px">A IA ajusta o texto e marca em amarelo o que mudou. Ela não cria multas, percentuais ou obrigações legais que você não pediu, e o resultado sempre precisa da sua revisão.</p>
            <div data-obs-ia></div>
          </section>` : ''}
          <section class="painel">
            <div class="painel-topo" style="margin-bottom:8px"><h2>Andamento</h2></div>
            <div class="acoes" style="flex-direction:column;align-items:stretch">
              ${contrato.status === 'rascunho' ? html`<button class="btn btn-secundario" data-status="em_revisao">Enviar para revisão</button>` : ''}
              ${editavel() ? html`<button class="btn btn-primario" data-status="finalizado">${raw(icon('lock', 16))}Finalizar contrato</button>
                <button class="btn btn-secundario" data-regerar>${raw(icon('refresh', 16))}Gerar de novo pelo modelo</button>` : ''}
              ${contrato.status !== 'cancelado' ? html`<button class="btn btn-fantasma btn-texto-perigo" data-status="cancelado">Cancelar contrato</button>` : ''}
              ${contrato.status === 'cancelado' && projeto ? html`<button class="btn btn-secundario" data-novo>Gerar novo contrato para o projeto</button>` : ''}
            </div>
            <p style="font-size:12px;color:var(--texto-3);margin-top:12px">Modelo base: revise com um advogado antes de assinar.</p>
          </section>
          <section class="painel">
            <div class="painel-topo" style="margin-bottom:4px"><h2>Versões</h2></div>
            <ul class="versoes">${versoes.map((v) => html`<li class="${v.versao === contrato.versao_atual ? 'atual' : ''}">
              <div><b>v${v.versao}</b> · ${origemTxt[v.origem]}<br><span style="color:var(--texto-3)">${dataHora(v.created_at)} · ${nome(v.created_by)}</span>
                ${v.sugestoes ? html`<br><span style="color:var(--texto-3)" title="${v.sugestoes}">“${v.sugestoes.length > 60 ? v.sugestoes.slice(0, 60) + '…' : v.sugestoes}”</span>` : ''}</div>
              ${v.versao !== contrato.versao_atual ? html`<button class="btn btn-fantasma btn-p" data-ver="${v.versao}">${editavel() ? 'Restaurar' : 'Ver'}</button>` : html`<span class="badge badge-neutro">atual</span>`}</li>`)}</ul>
          </section>
        </aside>
      </div>`);
    ligar();
  }

  const doc = () => $('.contrato-doc', view);
  function marcarSujo(origem = 'manual', sugestoes = null) {
    sujo = true; origemPendente = origem; sugestoesPendentes = sugestoes;
    const b = $('[data-salvar]', view); if (b) b.disabled = false;
  }

  function ligar() {
    const d = doc();
    if (editavel()) {
      d.addEventListener('input', () => { if (!sujo) marcarSujo('manual'); });
      // Colar sempre como texto simples (evita HTML externo no documento)
      d.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const texto = (ev.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, texto);
      });
    }
    $('[data-pdf]', view).addEventListener('click', () => {
      if (sujo) toast('O PDF usa o texto na tela, incluindo alterações ainda não salvas.');
      const t = document.title; document.title = contrato.numero; window.print(); setTimeout(() => { document.title = t; }, 500);
    });
    $('[data-salvar]', view)?.addEventListener('click', (ev) => comBotao(ev.currentTarget, salvarVersao));
    $('[data-ia]', view)?.addEventListener('click', (ev) => comBotao(ev.currentTarget, aplicarIA));
    $('[data-regerar]', view)?.addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      if (!(await confirmar({ titulo: 'Gerar de novo pelo modelo', mensagem: 'O texto na tela será substituído pelo modelo preenchido com os dados atuais do cliente e do projeto. Nada é salvo até você clicar em Salvar nova versão.', confirmar: 'Gerar de novo' }))) return;
      try { const { conteudo } = await montarDocumento(contrato.projeto_id, contrato.numero); doc().innerHTML = conteudo; marcarSujo('modelo'); toast('Documento gerado. Revise e salve a nova versão.'); }
      catch (e) { toastErro(e); }
    }));
    $$('[data-status]', view).forEach((b) => b.addEventListener('click', () => mudarStatus(b.dataset.status)));
    $('[data-novo]', view)?.addEventListener('click', async () => { const novo = await gerarContrato(contrato.projeto_id); if (novo) location.hash = `#/contratos/${novo}`; });
    $$('[data-ver]', view).forEach((b) => b.addEventListener('click', () => comBotao(b, async () => {
      if (sujo && !(await confirmar({ titulo: 'Descartar alterações?', mensagem: 'As alterações não salvas serão perdidas.', confirmar: 'Descartar', perigo: true }))) return;
      const conteudo = await conteudoVersao(Number(b.dataset.ver));
      doc().innerHTML = conteudo;
      if (editavel()) { marcarSujo('manual'); toast(`Versão ${b.dataset.ver} carregada. Salve para restaurá-la como nova versão.`); }
      else { sujo = false; toast(`Exibindo a versão ${b.dataset.ver}.`); }
    })));
  }

  async function salvarVersao() {
    const conteudo = await sanitizar(doc().innerHTML);
    if (!conteudo.replace(/<[^>]+>/g, '').trim()) return toast('O documento está vazio.', 'erro');
    try {
      await q(sb.from('contrato_versoes').insert({ contrato_id: id, versao: 0, conteudo_html: conteudo, origem: origemPendente, sugestoes: sugestoesPendentes }));
      sujo = false; sugestoesPendentes = null; origemPendente = 'manual';
      await carregar(); toast(`Versão ${contrato.versao_atual} salva.`); emitir('dados-alterados');
      renderizar(conteudo);
    } catch (e) { toastErro(e); }
  }

  async function aplicarIA() {
    const campo = $('[data-sugestoes]', view);
    const sugestoes = campo.value.trim();
    if (sugestoes.length < 5) return toast('Descreva a alteração que você quer no contrato.', 'erro');
    const obs = $('[data-obs-ia]', view);
    try {
      const r = await api('/api/contrato-ia', { html: await sanitizar(doc().innerHTML), sugestoes, numero: contrato.numero });
      doc().innerHTML = await sanitizar(r.html);
      marcarSujo('ia', sugestoes);
      mount(obs, html`<div class="aviso observacoes-ia" style="margin-top:12px">${raw(icon('alert', 16))}<div>
        <b>Revise antes de salvar.</b>
        ${r.alteracoes?.length ? html`<ul>${r.alteracoes.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
        ${r.pontos_de_revisao?.length ? html`<p style="margin-top:6px"><b>Pontos para revisão jurídica:</b></p><ul>${r.pontos_de_revisao.map((a) => html`<li>${a}</li>`)}</ul>` : ''}</div></div>`);
      toast('Sugestões aplicadas. Revise o texto marcado e salve a nova versão.');
    } catch (e) {
      if (e.codigo === 'not_configured' || e.status === 404) {
        const inserir = await confirmar({ titulo: 'IA indisponível', mensagem: 'A geração com IA não está configurada neste ambiente. Deseja inserir a sugestão no fim do documento, marcada para você editar manualmente?', confirmar: 'Inserir para editar' });
        if (inserir) {
          const sec = document.createElement('section');
          sec.innerHTML = `<h2>Alterações solicitadas</h2><p><mark class="revisar">${esc(sugestoes)}</mark></p>`;
          const assinaturas = $('.assinaturas', doc());
          const localData = $('.local-data', doc());
          doc().insertBefore(sec, localData || assinaturas || null);
          marcarSujo('manual', sugestoes);
        }
      } else toastErro(e);
    }
  }

  async function mudarStatus(novo) {
    const textos = {
      em_revisao: ['Enviar para revisão', 'O contrato passa para Em revisão e continua editável.', 'Enviar para revisão', false],
      finalizado: ['Finalizar contrato', 'Depois de finalizado, o documento não pode mais ser alterado. A versão salva mais recente será a oficial.', 'Finalizar contrato', false],
      cancelado: ['Cancelar contrato', 'O contrato fica cancelado e não aceita novas versões. O histórico é mantido.', 'Cancelar contrato', true]
    }[novo];
    if (novo === 'finalizado' && sujo) return toast('Salve a nova versão antes de finalizar.', 'erro');
    if (!(await confirmar({ titulo: textos[0], mensagem: textos[1], confirmar: textos[2], perigo: textos[3] }))) return;
    try {
      await q(sb.from('contratos').update({ status: novo }).eq('id', id));
      sujo = false; await carregar(); toast(`Contrato: ${STATUS_CONTRATO[novo].toLowerCase()}.`); emitir('dados-alterados');
      renderizar(await conteudoVersao(contrato.versao_atual));
    } catch (e) { toastErro(e); }
  }

  renderizar(contrato.versao_atual ? await conteudoVersao(contrato.versao_atual) : '');
  if (!contrato.versao_atual && editavel()) {
    try { const { conteudo } = await montarDocumento(contrato.projeto_id, contrato.numero); doc().innerHTML = conteudo; marcarSujo('modelo'); toast('Este contrato ainda não tinha documento. Revise e salve a primeira versão.'); } catch (e) { toastErro(e); }
  }

  return {
    temAlteracoes: () => sujo,
    podeSair: async () => !sujo || confirmar({ titulo: 'Sair sem salvar?', mensagem: 'Há alterações no contrato que ainda não viraram uma nova versão.', confirmar: 'Sair sem salvar', perigo: true })
  };
}
