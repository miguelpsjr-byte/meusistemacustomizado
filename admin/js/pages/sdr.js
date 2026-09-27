// SDR: prospecção das clínicas de estética.
// Hoje (rascunhos para aprovar + tarefas manuais), Respostas, Clínicas e Cliente oculto.
// Todos os dados passam por /api/sdr (o schema "sdr" só é acessível com a chave secreta no servidor).
import { api } from '../core/supabase.js';
import { html, raw, mount, $, $$, dataHora, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro, comBotao, plural, num, lerForm } from '../core/ui.js';
import { icon } from '../core/icons.js';

const ABAS = [['hoje', 'Hoje'], ['respostas', 'Respostas'], ['clinicas', 'Clínicas'], ['oculto', 'Cliente oculto']];
const CANAL = {
  email: ['E-mail', 'mail'], whatsapp_manual: ['WhatsApp', 'phone'], instagram_manual: ['Instagram', 'user'],
  ligacao: ['Ligação', 'phone'], tarefa: ['Tarefa', 'check']
};
const STATUS = {
  novo: ['Novo', 'neutro'], enriquecido: ['Pronta', 'neutro'], em_cadencia: ['Em cadência', 'laranja'], respondeu: ['Respondeu', 'alerta'],
  interessado: ['Interessada', 'ok'], reuniao: ['Reunião', 'ok'], ganho: ['Cliente', 'ok'], perdido: ['Perdida', 'apagado'],
  descartado: ['Descartada', 'apagado'], opt_out: ['Opt-out', 'erro']
};
const CLASSIFICACAO = {
  interessado: ['Interessada', 'ok'], duvida: ['Dúvida', 'alerta'], agora_nao: ['Agora não', 'neutro'], nao_quero: ['Sem interesse', 'erro'],
  resposta_automatica: ['Automática', 'apagado'], fora_do_escopo: ['Fora do assunto', 'apagado']
};
// Quadro (Kanban) das clínicas: as colunas vêm do status que o SDR já grava, então a automação e o arrasto andam juntos.
const COLUNAS = [
  { k: 'contactar', t: 'Contactar', cor: '#94A3B8', sub: 'Ainda sem o primeiro contato' },
  { k: 'aguardando', t: 'Aguardando resposta', cor: '#F59E0B', sub: 'Abordadas, na cadência' },
  { k: 'atendimento', t: 'Em atendimento', cor: '#F97316', sub: 'Responderam, em conversa' },
  { k: 'ganho', t: 'Ganho', cor: '#16A34A', sub: 'Viraram clientes' },
  { k: 'perdido', t: 'Perdido', cor: '#DC2626', sub: 'Não fecharam' }
];
const BLOQUEADOS = ['ganho', 'perdido', 'descartado', 'opt_out'];
function colunaDe(e) {
  const i = (e.inscricoes || []).find((x) => x.status === 'ativa') || (e.inscricoes || [])[0];
  if (['novo', 'enriquecido'].includes(e.status)) return 'contactar';
  if (e.status === 'em_cadencia') return i && i.status === 'ativa' && Number(i.passo_atual) <= 1 ? 'contactar' : 'aguardando';
  if (['respondeu', 'interessado', 'reuniao'].includes(e.status)) return 'atendimento';
  return e.status === 'ganho' ? 'ganho' : 'perdido';
}
const lerVisao = () => { try { return localStorage.getItem('sdr-visao') === 'lista' ? 'lista' : 'quadro'; } catch { return 'quadro'; } };
const gravarVisao = (v) => { try { localStorage.setItem('sdr-visao', v); } catch { /* sem armazenamento: fica só nesta sessão */ } };

const FUNIL = [['em_cadencia', 'Em cadência'], ['respondeu', 'Responderam'], ['interessado', 'Interessadas'], ['reuniao', 'Reunião'], ['ganho', 'Clientes']];

const badge = (map, k) => { const [t, tom] = map[k] || [k, 'neutro']; return html`<span class="badge badge-${tom}">${t}</span>`; };
const digitos = (t) => String(t || '').replace(/\D/g, '');
const celular = (t) => { const d = digitos(t); return d.length === 13 && d[4] === '9'; };
const linkWhats = (tel, txt) => `https://wa.me/${digitos(tel)}${txt ? `?text=${encodeURIComponent(txt)}` : ''}`;
const linkInsta = (u) => `https://instagram.com/${String(u || '').replace(/^@/, '')}`;
const nomeCurto = (n) => String(n || '').replace(/\s+-\s+(Balneário Camboriú|Itajaí|Estética Avançada)$/i, '');

export async function render(view, params) {
  let aba = ABAS.some(([k]) => k === params[0]) ? params[0] : 'hoje';
  let dados = null;
  let filtro = { texto: '', prioridade: '', status: '' };
  let visao = lerVisao();
  let mostrarDescartadas = false;
  const selecionadas = new Set();

  mount(view, html`
    <div class="pagina-topo">
      <div><h1>SDR</h1><p>Prospecção das clínicas de estética de Balneário Camboriú e Itajaí.</p></div>
      <div class="acoes">
        <button class="btn btn-secundario" data-ler>${raw(icon('mail', 16))}Ler respostas</button>
        <button class="btn btn-primario" data-gerar>${raw(icon('sparkles', 16))}Gerar rascunhos</button>
      </div>
    </div>
    <div data-avisos></div>
    <section class="kpis kpis-5 sdr-kpis" aria-label="Indicadores">${carregando()}</section>
    <nav class="abas" role="tablist" style="margin-top:20px">${ABAS.map(([k, t]) => html`<button role="tab" data-aba="${k}" aria-selected="${k === aba}">${t}<span class="aba-num" data-num="${k}"></span></button>`)}</nav>
    <div data-conteudo>${carregando()}</div>`);

  const conteudo = $('[data-conteudo]', view);

  async function carregar() {
    try {
      dados = await api('/api/sdr', { acao: 'painel' });
      desenharTopo();
      desenharAba();
    } catch (e) { mount(conteudo, erroBox(e)); mount($('.sdr-kpis', view), ''); }
  }

  // ---------- Topo: avisos de configuração, indicadores e funil ----------
  function desenharTopo() {
    const { config, envio, pendentes, fila, respostas, empresas, funil } = dados;
    const avisos = [];
    if (!config.smtp) avisos.push('Faltam SMTP_USER e SMTP_PASS na Vercel: sem elas nada é enviado nem lido.');
    if (!config.ia) avisos.push('Falta OPENAI_API_KEY na Vercel: sem ela os rascunhos não são gerados.');
    mount($('[data-avisos]', view), avisos.map((a) => html`<div class="aviso" role="alert" style="margin-bottom:12px">${raw(icon('alert', 16))}<span>${a}</span></div>`));

    const emails = pendentes.filter((m) => m.canal === 'email').length;
    const manuais = pendentes.length - emails;
    const semTexto = fila.filter((f) => !f.mensagem_id).length;
    const novas = respostas.filter((r) => Date.now() - new Date(r.recebido_em || r.created_at) < 7 * 864e5 && !['resposta_automatica', 'fora_do_escopo'].includes(r.classificacao)).length;
    const conta = (st) => funil.filter((f) => f.status === st).reduce((a, f) => a + f.empresas, 0);
    const card = (ic, titulo, valor, sub, destino, extra = '') => html`<button class="kpi ${extra}" data-ir="${destino}">
      <span class="kpi-topo"><span class="kpi-icone">${raw(icon(ic, 16))}</span>${titulo}</span>
      <span class="kpi-valor">${valor}</span><span class="kpi-sub">${sub}</span></button>`;
    mount($('.sdr-kpis', view), html`
      ${card('mail', 'E-mails para aprovar', num(emails), `${envio.hoje} de ${envio.limite} enviados hoje`, 'hoje', emails ? 'kpi-destaque' : '')}
      ${card('phone', 'Tarefas manuais', num(manuais), 'WhatsApp, Instagram e ligação', 'hoje', manuais ? 'kpi-destaque' : '')}
      ${card('clock', 'Na fila de hoje', num(fila.length), semTexto ? `${semTexto} sem texto ainda` : 'tudo com texto pronto', 'hoje')}
      ${card('history', 'Respostas (7 dias)', num(novas), `${conta('interessado') + conta('reuniao')} interessada(s) no total`, 'respostas')}
      ${card('check', 'Em cadência', num(conta('em_cadencia')), `${plural(empresas.length, 'clínica', 'clínicas')} na base`, 'clinicas')}`);

    const n = { hoje: pendentes.length || '', respostas: novas || '', clinicas: '', oculto: '' };
    $$('[data-num]', view).forEach((el) => { el.textContent = n[el.dataset.num] ? ` · ${n[el.dataset.num]}` : ''; });
  }

  function desenharAba() {
    $$('.abas [data-aba]', view).forEach((b) => b.setAttribute('aria-selected', b.dataset.aba === aba));
    if (aba === 'hoje') return abaHoje();
    if (aba === 'respostas') return abaRespostas();
    if (aba === 'clinicas') return abaClinicas();
    if (aba === 'oculto') return abaOculto();
  }

  // ---------- Hoje ----------
  function abaHoje() {
    const { pendentes, fila } = dados;
    const semTexto = fila.filter((f) => !f.mensagem_id);
    if (!pendentes.length && !semTexto.length) {
      mount(conteudo, html`<section class="painel">${vazio({ titulo: 'Nada para hoje', texto: 'A rotina das 8h gera os rascunhos dos dias úteis. Para começar, vá em Clínicas, selecione as clínicas e clique em "Inscrever na cadência".' })}</section>`);
      return;
    }
    const ordenar = (a, b) => (a.canal === 'email') - (b.canal === 'email') || String(a.empresas?.prioridade).localeCompare(String(b.empresas?.prioridade));
    mount(conteudo, html`
      ${semTexto.length ? html`<div class="aviso aviso-neutro" style="margin-bottom:14px">${raw(icon('sparkles', 16))}<span>${plural(semTexto.length, 'clínica está', 'clínicas estão')} na fila sem texto: ${semTexto.map((f) => nomeCurto(f.nome)).join(', ')}. Clique em "Gerar rascunhos".</span></div>` : ''}
      <div class="sdr-cards">${[...pendentes].sort(ordenar).map(cartaoMensagem)}</div>`);
  }

  function cartaoMensagem(m) {
    const e = m.empresas || {};
    const [canalTxt, canalIc] = CANAL[m.canal] || [m.canal, 'check'];
    const passo = m.cadencia_passos ? `Toque ${m.cadencia_passos.ordem} · D${m.cadencia_passos.dia}` : '';
    const ehEmail = m.canal === 'email';
    const tel = m.para && digitos(m.para).length >= 10 ? m.para : (e.whatsapp || e.telefone);
    return html`<article class="painel sdr-msg" data-msg="${m.id}">
      <header class="sdr-msg-topo">
        <div><b>${nomeCurto(e.nome)}</b> <span class="prio-sdr prio-${e.prioridade}">${e.prioridade}</span>
          <span class="sub">${e.cidade || ''}${e.responsavel ? ` · ${e.responsavel}` : ''}</span></div>
        <div class="acoes"><span class="badge badge-neutro">${raw(icon(canalIc, 13))}${canalTxt}</span>${passo ? html`<span class="badge badge-neutro">${passo}</span>` : ''}
          ${m.status === 'aprovado' ? html`<span class="badge badge-alerta">Aprovado, aguardando limite do dia</span>` : ''}
          ${m.status === 'falhou' ? html`<span class="badge badge-erro" title="${m.erro || ''}">Falhou</span>` : ''}</div>
      </header>
      ${m.erro && m.status === 'falhou' ? html`<p class="sdr-erro">${m.erro}</p>` : ''}
      ${ehEmail ? html`<label class="campo"><span>Para</span><input name="para" type="email" value="${m.para || e.email || ''}"></label>
        <label class="campo"><span>Assunto</span><input name="assunto" value="${m.assunto || ''}" maxlength="200"></label>` : ''}
      <label class="campo"><span>${m.canal === 'ligacao' ? 'Roteiro da ligação' : 'Mensagem'}</span><textarea name="corpo" rows="${ehEmail ? 10 : 5}">${m.corpo || ''}</textarea></label>
      <footer class="sdr-msg-rodape">
        <div class="acoes">
          ${ehEmail ? html`<button class="btn btn-primario" data-aprovar>${raw(icon('check', 16))}Aprovar e enviar</button>`
            : m.canal === 'ligacao' ? html`${tel ? html`<a class="btn btn-secundario" href="tel:+${digitos(tel)}">${raw(icon('phone', 16))}Ligar ${tel}</a>` : ''}
                <button class="btn btn-primario" data-feito>${raw(icon('check', 16))}Registrar ligação</button>`
            : html`${m.canal !== 'instagram_manual' && tel && celular(tel) ? html`<button class="btn btn-secundario" data-whats="${tel}">${raw(icon('phone', 16))}Abrir no WhatsApp</button>` : ''}
                ${e.instagram ? html`<a class="btn btn-secundario" href="${linkInsta(e.instagram)}" target="_blank" rel="noopener">${raw(icon('user', 16))}${e.instagram}</a>` : ''}
                <button class="btn btn-secundario" data-copiar>Copiar texto</button>
                <button class="btn btn-primario" data-feito>${raw(icon('check', 16))}Marquei como enviado</button>`}
        </div>
        <div class="acoes">
          <button class="btn btn-fantasma btn-p" data-salvar>Salvar edição</button>
          <button class="btn btn-fantasma btn-p" data-regerar>${raw(icon('refresh', 14))}Refazer com IA</button>
          <button class="btn btn-fantasma btn-p" data-pular title="Não fazer este toque e seguir para o próximo">Pular toque</button>
          <button class="btn btn-fantasma btn-p btn-texto-perigo" data-descartar title="Apaga o texto; a IA gera outro na próxima rodada">Descartar</button>
        </div>
      </footer>
      ${!ehEmail && !e.email ? html`<p class="sub" style="margin-top:8px">Sem e-mail cadastrado: este toque sai por ${m.canal === 'instagram_manual' ? 'Instagram' : 'WhatsApp'}. Achou o e-mail? Cadastre em Clínicas e os próximos toques vão por e-mail.</p>` : ''}
    </article>`;
  }

  // ---------- Respostas ----------
  function abaRespostas() {
    const { respostas, historico } = dados;
    mount(conteudo, html`<div class="duas-colunas" style="margin-top:0">
      <section class="painel">
        <div class="painel-topo"><div><h2>Respostas recebidas</h2><p>Quem responde tem a cadência pausada na hora. Responda pelo seu e-mail normalmente.</p></div></div>
        ${respostas.length ? html`<ul class="lista sdr-respostas">${respostas.map((r) => html`<li data-empresa="${r.empresa_id}">
          <div class="principal-l"><b>${nomeCurto(r.empresas?.nome) || r.de}</b>
            <span>${dataHora(r.recebido_em || r.created_at)} · ${r.de || ''}</span>
            ${r.resumo_ia ? html`<p class="sdr-resumo">${r.resumo_ia}</p>` : ''}
            <details><summary>Ver resposta</summary><pre class="sdr-pre">${r.corpo || ''}</pre></details></div>
          <div class="acoes" style="flex-direction:column;align-items:flex-end">${badge(CLASSIFICACAO, r.classificacao)}${badge(STATUS, r.empresas?.status)}
            <button class="btn btn-secundario btn-p" data-abrir-empresa="${r.empresa_id}">Abrir clínica</button></div></li>`)}</ul>`
          : vazio({ titulo: 'Nenhuma resposta ainda', texto: 'A caixa é lida todo dia às 8h, ou quando você clica em "Ler respostas".' })}
      </section>
      <section class="painel">
        <div class="painel-topo"><div><h2>Enviados recentemente</h2></div></div>
        ${historico.length ? html`<ul class="lista">${historico.map((h) => html`<li><span class="kpi-icone">${raw(icon((CANAL[h.canal] || [, 'check'])[1], 14))}</span>
          <div class="principal-l"><b>${nomeCurto(h.empresas?.nome)}</b><span>${(CANAL[h.canal] || [h.canal])[0]}${h.assunto ? ` · ${h.assunto}` : ''} · ${dataHora(h.enviado_em)}</span></div></li>`)}</ul>`
          : html`<p class="sub">Nada enviado ainda.</p>`}
      </section></div>`);
  }

  // ---------- Clínicas ----------
  function abaClinicas() {
    const { empresas, funil } = dados;
    const conta = (st) => funil.filter((f) => f.status === st).reduce((a, f) => a + f.empresas, 0);
    mount(conteudo, html`
      <section class="painel" style="margin-bottom:16px">
        <div class="sdr-funil">${FUNIL.map(([k, t], i) => html`<div class="sdr-funil-etapa"><span>${t}</span><b>${conta(k)}</b>${i < FUNIL.length - 1 ? raw(icon('chevronRight', 16)) : ''}</div>`)}</div>
      </section>
      <section class="painel">
        <div class="filtros">
          <div class="segmentado" role="group" aria-label="Visualização">
            <button data-visao="quadro" aria-pressed="${visao === 'quadro'}">${raw(icon('kanban', 14))} Quadro</button>
            <button data-visao="lista" aria-pressed="${visao === 'lista'}">Lista</button>
          </div>
          <input class="entrada" type="search" placeholder="Buscar clínica" value="${filtro.texto}" data-f="texto" aria-label="Buscar clínica">
          <select class="entrada" data-f="prioridade" aria-label="Prioridade"><option value="">Todas as prioridades</option>${['A', 'B', 'C'].map((p) => html`<option ${filtro.prioridade === p ? raw('selected') : ''}>${p}</option>`)}</select>
          ${visao === 'lista'
            ? html`<select class="entrada" data-f="status" aria-label="Status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, [t]]) => html`<option value="${k}" ${filtro.status === k ? raw('selected') : ''}>${t}</option>`)}</select>`
            : html`<label class="check"><input type="checkbox" data-descartadas ${mostrarDescartadas ? raw('checked') : ''}>Mostrar descartadas e opt-out</label>`}
          <span style="flex:1"></span>
          ${visao === 'lista' ? html`<button class="btn btn-primario" data-inscrever disabled>${raw(icon('plus', 16))}Inscrever na cadência</button>`
            : html`<span class="sub sdr-dica">Arraste os cards entre as colunas. Soltar em "Aguardando resposta" inscreve na cadência.</span>`}
        </div>
        <div data-tabela></div>
      </section>`);
    desenharTabela();
  }

  function desenharTabela() {
    const box = $('[data-tabela]', conteudo); if (!box) return;
    if (visao === 'quadro') return desenharQuadro(box);
    const t = filtro.texto.toLowerCase();
    const lista = dados.empresas.filter((e) => (!t || e.nome.toLowerCase().includes(t)) && (!filtro.prioridade || e.prioridade === filtro.prioridade) && (!filtro.status || e.status === filtro.status));
    const inscrivel = (e) => !['opt_out', 'descartado', 'ganho', 'perdido'].includes(e.status) && !(e.inscricoes || []).length;
    for (const id of [...selecionadas]) if (!lista.some((e) => e.id === id && inscrivel(e))) selecionadas.delete(id);
    const insc = (e) => (e.inscricoes || [])[0];
    const oculto = (id) => dados.testes.find((x) => x.empresa_id === id);
    mount(box, lista.length ? html`<div class="tabela-wrap"><table class="tabela tabela-cards">
      <thead><tr><th style="width:32px"><input type="checkbox" data-todas aria-label="Selecionar todas"></th><th>Clínica</th><th>Contato</th><th>Google</th><th>Cadência</th><th>Cliente oculto</th><th>Status</th></tr></thead>
      <tbody>${lista.map((e) => { const i = insc(e); const o = oculto(e.id); return html`<tr class="clicavel" data-empresa="${e.id}">
        <td>${inscrivel(e) ? html`<input type="checkbox" data-sel="${e.id}" ${selecionadas.has(e.id) ? raw('checked') : ''} aria-label="Selecionar ${e.nome}">` : ''}</td>
        <td><b>${nomeCurto(e.nome)}</b> <span class="prio-sdr prio-${e.prioridade}">${e.prioridade}</span><span class="sub">${e.cidade}${e.porte === 'equipe' ? ' · equipe' : ' · solo'}</span></td>
        <td data-r="Contato"><span class="sdr-contatos">
          <span class="${e.email ? 'tem' : ''}" title="${e.email || 'Sem e-mail'}">${raw(icon('mail', 14))}</span>
          <span class="${e.whatsapp || e.telefone ? 'tem' : ''}" title="${e.whatsapp || e.telefone || 'Sem telefone'}">${raw(icon('phone', 14))}</span>
          <span class="${e.instagram ? 'tem' : ''}" title="${e.instagram || 'Sem Instagram'}">${raw(icon('user', 14))}</span></span></td>
        <td data-r="Google">${e.google_nota ?? '—'} ★ <span class="sub">${num(e.google_avaliacoes || 0)} avaliações</span></td>
        <td data-r="Cadência">${i ? html`${i.status === 'ativa' ? `Toque ${i.passo_atual}` : i.status}<span class="sub">${i.status === 'ativa' ? `próximo ${dataHora(i.proxima_acao_em).split(' —')[0]}` : (i.motivo_parada || '')}</span>` : html`<span class="sub">—</span>`}</td>
        <td data-r="Oculto">${o ? (o.primeira_resposta_em ? `${o.minutos_ate_resposta} min` : html`<span class="badge badge-erro">Sem resposta</span>`) : html`<span class="sub">não testado</span>`}</td>
        <td data-r="Status">${badge(STATUS, e.status)}</td></tr>`; })}</tbody></table></div>`
      : vazio({ titulo: 'Nenhuma clínica com esses filtros' }));
    atualizarBotaoInscrever();
  }
  // ---------- Clínicas em quadro (Kanban) ----------
  function desenharQuadro(box) {
    const t = filtro.texto.toLowerCase();
    const lista = dados.empresas.filter((e) => (!t || e.nome.toLowerCase().includes(t)) && (!filtro.prioridade || e.prioridade === filtro.prioridade)
      && (mostrarDescartadas || !['descartado', 'opt_out'].includes(e.status)));
    const proxima = (e) => { const i = (e.inscricoes || []).find((x) => x.status === 'ativa'); return i ? new Date(i.proxima_acao_em).getTime() : Infinity; };
    mount(box, html`<div class="kanban kanban-sdr" aria-label="Quadro das clínicas">${COLUNAS.map((c) => {
      let cards = lista.filter((e) => colunaDe(e) === c.k);
      if (c.k === 'aguardando' || c.k === 'contactar') cards = [...cards].sort((a, b) => String(a.prioridade).localeCompare(String(b.prioridade)) || proxima(a) - proxima(b));
      return html`<section class="coluna" data-coluna="${c.k}" aria-label="${c.t}">
        <header class="coluna-topo">
          <div class="coluna-titulo"><span class="bloco" style="background:${c.cor}"></span>${c.t}<span class="qtd">${cards.length}</span></div>
          <div class="coluna-total">${c.sub}</div>
        </header>
        <div class="coluna-cards">${cards.length ? cards.map(cartaoClinica) : html`<div class="coluna-vazia">Solte um card aqui</div>`}</div>
      </section>`;
    })}</div>`);
  }

  function cartaoClinica(e) {
    const i = (e.inscricoes || []).find((x) => x.status === 'ativa') || (e.inscricoes || [])[0];
    const o = dados.testes.find((x) => x.empresa_id === e.id);
    const fixo = e.status === 'opt_out';
    const cad = i ? (i.status === 'ativa' ? `Toque ${i.passo_atual} · ${dataHora(i.proxima_acao_em).split(' —')[0]}` : `Cadência ${i.status}`) : 'Fora da cadência';
    return html`<article class="card sdr-card" ${fixo ? '' : raw('draggable="true"')} data-empresa="${e.id}" tabindex="0" aria-label="${nomeCurto(e.nome)}, ${(STATUS[e.status] || [e.status])[0]}">
      <div class="card-topo">
        <div class="tit"><b>${nomeCurto(e.nome)}</b><span class="empresa">${e.cidade || ''}${e.porte === 'equipe' ? ' · equipe' : e.porte ? ' · solo' : ''}</span></div>
        ${fixo ? '' : html`<button class="btn-icone card-mover" data-mover-clinica aria-label="Mover para outra coluna" title="Mover para outra coluna">${raw(icon('move', 16))}</button>`}
      </div>
      <div class="card-linha"><span class="sdr-contatos">
        <span class="${e.email ? 'tem' : ''}" title="${e.email || 'Sem e-mail'}">${raw(icon('mail', 13))}</span>
        <span class="${e.whatsapp || e.telefone ? 'tem' : ''}" title="${e.whatsapp || e.telefone || 'Sem telefone'}">${raw(icon('phone', 13))}</span>
        <span class="${e.instagram ? 'tem' : ''}" title="${e.instagram || 'Sem Instagram'}">${raw(icon('user', 13))}</span></span>
        <span style="margin-left:auto">${e.google_nota ?? '—'} ★ (${num(e.google_avaliacoes || 0)})</span></div>
      <div class="card-linha">${raw(icon('history', 13))}${cad}</div>
      ${o ? html`<div class="card-linha">${raw(icon('clock', 13))}Cliente oculto: ${o.primeira_resposta_em ? `${o.minutos_ate_resposta} min` : 'sem resposta'}</div>` : ''}
      <div class="card-rodape"><span class="prio-sdr prio-${e.prioridade}">${e.prioridade}</span>${badge(STATUS, e.status)}</div>
    </article>`;
  }

  // Leva a clínica para a coluna escolhida, usando as mesmas ações do SDR.
  async function moverClinica(id, destino) {
    const e = dados.empresas.find((x) => x.id === id);
    if (!e || e.status === 'opt_out') return;
    const origem = colunaDe(e);
    if (origem === destino) return;
    const post = (corpo) => api('/api/sdr', corpo);
    const i = (e.inscricoes || [])[0];
    try {
      if (destino === 'contactar') {
        await post({ acao: 'status_empresa', empresa_id: e.id, status: 'enriquecido' });
        toast(`${nomeCurto(e.nome)} voltou para Contactar${i?.status === 'ativa' ? ' (cadência pausada)' : ''}.`);
      } else if (destino === 'aguardando') {
        if (e.status === 'em_cadencia' && i?.status === 'ativa') {
          toast('Ela passa para "Aguardando resposta" assim que o primeiro toque for enviado (aba Hoje).', 'erro'); return;
        }
        if (!(e.inscricoes || []).length) {
          if (!(await confirmar({ titulo: 'Inscrever na cadência?', mensagem: `${nomeCurto(e.nome)} entra na cadência de 14 dias a partir do próximo dia útil. ${e.email ? '' : 'Sem e-mail: os toques de e-mail viram tarefas de WhatsApp/Instagram. '}Nada sai sem a sua aprovação.`, confirmar: 'Inscrever' }))) return;
          if (BLOQUEADOS.includes(e.status)) await post({ acao: 'status_empresa', empresa_id: e.id, status: 'enriquecido' });
          const r = await post({ acao: 'inscrever', empresa_ids: [e.id] });
          if (r.falhas?.length) throw new Error(r.falhas[0].erro);
          toast(`${nomeCurto(e.nome)} inscrita na cadência.`);
        } else {
          await post({ acao: 'status_empresa', empresa_id: e.id, status: 'em_cadencia' });
          toast(`${nomeCurto(e.nome)} em Aguardando resposta${i?.status === 'pausada' ? ' (cadência retomada)' : ''}.`);
        }
      } else if (destino === 'atendimento') {
        await post({ acao: 'status_empresa', empresa_id: e.id, status: 'interessado' });
        toast(`${nomeCurto(e.nome)} em atendimento. A cadência automática foi pausada.`);
      } else if (destino === 'ganho') {
        await post({ acao: 'status_empresa', empresa_id: e.id, status: 'ganho' });
        toast(`${nomeCurto(e.nome)} virou cliente!`);
      } else if (destino === 'perdido') {
        const motivo = await pedirMotivoPerda(e);
        if (motivo === null) return;
        await post({ acao: 'status_empresa', empresa_id: e.id, status: 'perdido', motivo: motivo || undefined });
        toast(`${nomeCurto(e.nome)} marcada como perdida.`);
      }
      await carregar();
    } catch (er) { toastErro(er); }
  }

  // Resolve com o motivo (pode ser vazio) ou null se cancelar.
  function pedirMotivoPerda(e) {
    return new Promise((resolve) => {
      const md = abrirModal({ titulo: `Perdida · ${nomeCurto(e.nome)}`, tamanho: 's',
        corpo: html`<label class="campo"><span>Motivo (opcional)</span><input name="motivo" maxlength="300" placeholder="Ex.: já tem sistema, sem orçamento agora"></label>`,
        rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-ok>Marcar como perdida</button>`,
        aoFechar: (v) => resolve(v === undefined ? null : v) });
      md.el.querySelector('[data-ok]').addEventListener('click', () => md.fechar(md.el.querySelector('[name=motivo]').value.trim()));
    });
  }

  function menuMoverClinica(botao, id) {
    document.querySelector('.menu-mover')?.remove();
    const e = dados.empresas.find((x) => x.id === id); if (!e) return;
    const atual = colunaDe(e);
    const menu = document.createElement('div');
    menu.className = 'popover menu-mover'; menu.setAttribute('role', 'menu');
    mount(menu, html`<div class="notif-topo" style="padding:8px 10px"><b>Mover para</b></div>
      ${COLUNAS.map((c) => html`<button class="menu-item" role="menuitem" data-destino="${c.k}" ${c.k === atual ? raw('disabled aria-current="true"') : ''}>
        <span class="cor-amostra" style="background:${c.cor}"></span>${c.t}${c.k === atual ? ' (atual)' : ''}</button>`)}`);
    document.body.appendChild(menu);
    const r = botao.getBoundingClientRect();
    menu.style.top = `${Math.min(r.bottom + 6, innerHeight - menu.offsetHeight - 8)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8))}px`;
    $('[data-destino]:not([disabled])', menu)?.focus();
    const fechar = () => { menu.remove(); document.removeEventListener('mousedown', fora, true); document.removeEventListener('keydown', esc); };
    const fora = (ev) => { if (!menu.contains(ev.target)) fechar(); };
    const esc = (ev) => { if (ev.key === 'Escape') { fechar(); botao.focus(); } };
    document.addEventListener('mousedown', fora, true); document.addEventListener('keydown', esc);
    menu.addEventListener('click', (ev) => { const b = ev.target.closest('[data-destino]'); if (b) { fechar(); moverClinica(id, b.dataset.destino); } });
  }

  // Arrastar e soltar (registrado uma vez; o quadro é redesenhado dentro de "conteudo")
  let arrastando = null;
  conteudo.addEventListener('dragstart', (ev) => {
    const c = ev.target.closest?.('.sdr-card'); if (!c) return;
    arrastando = c.dataset.empresa; c.classList.add('arrastando');
    ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', arrastando);
  });
  conteudo.addEventListener('dragend', (ev) => { ev.target.closest?.('.sdr-card')?.classList.remove('arrastando'); $$('.coluna.alvo', conteudo).forEach((x) => x.classList.remove('alvo')); arrastando = null; });
  conteudo.addEventListener('dragover', (ev) => {
    const col = ev.target.closest?.('.kanban-sdr .coluna'); if (!col || !arrastando) return;
    ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
    $$('.coluna.alvo', conteudo).forEach((x) => x !== col && x.classList.remove('alvo'));
    col.classList.add('alvo');
  });
  conteudo.addEventListener('dragleave', (ev) => { const col = ev.target.closest?.('.kanban-sdr .coluna'); if (col && !col.contains(ev.relatedTarget)) col.classList.remove('alvo'); });
  conteudo.addEventListener('drop', (ev) => {
    const col = ev.target.closest?.('.kanban-sdr .coluna'); if (!col) return;
    ev.preventDefault(); col.classList.remove('alvo');
    const id = ev.dataTransfer.getData('text/plain') || arrastando;
    if (id) moverClinica(id, col.dataset.coluna);
  });
  conteudo.addEventListener('keydown', (ev) => {
    const c = ev.target.closest?.('.sdr-card'); if (!c || ev.target !== c) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); modalEmpresa(c.dataset.empresa); }
    if ((ev.key === 'm' || ev.key === 'M') && $('[data-mover-clinica]', c)) { ev.preventDefault(); menuMoverClinica($('[data-mover-clinica]', c), c.dataset.empresa); }
  });

  function atualizarBotaoInscrever() {
    const b = $('[data-inscrever]', conteudo); if (!b) return;
    b.disabled = !selecionadas.size;
    b.innerHTML = `${icon('plus', 16)}Inscrever${selecionadas.size ? ` ${selecionadas.size}` : ''} na cadência`;
  }

  // ---------- Cliente oculto ----------
  function abaOculto() {
    const alvo = dados.empresas.filter((e) => e.prioridade === 'A' || dados.testes.some((t) => t.empresa_id === e.id));
    const ultimo = (id) => dados.testes.find((t) => t.empresa_id === id);
    const sim = (v) => (v === true ? 'Sim' : v === false ? 'Não' : '—');
    const feitos = alvo.filter((e) => ultimo(e.id)).length;
    mount(conteudo, html`<section class="painel">
      <div class="painel-topo"><div><h2>Teste de cliente oculto</h2>
        <p>Mande "Oi, quanto custa o botox?" (ou o procedimento carro-chefe) como paciente comum e registre aqui. O resultado vira o gancho do primeiro e-mail. ${feitos} de ${alvo.length} testadas.</p></div></div>
      <div class="tabela-wrap"><table class="tabela tabela-cards">
        <thead><tr><th>Clínica</th><th>Canal</th><th>Enviado</th><th class="num">Tempo de resposta</th><th>Passou preço</th><th>Voltou a chamar (D3/D7)</th><th></th></tr></thead>
        <tbody>${alvo.map((e) => { const t = ultimo(e.id); return html`<tr>
          <td><b>${nomeCurto(e.nome)}</b><span class="sub">${e.whatsapp || e.telefone || e.instagram || ''}</span></td>
          <td data-r="Canal">${t?.canal || '—'}</td>
          <td data-r="Enviado">${t ? dataHora(t.enviado_em) : '—'}</td>
          <td class="num" data-r="Resposta">${t ? (t.primeira_resposta_em ? `${t.minutos_ate_resposta} min` : html`<span class="badge badge-erro">Não respondeu</span>`) : '—'}</td>
          <td data-r="Preço">${sim(t?.passou_preco)}</td>
          <td data-r="Follow-up">${t ? `${sim(t.followup_d3)} / ${sim(t.followup_d7)}` : '—'}</td>
          <td class="acoes-td"><button class="btn btn-secundario btn-p" data-oculto="${e.id}" data-teste="${t?.id || ''}">${t ? 'Editar' : 'Registrar'}</button></td></tr>`; })}</tbody></table></div></section>`);
  }

  // ---------- Modais ----------
  function modalOculto(empresaId, testeId) {
    const e = dados.empresas.find((x) => x.id === empresaId);
    const t = dados.testes.find((x) => x.id === testeId) || {};
    const local = (ts) => (ts ? new Date(new Date(ts).getTime() - 3 * 3600e3).toISOString().slice(0, 16) : '');
    const tri = (nome, v) => html`<select name="${nome}">${[['', 'Não sei ainda'], ['true', 'Sim'], ['false', 'Não']].map(([k, txt]) => html`<option value="${k}" ${String(v ?? '') === k ? raw('selected') : ''}>${txt}</option>`)}</select>`;
    const m = abrirModal({
      titulo: `Cliente oculto · ${nomeCurto(e.nome)}`,
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo"><span>Canal</span><select name="canal">${['whatsapp', 'instagram', 'telefone', 'site'].map((c) => html`<option ${t.canal === c ? raw('selected') : ''}>${c}</option>`)}</select></label>
        <span></span>
        <label class="campo"><span>Quando você mandou a mensagem</span><input type="datetime-local" name="enviado_em" value="${local(t.enviado_em)}" required></label>
        <label class="campo"><span>Quando responderam (vazio = não responderam)</span><input type="datetime-local" name="primeira_resposta_em" value="${local(t.primeira_resposta_em)}"></label>
        <label class="campo"><span>Passaram o preço?</span>${tri('passou_preco', t.passou_preco)}</label>
        <span></span>
        <label class="campo"><span>Voltaram a chamar em 3 dias?</span>${tri('followup_d3', t.followup_d3)}</label>
        <label class="campo"><span>Voltaram a chamar em 7 dias?</span>${tri('followup_d7', t.followup_d7)}</label>
        <label class="campo col-toda"><span>Observações</span><textarea name="notas" rows="3">${t.notas || ''}</textarea></label>
      </form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-ok>Salvar</button>`
    });
    m.el.querySelector('[data-ok]').addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const f = lerForm(m.el.querySelector('form'));
      const bool = (v) => (v === 'true' ? true : v === 'false' ? false : null);
      const iso = (v) => (v ? new Date(`${v}:00-03:00`).toISOString() : null);
      try {
        await api('/api/sdr', { acao: 'teste_oculto', id: testeId || undefined, empresa_id: empresaId, canal: f.canal, enviado_em: iso(f.enviado_em), primeira_resposta_em: iso(f.primeira_resposta_em),
          passou_preco: bool(f.passou_preco), followup_d3: bool(f.followup_d3), followup_d7: bool(f.followup_d7), notas: f.notas });
        toast('Teste registrado.'); m.fechar(); carregar();
      } catch (er) { toastErro(er); }
    }));
  }

  function modalEmpresa(empresaId) {
    const e = dados.empresas.find((x) => x.id === empresaId);
    if (!e) return;
    const i = (e.inscricoes || [])[0];
    const conversa = [...dados.respostas.filter((r) => r.empresa_id === e.id), ...dados.historico.filter((h) => h.empresa_id === e.id)];
    const m = abrirModal({
      titulo: nomeCurto(e.nome), tamanho: 'l',
      corpo: html`<div class="sdr-empresa-topo">${badge(STATUS, e.status)} <span class="prio-sdr prio-${e.prioridade}">${e.prioridade}</span>
          <span class="sub">${e.cidade} · ${e.endereco || ''} · ${e.google_nota ?? '—'} ★ (${e.google_avaliacoes || 0})</span></div>
        ${e.dor_observada ? html`<p class="aviso aviso-neutro" style="margin:10px 0">${raw(icon('alert', 16))}<span>${e.dor_observada}</span></p>` : ''}
        <form class="grade-2" novalidate style="margin-top:12px">
          <label class="campo"><span>E-mail</span><input name="email" type="email" value="${e.email || ''}" placeholder="contato@clinica.com.br"></label>
          <label class="campo"><span>WhatsApp</span><input name="whatsapp" value="${e.whatsapp || ''}" placeholder="+55 47 9…"></label>
          <label class="campo"><span>Instagram</span><input name="instagram" value="${e.instagram || ''}" placeholder="@clinica"></label>
          <label class="campo"><span>Site</span><input name="site" value="${e.site || ''}"></label>
          <label class="campo"><span>Responsável</span><input name="responsavel" value="${e.responsavel || ''}"></label>
          <label class="campo"><span>Prioridade</span><select name="prioridade">${['A', 'B', 'C'].map((p) => html`<option ${e.prioridade === p ? raw('selected') : ''}>${p}</option>`)}</select></label>
          <label class="campo col-toda"><span>Gancho (frase de abertura que a IA deve usar)</span><input name="gancho" value="${e.gancho || ''}" placeholder="Ex.: Mandei mensagem no WhatsApp de vocês na terça e só tive resposta no dia seguinte."></label>
          <label class="campo col-toda"><span>Fato verificável</span><input name="fato" value="${e.fato || ''}"></label>
          <label class="campo col-toda"><span>Notas</span><textarea name="notas" rows="3">${e.notas || ''}</textarea></label>
        </form>
        ${(e.procedimentos || []).length ? html`<p class="sdr-procs">Procedimentos: ${e.procedimentos.join(', ')}</p>` : ''}
        <div class="acoes" style="margin-top:12px">
          ${e.site ? html`<button class="btn btn-secundario btn-p" data-enriquecer>${raw(icon('search', 14))}Procurar e-mail no site</button>` : ''}
          ${e.whatsapp && celular(e.whatsapp) ? html`<a class="btn btn-secundario btn-p" href="${linkWhats(e.whatsapp)}" target="_blank" rel="noopener">${raw(icon('phone', 14))}WhatsApp</a>` : ''}
          ${e.instagram ? html`<a class="btn btn-secundario btn-p" href="${linkInsta(e.instagram)}" target="_blank" rel="noopener">${raw(icon('user', 14))}Instagram</a>` : ''}
          ${e.site ? html`<a class="btn btn-secundario btn-p" href="${e.site}" target="_blank" rel="noopener">Site</a>` : ''}
        </div>
        <h3 class="sdr-h3">Cadência</h3>
        <p>${i ? html`${i.status === 'ativa' ? `Ativa, toque ${i.passo_atual}, próximo em ${dataHora(i.proxima_acao_em)}` : `${i.status}${i.motivo_parada ? ` (${i.motivo_parada})` : ''}`}` : 'Não inscrita.'}</p>
        <div class="acoes" style="margin-top:8px">
          ${i?.status === 'ativa' ? html`<button class="btn btn-secundario btn-p" data-pausar="${i.id}">Pausar</button>` : ''}
          ${i?.status === 'pausada' ? html`<button class="btn btn-secundario btn-p" data-retomar="${i.id}">Retomar cadência</button>` : ''}
          ${!i && !['opt_out', 'descartado', 'ganho', 'perdido'].includes(e.status) ? html`<button class="btn btn-secundario btn-p" data-inscrever-uma>Inscrever</button>` : ''}
          <select class="entrada" data-mudar-status style="width:auto;padding:6px 10px;font-size:13px" aria-label="Mudar status">
            <option value="">Mudar status…</option>${['interessado', 'reuniao', 'ganho', 'perdido', 'descartado'].map((s) => html`<option value="${s}">${STATUS[s][0]}</option>`)}</select>
          ${e.status !== 'opt_out' ? html`<button class="btn btn-fantasma btn-p btn-texto-perigo" data-optout>Pediu para sair (opt-out)</button>` : ''}
        </div>
        ${conversa.length ? html`<h3 class="sdr-h3">Histórico</h3><ul class="lista">${conversa.sort((a, b) => new Date(b.recebido_em || b.enviado_em) - new Date(a.recebido_em || a.enviado_em)).map((c) => html`<li>
          <div class="principal-l"><b>${c.direcao === 'entrada' ? 'Resposta' : (CANAL[c.canal] || [c.canal])[0]}${c.assunto ? ` · ${c.assunto}` : ''}</b><span>${dataHora(c.recebido_em || c.enviado_em)}${c.resumo_ia ? ` · ${c.resumo_ia}` : ''}</span></div></li>`)}</ul>` : ''}`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Fechar</button><button class="btn btn-primario" data-ok>Salvar</button>`
    });
    const acao = async (btn, corpo, ok) => comBotao(btn, async () => {
      try { const r = await api('/api/sdr', corpo); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); m.fechar(); carregar(); } catch (er) { toastErro(er); }
    });
    m.el.querySelector('[data-ok]').addEventListener('click', (ev) => acao(ev.currentTarget, { acao: 'salvar_empresa', empresa_id: e.id, campos: lerForm(m.el.querySelector('form')) }, 'Clínica salva.'));
    m.el.querySelector('[data-enriquecer]')?.addEventListener('click', (ev) => acao(ev.currentTarget, { acao: 'enriquecer', empresa_id: e.id },
      (r) => (r.alterado ? `Encontrado: ${Object.values(r.salvo).filter((v) => typeof v === 'string' && !v.includes('T')).join(', ')}` : (r.motivo || 'Nada novo no site.'))));
    m.el.querySelector('[data-pausar]')?.addEventListener('click', (ev) => acao(ev.currentTarget, { acao: 'pausar', inscricao_id: ev.currentTarget.dataset.pausar }, 'Cadência pausada.'));
    m.el.querySelector('[data-retomar]')?.addEventListener('click', (ev) => acao(ev.currentTarget, { acao: 'retomar', inscricao_id: ev.currentTarget.dataset.retomar }, 'Cadência retomada.'));
    m.el.querySelector('[data-inscrever-uma]')?.addEventListener('click', (ev) => acao(ev.currentTarget, { acao: 'inscrever', empresa_ids: [e.id] }, 'Clínica inscrita.'));
    m.el.querySelector('[data-mudar-status]')?.addEventListener('change', async (ev) => {
      const st = ev.target.value; if (!st) return;
      try { await api('/api/sdr', { acao: 'status_empresa', empresa_id: e.id, status: st }); toast(`Status: ${STATUS[st][0]}.`); m.fechar(); carregar(); } catch (er) { toastErro(er); }
    });
    m.el.querySelector('[data-optout]')?.addEventListener('click', async (ev) => {
      if (!(await confirmar({ titulo: 'Registrar opt-out', mensagem: `${nomeCurto(e.nome)} não recebe mais nenhuma mensagem da prospecção. Isso não pode ser desfeito pela tela.`, confirmar: 'Registrar opt-out', perigo: true }))) return;
      acao(ev.currentTarget, { acao: 'optout', empresa_id: e.id }, 'Opt-out registrado.');
    });
  }

  // ---------- Eventos ----------
  view.addEventListener('click', async (ev) => {
    const alvo = ev.target;
    const abaBtn = alvo.closest('.abas [data-aba]');
    if (abaBtn) { aba = abaBtn.dataset.aba; history.replaceState(null, '', `#/sdr/${aba}`); return desenharAba(); }
    const ir = alvo.closest('[data-ir]');
    if (ir) { aba = ir.dataset.ir; history.replaceState(null, '', `#/sdr/${aba}`); return desenharAba(); }

    if (alvo.closest('[data-gerar]')) {
      return comBotao(alvo.closest('[data-gerar]'), async () => {
        try {
          const r = await api('/api/sdr', { acao: 'gerar', max: 8 });
          toast(r.gerados ? `${plural(r.gerados, 'rascunho gerado', 'rascunhos gerados')}.` : 'Nada novo para gerar.');
          if (r.falhas?.length) toast(r.falhas[0].erro, 'erro');
          aba = 'hoje'; await carregar();
        } catch (e) { toastErro(e); }
      });
    }
    if (alvo.closest('[data-ler]')) {
      return comBotao(alvo.closest('[data-ler]'), async () => {
        try { const r = await api('/api/sdr', { acao: 'ler_respostas' }); toast(r.novas ? `${plural(r.novas, 'resposta nova', 'respostas novas')}${r.interessados ? `, ${r.interessados} com interesse` : ''}.` : 'Nenhuma resposta nova.'); await carregar(); }
        catch (e) { toastErro(e); }
      });
    }

    // Cartões de mensagem
    const card = alvo.closest('[data-msg]');
    if (card) {
      const id = card.dataset.msg;
      const campos = () => ({ corpo: $('[name=corpo]', card).value, ...($('[name=assunto]', card) ? { assunto: $('[name=assunto]', card).value, para: $('[name=para]', card).value.trim() } : {}) });
      const m = dados.pendentes.find((x) => x.id === id);
      const b = alvo.closest('button');
      if (alvo.closest('[data-aprovar]')) return comBotao(b, async () => {
        try {
          const r = await api('/api/sdr', { acao: 'aprovar', mensagem_id: id, ...campos() });
          const env = r.envio || {};
          toast(env.enviado ? 'E-mail enviado.' : env.motivo === 'limite' ? `Aprovado. O limite de hoje (${env.limite}) acabou: sai amanhã às 8h.` : env.motivo === 'opt-out' ? 'Destinatário está em opt-out: descartado.' : 'Aprovado.');
          await carregar();
        } catch (e) { toastErro(e); }
      });
      if (alvo.closest('[data-whats]')) {
        window.open(linkWhats(alvo.closest('[data-whats]').dataset.whats, $('[name=corpo]', card).value), '_blank', 'noopener');
        return;
      }
      if (alvo.closest('[data-copiar]')) {
        try { await navigator.clipboard.writeText($('[name=corpo]', card).value); toast('Texto copiado.'); } catch { toast('Não foi possível copiar. Selecione o texto e copie à mão.', 'erro'); }
        return;
      }
      if (alvo.closest('[data-feito]')) {
        let resultado;
        if (m?.canal === 'ligacao') {
          resultado = await new Promise((resolve) => {
            const md = abrirModal({ titulo: 'Como foi a ligação?', tamanho: 's',
              corpo: html`<label class="campo"><span>Resultado</span><textarea name="r" rows="3" placeholder="Ex.: falei com a recepção, a Dra. retorna quinta"></textarea></label>`,
              rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-ok>Registrar</button>`, aoFechar: (v) => resolve(v) });
            md.el.querySelector('[data-ok]').addEventListener('click', () => md.fechar($('[name=r]', md.el).value.trim() || 'ligação feita'));
          });
          if (!resultado) return;
        }
        return comBotao(b, async () => {
          try { await api('/api/sdr', { acao: 'concluir', mensagem_id: id, corpo: $('[name=corpo]', card).value, resultado }); toast('Registrado. Próximo toque agendado.'); await carregar(); }
          catch (e) { toastErro(e); }
        });
      }
      if (alvo.closest('[data-salvar]')) return comBotao(b, async () => {
        try { await api('/api/sdr', { acao: 'salvar', mensagem_id: id, ...campos() }); toast('Edição salva.'); } catch (e) { toastErro(e); }
      });
      if (alvo.closest('[data-regerar]')) return comBotao(b, async () => {
        try { const r = await api('/api/sdr', { acao: 'regerar', mensagem_id: id }); $('[name=corpo]', card).value = r.mensagem.corpo; if ($('[name=assunto]', card)) $('[name=assunto]', card).value = r.mensagem.assunto || ''; toast('Texto refeito.'); }
        catch (e) { toastErro(e); }
      });
      if (alvo.closest('[data-pular]')) {
        if (!(await confirmar({ titulo: 'Pular este toque?', mensagem: 'Nada é enviado neste passo e a clínica segue para o próximo toque da cadência.', confirmar: 'Pular toque' }))) return;
        try { await api('/api/sdr', { acao: 'pular', inscricao_id: m.inscricao_id }); toast('Toque pulado.'); await carregar(); } catch (e) { toastErro(e); }
        return;
      }
      if (alvo.closest('[data-descartar]')) {
        try { await api('/api/sdr', { acao: 'descartar', mensagem_id: id }); toast('Rascunho descartado. A IA gera outro na próxima rodada.'); await carregar(); } catch (e) { toastErro(e); }
        return;
      }
      return;
    }

    // Clínicas
    const vis = alvo.closest('[data-visao]');
    if (vis) { if (vis.dataset.visao !== visao) { visao = vis.dataset.visao; gravarVisao(visao); abaClinicas(); } return; }
    if (alvo.closest('[data-descartadas]')) { mostrarDescartadas = alvo.closest('[data-descartadas]').checked; return desenharTabela(); }
    const mv = alvo.closest('[data-mover-clinica]');
    if (mv) { ev.stopPropagation(); return menuMoverClinica(mv, mv.closest('.sdr-card').dataset.empresa); }
    const cartao = alvo.closest('.sdr-card');
    if (cartao) return modalEmpresa(cartao.dataset.empresa);
    if (alvo.closest('[data-todas]')) {
      const marcar = alvo.closest('[data-todas]').checked;
      $$('[data-sel]', conteudo).forEach((c) => { c.checked = marcar; marcar ? selecionadas.add(c.dataset.sel) : selecionadas.delete(c.dataset.sel); });
      return atualizarBotaoInscrever();
    }
    if (alvo.closest('[data-sel]')) {
      const c = alvo.closest('[data-sel]'); c.checked ? selecionadas.add(c.dataset.sel) : selecionadas.delete(c.dataset.sel);
      return atualizarBotaoInscrever();
    }
    if (alvo.closest('[data-inscrever]')) {
      const ids = [...selecionadas];
      const semEmail = dados.empresas.filter((e) => ids.includes(e.id) && !e.email).length;
      if (!(await confirmar({ titulo: `Inscrever ${plural(ids.length, 'clínica', 'clínicas')}?`,
        mensagem: `Elas entram na cadência de 14 dias a partir do próximo dia útil. ${semEmail ? `${plural(semEmail, 'não tem', 'não têm')} e-mail: os toques de e-mail viram tarefas de WhatsApp/Instagram para você. ` : ''}Nada sai sem a sua aprovação.`, confirmar: 'Inscrever' }))) return;
      try { const r = await api('/api/sdr', { acao: 'inscrever', empresa_ids: ids }); selecionadas.clear(); toast(`${plural(r.inscritas, 'clínica inscrita', 'clínicas inscritas')}.`); if (r.falhas.length) toast(r.falhas[0].erro, 'erro'); await carregar(); }
      catch (e) { toastErro(e); }
      return;
    }
    const abrir = alvo.closest('[data-abrir-empresa]') || (alvo.closest('tr[data-empresa]') && !alvo.closest('input'));
    if (abrir) return modalEmpresa(alvo.closest('[data-abrir-empresa]')?.dataset.abrirEmpresa || alvo.closest('tr[data-empresa]').dataset.empresa);
    const oc = alvo.closest('[data-oculto]');
    if (oc) return modalOculto(oc.dataset.oculto, oc.dataset.teste);
  });

  view.addEventListener('input', (ev) => {
    const f = ev.target.closest('[data-f]');
    if (f) { filtro[f.dataset.f] = f.value; desenharTabela(); }
  });

  await carregar();
  return {
    temAlteracoes: () => false,
    destruir: () => document.querySelector('.menu-mover')?.remove()
  };
}
