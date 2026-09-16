// Financeiro da empresa: valores cobrados de clientes (parcelas), recebimentos e forecast.
// Não usa nenhuma tabela de Finanças Pessoais.
import { sb, q, qc } from '../core/supabase.js';
import { ao, emitir } from '../core/store.js';
import { html, raw, mount, $, $$, brl, data, carregando, erroBox, vazio, statusParcelaBadge, mesLabel, MESES, hojeISO, addDiasISO,
  termoBusca, debounce, num, plural } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { grafico, CORES, eixoBRL, tooltipBRL } from '../core/charts.js';
import { marcarPaga } from './parcelas.js';

const POR_PAGINA = 25;
const iso = (y, m) => `${y}-${String(m).padStart(2, '0')}-01`;

export async function render(view) {
  const hoje = new Date();
  const per = { tipo: 'ano', ano: hoje.getFullYear(), indice: hoje.getMonth() + 1 };
  const tab = { status: 'todas', texto: '', pagina: 0 };

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>Financeiro</h1><p>Cobranças de clientes, recebimentos e previsão. Finanças pessoais ficam fora destes números.</p></div>
      <div class="acoes">
        <div class="segmentado" role="group" aria-label="Tipo de período">
          ${[['mes', 'Mês'], ['trimestre', 'Trimestre'], ['semestre', 'Semestre'], ['ano', 'Ano']].map(([k, t]) => html`<button data-tipo="${k}" aria-pressed="${k === per.tipo}">${t}</button>`)}
        </div>
        <select class="entrada" data-indice aria-label="Período" style="width:auto"></select>
        <select class="entrada" data-ano aria-label="Ano" style="width:auto">${[-2, -1, 0, 1, 2].map((d) => html`<option ${d === 0 ? raw('selected') : ''}>${hoje.getFullYear() + d}</option>`)}</select>
      </div>
    </div>
    <section class="kpis kpis-5" data-kpis>${carregando()}</section>
    <div class="duas-colunas">
      <section class="painel"><div class="painel-topo"><div><h2>Fluxo de caixa projetado</h2><p data-sub-fluxo></p></div></div><div class="grafico"><canvas data-fluxo role="img" aria-label="Fluxo de caixa projetado por mês"></canvas></div></section>
      <section class="painel"><div class="painel-topo"><div><h2>Recebido x A receber</h2><p>No período selecionado.</p></div></div><div class="grafico grafico-s"><canvas data-pizza role="img" aria-label="Recebido versus a receber"></canvas></div>
        <div data-proximos style="margin-top:14px"></div></section>
    </div>
    <section class="painel" style="margin-top:16px"><div class="painel-topo"><div><h2>Forecast</h2><p>Previsão baseada nas parcelas cadastradas, por mês de vencimento.</p></div></div><div data-forecast>${carregando()}</div></section>
    <section class="painel" style="margin-top:16px">
      <div class="painel-topo"><div><h2>Parcelas</h2><p>Valores cobrados dos clientes. Condições de pagamento ficam em cada projeto.</p></div></div>
      <div class="filtros">
        <div class="segmentado" role="group" aria-label="Status das parcelas">
          ${[['todas', 'Todas'], ['pendente', 'Pendentes'], ['vencido', 'Vencidas'], ['pago', 'Pagas'], ['cancelado', 'Canceladas']].map(([k, t]) => html`<button data-status="${k}" aria-pressed="${k === tab.status}">${t}</button>`)}
        </div>
        <input class="entrada" type="search" data-busca placeholder="Cliente ou projeto" aria-label="Buscar parcelas">
        <label class="check"><input type="checkbox" data-so-periodo checked>Só do período</label>
      </div>
      <div data-parcelas>${carregando()}</div>
    </section>
    <section class="painel" style="margin-top:16px"><div class="painel-topo"><div><h2>Cobranças por projeto</h2><p>Valor final, recebido e pendente de cada projeto.</p></div></div><div data-cobrancas>${carregando()}</div></section>`);

  const selIndice = $('[data-indice]', view);
  function intervalo() {
    const { tipo, ano, indice } = per;
    if (tipo === 'mes') return { ini: iso(ano, indice), fimMes: iso(ano, indice), label: `${MESES[indice - 1]} de ${ano}` };
    if (tipo === 'trimestre') return { ini: iso(ano, (indice - 1) * 3 + 1), fimMes: iso(ano, indice * 3), label: `${indice}º trimestre de ${ano}` };
    if (tipo === 'semestre') return { ini: iso(ano, (indice - 1) * 6 + 1), fimMes: iso(ano, indice * 6), label: `${indice}º semestre de ${ano}` };
    return { ini: iso(ano, 1), fimMes: iso(ano, 12), label: String(ano) };
  }
  const fimDoMes = (mesIso) => { const [y, m] = mesIso.split('-').map(Number); return addDiasISO(iso(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1), -1); };
  function preencherIndice() {
    const opts = { mes: MESES.map((m, i) => [i + 1, m]), trimestre: [1, 2, 3, 4].map((n) => [n, `${n}º trimestre`]), semestre: [1, 2].map((n) => [n, `${n}º semestre`]), ano: [] }[per.tipo];
    if (per.tipo === 'mes') per.indice = Math.min(per.indice, 12);
    if (per.tipo === 'trimestre') per.indice = Math.min(Math.ceil(per.indice) || 1, 4);
    if (per.tipo === 'semestre') per.indice = Math.min(per.indice, 2);
    selIndice.hidden = !opts.length;
    mount(selIndice, opts.map(([v, t]) => html`<option value="${v}" ${v === per.indice ? raw('selected') : ''}>${t}</option>`));
  }
  preencherIndice();

  $('.pagina-topo .segmentado', view).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tipo]'); if (!b) return;
    const antes = per.tipo; per.tipo = b.dataset.tipo;
    if (antes === 'mes' && per.tipo === 'trimestre') per.indice = Math.ceil(per.indice / 3);
    else if (antes === 'mes' && per.tipo === 'semestre') per.indice = Math.ceil(per.indice / 6);
    else if (per.tipo !== 'ano' && antes !== per.tipo) per.indice = 1;
    $$('[data-tipo]', view).forEach((x) => x.setAttribute('aria-pressed', x === b));
    preencherIndice(); carregarTudo();
  });
  selIndice.addEventListener('change', () => { per.indice = Number(selIndice.value); carregarTudo(); });
  $('[data-ano]', view).addEventListener('change', (ev) => { per.ano = Number(ev.target.value); carregarTudo(); });

  async function carregarResumo() {
    const { ini, fimMes, label } = intervalo();
    const kpis = $('[data-kpis]', view), fc = $('[data-forecast]', view);
    try {
      // Para o gráfico de fluxo em "Mês", mostramos 6 meses a partir do mês escolhido.
      const fimGrafico = per.tipo === 'mes' ? (() => { const [y, m] = ini.split('-').map(Number); const t = m + 5; return iso(y + Math.floor((t - 1) / 12), ((t - 1) % 12) + 1); })() : fimMes;
      const [linhasPeriodo, linhasGrafico, vencidoGeral, proximos] = await Promise.all([
        q(sb.from('vw_forecast_mensal').select('*').gte('mes', ini).lte('mes', fimMes).order('mes')),
        q(sb.from('vw_forecast_mensal').select('*').gte('mes', ini).lte('mes', fimGrafico).order('mes')),
        q(sb.from('vw_parcelas').select('valor').eq('status', 'pendente').lt('vencimento', hojeISO())),
        q(sb.from('vw_parcelas').select('id,projeto_id,projeto_codigo,cliente_nome,numero,valor,vencimento').eq('status', 'pendente').gte('vencimento', hojeISO()).lte('vencimento', addDiasISO(hojeISO(), 30)).order('vencimento').limit(5))
      ]);
      const soma = (l, k) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
      const totVencidoGeral = vencidoGeral.reduce((a, p) => a + Number(p.valor), 0);
      mount(kpis, html`
        <div class="kpi kpi-destaque"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('contratos', 16))}</span>Total contratado</span><span class="kpi-valor">${brl(soma(linhasPeriodo, 'previsto'))}</span><span class="kpi-sub">${label}</span></div>
        <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('check', 16))}</span>Total recebido</span><span class="kpi-valor">${brl(soma(linhasPeriodo, 'recebido'))}</span><span class="kpi-sub">parcelas pagas do período</span></div>
        <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('clock', 16))}</span>Total a receber</span><span class="kpi-valor">${brl(soma(linhasPeriodo, 'a_receber'))}</span><span class="kpi-sub">pendentes do período</span></div>
        <div class="kpi ${soma(linhasPeriodo, 'vencido') > 0 ? 'kpi-alerta' : ''}"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('alert', 16))}</span>Total vencido</span><span class="kpi-valor">${brl(soma(linhasPeriodo, 'vencido'))}</span><span class="kpi-sub">${brl(totVencidoGeral)} vencido no total</span></div>
        <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('calendar', 16))}</span>Próximos 30 dias</span><span class="kpi-valor">${brl(proximos.reduce((a, p) => a + Number(p.valor), 0))}</span><span class="kpi-sub">${plural(proximos.length, 'vencimento listado', 'vencimentos listados')}</span></div>`);

      $('[data-sub-fluxo]', view).textContent = per.tipo === 'mes' ? 'Seis meses a partir do mês selecionado.' : `Meses de ${label}.`;
      // Série contínua de meses (inclui meses sem parcelas)
      const meses = [];
      for (let [y, m] = ini.split('-').map(Number); iso(y, m) <= fimGrafico; m === 12 ? (y++, m = 1) : m++) meses.push(iso(y, m));
      const porMes = Object.fromEntries(linhasGrafico.map((l) => [l.mes, l]));
      const serie = (k) => meses.map((mm) => Number(porMes[mm]?.[k] || 0));
      await grafico($('[data-fluxo]', view), {
        type: 'bar',
        data: { labels: meses.map((mm) => mesLabel(mm, true)), datasets: [
          { label: 'Recebido', data: serie('recebido'), backgroundColor: CORES.laranja, borderRadius: 6, stack: 's' },
          { label: 'A receber', data: serie('a_receber').map((v, i) => v - serie('vencido')[i]), backgroundColor: '#FCD9B6', borderRadius: 6, stack: 's' },
          { label: 'Vencido', data: serie('vencido'), backgroundColor: CORES.vermelho, borderRadius: 6, stack: 's' },
          { label: 'Previsto', data: serie('previsto'), type: 'line', borderColor: CORES.grafite, backgroundColor: CORES.grafite, tension: .3, pointRadius: 3, borderWidth: 2 }
        ] },
        options: { interaction: { mode: 'index', intersect: false }, scales: { x: { stacked: true, grid: { display: false } }, y: { ...eixoBRL, stacked: true, beginAtZero: true } }, plugins: { tooltip: tooltipBRL, legend: { position: 'bottom' } } }
      });
      const rec = soma(linhasPeriodo, 'recebido'), arec = soma(linhasPeriodo, 'a_receber');
      await grafico($('[data-pizza]', view), {
        type: 'doughnut',
        data: { labels: ['Recebido', 'A receber'], datasets: [{ data: rec + arec ? [rec, arec] : [0, 0], backgroundColor: [CORES.laranja, '#FCD9B6'], borderWidth: 0 }] },
        options: { cutout: '68%', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.parsed)}` } } } }
      });
      mount($('[data-proximos]', view), proximos.length ? html`<h3 class="rotulo" style="margin-bottom:4px">Próximos vencimentos</h3><ul class="lista lista-clicavel">${proximos.map((p) => html`<li data-projeto="${p.projeto_id}">
        <div class="principal-l"><b>${p.cliente_nome}</b><span>#${p.projeto_codigo} · parcela ${p.numero} · ${data(p.vencimento)}</span></div><b class="tabular">${brl(p.valor)}</b></li>`)}</ul>`
        : html`<p style="color:var(--texto-3);font-size:13px">Nenhum vencimento nos próximos 30 dias.</p>`);

      const mesesPeriodo = meses.filter((mm) => mm <= fimMes);
      const porMesPeriodo = Object.fromEntries(linhasPeriodo.map((l) => [l.mes, l]));
      mount(fc, linhasPeriodo.length ? html`<div class="tabela-wrap"><table class="tabela">
        <thead><tr><th>Mês</th><th class="num">Parcelas</th><th class="num">Previsto</th><th class="num">Recebido</th><th class="num">A receber</th><th class="num">Vencido</th></tr></thead>
        <tbody>${mesesPeriodo.map((mm) => { const l = porMesPeriodo[mm] || {}; return html`<tr>
          <td>${mesLabel(mm)}</td><td class="num">${num(l.parcelas || 0)}</td><td class="num">${brl(l.previsto)}</td><td class="num">${brl(l.recebido)}</td><td class="num">${brl(l.a_receber)}</td>
          <td class="num" style="${Number(l.vencido) > 0 ? 'color:var(--erro)' : ''}">${brl(l.vencido)}</td></tr>`; })}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${num(soma(linhasPeriodo, 'parcelas'))}</td><td class="num">${brl(soma(linhasPeriodo, 'previsto'))}</td><td class="num">${brl(soma(linhasPeriodo, 'recebido'))}</td><td class="num">${brl(soma(linhasPeriodo, 'a_receber'))}</td><td class="num">${brl(soma(linhasPeriodo, 'vencido'))}</td></tr></tfoot>
      </table></div>
      <p style="color:var(--texto-3);font-size:12px;margin-top:10px">Previsto = parcelas não canceladas com vencimento no mês. Recebido considera o valor efetivamente pago dessas parcelas; por isso pode diferir do previsto quando houve desconto ou acréscimo no pagamento.</p>`
        : vazio({ titulo: 'Sem parcelas neste período', texto: 'Defina valor e condições de pagamento nos projetos para montar a previsão.' }));
    } catch (e) { mount(kpis, erroBox(e)); mount(fc, ''); }
  }

  async function carregarParcelas() {
    const box = $('[data-parcelas]', view);
    const { ini, fimMes } = intervalo();
    try {
      let c = sb.from('vw_parcelas').select('*', { count: 'exact' });
      if (tab.status === 'vencido') c = c.eq('status_efetivo', 'vencido');
      else if (tab.status !== 'todas') c = c.eq('status', tab.status);
      if ($('[data-so-periodo]', view).checked) c = c.gte('vencimento', ini).lte('vencimento', fimDoMes(fimMes));
      const t = termoBusca(tab.texto);
      if (t) c = /^#?\d+$/.test(t) ? c.eq('projeto_codigo', Number(t.replace('#', ''))) : c.or(`cliente_nome.ilike.*${t}*,cliente_empresa.ilike.*${t}*,projeto_titulo.ilike.*${t}*`);
      const { data: lista, count } = await qc(c.order('vencimento').order('numero').range(tab.pagina * POR_PAGINA, (tab.pagina + 1) * POR_PAGINA - 1));
      if (!lista.length) return mount(box, vazio({ titulo: 'Nenhuma parcela encontrada', texto: 'Ajuste os filtros ou o período.' }));
      const paginas = Math.ceil(count / POR_PAGINA);
      mount(box, html`<div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Cliente / projeto</th><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th><th>Pagamento</th><th></th></tr></thead>
        <tbody>${lista.map((p) => html`<tr>
          <td><b>${p.cliente_nome}</b><span class="sub">#${p.projeto_codigo} ${p.projeto_titulo}</span></td>
          <td data-r="Parcela">${p.numero}</td>
          <td data-r="Vencimento">${data(p.vencimento)}</td>
          <td class="num" data-r="Valor">${brl(p.valor)}</td>
          <td>${statusParcelaBadge(p.status_efetivo)}</td>
          <td data-r="Pagamento">${p.status === 'pago' ? html`${data(p.data_pagamento)}<span class="sub">${brl(p.valor_recebido)}</span>` : '—'}</td>
          <td class="acoes-td">
            ${p.status === 'pendente' ? html`<button class="btn btn-primario btn-p" data-pagar="${p.id}">${raw(icon('check', 14))}Marcar como paga</button>` : ''}
            <button class="btn btn-fantasma btn-p" data-projeto="${p.projeto_id}">Abrir projeto</button></td>
        </tr>`)}</tbody></table></div>
        <div class="paginacao"><span>${num(count)} parcela(s) · página ${tab.pagina + 1} de ${paginas}</span>
          <div class="acoes"><button class="btn btn-secundario btn-p" data-pag="-1" ${tab.pagina === 0 ? raw('disabled') : ''}>${raw(icon('chevronLeft', 14))}Anterior</button>
          <button class="btn btn-secundario btn-p" data-pag="1" ${tab.pagina + 1 >= paginas ? raw('disabled') : ''}>Próxima${raw(icon('chevronRight', 14))}</button></div></div>`);
      box.onclick = (ev) => {
        const pag = ev.target.closest('[data-pag]'); if (pag) { tab.pagina += Number(pag.dataset.pag); return carregarParcelas(); }
        const pg = ev.target.closest('[data-pagar]'); if (pg) marcarPaga(lista.find((x) => x.id === pg.dataset.pagar), () => emitir('dados-alterados'));
      };
    } catch (e) { mount(box, erroBox(e)); }
  }

  async function carregarCobrancas() {
    const box = $('[data-cobrancas]', view);
    try {
      const lista = await q(sb.from('vw_projetos').select('id,codigo,titulo,cliente_nome,valor_final,valor_recebido,valor_a_receber,valor_vencido,parcelas_qtd,parcelas_pagas,forma_pagamento,status')
        .not('status', 'in', '(cancelado,perdido)').gt('valor_final', 0).order('valor_a_receber', { ascending: false }).limit(50));
      if (!lista.length) return mount(box, vazio({ titulo: 'Nenhum projeto com valor definido' }));
      mount(box, html`<div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Projeto</th><th class="num">Valor final</th><th class="num">Recebido</th><th class="num">A receber</th><th class="num">Vencido</th><th>Parcelas</th></tr></thead>
        <tbody>${lista.map((p) => html`<tr class="clicavel" data-projeto="${p.id}" data-aba="financeiro">
          <td><b>#${p.codigo} ${p.titulo}</b><span class="sub">${p.cliente_nome}</span></td>
          <td class="num" data-r="Valor final">${brl(p.valor_final)}</td><td class="num" data-r="Recebido">${brl(p.valor_recebido)}</td>
          <td class="num" data-r="A receber">${brl(p.valor_a_receber)}</td>
          <td class="num" data-r="Vencido" style="${Number(p.valor_vencido) > 0 ? 'color:var(--erro)' : ''}">${brl(p.valor_vencido)}</td>
          <td data-r="Parcelas">${p.parcelas_pagas}/${p.parcelas_qtd} pagas${p.parcelas_qtd === 0 ? html` <span class="badge badge-alerta">sem parcelas</span>` : ''}</td></tr>`)}</tbody></table></div>`);
    } catch (e) { mount(box, erroBox(e)); }
  }

  $('[data-parcelas]', view).closest('.painel').querySelector('.segmentado').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-status]'); if (!b) return;
    tab.status = b.dataset.status; tab.pagina = 0;
    $$('[data-status]', view).forEach((x) => x.setAttribute('aria-pressed', x === b));
    carregarParcelas();
  });
  $('[data-busca]', view).addEventListener('input', debounce((ev) => { tab.texto = ev.target.value; tab.pagina = 0; carregarParcelas(); }, 300));
  $('[data-so-periodo]', view).addEventListener('change', () => { tab.pagina = 0; carregarParcelas(); });
  view.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-projeto]'); if (!el) return;
    (await import('./projeto.js')).abrirProjeto(el.dataset.projeto, { aba: 'financeiro' });
  });

  const carregarTudo = () => { tab.pagina = 0; carregarResumo(); carregarParcelas(); carregarCobrancas(); };
  carregarTudo();
  const off = ao('dados-alterados', carregarTudo);
  return { destruir: off };
}
