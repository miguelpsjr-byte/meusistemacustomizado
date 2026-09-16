// Parcelas de um projeto: geração, edição, pagamento e cancelamento.
import { sb, q } from '../core/supabase.js';
import { emitir } from '../core/store.js';
import { html, raw, mount, $, brl, data, hojeISO, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro, comBotao,
  opcoes, FORMAS_PAGAMENTO, statusParcelaBadge, parseValor, valorInput } from '../core/ui.js';
import { icon } from '../core/icons.js';

export async function renderParcelas(box, projeto, { aoMudar } = {}) {
  mount(box, carregando());
  let lista;
  try {
    lista = await q(sb.from('vw_parcelas').select('*').eq('projeto_id', projeto.id).order('numero').order('vencimento'));
  } catch (e) { return mount(box, erroBox(e)); }

  const ativas = lista.filter((p) => p.status !== 'cancelado');
  const soma = ativas.reduce((a, p) => a + Number(p.valor), 0);
  const diferenca = Math.round((Number(projeto.valor_final) - soma) * 100) / 100;
  const temPaga = lista.some((p) => p.status === 'pago');

  mount(box, html`
    <div class="painel-topo" style="margin-bottom:10px">
      <div><h2 style="font-size:15px">Parcelas</h2>
        <p>${ativas.length} parcela(s) somando ${brl(soma)}${diferenca !== 0 && Number(projeto.valor_final) > 0 ? html` · <span style="color:var(--alerta);font-weight:700">diferença de ${brl(diferenca)} em relação ao valor final</span>` : ''}</p></div>
      <div class="acoes">
        <button class="btn btn-secundario btn-p" data-gerar ${temPaga ? raw('disabled title="Já existem parcelas pagas"') : ''}>${raw(icon('refresh', 14))}Gerar pelas condições</button>
        <button class="btn btn-secundario btn-p" data-nova>${raw(icon('plus', 14))}Parcela</button>
      </div>
    </div>
    ${lista.length ? html`<div class="tabela-wrap"><table class="tabela tabela-cards">
      <thead><tr><th>Nº</th><th class="num">Valor</th><th>Vencimento</th><th>Status</th><th>Pagamento</th><th></th></tr></thead>
      <tbody>${lista.map((p) => html`<tr>
        <td data-r="Nº"><b>${p.numero}</b></td>
        <td class="num" data-r="Valor">${brl(p.valor)}</td>
        <td data-r="Vencimento">${data(p.vencimento)}</td>
        <td>${statusParcelaBadge(p.status_efetivo)}</td>
        <td data-r="Pagamento">${p.status === 'pago' ? html`${data(p.data_pagamento)} · ${brl(p.valor_recebido)}${p.observacao ? html`<span class="sub">${p.observacao}</span>` : ''}` : '—'}</td>
        <td class="acoes-td">
          ${p.status === 'pendente' ? html`<button class="btn btn-primario btn-p" data-pagar="${p.id}">${raw(icon('check', 14))}Marcar como paga</button>` : ''}
          ${p.status === 'pago' ? html`<button class="btn btn-fantasma btn-p" data-desfazer="${p.id}" title="Desfazer pagamento">${raw(icon('undo', 14))}Desfazer</button>` : ''}
          ${p.status !== 'pago' ? html`<button class="btn-icone" data-editar="${p.id}" aria-label="Editar parcela ${p.numero}">${raw(icon('edit', 16))}</button>` : ''}
          ${p.status === 'pendente' ? html`<button class="btn-icone" data-cancelar="${p.id}" aria-label="Cancelar parcela ${p.numero}">${raw(icon('x', 16))}</button>` : ''}
        </td></tr>`)}</tbody></table></div>`
      : vazio({ titulo: 'Nenhuma parcela cadastrada', texto: Number(projeto.valor_final) > 0 ? 'Gere as parcelas a partir das condições comerciais ou crie manualmente.' : 'Defina o valor do projeto na aba Comercial para gerar as parcelas.' })}`);

  const atualizar = () => { emitir('dados-alterados'); if (aoMudar) aoMudar(); else renderParcelas(box, projeto); };
  const achar = (id) => lista.find((p) => p.id === id);

  box.onclick = async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-gerar')) {
      if (!(Number(projeto.valor_final) > 0)) return toast('Defina o valor do projeto na aba Comercial antes de gerar.', 'erro');
      if (ativas.length && !(await confirmar({ titulo: 'Gerar parcelas de novo?', mensagem: 'As parcelas pendentes atuais serão substituídas pelas condições do projeto.', confirmar: 'Gerar parcelas' }))) return;
      await comBotao(b, async () => {
        try { const n = await q(sb.rpc('gerar_parcelas', { p_projeto_id: projeto.id })); toast(`${n} parcela(s) geradas.`); atualizar(); }
        catch (e) { toastErro(e); }
      });
    }
    if (b.dataset.nova !== undefined) editarParcela(null, projeto, atualizar, lista);
    if (b.dataset.editar) editarParcela(achar(b.dataset.editar), projeto, atualizar, lista);
    if (b.dataset.pagar) marcarPaga(achar(b.dataset.pagar), atualizar);
    if (b.dataset.desfazer) {
      const p = achar(b.dataset.desfazer);
      if (!(await confirmar({ titulo: 'Desfazer pagamento', mensagem: `A parcela ${p.numero} voltará a ficar pendente e o recebimento de ${brl(p.valor_recebido)} será removido.`, confirmar: 'Desfazer pagamento', perigo: true }))) return;
      try { await q(sb.from('parcelas').update({ status: 'pendente', observacao: null }).eq('id', p.id)); toast('Pagamento desfeito.'); atualizar(); } catch (e) { toastErro(e); }
    }
    if (b.dataset.cancelar) {
      const p = achar(b.dataset.cancelar);
      if (!(await confirmar({ titulo: 'Cancelar parcela', mensagem: `A parcela ${p.numero} de ${brl(p.valor)} deixa de contar no financeiro e no forecast.`, confirmar: 'Cancelar parcela', perigo: true }))) return;
      try { await q(sb.from('parcelas').update({ status: 'cancelado' }).eq('id', p.id)); toast('Parcela cancelada.'); atualizar(); } catch (e) { toastErro(e); }
    }
  };
}

export function marcarPaga(p, aoConcluir) {
  const m = abrirModal({
    titulo: `Registrar pagamento · parcela ${p.numero}`, tamanho: 's',
    corpo: html`<form class="grade-2" novalidate>
      <label class="campo"><span>Data do pagamento</span><input type="date" name="data_pagamento" value="${hojeISO()}" required></label>
      <label class="campo"><span>Valor recebido (R$)</span><input name="valor_recebido" inputmode="decimal" value="${valorInput(p.valor)}" required></label>
      <label class="campo col-toda"><span>Forma de pagamento</span><select name="forma_pagamento">${opcoes(FORMAS_PAGAMENTO, p.forma_pagamento, 'Não informada')}</select></label>
      <label class="campo col-toda"><span>Observação</span><textarea name="observacao" rows="2" style="min-height:64px" maxlength="500"></textarea></label>
    </form>`,
    rodape: html`<button class="btn btn-secundario" data-fechar>Voltar</button><button class="btn btn-primario" data-salvar>Registrar pagamento</button>`
  });
  $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const f = $('form', m.el);
    const valor = parseValor(f.valor_recebido.value);
    if (!f.data_pagamento.value) return toast('Informe a data do pagamento.', 'erro');
    if (!Number.isFinite(valor) || valor < 0) return toast('Valor recebido inválido.', 'erro');
    try {
      await q(sb.from('parcelas').update({
        status: 'pago', data_pagamento: f.data_pagamento.value, valor_recebido: valor,
        forma_pagamento: f.forma_pagamento.value || null, observacao: f.observacao.value.trim() || null
      }).eq('id', p.id));
      toast('Pagamento registrado.'); m.fechar(); aoConcluir?.();
    } catch (e) { toastErro(e); }
  }));
}

function editarParcela(p, projeto, aoConcluir, lista) {
  const proximo = Math.max(0, ...lista.map((x) => x.numero)) + 1;
  const m = abrirModal({
    titulo: p ? `Editar parcela ${p.numero}` : 'Nova parcela', tamanho: 's',
    corpo: html`<form class="grade-2" novalidate>
      <label class="campo"><span>Número</span><input name="numero" type="number" min="1" value="${p?.numero ?? proximo}" required></label>
      <label class="campo"><span>Valor (R$)</span><input name="valor" inputmode="decimal" value="${valorInput(p?.valor)}" required></label>
      <label class="campo"><span>Vencimento</span><input type="date" name="vencimento" value="${p?.vencimento || hojeISO()}" required></label>
      <label class="campo"><span>Forma de pagamento</span><select name="forma_pagamento">${opcoes(FORMAS_PAGAMENTO, p?.forma_pagamento ?? projeto.forma_pagamento, 'Não informada')}</select></label>
    </form>`,
    rodape: html`<button class="btn btn-secundario" data-fechar>Voltar</button><button class="btn btn-primario" data-salvar>${p ? 'Salvar parcela' : 'Criar parcela'}</button>`
  });
  $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
    const f = $('form', m.el);
    const reg = { numero: parseInt(f.numero.value, 10), valor: parseValor(f.valor.value), vencimento: f.vencimento.value, forma_pagamento: f.forma_pagamento.value || null };
    if (!(reg.numero >= 1)) return toast('Número da parcela inválido.', 'erro');
    if (!(reg.valor > 0)) return toast('Informe um valor maior que zero.', 'erro');
    if (!reg.vencimento) return toast('Informe o vencimento.', 'erro');
    try {
      if (p) await q(sb.from('parcelas').update(reg).eq('id', p.id));
      else await q(sb.from('parcelas').insert({ ...reg, projeto_id: projeto.id }));
      toast(p ? 'Parcela salva.' : 'Parcela criada.'); m.fechar(); aoConcluir?.();
    } catch (e) { toastErro(e); }
  }));
}
