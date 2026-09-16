// Projetos em tabela: filtros no servidor e paginação.
import { sb, qc } from '../core/supabase.js';
import { apoio, ao } from '../core/store.js';
import { html, raw, mount, $, $$, brl, data, carregando, erroBox, vazio, slaBadge, prioridadeBadge, opcoes, opcoesLista,
  STATUS_PROJETO, PRIORIDADES, termoBusca, debounce, num } from '../core/ui.js';
import { icon } from '../core/icons.js';

const POR_PAGINA = 20;
const PRAZOS = { atrasado: 'Atrasados', proximo: 'Próximos do vencimento', no_prazo: 'Dentro do prazo', entregue_no_prazo: 'Entregues no prazo', entregue_com_atraso: 'Entregues com atraso', sem_sla: 'Sem SLA' };
const ORDENS = { 'etapa_desde.desc': 'Movimentados recentemente', 'data_limite.asc': 'Prazo mais próximo', 'valor_final.desc': 'Maior valor', 'codigo.desc': 'Mais novos' };

export async function render(view, params) {
  const [etapas, equipe, servicos] = await Promise.all([apoio('etapas'), apoio('equipe'), apoio('servicos')]);
  const f = { texto: '', status: 'abertos', etapa: '', responsavel: '', servico: '', prioridade: '', prazo: '', de: '', ate: '', valorMin: '', ordem: 'etapa_desde.desc' };
  let pagina = 0;

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>Projetos</h1><p>Todos os projetos com SLA, etapa e financeiro.</p></div>
      <div class="acoes"><button class="btn btn-primario" data-novo>${raw(icon('plus', 16))}Novo projeto</button></div>
    </div>
    <section class="painel">
      <div class="filtros">
        <input class="entrada" type="search" data-f="texto" placeholder="Projeto ou cliente" aria-label="Buscar projeto">
        <select class="entrada" data-f="status" aria-label="Status">${opcoes({ abertos: 'Ativos e pausados', ...STATUS_PROJETO, todos: 'Todos os status' }, f.status)}</select>
        <select class="entrada" data-f="etapa" aria-label="Etapa">${opcoesLista(etapas, '', 'Todas as etapas')}</select>
        <select class="entrada" data-f="responsavel" aria-label="Responsável">${opcoesLista(equipe, '', 'Todos os responsáveis', { texto: (u) => u.nome || u.email })}</select>
        <select class="entrada" data-f="servico" aria-label="Serviço">${opcoesLista(servicos, '', 'Todos os serviços')}</select>
        <select class="entrada" data-f="prioridade" aria-label="Prioridade">${opcoes(PRIORIDADES, '', 'Todas as prioridades')}</select>
        <select class="entrada" data-f="prazo" aria-label="Prazo">${opcoes(PRAZOS, '', 'Qualquer prazo')}</select>
        <label class="check" style="font-weight:500">Entrega de <input class="entrada" type="date" data-f="de" aria-label="Entrega a partir de"></label>
        <label class="check" style="font-weight:500">até <input class="entrada" type="date" data-f="ate" aria-label="Entrega até"></label>
        <input class="entrada" data-f="valorMin" inputmode="decimal" placeholder="Valor mínimo" aria-label="Valor mínimo" style="min-width:120px;width:130px">
        <select class="entrada" data-f="ordem" aria-label="Ordenar">${opcoes(ORDENS, f.ordem)}</select>
      </div>
      <div data-tabela>${carregando()}</div>
    </section>`);

  $('[data-novo]', view).addEventListener('click', async () => (await import('./projeto.js')).novoProjeto());
  const recarregar = debounce(() => { pagina = 0; carregar(); }, 250);
  $$('[data-f]', view).forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => { f[el.dataset.f] = el.value; recarregar(); }));

  async function carregar() {
    const box = $('[data-tabela]', view);
    try {
      let c = sb.from('vw_projetos').select('id,codigo,titulo,cliente_nome,cliente_empresa,servico_nome,etapa_nome,etapa_cor,responsavel_nome,prioridade,status,valor_final,valor_recebido,valor_a_receber,data_limite,dias_restantes,sla_status', { count: 'exact' });
      const t = termoBusca(f.texto);
      if (t) c = /^#?\d+$/.test(t) ? c.eq('codigo', Number(t.replace('#', ''))) : c.or(`titulo.ilike.*${t}*,cliente_nome.ilike.*${t}*,cliente_empresa.ilike.*${t}*`);
      if (f.status === 'abertos') c = c.in('status', ['ativo', 'pausado']); else if (f.status !== 'todos') c = c.eq('status', f.status);
      if (f.etapa) c = c.eq('etapa_id', f.etapa);
      if (f.responsavel) c = c.eq('responsavel_id', f.responsavel);
      if (f.servico) c = c.eq('servico_id', f.servico);
      if (f.prioridade) c = c.eq('prioridade', f.prioridade);
      if (f.prazo) c = c.eq('sla_status', f.prazo);
      if (f.de) c = c.gte('data_limite', f.de);
      if (f.ate) c = c.lte('data_limite', f.ate);
      const min = Number(String(f.valorMin).replace(/\./g, '').replace(',', '.'));
      if (f.valorMin && Number.isFinite(min)) c = c.gte('valor_final', min);
      const [col, dir] = f.ordem.split('.');
      c = c.order(col, { ascending: dir === 'asc', nullsFirst: false }).range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1);
      const { data: lista, count } = await qc(c);
      if (!lista.length) {
        mount(box, vazio(count === 0 && !t && f.status === 'abertos' ? { titulo: 'Nenhum projeto cadastrado', texto: 'Crie um projeto para começar a acompanhar SLA e financeiro.', acao: 'Novo projeto', acaoId: 'novo' } : { titulo: 'Nenhum projeto com esses filtros' }));
        $('[data-acao=novo]', box)?.addEventListener('click', async () => (await import('./projeto.js')).novoProjeto());
        return;
      }
      const paginas = Math.ceil(count / POR_PAGINA);
      mount(box, html`<div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Projeto</th><th>Etapa</th><th>Responsável</th><th>SLA</th><th class="num">Valor</th><th class="num">A receber</th></tr></thead>
        <tbody>${lista.map((p) => html`<tr class="clicavel" data-id="${p.id}" tabindex="0">
          <td><b>#${p.codigo} ${p.titulo}</b><span class="sub">${p.cliente_empresa || p.cliente_nome} · ${p.servico_nome || 'Sem serviço'}</span></td>
          <td data-r="Etapa"><span class="coluna-titulo" style="font-weight:600;font-size:13px"><span class="bloco" style="background:${p.etapa_cor}"></span>${p.etapa_nome}</span>
            ${p.status !== 'ativo' ? html`<span class="sub">${STATUS_PROJETO[p.status]}</span>` : ''}</td>
          <td data-r="Responsável">${p.responsavel_nome || '—'}<span class="sub">${prioridadeBadge(p.prioridade)}</span></td>
          <td>${slaBadge(p)}<span class="sub">${p.data_limite ? `Entrega ${data(p.data_limite)}` : ''}</span></td>
          <td class="num" data-r="Valor">${brl(p.valor_final)}<span class="sub">recebido ${brl(p.valor_recebido)}</span></td>
          <td class="num" data-r="A receber">${brl(p.valor_a_receber)}</td>
        </tr>`)}</tbody></table></div>
        <div class="paginacao"><span>${num(count)} projeto(s) · página ${pagina + 1} de ${paginas}</span>
          <div class="acoes"><button class="btn btn-secundario btn-p" data-pag="-1" ${pagina === 0 ? raw('disabled') : ''}>${raw(icon('chevronLeft', 14))}Anterior</button>
          <button class="btn btn-secundario btn-p" data-pag="1" ${pagina + 1 >= paginas ? raw('disabled') : ''}>Próxima${raw(icon('chevronRight', 14))}</button></div></div>`);
    } catch (e) { mount(box, erroBox(e)); }
  }

  view.addEventListener('click', async (ev) => {
    const pag = ev.target.closest('[data-pag]');
    if (pag) { pagina += Number(pag.dataset.pag); return carregar(); }
    const tr = ev.target.closest('tr[data-id]');
    if (tr) (await import('./projeto.js')).abrirProjeto(tr.dataset.id);
  });
  view.addEventListener('keydown', async (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (tr && ev.key === 'Enter') (await import('./projeto.js')).abrirProjeto(tr.dataset.id);
  });

  await carregar();
  if (params[0]) (await import('./projeto.js')).abrirProjeto(params[0]);
  const off = ao('dados-alterados', () => carregar());
  return { destruir: off };
}
