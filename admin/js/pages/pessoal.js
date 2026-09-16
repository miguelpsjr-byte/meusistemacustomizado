// Finanças Pessoais: 100% separado do financeiro da empresa.
// Usa apenas as tabelas pf_* (RLS: somente o dono enxerga, nem administradores).
import { sb, q } from '../core/supabase.js';
import { html, raw, mount, $, $$, brl, data, hojeISO, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro, comBotao,
  opcoes, opcoesLista, parseValor, valorInput, mesLabel, plural } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { grafico, CORES, eixoBRL } from '../core/charts.js';

const TIPOS = { fixa: 'Despesa fixa recorrente', variavel: 'Despesa variável', extra: 'Extra' };
const TIPOS_CURTOS = { fixa: 'Fixa', variavel: 'Variável', extra: 'Extra' };
const RECORRENCIAS = { nenhuma: 'Não se repete', mensal: 'Todo mês', anual: 'Todo ano' };
const STATUS_DIVIDA = { ativa: 'Ativa', atrasada: 'Atrasada', renegociada: 'Renegociada', quitada: 'Quitada' };
const CATEGORIAS_PADRAO = [['Moradia', '#F97316'], ['Alimentação', '#F59E0B'], ['Transporte', '#1F2937'], ['Educação', '#0EA5E9'], ['Lazer', '#8B5CF6'], ['Saúde', '#16A34A'], ['Assinaturas', '#EC4899'], ['Outros', '#94A3B8']];

export async function render(view) {
  const agora = new Date();
  const estado = { aba: 'visao', mes: `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-01` };
  let categorias = [];

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>Finanças Pessoais</h1><p>Seus gastos e dívidas, fora dos números da empresa.</p></div>
      <div class="acoes"><span class="aviso-privado">${raw(icon('lock', 14))}Só você vê esta área</span>
        <button class="btn btn-secundario" data-nova-divida>${raw(icon('plus', 16))}Dívida</button>
        <button class="btn btn-primario" data-nova-despesa>${raw(icon('plus', 16))}Despesa</button></div>
    </div>
    <nav class="abas" role="tablist">${[['visao', 'Visão geral'], ['despesas', 'Despesas'], ['dividas', 'Dívidas e empréstimos'], ['categorias', 'Categorias']].map(([k, t]) => html`<button role="tab" data-aba="${k}" aria-selected="${k === estado.aba}">${t}</button>`)}</nav>
    <div data-conteudo>${carregando()}</div>`);

  const box = $('[data-conteudo]', view);
  async function carregarCategorias() {
    categorias = await q(sb.from('pf_categorias').select('*').order('nome'));
    if (!categorias.length) {
      await q(sb.from('pf_categorias').insert(CATEGORIAS_PADRAO.map(([nome, cor]) => ({ nome, cor }))));
      categorias = await q(sb.from('pf_categorias').select('*').order('nome'));
    }
  }
  try { await carregarCategorias(); } catch (e) { return mount(box, erroBox(e)); }

  $('.abas', view).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-aba]'); if (!b) return;
    estado.aba = b.dataset.aba;
    $$('.abas [data-aba]', view).forEach((x) => x.setAttribute('aria-selected', x === b));
    renderAba();
  });
  $('[data-nova-despesa]', view).addEventListener('click', () => formDespesa(null));
  $('[data-nova-divida]', view).addEventListener('click', () => formDivida(null));

  const seletorMes = () => html`<label class="check" style="font-weight:600">Mês
    <input type="month" class="entrada" data-mes value="${estado.mes.slice(0, 7)}" style="width:auto"></label>`;
  function ligarMes() {
    $('[data-mes]', box)?.addEventListener('change', (ev) => { if (ev.target.value) { estado.mes = `${ev.target.value}-01`; renderAba(); } });
  }
  const renderAba = () => ({ visao: abaVisao, despesas: abaDespesas, dividas: abaDividas, categorias: abaCategorias })[estado.aba]();

  // ---------- Visão geral ----------
  async function abaVisao() {
    mount(box, carregando());
    try {
      const [meses, porCategoria, dividas] = await Promise.all([
        q(sb.rpc('pf_resumo_mensal', { p_meses: 12 })),
        q(sb.rpc('pf_gastos_por_categoria', { p_mes: estado.mes })),
        q(sb.from('pf_dividas').select('*').is('deleted_at', null))
      ]);
      // Resumo do mês escolhido (pode ser anterior à janela de 12 meses)
      const [doMes] = estado.mes >= meses[0]?.mes ? [meses.find((m) => m.mes === estado.mes)] : await q(sb.rpc('pf_resumo_mensal', { p_meses: 36 })).then((l) => [l.find((m) => m.mes === estado.mes)]);
      const r = doMes || { fixa: 0, variavel: 0, extra: 0, total: 0 };
      const ativas = dividas.filter((d) => d.status !== 'quitada');
      const saldoDividas = ativas.reduce((a, d) => a + Number(d.saldo_atual), 0);
      const parcelasFuturas = ativas.reduce((a, d) => a + Math.max(0, d.num_parcelas - d.parcelas_pagas) * Number(d.valor_parcela), 0);
      const qtdFuturas = ativas.reduce((a, d) => a + Math.max(0, d.num_parcelas - d.parcelas_pagas), 0);
      mount(box, html`
        <div class="filtros">${seletorMes()}</div>
        <section class="kpis">
          <div class="kpi kpi-destaque"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('money', 16))}</span>Gastos do mês</span><span class="kpi-valor">${brl(r.total)}</span><span class="kpi-sub">${mesLabel(estado.mes)}</span></div>
          <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('refresh', 16))}</span>Gastos fixos</span><span class="kpi-valor">${brl(r.fixa)}</span></div>
          <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('financeiro', 16))}</span>Gastos variáveis</span><span class="kpi-valor">${brl(r.variavel)}</span></div>
          <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('zap', 16))}</span>Extras</span><span class="kpi-valor">${brl(r.extra)}</span></div>
          <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('alert', 16))}</span>Dívidas</span><span class="kpi-valor">${brl(saldoDividas)}</span><span class="kpi-sub">${plural(ativas.length, 'dívida ativa', 'dívidas ativas')}</span></div>
          <div class="kpi"><span class="kpi-topo"><span class="kpi-icone">${raw(icon('calendar', 16))}</span>Parcelas futuras</span><span class="kpi-valor">${brl(parcelasFuturas)}</span><span class="kpi-sub">${plural(qtdFuturas, 'parcela restante', 'parcelas restantes')}</span></div>
        </section>
        <div class="metade">
          <section class="painel"><div class="painel-topo"><div><h2>Maiores gastos por categoria</h2><p>${mesLabel(estado.mes)}</p></div></div>
            ${porCategoria.length ? html`<div class="grafico"><canvas data-cat role="img" aria-label="Gastos por categoria"></canvas></div>` : vazio({ titulo: 'Sem gastos neste mês', texto: 'Cadastre despesas para ver a divisão por categoria.' })}</section>
          <section class="painel"><div class="painel-topo"><div><h2>Gastos por mês</h2><p>Últimos 12 meses, incluindo recorrências.</p></div></div>
            <div class="grafico"><canvas data-meses role="img" aria-label="Gastos por mês"></canvas></div></section>
        </div>`);
      ligarMes();
      if (porCategoria.length) await grafico($('[data-cat]', box), {
        type: 'bar',
        data: { labels: porCategoria.map((c) => c.categoria), datasets: [{ label: 'Gasto', data: porCategoria.map((c) => Number(c.total)), backgroundColor: porCategoria.map((c) => c.cor), borderRadius: 6 }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => brl(c.parsed.x) } } }, scales: { x: { ...eixoBRL, beginAtZero: true }, y: { grid: { display: false } } } }
      });
      await grafico($('[data-meses]', box), {
        type: 'bar',
        data: { labels: meses.map((m) => mesLabel(m.mes, true)), datasets: [
          { label: 'Fixas', data: meses.map((m) => Number(m.fixa)), backgroundColor: CORES.grafite, borderRadius: 4, stack: 's' },
          { label: 'Variáveis', data: meses.map((m) => Number(m.variavel)), backgroundColor: CORES.laranja, borderRadius: 4, stack: 's' },
          { label: 'Extras', data: meses.map((m) => Number(m.extra)), backgroundColor: CORES.amarelo, borderRadius: 4, stack: 's' }] },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { ...eixoBRL, stacked: true, beginAtZero: true } } }
      });
    } catch (e) { mount(box, erroBox(e)); }
  }

  // ---------- Despesas ----------
  let filtroDesp = { tipo: '', categoria: '' };
  async function abaDespesas() {
    mount(box, carregando());
    try {
      const [ano, mes] = estado.mes.split('-').map(Number);
      const fim = `${mes === 12 ? ano + 1 : ano}-${String(mes === 12 ? 1 : mes + 1).padStart(2, '0')}-01`;
      const [avulsas, recorrentes] = await Promise.all([
        q(sb.from('pf_despesas').select('*').is('deleted_at', null).eq('recorrencia', 'nenhuma').gte('data', estado.mes).lt('data', fim).order('data', { ascending: false })),
        q(sb.from('pf_despesas').select('*').is('deleted_at', null).neq('recorrencia', 'nenhuma').lt('data', fim).order('descricao'))
      ]);
      const recorrentesDoMes = recorrentes.filter((d) => (!d.recorrencia_fim || d.recorrencia_fim >= estado.mes) && (d.recorrencia === 'mensal' || Number(d.data.slice(5, 7)) === mes));
      let lista = [...recorrentesDoMes, ...avulsas];
      if (filtroDesp.tipo) lista = lista.filter((d) => d.tipo === filtroDesp.tipo);
      if (filtroDesp.categoria) lista = lista.filter((d) => d.categoria_id === filtroDesp.categoria);
      const total = lista.reduce((a, d) => a + Number(d.valor), 0);
      const cat = (id) => categorias.find((c) => c.id === id);
      mount(box, html`
        <div class="filtros">${seletorMes()}
          <select class="entrada" data-ft="tipo" aria-label="Tipo">${opcoes(TIPOS_CURTOS, filtroDesp.tipo, 'Todos os tipos')}</select>
          <select class="entrada" data-ft="categoria" aria-label="Categoria">${opcoesLista(categorias, filtroDesp.categoria, 'Todas as categorias')}</select>
          <b style="margin-left:auto" class="tabular">Total: ${brl(total)}</b></div>
        <section class="painel">
          ${lista.length ? html`<div class="tabela-wrap"><table class="tabela tabela-cards">
            <thead><tr><th>Descrição</th><th>Categoria</th><th>Tipo</th><th>Data</th><th class="num">Valor</th><th></th></tr></thead>
            <tbody>${lista.map((d) => html`<tr>
              <td><b>${d.descricao}</b>${d.observacao ? html`<span class="sub">${d.observacao}</span>` : ''}</td>
              <td data-r="Categoria">${cat(d.categoria_id) ? html`<span class="cor-amostra" style="background:${cat(d.categoria_id).cor}"></span> ${cat(d.categoria_id).nome}` : 'Sem categoria'}</td>
              <td data-r="Tipo">${TIPOS_CURTOS[d.tipo]}${d.recorrencia !== 'nenhuma' ? html` <span class="badge badge-neutro">${raw(icon('refresh', 12))}${RECORRENCIAS[d.recorrencia]}</span>` : ''}</td>
              <td data-r="Data">${d.recorrencia === 'nenhuma' ? data(d.data) : `desde ${data(d.data)}${d.recorrencia_fim ? ` até ${data(d.recorrencia_fim)}` : ''}`}</td>
              <td class="num" data-r="Valor">${brl(d.valor)}</td>
              <td class="acoes-td"><button class="btn-icone" data-editar="${d.id}" aria-label="Editar ${d.descricao}">${raw(icon('edit', 16))}</button>
                <button class="btn-icone" data-apagar="${d.id}" aria-label="Apagar ${d.descricao}">${raw(icon('trash', 16))}</button></td></tr>`)}</tbody></table></div>`
          : vazio({ titulo: `Nenhuma despesa em ${mesLabel(estado.mes)}`, texto: 'Despesas fixas recorrentes aparecem em todos os meses a partir da data de início.', acao: 'Nova despesa', acaoId: 'nova' })}
        </section>`);
      ligarMes();
      $$('[data-ft]', box).forEach((el) => el.addEventListener('change', () => { filtroDesp[el.dataset.ft] = el.value; abaDespesas(); }));
      box.onclick = async (ev) => {
        if (ev.target.closest('[data-acao=nova]')) return formDespesa(null);
        const ed = ev.target.closest('[data-editar]'); if (ed) return formDespesa(lista.find((d) => d.id === ed.dataset.editar));
        const ap = ev.target.closest('[data-apagar]');
        if (ap) {
          const d = lista.find((x) => x.id === ap.dataset.apagar);
          const msg = d.recorrencia !== 'nenhuma' ? `"${d.descricao}" é recorrente: apagar remove de todos os meses. Para parar só daqui em diante, edite e defina a data final.` : `Apagar "${d.descricao}" de ${brl(d.valor)}?`;
          if (!(await confirmar({ titulo: 'Apagar lançamento', mensagem: msg, confirmar: 'Apagar lançamento', perigo: true }))) return;
          try { await q(sb.from('pf_despesas').update({ deleted_at: new Date().toISOString() }).eq('id', d.id)); toast('Lançamento apagado.'); abaDespesas(); } catch (e) { toastErro(e); }
        }
      };
    } catch (e) { mount(box, erroBox(e)); }
  }

  function formDespesa(d) {
    const m = abrirModal({
      titulo: d ? 'Editar despesa' : 'Nova despesa', tamanho: 'm',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo col-toda"><span>Descrição</span><input name="descricao" value="${d?.descricao || ''}" maxlength="140" required></label>
        <label class="campo"><span>Valor (R$)</span><input name="valor" inputmode="decimal" value="${valorInput(d?.valor)}" required></label>
        <label class="campo"><span>Data</span><input type="date" name="data" value="${d?.data || hojeISO()}" required></label>
        <label class="campo"><span>Categoria</span><select name="categoria_id">${opcoesLista(categorias.filter((c) => c.ativo || c.id === d?.categoria_id), d?.categoria_id, 'Sem categoria')}</select></label>
        <label class="campo"><span>Tipo</span><select name="tipo">${opcoes(TIPOS, d?.tipo || 'variavel')}</select></label>
        <label class="campo"><span>Recorrência</span><select name="recorrencia">${opcoes(RECORRENCIAS, d?.recorrencia || 'nenhuma')}</select></label>
        <label class="campo" data-fim><span>Repetir até (opcional)</span><input type="date" name="recorrencia_fim" value="${d?.recorrencia_fim || ''}"></label>
        <label class="campo col-toda"><span>Observação</span><textarea name="observacao" rows="2" style="min-height:64px" maxlength="1000">${d?.observacao || ''}</textarea></label>
      </form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>${d ? 'Salvar despesa' : 'Criar despesa'}</button>`
    });
    const f = $('form', m.el);
    const sync = () => { $('[data-fim]', f).hidden = f.recorrencia.value === 'nenhuma'; };
    f.tipo.addEventListener('change', () => { if (f.tipo.value === 'fixa' && f.recorrencia.value === 'nenhuma') f.recorrencia.value = 'mensal'; sync(); });
    f.recorrencia.addEventListener('change', sync); sync();
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const reg = { descricao: f.descricao.value.trim(), valor: parseValor(f.valor.value), data: f.data.value, categoria_id: f.categoria_id.value || null,
        tipo: f.tipo.value, recorrencia: f.recorrencia.value, recorrencia_fim: f.recorrencia.value === 'nenhuma' ? null : (f.recorrencia_fim.value || null), observacao: f.observacao.value.trim() || null };
      if (!reg.descricao) return toast('Informe a descrição.', 'erro');
      if (!(reg.valor > 0)) return toast('Informe um valor maior que zero.', 'erro');
      if (!reg.data) return toast('Informe a data.', 'erro');
      if (reg.recorrencia_fim && reg.recorrencia_fim < reg.data) return toast('A data final deve ser depois do início.', 'erro');
      try {
        if (d) await q(sb.from('pf_despesas').update(reg).eq('id', d.id)); else await q(sb.from('pf_despesas').insert(reg));
        toast(d ? 'Despesa salva.' : 'Despesa criada.'); m.fechar(); renderAba();
      } catch (e) { toastErro(e); }
    }));
  }

  // ---------- Dívidas ----------
  async function abaDividas() {
    mount(box, carregando());
    try {
      const dividas = await q(sb.from('pf_dividas').select('*').is('deleted_at', null).order('status').order('proximo_vencimento', { nullsFirst: false }));
      const ativas = dividas.filter((d) => d.status !== 'quitada');
      const soma = (l, fn) => l.reduce((a, d) => a + fn(d), 0);
      mount(box, html`
        <section class="kpis kpis-4" style="margin-bottom:16px">
          <div class="kpi"><span class="kpi-topo">Valor total contratado</span><span class="kpi-valor">${brl(soma(dividas, (d) => Number(d.valor_original)))}</span></div>
          <div class="kpi kpi-destaque"><span class="kpi-topo">Saldo devedor</span><span class="kpi-valor">${brl(soma(ativas, (d) => Number(d.saldo_atual)))}</span></div>
          <div class="kpi"><span class="kpi-topo">Parcelas pagas</span><span class="kpi-valor">${soma(dividas, (d) => d.parcelas_pagas)}</span></div>
          <div class="kpi"><span class="kpi-topo">Parcelas restantes</span><span class="kpi-valor">${soma(ativas, (d) => Math.max(0, d.num_parcelas - d.parcelas_pagas))}</span></div>
        </section>
        ${dividas.length ? html`<div class="dividas">${dividas.map((d) => {
          const pct = d.num_parcelas ? Math.round((d.parcelas_pagas / d.num_parcelas) * 100) : 0;
          const atrasada = d.status === 'atrasada' || (d.status === 'ativa' && d.proximo_vencimento && d.proximo_vencimento < hojeISO());
          return html`<article class="painel divida">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><h3>${d.descricao}</h3><span class="credor">${d.credor || 'Credor não informado'}</span></div>
              <span class="badge ${d.status === 'quitada' ? 'badge-ok' : atrasada ? 'badge-erro' : 'badge-neutro'}">${atrasada && d.status === 'ativa' ? 'Vencida' : STATUS_DIVIDA[d.status]}</span></div>
            <div class="saldo">${brl(d.saldo_atual)}</div><span class="credor">saldo de ${brl(d.valor_original)}${d.juros_mensal != null ? ` · juros ${String(d.juros_mensal).replace('.', ',')}% a.m.` : ''}</span>
            <div class="barra ok" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Parcelas pagas"><i style="width:${pct}%"></i></div>
            <span class="credor">${d.parcelas_pagas} de ${d.num_parcelas} parcelas pagas · ${brl(d.valor_parcela)} por parcela</span>
            <div class="rodape-divida"><span class="credor">${d.status !== 'quitada' && d.proximo_vencimento ? `Próximo vencimento: ${data(d.proximo_vencimento)}` : ''}</span>
              <div class="acoes">
                ${d.status !== 'quitada' ? html`<button class="btn btn-primario btn-p" data-pagar="${d.id}">${raw(icon('check', 14))}Pagar parcela</button>` : ''}
                <button class="btn-icone" data-editar="${d.id}" aria-label="Editar ${d.descricao}">${raw(icon('edit', 16))}</button>
                <button class="btn-icone" data-apagar="${d.id}" aria-label="Apagar ${d.descricao}">${raw(icon('trash', 16))}</button></div></div>
            ${d.observacoes ? html`<p class="credor" style="margin-top:8px;white-space:pre-wrap">${d.observacoes}</p>` : ''}
          </article>`; })}</div>`
          : html`<section class="painel">${vazio({ titulo: 'Nenhuma dívida ou empréstimo', texto: 'Cadastre financiamentos, empréstimos e parcelamentos para acompanhar o saldo.', acao: 'Nova dívida', acaoId: 'nova' })}</section>`}`);
      box.onclick = async (ev) => {
        if (ev.target.closest('[data-acao=nova]')) return formDivida(null);
        const achar = (el) => dividas.find((x) => x.id === el.dataset.pagar || x.id === el.dataset.editar || x.id === el.dataset.apagar);
        const ed = ev.target.closest('[data-editar]'); if (ed) return formDivida(achar(ed));
        const pg = ev.target.closest('[data-pagar]');
        if (pg) {
          const d = achar(pg);
          const novoSaldo = Math.max(0, Math.round((Number(d.saldo_atual) - Number(d.valor_parcela)) * 100) / 100);
          const pagas = Math.min(d.num_parcelas, d.parcelas_pagas + 1);
          const quitada = pagas >= d.num_parcelas || novoSaldo === 0;
          if (!(await confirmar({ titulo: 'Registrar parcela paga', mensagem: `Parcela ${pagas} de ${d.num_parcelas}: o saldo passa de ${brl(d.saldo_atual)} para ${brl(novoSaldo)}${quitada ? ' e a dívida fica quitada' : ''}. Se houve juros ou valor diferente, ajuste o saldo depois em Editar.`, confirmar: 'Registrar pagamento' }))) return;
          let prox = d.proximo_vencimento;
          if (prox && !quitada) { const [y, mm, dd] = prox.split('-').map(Number); const dt = new Date(y, mm, 1); const ult = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate(); prox = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(Math.min(dd, ult)).padStart(2, '0')}`; }
          try { await q(sb.from('pf_dividas').update({ parcelas_pagas: pagas, saldo_atual: novoSaldo, status: quitada ? 'quitada' : (d.status === 'atrasada' ? 'ativa' : d.status), proximo_vencimento: quitada ? null : prox }).eq('id', d.id)); toast(quitada ? 'Dívida quitada.' : 'Parcela registrada.'); abaDividas(); }
          catch (e) { toastErro(e); }
        }
        const ap = ev.target.closest('[data-apagar]');
        if (ap) {
          const d = achar(ap);
          if (!(await confirmar({ titulo: 'Apagar dívida', mensagem: `"${d.descricao}" sairá da lista e dos totais.`, confirmar: 'Apagar dívida', perigo: true }))) return;
          try { await q(sb.from('pf_dividas').update({ deleted_at: new Date().toISOString() }).eq('id', d.id)); toast('Dívida apagada.'); abaDividas(); } catch (e) { toastErro(e); }
        }
      };
    } catch (e) { mount(box, erroBox(e)); }
  }

  function formDivida(d) {
    const m = abrirModal({
      titulo: d ? 'Editar dívida' : 'Nova dívida ou empréstimo', tamanho: 'm',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo"><span>Descrição</span><input name="descricao" value="${d?.descricao || ''}" maxlength="140" required placeholder="Ex.: Financiamento do carro"></label>
        <label class="campo"><span>Credor / instituição</span><input name="credor" value="${d?.credor || ''}" maxlength="140"></label>
        <label class="campo"><span>Valor original (R$)</span><input name="valor_original" inputmode="decimal" value="${valorInput(d?.valor_original)}" required></label>
        <label class="campo"><span>Saldo atual (R$)</span><input name="saldo_atual" inputmode="decimal" value="${valorInput(d?.saldo_atual)}" placeholder="Igual ao original, se vazio"></label>
        <label class="campo"><span>Número de parcelas</span><input name="num_parcelas" type="number" min="1" value="${d?.num_parcelas ?? 1}"></label>
        <label class="campo"><span>Parcelas já pagas</span><input name="parcelas_pagas" type="number" min="0" value="${d?.parcelas_pagas ?? 0}"></label>
        <label class="campo"><span>Valor da parcela (R$)</span><input name="valor_parcela" inputmode="decimal" value="${valorInput(d?.valor_parcela)}"></label>
        <label class="campo"><span>Próximo vencimento</span><input type="date" name="proximo_vencimento" value="${d?.proximo_vencimento || ''}"></label>
        <label class="campo"><span>Juros ao mês (%)</span><input name="juros_mensal" inputmode="decimal" value="${d?.juros_mensal != null ? String(d.juros_mensal).replace('.', ',') : ''}"></label>
        <label class="campo"><span>Status</span><select name="status">${opcoes(STATUS_DIVIDA, d?.status || 'ativa')}</select></label>
        <label class="campo col-toda"><span>Observações</span><textarea name="observacoes" rows="2" style="min-height:64px" maxlength="2000">${d?.observacoes || ''}</textarea></label>
      </form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>${d ? 'Salvar dívida' : 'Criar dívida'}</button>`
    });
    const f = $('form', m.el);
    f.num_parcelas.addEventListener('input', () => {
      const v = parseValor(f.valor_original.value), n = parseInt(f.num_parcelas.value, 10);
      if (!f.valor_parcela.value && v > 0 && n > 0) f.valor_parcela.placeholder = `Sugestão: ${valorInput(v / n)}`;
    });
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const original = parseValor(f.valor_original.value);
      const reg = {
        descricao: f.descricao.value.trim(), credor: f.credor.value.trim() || null, valor_original: original,
        saldo_atual: f.saldo_atual.value ? parseValor(f.saldo_atual.value) : original,
        num_parcelas: parseInt(f.num_parcelas.value, 10) || 1, parcelas_pagas: parseInt(f.parcelas_pagas.value, 10) || 0,
        valor_parcela: f.valor_parcela.value ? parseValor(f.valor_parcela.value) : 0,
        proximo_vencimento: f.proximo_vencimento.value || null,
        juros_mensal: f.juros_mensal.value ? parseValor(f.juros_mensal.value) : null,
        status: f.status.value, observacoes: f.observacoes.value.trim() || null
      };
      if (!reg.descricao) return toast('Informe a descrição.', 'erro');
      if (!(reg.valor_original >= 0) || !(reg.saldo_atual >= 0) || !(reg.valor_parcela >= 0)) return toast('Confira os valores informados.', 'erro');
      if (reg.parcelas_pagas > reg.num_parcelas) return toast('Parcelas pagas não pode passar do total.', 'erro');
      if (reg.juros_mensal != null && !(reg.juros_mensal >= 0)) return toast('Juros inválidos.', 'erro');
      try {
        if (d) await q(sb.from('pf_dividas').update(reg).eq('id', d.id)); else await q(sb.from('pf_dividas').insert(reg));
        toast(d ? 'Dívida salva.' : 'Dívida criada.'); m.fechar();
        if (estado.aba !== 'dividas') { estado.aba = 'dividas'; $$('.abas [data-aba]', view).forEach((x) => x.setAttribute('aria-selected', x.dataset.aba === 'dividas')); }
        renderAba();
      } catch (e) { toastErro(e); }
    }));
  }

  // ---------- Categorias ----------
  async function abaCategorias() {
    mount(box, html`<section class="painel" style="max-width:720px">
      <form class="inline-add" data-nova-cat novalidate>
        <label class="campo"><span>Nova categoria</span><input name="nome" maxlength="60" placeholder="Ex.: Pets"></label>
        <label class="campo" style="flex:0"><span>Cor</span><input type="color" name="cor" value="#F59E0B"></label>
        <button class="btn btn-primario" type="submit">Adicionar</button>
      </form>
      <ul class="lista" style="margin-top:16px">${categorias.map((c) => html`<li>
        <input type="color" value="${c.cor}" data-cor="${c.id}" aria-label="Cor de ${c.nome}">
        <div class="principal-l"><input class="entrada" value="${c.nome}" data-nome="${c.id}" maxlength="60" aria-label="Nome da categoria" style="max-width:280px"></div>
        <label class="check"><input type="checkbox" data-ativo="${c.id}" ${c.ativo ? raw('checked') : ''}>Ativa</label>
      </li>`)}</ul>
      <p style="color:var(--texto-3);font-size:12px;margin-top:10px">Categorias inativas somem das opções, mas continuam nas despesas antigas.</p>
    </section>`);
    const salvarCat = async (id, campos) => {
      try { await q(sb.from('pf_categorias').update(campos).eq('id', id)); await carregarCategorias(); toast('Categoria salva.'); } catch (e) { toastErro(e); await carregarCategorias(); abaCategorias(); }
    };
    $('[data-nova-cat]', box).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const nome = ev.target.nome.value.trim(); if (!nome) return toast('Informe o nome da categoria.', 'erro');
      try { await q(sb.from('pf_categorias').insert({ nome, cor: ev.target.cor.value })); await carregarCategorias(); toast('Categoria criada.'); abaCategorias(); } catch (e) { toastErro(e); }
    });
    $$('[data-cor]', box).forEach((el) => el.addEventListener('change', () => salvarCat(el.dataset.cor, { cor: el.value })));
    $$('[data-nome]', box).forEach((el) => el.addEventListener('change', () => { if (el.value.trim()) salvarCat(el.dataset.nome, { nome: el.value.trim() }); }));
    $$('[data-ativo]', box).forEach((el) => el.addEventListener('change', () => salvarCat(el.dataset.ativo, { ativo: el.checked })));
  }

  renderAba();
}
