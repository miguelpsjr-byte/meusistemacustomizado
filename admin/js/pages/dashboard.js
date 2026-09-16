// Dashboard executivo: indicadores, forecast do ano, entregas e vencimentos próximos.
import { sb, q } from '../core/supabase.js';
import { sessao, ao } from '../core/store.js';
import { html, raw, mount, $, brl, num, data, carregando, erroBox, vazio, slaBadge, MESES_CURTOS, plural, hojeISO } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { grafico, CORES, eixoBRL, tooltipBRL } from '../core/charts.js';

export async function render(view) {
  const anoAtual = new Date().getFullYear();
  let ano = anoAtual;
  const nome = (sessao.perfil.nome || '').split(' ')[0];

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>${nome ? `Olá, ${nome}` : 'Dashboard'}</h1><p>Visão geral da empresa hoje.</p></div>
      <div class="acoes">
        <button class="btn btn-secundario" data-novo-cliente>${raw(icon('plus', 16))}Novo cliente</button>
        <button class="btn btn-primario" data-novo-projeto>${raw(icon('plus', 16))}Novo projeto</button>
      </div>
    </div>
    <section class="kpis" aria-label="Indicadores">${carregando()}</section>
    <div class="duas-colunas">
      <section class="painel">
        <div class="painel-topo">
          <div><h2>Forecast financeiro</h2><p>Parcelas por mês de vencimento.</p></div>
          <div class="segmentado" role="group" aria-label="Ano">
            ${[anoAtual - 1, anoAtual, anoAtual + 1].map((a) => html`<button data-ano="${a}" aria-pressed="${a === ano}">${a}</button>`)}
          </div>
        </div>
        <div class="kpis kpis-4 resumo-ano" style="margin-bottom:16px"></div>
        <div class="grafico"><canvas aria-label="Gráfico de forecast mensal" role="img"></canvas></div>
      </section>
      <section class="painel">
        <div class="painel-topo"><div><h2>Entregas próximas</h2><p>Projetos perto do prazo ou atrasados.</p></div><a class="btn btn-fantasma btn-p" href="#/crm">Ver CRM</a></div>
        <div class="entregas">${carregando()}</div>
      </section>
    </div>
    <div class="metade">
      <section class="painel">
        <div class="painel-topo"><div><h2>Próximos vencimentos</h2><p>Parcelas pendentes de clientes.</p></div><a class="btn btn-fantasma btn-p" href="#/financeiro">Ver financeiro</a></div>
        <div class="vencimentos">${carregando()}</div>
      </section>
      <section class="painel">
        <div class="painel-topo"><div><h2>Propostas e projetos parados</h2><p>Sem mudar de etapa além do limite configurado.</p></div></div>
        <div class="parados">${carregando()}</div>
      </section>
    </div>`);

  view.querySelector('[data-novo-projeto]').addEventListener('click', async () => (await import('./projeto.js')).novoProjeto());
  view.querySelector('[data-novo-cliente]').addEventListener('click', async () => (await import('./clientes.js')).formCliente({}));
  view.querySelector('.segmentado').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ano]'); if (!b) return;
    ano = Number(b.dataset.ano);
    view.querySelectorAll('[data-ano]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    carregarForecast();
  });

  async function carregarKpis() {
    const box = $('.kpis', view);
    try {
      const k = await q(sb.from('vw_dashboard_empresa').select('*').single());
      const card = (ic, titulo, valor, sub, rota, extra = '') => html`<button class="kpi ${extra}" data-rota="${rota}">
        <span class="kpi-topo"><span class="kpi-icone">${raw(icon(ic, 16))}</span>${titulo}</span>
        <span class="kpi-valor">${valor}</span><span class="kpi-sub">${sub}</span></button>`;
      mount(box, html`
        ${card('clientes', 'Clientes', num(k.clientes_total), 'cadastrados', 'clientes')}
        ${card('check', 'Negócios fechados', brl(k.negocios_fechados_valor), plural(k.negocios_fechados_qtd, 'projeto em execução ou entregue', 'projetos em execução ou entregues'), 'projetos', 'kpi-destaque')}
        ${card('money', 'Valores recebidos', brl(k.valor_recebido), 'parcelas pagas', 'financeiro')}
        ${card('clock', 'Valores a receber', brl(k.valor_a_receber), Number(k.valor_vencido) > 0 ? `${brl(k.valor_vencido)} vencido` : 'nada vencido', 'financeiro', Number(k.valor_vencido) > 0 ? 'kpi-alerta-sub' : '')}
        ${card('kanban', 'Projetos em execução', num(k.projetos_em_execucao), 'na etapa Em execução', 'crm')}
        ${card('calendar', 'Entregas próximas', num(k.entregas_proximas), k.projetos_atrasados ? plural(k.projetos_atrasados, 'atrasado', 'atrasados') : 'nenhum atrasado', 'crm', k.projetos_atrasados ? 'kpi-alerta' : '')}`);
      box.onclick = (ev) => { const b = ev.target.closest('[data-rota]'); if (b) location.hash = `#/${b.dataset.rota}`; };
    } catch (e) { mount(box, erroBox(e)); }
  }

  async function carregarForecast() {
    const resumo = $('.resumo-ano', view), canvas = $('canvas', view);
    try {
      const linhas = await q(sb.from('vw_forecast_mensal').select('*').gte('mes', `${ano}-01-01`).lte('mes', `${ano}-12-01`));
      const porMes = Object.fromEntries(linhas.map((l) => [Number(l.mes.slice(5, 7)), l]));
      const serie = (campo) => MESES_CURTOS.map((_, i) => Number(porMes[i + 1]?.[campo] || 0));
      const soma = (campo) => linhas.reduce((a, l) => a + Number(l[campo] || 0), 0);
      const hoje = hojeISO();
      const futuras = await q(sb.from('vw_parcelas').select('valor', { count: 'exact' }).eq('status', 'pendente').gte('vencimento', hoje).gte('vencimento', `${ano}-01-01`).lte('vencimento', `${ano}-12-31`));
      const somaFuturas = futuras.reduce((a, p) => a + Number(p.valor), 0);
      mount(resumo, html`
        <div class="kpi"><span class="kpi-topo">Contratado no ano</span><span class="kpi-valor">${brl(soma('previsto'))}</span></div>
        <div class="kpi"><span class="kpi-topo">Recebido</span><span class="kpi-valor">${brl(soma('recebido'))}</span></div>
        <div class="kpi"><span class="kpi-topo">A receber</span><span class="kpi-valor">${brl(soma('a_receber'))}</span></div>
        <div class="kpi"><span class="kpi-topo">Parcelas futuras</span><span class="kpi-valor">${brl(somaFuturas)}</span><span class="kpi-sub">${plural(futuras.length, 'parcela', 'parcelas')}</span></div>`);
      await grafico(canvas, {
        type: 'bar',
        data: {
          labels: MESES_CURTOS,
          datasets: [
            { label: 'Recebido', data: serie('recebido'), backgroundColor: CORES.laranja, borderRadius: 6, stack: 'v' },
            { label: 'A receber', data: serie('a_receber'), backgroundColor: '#FCD9B6', borderRadius: 6, stack: 'v' },
            { label: 'Previsto', data: serie('previsto'), type: 'line', borderColor: CORES.grafite, backgroundColor: CORES.grafite, pointRadius: 3, tension: .3, borderWidth: 2 }
          ]
        },
        options: { interaction: { mode: 'index', intersect: false }, scales: { x: { stacked: true, grid: { display: false } }, y: { ...eixoBRL, stacked: true, beginAtZero: true } }, plugins: { tooltip: tooltipBRL, legend: { position: 'bottom' } } }
      });
    } catch (e) { mount(resumo, erroBox(e)); }
  }

  async function carregarListas() {
    const [ent, ven, par] = [$('.entregas', view), $('.vencimentos', view), $('.parados', view)];
    try {
      const [projetos, parcelas, parados] = await Promise.all([
        q(sb.from('vw_projetos').select('id,codigo,titulo,cliente_nome,data_limite,dias_restantes,sla_status').in('sla_status', ['proximo', 'atrasado']).in('status', ['ativo', 'pausado']).order('data_limite').limit(8)),
        q(sb.from('vw_parcelas').select('id,projeto_id,projeto_codigo,cliente_nome,numero,valor,vencimento,status_efetivo').eq('status', 'pendente').order('vencimento').limit(8)),
        q(sb.from('vw_projetos').select('id,codigo,titulo,cliente_nome,etapa_nome,dias_na_etapa').eq('parado', true).order('dias_na_etapa', { ascending: false }).limit(8))
      ]);
      mount(ent, projetos.length ? html`<ul class="lista lista-clicavel">${projetos.map((p) => html`<li data-projeto="${p.id}">
          <div class="principal-l"><b>#${p.codigo} ${p.titulo}</b><span>${p.cliente_nome} · entrega ${data(p.data_limite)}</span></div>${slaBadge(p)}</li>`)}</ul>`
        : vazio({ titulo: 'Nenhuma entrega apertada', texto: 'Projetos perto do prazo aparecem aqui.' }));
      mount(ven, parcelas.length ? html`<ul class="lista lista-clicavel">${parcelas.map((p) => html`<li data-projeto="${p.projeto_id}" data-aba="financeiro">
          <div class="principal-l"><b>${p.cliente_nome}</b><span>#${p.projeto_codigo} · parcela ${p.numero} · ${data(p.vencimento)}</span></div>
          <div style="text-align:right"><b class="tabular">${brl(p.valor)}</b><br>${p.status_efetivo === 'vencido' ? html`<span class="badge badge-erro">${raw(icon('alert', 12))}Vencida</span>` : ''}</div></li>`)}</ul>`
        : vazio({ titulo: 'Nenhuma parcela pendente', texto: 'Cadastre as condições de pagamento nos projetos.' }));
      mount(par, parados.length ? html`<ul class="lista lista-clicavel">${parados.map((p) => html`<li data-projeto="${p.id}" data-aba="historico">
          <div class="principal-l"><b>#${p.codigo} ${p.titulo}</b><span>${p.cliente_nome} · ${p.etapa_nome}</span></div>
          <span class="badge badge-alerta">${raw(icon('history', 12))}${plural(p.dias_na_etapa, 'dia', 'dias')}</span></li>`)}</ul>`
        : vazio({ titulo: 'Nada parado', texto: 'Tudo andando dentro dos limites de cada etapa.' }));
    } catch (e) { mount(ent, erroBox(e)); mount(ven, ''); mount(par, ''); }
  }

  view.addEventListener('click', async (ev) => {
    const li = ev.target.closest('[data-projeto]'); if (!li) return;
    (await import('./projeto.js')).abrirProjeto(li.dataset.projeto, { aba: li.dataset.aba });
  });

  const recarregar = () => { carregarKpis(); carregarForecast(); carregarListas(); };
  recarregar();
  const off = ao('dados-alterados', recarregar);
  return { destruir: off };
}
