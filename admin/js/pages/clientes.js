// Clientes: cadastro central, com projetos, contratos, financeiro e histórico comercial relacionados.
import { sb, q, qc } from '../core/supabase.js';
import { ehAdmin, ao, emitir } from '../core/store.js';
import { html, raw, mount, $, $$, brl, data, dataHora, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro, comBotao,
  slaBadge, statusParcelaBadge, STATUS_CONTRATO, termoBusca, debounce, documentoValido, num, iniciais } from '../core/ui.js';
import { icon } from '../core/icons.js';

const POR_PAGINA = 20;

export async function render(view, params) {
  let pagina = 0, texto = '';
  mount(view, html`
    <div class="pagina-topo">
      <div><h1>Clientes</h1><p>Cadastro central usado no CRM, nos contratos e no financeiro.</p></div>
      <div class="acoes"><button class="btn btn-primario" data-novo>${raw(icon('plus', 16))}Novo cliente</button></div>
    </div>
    <section class="painel">
      <div class="filtros"><input class="entrada" type="search" placeholder="Nome, empresa, e-mail, telefone ou CPF/CNPJ" aria-label="Buscar clientes" style="min-width:min(360px,100%)"></div>
      <div data-tabela>${carregando()}</div>
    </section>`);

  $('[data-novo]', view).addEventListener('click', () => formCliente({ aoSalvar: () => carregar() }));
  $('input[type=search]', view).addEventListener('input', debounce((ev) => { texto = ev.target.value; pagina = 0; carregar(); }, 300));

  async function carregar() {
    const box = $('[data-tabela]', view);
    try {
      let c = sb.from('clientes').select('id,nome,empresa,documento,telefone,whatsapp,email,created_at', { count: 'exact' }).is('deleted_at', null);
      const t = termoBusca(texto);
      if (t) c = c.or(`nome.ilike.*${t}*,empresa.ilike.*${t}*,email.ilike.*${t}*,documento.ilike.*${t}*,telefone.ilike.*${t}*,whatsapp.ilike.*${t}*`);
      const { data: lista, count } = await qc(c.order('nome').range(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA - 1));
      if (!lista.length) {
        mount(box, t ? vazio({ titulo: `Nenhum cliente encontrado para "${t}"` }) : vazio({ titulo: 'Nenhum cliente cadastrado', texto: 'Cadastre clientes para vinculá-los a projetos e contratos.', acao: 'Novo cliente', acaoId: 'novo' }));
        $('[data-acao=novo]', box)?.addEventListener('click', () => formCliente({ aoSalvar: () => carregar() }));
        return;
      }
      const ids = lista.map((c2) => c2.id);
      const projetos = await q(sb.from('vw_projetos').select('cliente_id,status,valor_final,valor_a_receber').in('cliente_id', ids));
      const resumo = (id) => {
        const ps = projetos.filter((p) => p.cliente_id === id);
        return { qtd: ps.filter((p) => ['ativo', 'pausado'].includes(p.status)).length, total: ps.filter((p) => !['cancelado', 'perdido'].includes(p.status)).reduce((a, p) => a + Number(p.valor_final), 0), receber: ps.reduce((a, p) => a + Number(p.valor_a_receber), 0) };
      };
      const paginas = Math.ceil(count / POR_PAGINA);
      mount(box, html`<div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Cliente</th><th>Contato</th><th>CPF/CNPJ</th><th class="num">Projetos ativos</th><th class="num">Total contratado</th><th class="num">A receber</th></tr></thead>
        <tbody>${lista.map((c2) => { const r = resumo(c2.id); return html`<tr class="clicavel" data-id="${c2.id}" tabindex="0">
          <td><div style="display:flex;gap:10px;align-items:center"><span class="avatar">${iniciais(c2.nome)}</span><div><b>${c2.nome}</b><span class="sub">${c2.empresa || '—'}</span></div></div></td>
          <td data-r="Contato">${c2.whatsapp || c2.telefone || '—'}<span class="sub">${c2.email || ''}</span></td>
          <td data-r="CPF/CNPJ">${c2.documento || '—'}</td>
          <td class="num" data-r="Projetos ativos">${r.qtd}</td>
          <td class="num" data-r="Total">${brl(r.total)}</td>
          <td class="num" data-r="A receber">${brl(r.receber)}</td></tr>`; })}</tbody></table></div>
        <div class="paginacao"><span>${num(count)} cliente(s) · página ${pagina + 1} de ${paginas}</span>
          <div class="acoes"><button class="btn btn-secundario btn-p" data-pag="-1" ${pagina === 0 ? raw('disabled') : ''}>${raw(icon('chevronLeft', 14))}Anterior</button>
          <button class="btn btn-secundario btn-p" data-pag="1" ${pagina + 1 >= paginas ? raw('disabled') : ''}>Próxima${raw(icon('chevronRight', 14))}</button></div></div>`);
    } catch (e) { mount(box, erroBox(e)); }
  }

  view.addEventListener('click', (ev) => {
    const pag = ev.target.closest('[data-pag]'); if (pag) { pagina += Number(pag.dataset.pag); return carregar(); }
    const tr = ev.target.closest('tr[data-id]'); if (tr) abrirCliente(tr.dataset.id);
  });
  view.addEventListener('keydown', (ev) => { const tr = ev.target.closest('tr[data-id]'); if (tr && ev.key === 'Enter') abrirCliente(tr.dataset.id); });

  await carregar();
  if (params[0]) abrirCliente(params[0]);
  const off = ao('dados-alterados', () => carregar());
  return { destruir: off };
}

// Formulário (novo ou edição). Pode ser aberto de qualquer tela (ex.: dentro do CRM).
export function formCliente({ cliente = null, aoSalvar } = {}) {
  const c = cliente || {};
  const m = abrirModal({
    titulo: cliente ? 'Editar cliente' : 'Novo cliente', tamanho: 'm',
    corpo: html`<form class="grade-2" novalidate>
      <label class="campo"><span>Nome</span><input name="nome" value="${c.nome || ''}" maxlength="140" required autofocus></label>
      <label class="campo"><span>Empresa</span><input name="empresa" value="${c.empresa || ''}" maxlength="140"></label>
      <label class="campo"><span>CPF/CNPJ</span><input name="documento" value="${c.documento || ''}" inputmode="numeric" maxlength="18" placeholder="Somente números ou com pontuação"></label>
      <label class="campo"><span>E-mail</span><input name="email" type="email" value="${c.email || ''}" maxlength="160"></label>
      <label class="campo"><span>Telefone</span><input name="telefone" value="${c.telefone || ''}" inputmode="tel" maxlength="30"></label>
      <label class="campo"><span>WhatsApp</span><input name="whatsapp" value="${c.whatsapp || ''}" inputmode="tel" maxlength="30"></label>
      <label class="campo col-toda"><span>Endereço</span><input name="endereco" value="${c.endereco || ''}" maxlength="300" placeholder="Rua, número, bairro, cidade/UF, CEP"></label>
      <label class="campo col-toda"><span>Observações</span><textarea name="observacoes" rows="3" maxlength="4000">${c.observacoes || ''}</textarea></label>
    </form>`,
    rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>${cliente ? 'Salvar cliente' : 'Criar cliente'}</button>`
  });
  const f = $('form', m.el);
  $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    $$('.campo.invalido', f).forEach((x) => x.classList.remove('invalido'));
    const invalido = (campo, msg) => { f[campo].closest('.campo').classList.add('invalido'); f[campo].focus(); toast(msg, 'erro'); };
    const reg = {};
    ['nome', 'empresa', 'documento', 'email', 'telefone', 'whatsapp', 'endereco', 'observacoes'].forEach((k) => { reg[k] = f[k].value.trim() || null; });
    if (!reg.nome) return invalido('nome', 'Informe o nome do cliente.');
    if (reg.documento && !documentoValido(reg.documento)) return invalido('documento', 'CPF/CNPJ inválido. Confira os dígitos.');
    if (reg.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reg.email)) return invalido('email', 'E-mail inválido.');
    try {
      const salvo = cliente
        ? await q(sb.from('clientes').update(reg).eq('id', cliente.id).select().single())
        : await q(sb.from('clientes').insert(reg).select().single());
      toast(cliente ? 'Cliente salvo.' : 'Cliente criado.');
      m.fechar(); emitir('dados-alterados'); aoSalvar?.(salvo);
    } catch (e) { toastErro(e); }
  }));
}

export async function abrirCliente(id) {
  const m = abrirModal({ titulo: 'Cliente', tamanho: 'l', corpo: carregando() });
  async function renderizar() {
    let c, projetos, contratos, parcelas, historico;
    try {
      c = await q(sb.from('clientes').select('*').eq('id', id).is('deleted_at', null).maybeSingle());
      if (!c) return mount(m.corpo, vazio({ titulo: 'Cliente não encontrado', texto: 'Ele pode ter sido excluído.' }));
      [projetos, contratos, parcelas] = await Promise.all([
        q(sb.from('vw_projetos').select('*').eq('cliente_id', id).order('codigo', { ascending: false })),
        q(sb.from('contratos').select('id,numero,status,versao_atual,valor,created_at').eq('cliente_id', id).is('deleted_at', null).order('created_at', { ascending: false })),
        q(sb.from('vw_parcelas').select('*').eq('cliente_id', id).neq('status', 'cancelado').order('vencimento'))
      ]);
      historico = projetos.length ? await q(sb.from('projeto_historico').select('projeto_id,etapa_para_nome,movido_em').in('projeto_id', projetos.map((p) => p.id)).order('movido_em', { ascending: false }).limit(15)) : [];
    } catch (e) { return mount(m.corpo, erroBox(e)); }

    $('.modal-topo h2', m.el).textContent = c.nome;
    const recebido = parcelas.filter((p) => p.status === 'pago').reduce((a, p) => a + Number(p.valor_recebido), 0);
    const aReceber = parcelas.filter((p) => p.status === 'pendente').reduce((a, p) => a + Number(p.valor), 0);
    const codigo = (pid) => projetos.find((p) => p.id === pid)?.codigo;
    mount(m.corpo, html`
      <div class="duas-colunas" style="margin-top:0">
        <section class="bloco-info"><h3>Dados</h3><dl class="dl">
          <dt>Empresa</dt><dd>${c.empresa || '—'}</dd><dt>CPF/CNPJ</dt><dd>${c.documento || '—'}</dd>
          <dt>Telefone</dt><dd>${c.telefone || '—'}</dd><dt>WhatsApp</dt><dd>${c.whatsapp || '—'}</dd>
          <dt>E-mail</dt><dd>${c.email || '—'}</dd><dt>Endereço</dt><dd>${c.endereco || '—'}</dd>
          <dt>Cadastro</dt><dd>${dataHora(c.created_at)}</dd></dl>
          ${c.observacoes ? html`<p style="margin-top:12px;white-space:pre-wrap;color:var(--texto-2)">${c.observacoes}</p>` : ''}</section>
        <section class="bloco-info"><h3>Financeiro</h3>
          <div class="kpis kpis-4" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="kpi"><span class="kpi-topo">Recebido</span><span class="kpi-valor">${brl(recebido)}</span></div>
            <div class="kpi"><span class="kpi-topo">A receber</span><span class="kpi-valor">${brl(aReceber)}</span></div></div></section>
      </div>
      <section style="margin-top:20px"><div class="painel-topo"><h2 style="font-size:15px">Projetos</h2><button class="btn btn-secundario btn-p" data-novo-projeto>${raw(icon('plus', 14))}Novo projeto</button></div>
        ${projetos.length ? html`<ul class="lista lista-clicavel">${projetos.map((p) => html`<li data-projeto="${p.id}"><div class="principal-l"><b>#${p.codigo} ${p.titulo}</b><span>${p.etapa_nome} · ${brl(p.valor_final)}</span></div>${slaBadge(p)}</li>`)}</ul>`
          : html`<p style="color:var(--texto-3)">Nenhum projeto para este cliente.</p>`}</section>
      <section style="margin-top:20px"><h2 style="font-size:15px;margin-bottom:8px">Contratos</h2>
        ${contratos.length ? html`<ul class="lista lista-clicavel">${contratos.map((k) => html`<li data-contrato="${k.id}"><div class="principal-l"><b>${k.numero}</b><span>v${k.versao_atual} · ${brl(k.valor)}</span></div><span class="badge badge-neutro">${STATUS_CONTRATO[k.status]}</span></li>`)}</ul>`
          : html`<p style="color:var(--texto-3)">Nenhum contrato.</p>`}</section>
      <section style="margin-top:20px"><h2 style="font-size:15px;margin-bottom:8px">Parcelas</h2>
        ${parcelas.length ? html`<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Projeto</th><th>Parcela</th><th>Vencimento</th><th class="num">Valor</th><th>Status</th></tr></thead>
          <tbody>${parcelas.map((p) => html`<tr><td>#${p.projeto_codigo}</td><td>${p.numero}</td><td>${data(p.vencimento)}</td><td class="num">${brl(p.valor)}</td><td>${statusParcelaBadge(p.status_efetivo)}</td></tr>`)}</tbody></table></div>`
          : html`<p style="color:var(--texto-3)">Nenhuma parcela.</p>`}</section>
      <section style="margin-top:20px"><h2 style="font-size:15px;margin-bottom:8px">Histórico comercial</h2>
        ${historico.length ? html`<ul class="linha-tempo">${historico.map((hh) => html`<li><b>#${codigo(hh.projeto_id)} entrou em ${hh.etapa_para_nome}</b><span>${dataHora(hh.movido_em)}</span></li>`)}</ul>`
          : html`<p style="color:var(--texto-3)">Sem movimentações.</p>`}</section>`);

    if (!m.rodape) { const f = document.createElement('footer'); f.className = 'modal-rodape'; m.el.appendChild(f); m.rodape = f; }
    mount(m.rodape, html`${ehAdmin() ? html`<button class="btn btn-fantasma btn-texto-perigo" data-excluir style="margin-right:auto">${raw(icon('trash', 16))}Excluir cliente</button>` : ''}
      <button class="btn btn-secundario" data-fechar>Fechar</button><button class="btn btn-primario" data-editar>${raw(icon('edit', 16))}Editar</button>`);
    $('[data-editar]', m.rodape).onclick = () => formCliente({ cliente: c, aoSalvar: renderizar });
    const btnExcluir = $('[data-excluir]', m.rodape);
    if (btnExcluir) btnExcluir.onclick = async () => {
      const ativos = projetos.filter((p) => ['ativo', 'pausado'].includes(p.status)).length;
      const msg = ativos ? `${c.nome} tem ${ativos} projeto(s) ativo(s). Ao excluir, o cliente some das listas, mas projetos e contratos continuam registrados.` : `${c.nome} sairá da lista de clientes. O registro fica guardado na auditoria.`;
      if (!(await confirmar({ titulo: 'Excluir cliente', mensagem: msg, confirmar: 'Excluir cliente', perigo: true }))) return;
      try { await q(sb.from('clientes').update({ deleted_at: new Date().toISOString() }).eq('id', id)); toast('Cliente excluído.'); emitir('dados-alterados'); m.fechar(); }
      catch (e) { toastErro(e); }
    };
    m.corpo.onclick = async (ev) => {
      const pr = ev.target.closest('[data-projeto]'); if (pr) return (await import('./projeto.js')).abrirProjeto(pr.dataset.projeto);
      const ct = ev.target.closest('[data-contrato]'); if (ct) { m.fechar(); location.hash = `#/contratos/${ct.dataset.contrato}`; return; }
      if (ev.target.closest('[data-novo-projeto]')) (await import('./projeto.js')).novoProjeto({ clienteId: id });
    };
  }
  renderizar();
}
