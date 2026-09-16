// CRM Comercial em Kanban: cada card é um projeto; arrastar muda a etapa (histórico gravado no banco).
import { sb, q } from '../core/supabase.js';
import { apoio, ao, emitir } from '../core/store.js';
import { html, raw, mount, $, $$, brl, data, carregando, erroBox, vazio, toast, toastErro, slaBadge, prioridadeBadge, plural,
  opcoes, opcoesLista, PRIORIDADES, STATUS_PROJETO, debounce, iniciais } from '../core/ui.js';
import { icon } from '../core/icons.js';

const PERIODOS = { '': 'Qualquer período', 30: 'Criados nos últimos 30 dias', 90: 'Últimos 90 dias', 365: 'Últimos 12 meses' };
const PRAZOS = { '': 'Qualquer prazo', atrasado: 'Atrasados', proximo: 'Próximos do vencimento', no_prazo: 'Dentro do prazo', sem_sla: 'Sem SLA' };

export async function render(view) {
  const filtros = { texto: '', responsavel: '', servico: '', prioridade: '', prazo: '', periodo: '', valorMin: '', encerrados: false };
  let etapas = [], projetos = [], equipe = [], servicos = [];

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>CRM Comercial</h1><p>Arraste os cards entre as etapas. Cada mudança fica registrada no histórico.</p></div>
      <div class="acoes">
        <button class="btn btn-secundario" data-novo-cliente>${raw(icon('plus', 16))}Novo cliente</button>
        <button class="btn btn-primario" data-novo-projeto>${raw(icon('plus', 16))}Novo projeto</button>
      </div>
    </div>
    <div class="filtros" role="search">
      <input class="entrada" type="search" data-f="texto" placeholder="Filtrar por cliente, empresa ou projeto" aria-label="Filtrar cards">
      <select class="entrada" data-f="responsavel" aria-label="Responsável"></select>
      <select class="entrada" data-f="servico" aria-label="Serviço"></select>
      <select class="entrada" data-f="prioridade" aria-label="Prioridade">${opcoes(PRIORIDADES, '', 'Todas as prioridades')}</select>
      <select class="entrada" data-f="prazo" aria-label="Prazo">${opcoes(PRAZOS, '')}</select>
      <select class="entrada" data-f="periodo" aria-label="Período">${opcoes(PERIODOS, '')}</select>
      <input class="entrada" data-f="valorMin" inputmode="decimal" placeholder="Valor mínimo (R$)" aria-label="Valor mínimo" style="min-width:150px;width:150px">
      <label class="check"><input type="checkbox" data-f="encerrados">Mostrar concluídos e cancelados</label>
    </div>
    <div class="kanban" aria-label="Quadro de projetos">${carregando()}</div>`);

  const quadro = $('.kanban', view);
  $('[data-novo-projeto]', view).addEventListener('click', async () => (await import('./projeto.js')).novoProjeto());
  $('[data-novo-cliente]', view).addEventListener('click', async () => (await import('./clientes.js')).formCliente({}));

  const aplicar = debounce(renderQuadro, 150);
  $$('[data-f]', view).forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    filtros[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.f === 'encerrados') carregar(); else aplicar();
  }));

  async function carregar() {
    try {
      let consulta = sb.from('vw_projetos').select('*').order('etapa_desde', { ascending: false });
      if (!filtros.encerrados) consulta = consulta.in('status', ['ativo', 'pausado']);
      [etapas, projetos, equipe, servicos] = await Promise.all([apoio('etapas'), q(consulta.limit(1000)), apoio('equipe'), apoio('servicos')]);
      const selResp = $('[data-f=responsavel]', view), selServ = $('[data-f=servico]', view);
      if (!selResp.options.length) {
        mount(selResp, opcoesLista(equipe, filtros.responsavel, 'Todos os responsáveis', { texto: (u) => u.nome || u.email }));
        mount(selServ, opcoesLista(servicos, filtros.servico, 'Todos os serviços'));
      }
      renderQuadro();
    } catch (e) { mount(quadro, erroBox(e)); }
  }

  function filtrados() {
    const t = filtros.texto.trim().toLowerCase();
    const min = filtros.valorMin ? Number(String(filtros.valorMin).replace(/\./g, '').replace(',', '.')) : null;
    const limite = filtros.periodo ? Date.now() - Number(filtros.periodo) * 86400000 : null;
    return projetos.filter((p) =>
      (!t || [p.titulo, p.cliente_nome, p.cliente_empresa, `#${p.codigo}`].some((x) => String(x || '').toLowerCase().includes(t))) &&
      (!filtros.responsavel || p.responsavel_id === filtros.responsavel) &&
      (!filtros.servico || p.servico_id === filtros.servico) &&
      (!filtros.prioridade || p.prioridade === filtros.prioridade) &&
      (!filtros.prazo || p.sla_status === filtros.prazo) &&
      (!limite || new Date(p.created_at).getTime() >= limite) &&
      (min === null || !Number.isFinite(min) || Number(p.valor_final) >= min));
  }

  function card(p) {
    const status = p.status !== 'ativo' ? html`<span class="badge ${p.status === 'pausado' ? 'badge-alerta' : 'badge-neutro'} card-status">${STATUS_PROJETO[p.status]}</span>` : '';
    return html`<article class="card" draggable="true" data-id="${p.id}" tabindex="0" aria-label="Projeto ${p.codigo}: ${p.cliente_nome}, ${p.etapa_nome}">
      ${status}
      <div class="card-topo">
        <div class="tit"><b>${p.cliente_empresa || p.cliente_nome}</b><span class="empresa">${p.cliente_empresa ? p.cliente_nome + ' · ' : ''}#${p.codigo}</span></div>
        <button class="btn-icone card-mover" data-mover aria-label="Mover para outra etapa" title="Mover para outra etapa">${raw(icon('move', 16))}</button>
      </div>
      <div class="card-servico">${p.servico_nome || p.titulo}</div>
      <div class="card-valor">${brl(p.valor_final)}</div>
      ${p.cliente_telefone || p.cliente_whatsapp || p.cliente_email ? html`<div class="card-contato">
        ${p.cliente_whatsapp || p.cliente_telefone ? html`<span>${raw(icon('phone', 12))}${p.cliente_whatsapp || p.cliente_telefone}</span>` : ''}
        ${p.cliente_email ? html`<span>${raw(icon('mail', 12))}${p.cliente_email}</span>` : ''}</div>` : ''}
      <div>${slaBadge(p)}</div>
      <div class="card-linha">${raw(icon('calendar', 13))}${p.data_limite ? `Entrega ${data(p.data_limite)}` : 'Sem prazo definido'}${p.sla_dias ? ` · SLA ${p.sla_dias} d` : ''}</div>
      <div class="card-linha">${raw(icon('history', 13))}Na etapa desde ${data(p.etapa_desde)} · ${plural(p.dias_na_etapa, 'dia', 'dias')}${p.parado ? html` <span class="badge badge-alerta">parado</span>` : ''}</div>
      <div class="card-rodape">
        ${prioridadeBadge(p.prioridade)}
        ${p.responsavel_nome ? html`<span class="avatar" title="Responsável: ${p.responsavel_nome}">${iniciais(p.responsavel_nome)}</span>` : html`<span class="card-linha">Sem responsável</span>`}
      </div>
    </article>`;
  }

  function renderQuadro() {
    const lista = filtrados();
    const visiveis = etapas.filter((e) => e.ativo || lista.some((p) => p.etapa_id === e.id));
    if (!projetos.length) {
      mount(quadro, html`<div style="grid-column:1/-1">${vazio({ titulo: 'Nenhum projeto cadastrado', texto: 'Crie o primeiro projeto: ele entra automaticamente em Diagnóstico.', acao: 'Novo projeto', acaoId: 'novo' })}</div>`);
      $('[data-acao=novo]', quadro)?.addEventListener('click', async () => (await import('./projeto.js')).novoProjeto());
      return;
    }
    mount(quadro, visiveis.map((e) => {
      const cards = lista.filter((p) => p.etapa_id === e.id);
      const total = cards.reduce((a, p) => a + Number(p.valor_final), 0);
      return html`<section class="coluna" data-etapa="${e.id}" aria-label="Etapa ${e.nome}">
        <header class="coluna-topo">
          <div class="coluna-titulo"><span class="bloco" style="background:${e.cor}"></span>${e.nome}<span class="qtd">${cards.length}</span></div>
          <div class="coluna-total">${brl(total)}</div>
        </header>
        <div class="coluna-cards">${cards.length ? cards.map(card) : html`<div class="coluna-vazia">Solte um card aqui</div>`}</div>
      </section>`;
    }));
  }

  // ---------- Arrastar e soltar ----------
  let arrastandoId = null;
  quadro.addEventListener('dragstart', (ev) => {
    const c = ev.target.closest('.card'); if (!c) return;
    arrastandoId = c.dataset.id; c.classList.add('arrastando');
    ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', arrastandoId);
  });
  quadro.addEventListener('dragend', (ev) => { ev.target.closest('.card')?.classList.remove('arrastando'); $$('.coluna.alvo', quadro).forEach((x) => x.classList.remove('alvo')); arrastandoId = null; });
  quadro.addEventListener('dragover', (ev) => {
    const col = ev.target.closest('.coluna'); if (!col || !arrastandoId) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
    $$('.coluna.alvo', quadro).forEach((x) => x !== col && x.classList.remove('alvo'));
    col.classList.add('alvo');
  });
  quadro.addEventListener('dragleave', (ev) => { const col = ev.target.closest('.coluna'); if (col && !col.contains(ev.relatedTarget)) col.classList.remove('alvo'); });
  quadro.addEventListener('drop', (ev) => {
    const col = ev.target.closest('.coluna'); if (!col) return;
    ev.preventDefault(); col.classList.remove('alvo');
    const id = ev.dataTransfer.getData('text/plain') || arrastandoId;
    if (id) mover(id, col.dataset.etapa);
  });

  async function mover(id, etapaId) {
    const p = projetos.find((x) => x.id === id);
    if (!p || p.etapa_id === etapaId) return;
    const anterior = p.etapa_id, destino = etapas.find((e) => e.id === etapaId);
    p.etapa_id = etapaId; p.etapa_desde = new Date().toISOString(); p.dias_na_etapa = 0; p.parado = false;
    renderQuadro();
    $(`.card[data-id="${id}"]`, quadro)?.classList.add('salvando');
    try {
      await q(sb.from('projetos').update({ etapa_id: etapaId }).eq('id', id));
      const atualizado = await q(sb.from('vw_projetos').select('*').eq('id', id).single());
      Object.assign(p, atualizado);
      toast(`#${p.codigo} movido para ${destino.nome}.`);
      emitir('dados-alterados', { origem: 'crm' });
    } catch (e) {
      p.etapa_id = anterior; toastErro(e);
    }
    renderQuadro();
  }

  // ---------- Clique / teclado / mover sem arrastar (mobile e acessibilidade) ----------
  quadro.addEventListener('click', async (ev) => {
    const btnMover = ev.target.closest('[data-mover]');
    const c = ev.target.closest('.card'); if (!c) return;
    if (btnMover) { ev.stopPropagation(); return menuMover(btnMover, c.dataset.id); }
    (await import('./projeto.js')).abrirProjeto(c.dataset.id);
  });
  quadro.addEventListener('keydown', async (ev) => {
    const c = ev.target.closest('.card'); if (!c || ev.target !== c) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); (await import('./projeto.js')).abrirProjeto(c.dataset.id); }
    if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); menuMover($('[data-mover]', c), c.dataset.id); }
  });

  function menuMover(botao, id) {
    document.querySelector('.menu-mover')?.remove();
    const p = projetos.find((x) => x.id === id);
    const menu = document.createElement('div');
    menu.className = 'popover menu-mover';
    menu.setAttribute('role', 'menu');
    mount(menu, html`<div class="notif-topo" style="padding:8px 10px"><b>Mover #${p.codigo} para</b></div>
      ${etapas.filter((e) => e.ativo).map((e) => html`<button class="menu-item" role="menuitem" data-destino="${e.id}" ${e.id === p.etapa_id ? raw('disabled aria-current="true"') : ''}>
        <span class="cor-amostra" style="background:${e.cor}"></span>${e.nome}${e.id === p.etapa_id ? ' (atual)' : ''}</button>`)}`);
    document.body.appendChild(menu);
    const r = botao.getBoundingClientRect();
    menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    $('[data-destino]:not([disabled])', menu)?.focus();
    const fechar = () => { menu.remove(); document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', esc); };
    const fora = (ev) => { if (!menu.contains(ev.target)) fechar(); };
    const esc = (ev) => { if (ev.key === 'Escape') { fechar(); botao.focus(); } };
    document.addEventListener('mousedown', fora, true); document.addEventListener('keydown', esc);
    menu.addEventListener('click', (ev) => { const b = ev.target.closest('[data-destino]'); if (b) { fechar(); mover(id, b.dataset.destino); } });
  }

  await carregar();
  const off = ao('dados-alterados', (d) => { if (d?.origem !== 'crm') carregar(); });
  return { destruir: () => { off(); document.querySelector('.menu-mover')?.remove(); } };
}
