// Configurações: empresa, serviços, etapas do CRM, SLA, modelos de contrato, usuários, automações e auditoria.
import { sb, q, qc, api } from '../core/supabase.js';
import { sessao, ehAdmin, apoio, invalidar, emitir } from '../core/store.js';
import { html, raw, mount, $, $$, dataHora, carregando, erroBox, vazio, abrirModal, confirmar, toast, toastErro, comBotao, opcoes, num } from '../core/ui.js';
import { icon } from '../core/icons.js';
import { CDN } from '../config.js';

const ABAS = [
  ['empresa', 'Empresa'], ['servicos', 'Serviços'], ['etapas', 'Etapas do CRM'], ['sla', 'SLA'],
  ['modelos', 'Modelos de contrato'], ['usuarios', 'Usuários', true], ['automacoes', 'Automações'], ['auditoria', 'Auditoria', true]
];
const PLACEHOLDERS = ['contrato_numero', 'data_extenso', 'empresa_nome_fantasia', 'empresa_razao_social', 'empresa_cnpj', 'empresa_endereco', 'empresa_email', 'empresa_cidade', 'empresa_uf',
  'cliente_nome', 'cliente_empresa_trecho', 'cliente_documento', 'cliente_endereco', 'cliente_email', 'cliente_telefone', 'servico', 'projeto_titulo', 'resumo',
  'data_inicio', 'sla_dias', 'data_limite', 'valor_total', 'desconto_trecho', 'valor_final', 'forma_pagamento', 'parcelas_descricao'];

export async function render(view, params) {
  const admin = ehAdmin();
  const visiveis = ABAS.filter(([, , soAdmin]) => !soAdmin || admin);
  let aba = visiveis.some(([k]) => k === params[0]) ? params[0] : 'empresa';

  mount(view, html`
    <div class="pagina-topo"><div><h1>Configurações</h1><p>${admin ? 'Ajustes gerais do sistema.' : 'Somente administradores podem alterar estas configurações.'}</p></div></div>
    <nav class="abas" role="tablist">${visiveis.map(([k, t]) => html`<button role="tab" data-aba="${k}" aria-selected="${k === aba}">${t}</button>`)}</nav>
    <div data-conteudo></div>`);
  const box = $('[data-conteudo]', view);
  $('.abas', view).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-aba]'); if (!b) return;
    aba = b.dataset.aba; history.replaceState(null, '', `#/configuracoes/${aba}`);
    $$('.abas [data-aba]', view).forEach((x) => x.setAttribute('aria-selected', x === b));
    renderAba();
  });
  const bloqueio = admin ? '' : raw('disabled');

  function renderAba() {
    box.onclick = null;
    mount(box, carregando());
    ({ empresa, servicos, etapas, sla, modelos, usuarios, automacoes, auditoria })[aba]().catch((e) => mount(box, erroBox(e)));
  }

  // ---------- Empresa ----------
  async function empresa() {
    const cfg = (await apoio('config', true)).empresa || {};
    const campos = [['nome_fantasia', 'Nome fantasia'], ['razao_social', 'Razão social'], ['cnpj', 'CNPJ'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['cidade', 'Cidade'], ['uf', 'UF'], ['endereco', 'Endereço completo', true]];
    mount(box, html`<section class="painel" style="max-width:820px">
      <div class="painel-topo"><div><h2>Dados da empresa</h2><p>Usados como "Contratada" nos contratos gerados.</p></div></div>
      <form class="grade-2" novalidate>${campos.map(([k, t, toda]) => html`<label class="campo ${toda ? 'col-toda' : ''}"><span>${t}</span><input name="${k}" value="${cfg[k] || ''}" maxlength="${k === 'uf' ? 2 : 300}" ${bloqueio}></label>`)}
        ${admin ? html`<div class="col-toda form-acoes"><button class="btn btn-primario" data-salvar>Salvar dados da empresa</button></div>` : ''}</form></section>`);
    $('[data-salvar]', box)?.addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const f = $('form', box); const valor = {};
      campos.forEach(([k]) => { valor[k] = f[k].value.trim(); });
      valor.uf = valor.uf.toUpperCase();
      try { await q(sb.from('configuracoes').upsert({ chave: 'empresa', valor })); invalidar('config'); toast('Dados da empresa salvos.'); } catch (e) { toastErro(e); }
    }); });
  }

  // ---------- Serviços ----------
  async function servicos() {
    const lista = await apoio('servicos', true);
    mount(box, html`<section class="painel">
      <div class="painel-topo"><div><h2>Tipos de serviço</h2><p>Aparecem no cadastro de projetos. O SLA padrão preenche o prazo automaticamente.</p></div>
        ${admin ? html`<button class="btn btn-primario" data-novo>${raw(icon('plus', 16))}Novo serviço</button>` : ''}</div>
      ${lista.length ? html`<div class="tabela-wrap"><table class="tabela tabela-cards"><thead><tr><th>Serviço</th><th class="num">SLA padrão</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((s) => html`<tr><td><b>${s.nome}</b>${s.descricao ? html`<span class="sub">${s.descricao}</span>` : ''}</td>
          <td class="num" data-r="SLA">${s.sla_padrao_dias ? `${s.sla_padrao_dias} dias` : '—'}</td>
          <td>${s.ativo ? html`<span class="badge badge-ok">Ativo</span>` : html`<span class="badge badge-neutro">Inativo</span>`}</td>
          <td class="acoes-td">${admin ? html`<button class="btn-icone" data-editar="${s.id}" aria-label="Editar ${s.nome}">${raw(icon('edit', 16))}</button>` : ''}</td></tr>`)}</tbody></table></div>`
        : vazio({ titulo: 'Nenhum serviço cadastrado' })}</section>`);
    box.onclick = (ev) => {
      if (ev.target.closest('[data-novo]')) formServico(null);
      const e = ev.target.closest('[data-editar]'); if (e) formServico(lista.find((s) => s.id === e.dataset.editar));
    };
  }
  function formServico(s) {
    const m = abrirModal({ titulo: s ? 'Editar serviço' : 'Novo serviço', tamanho: 's',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo col-toda"><span>Nome</span><input name="nome" value="${s?.nome || ''}" maxlength="80" required></label>
        <label class="campo"><span>SLA padrão (dias)</span><input name="sla" type="number" min="1" value="${s?.sla_padrao_dias ?? ''}"></label>
        <label class="campo"><span>Ordem</span><input name="ordem" type="number" value="${s?.ordem ?? 50}"></label>
        <label class="campo col-toda"><span>Descrição</span><textarea name="descricao" rows="2" style="min-height:64px" maxlength="500">${s?.descricao || ''}</textarea></label>
        <label class="check col-toda"><input type="checkbox" name="ativo" ${s?.ativo === false ? '' : raw('checked')}>Ativo</label></form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>${s ? 'Salvar serviço' : 'Criar serviço'}</button>` });
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const f = $('form', m.el);
      const reg = { nome: f.nome.value.trim(), sla_padrao_dias: f.sla.value ? parseInt(f.sla.value, 10) : null, ordem: parseInt(f.ordem.value, 10) || 0, descricao: f.descricao.value.trim() || null, ativo: f.ativo.checked };
      if (!reg.nome) return toast('Informe o nome do serviço.', 'erro');
      if (reg.sla_padrao_dias !== null && !(reg.sla_padrao_dias > 0)) return toast('SLA deve ser maior que zero.', 'erro');
      try { if (s) await q(sb.from('servicos').update(reg).eq('id', s.id)); else await q(sb.from('servicos').insert(reg));
        invalidar('servicos'); toast(s ? 'Serviço salvo.' : 'Serviço criado.'); m.fechar(); servicos(); } catch (e) { toastErro(e); }
    }));
  }

  // ---------- Etapas ----------
  async function etapas() {
    const lista = await apoio('etapas', true);
    mount(box, html`<section class="painel">
      <div class="painel-topo"><div><h2>Etapas do CRM</h2><p>Colunas do Kanban. "Execução" conta o tempo em execução; "Final" registra a data de entrega. O alerta avisa quando um projeto fica parado.</p></div>
        ${admin ? html`<button class="btn btn-primario" data-nova>${raw(icon('plus', 16))}Nova etapa</button>` : ''}</div>
      <div class="tabela-wrap"><table class="tabela tabela-cards"><thead><tr><th>Ordem</th><th>Etapa</th><th>Marcações</th><th>Alerta de parado</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((e, i) => html`<tr>
          <td data-r="Ordem">${admin ? html`<div class="acoes"><button class="btn-icone" data-subir="${e.id}" aria-label="Subir ${e.nome}" ${i === 0 ? raw('disabled') : ''}>${raw(icon('arrowUp', 16))}</button>
            <button class="btn-icone" data-descer="${e.id}" aria-label="Descer ${e.nome}" ${i === lista.length - 1 ? raw('disabled') : ''} style="transform:rotate(180deg)">${raw(icon('arrowUp', 16))}</button></div>` : e.ordem}</td>
          <td><span class="coluna-titulo"><span class="bloco" style="background:${e.cor}"></span>${e.nome}</span></td>
          <td data-r="Marcações">${e.is_execucao ? html`<span class="badge badge-laranja">Execução</span> ` : ''}${e.is_final ? html`<span class="badge badge-ok">Final</span>` : ''}${!e.is_execucao && !e.is_final ? '—' : ''}</td>
          <td data-r="Alerta">${e.alerta_parado_dias ? `${e.alerta_parado_dias} dias` : '—'}</td>
          <td>${e.ativo ? html`<span class="badge badge-ok">Ativa</span>` : html`<span class="badge badge-neutro">Inativa</span>`}</td>
          <td class="acoes-td">${admin ? html`<button class="btn-icone" data-editar="${e.id}" aria-label="Editar ${e.nome}">${raw(icon('edit', 16))}</button>` : ''}</td></tr>`)}</tbody></table></div>
    </section>`);
    box.onclick = async (ev) => {
      if (ev.target.closest('[data-nova]')) return formEtapa(null, lista);
      const ed = ev.target.closest('[data-editar]'); if (ed) return formEtapa(lista.find((x) => x.id === ed.dataset.editar), lista);
      const mov = ev.target.closest('[data-subir],[data-descer]');
      if (mov) {
        const idx = lista.findIndex((x) => x.id === (mov.dataset.subir || mov.dataset.descer));
        const alvo = mov.dataset.subir ? idx - 1 : idx + 1;
        const a = lista[idx], b = lista[alvo]; if (!a || !b) return;
        try {
          await q(sb.from('crm_etapas').update({ ordem: b.ordem }).eq('id', a.id));
          await q(sb.from('crm_etapas').update({ ordem: a.ordem }).eq('id', b.id));
          invalidar('etapas'); emitir('dados-alterados'); etapas();
        } catch (e) { toastErro(e); }
      }
    };
  }
  function formEtapa(e, lista) {
    const m = abrirModal({ titulo: e ? 'Editar etapa' : 'Nova etapa', tamanho: 's',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo"><span>Nome</span><input name="nome" value="${e?.nome || ''}" maxlength="60" required></label>
        <label class="campo"><span>Cor</span><input type="color" name="cor" value="${e?.cor || '#F59E0B'}"></label>
        <label class="campo col-toda"><span>Alertar se ficar parado por (dias)</span><input name="alerta" type="number" min="1" value="${e?.alerta_parado_dias ?? ''}" placeholder="Sem alerta"></label>
        <label class="check col-toda"><input type="checkbox" name="exec" ${e?.is_execucao ? raw('checked') : ''}>Etapa de execução (conta tempo em execução)</label>
        <label class="check col-toda"><input type="checkbox" name="final" ${e?.is_final ? raw('checked') : ''}>Etapa final (registra a data de entrega)</label>
        <label class="check col-toda"><input type="checkbox" name="ativo" ${e?.ativo === false ? '' : raw('checked')}>Ativa</label></form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>${e ? 'Salvar etapa' : 'Criar etapa'}</button>` });
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const f = $('form', m.el);
      const reg = { nome: f.nome.value.trim(), cor: f.cor.value, alerta_parado_dias: f.alerta.value ? parseInt(f.alerta.value, 10) : null, is_execucao: f.exec.checked, is_final: f.final.checked, ativo: f.ativo.checked };
      if (!reg.nome) return toast('Informe o nome da etapa.', 'erro');
      if (reg.is_execucao && reg.is_final) return toast('Uma etapa não pode ser de execução e final ao mesmo tempo.', 'erro');
      if (e && !reg.ativo) {
        const { count } = await qc(sb.from('projetos').select('id', { count: 'exact', head: true }).eq('etapa_id', e.id).is('deleted_at', null).in('status', ['ativo', 'pausado']));
        if (count && !(await confirmar({ titulo: 'Desativar etapa', mensagem: `Há ${count} projeto(s) ativo(s) nesta etapa. Eles continuam nela, mas a etapa deixa de aparecer como opção.`, confirmar: 'Desativar mesmo assim' }))) return;
      }
      try {
        if (e) await q(sb.from('crm_etapas').update(reg).eq('id', e.id));
        else await q(sb.from('crm_etapas').insert({ ...reg, ordem: Math.max(0, ...lista.map((x) => x.ordem)) + 1 }));
        invalidar('etapas'); emitir('dados-alterados'); toast(e ? 'Etapa salva.' : 'Etapa criada.'); m.fechar(); etapas();
      } catch (err) { toastErro(err); }
    }));
  }

  // ---------- SLA ----------
  async function sla() {
    const cfg = (await apoio('config', true)).sla || { alerta_dias: 5 };
    mount(box, html`<section class="painel" style="max-width:640px">
      <div class="painel-topo"><div><h2>SLA</h2><p>Define quando um projeto passa a aparecer como "Próximo do vencimento".</p></div></div>
      <form class="grade-2" novalidate>
        <label class="campo"><span>Avisar quando faltarem (dias)</span><input name="alerta" type="number" min="1" max="60" value="${cfg.alerta_dias}" ${bloqueio}></label>
        <div class="campo"><span>&nbsp;</span><small>O prazo padrão de cada tipo de projeto fica na aba Serviços.</small></div>
        ${admin ? html`<div class="col-toda form-acoes"><button class="btn btn-primario" data-salvar>Salvar SLA</button></div>` : ''}</form></section>`);
    $('[data-salvar]', box)?.addEventListener('click', (ev) => { ev.preventDefault(); comBotao(ev.currentTarget, async () => {
      const n = parseInt($('form', box).alerta.value, 10);
      if (!(n >= 1 && n <= 60)) return toast('Informe um número entre 1 e 60.', 'erro');
      try { await q(sb.from('configuracoes').upsert({ chave: 'sla', valor: { alerta_dias: n } })); invalidar('config'); emitir('dados-alterados'); toast('SLA salvo.'); } catch (e) { toastErro(e); }
    }); });
  }

  // ---------- Modelos de contrato ----------
  async function modelos() {
    const lista = await q(sb.from('contrato_modelos').select('id,nome,padrao,ativo,updated_at').order('padrao', { ascending: false }).order('nome'));
    mount(box, html`<section class="painel">
      <div class="painel-topo"><div><h2>Modelos de contrato</h2><p>O modelo padrão é usado em "Gerar contrato". Revise o texto com um advogado.</p></div>
        ${admin ? html`<button class="btn btn-primario" data-novo>${raw(icon('plus', 16))}Novo modelo</button>` : ''}</div>
      ${lista.length ? html`<ul class="lista lista-clicavel">${lista.map((mm) => html`<li data-id="${mm.id}"><div class="principal-l"><b>${mm.nome}</b><span>Atualizado em ${dataHora(mm.updated_at)}</span></div>
        ${mm.padrao ? html`<span class="badge badge-laranja">Padrão</span>` : ''}${mm.ativo ? '' : html`<span class="badge badge-neutro">Inativo</span>`}${raw(icon('chevronRight', 16))}</li>`)}</ul>`
        : vazio({ titulo: 'Nenhum modelo cadastrado' })}</section>`);
    box.onclick = (ev) => {
      if (ev.target.closest('[data-novo]')) return formModelo(null);
      const li = ev.target.closest('[data-id]'); if (li) formModelo(li.dataset.id);
    };
  }
  async function formModelo(idModelo) {
    const mm = idModelo ? await q(sb.from('contrato_modelos').select('*').eq('id', idModelo).single()) : null;
    const m = abrirModal({ titulo: mm ? 'Editar modelo' : 'Novo modelo', tamanho: 'l',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo"><span>Nome</span><input name="nome" value="${mm?.nome || ''}" maxlength="120" ${bloqueio}></label>
        <div class="campo" style="justify-content:flex-end;gap:8px">
          <label class="check"><input type="checkbox" name="padrao" ${mm?.padrao ? raw('checked') : ''} ${bloqueio}>Modelo padrão</label>
          <label class="check"><input type="checkbox" name="ativo" ${mm?.ativo === false ? '' : raw('checked')} ${bloqueio}>Ativo</label></div>
        <label class="campo col-toda"><span>Conteúdo (HTML simples: h1, h2, p, strong, ul, li)</span>
          <textarea name="conteudo" rows="18" style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px" ${bloqueio}>${mm?.conteudo_html || '<h1>Contrato</h1>\n<p>Contrato nº {{contrato_numero}}</p>'}</textarea></label>
        <div class="col-toda"><span class="rotulo">Campos disponíveis</span><div class="placeholders" style="margin-top:6px">${PLACEHOLDERS.map((p) => html`<code>{{${p}}}</code>`)}</div></div>
      </form>`,
      rodape: admin ? html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>Salvar modelo</button>` : html`<button class="btn btn-secundario" data-fechar>Fechar</button>` });
    $('[data-salvar]', m.el)?.addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const f = $('form', m.el);
      const purify = (await import(CDN.dompurify)).default;
      const conteudo = purify.sanitize(f.conteudo.value, { ALLOWED_TAGS: ['h1', 'h2', 'h3', 'p', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'div', 'span', 'section', 'mark', 'table', 'thead', 'tbody', 'tr', 'td', 'th'], ALLOWED_ATTR: ['class'] });
      const reg = { nome: f.nome.value.trim(), conteudo_html: conteudo, padrao: f.padrao.checked, ativo: f.ativo.checked };
      if (!reg.nome) return toast('Informe o nome do modelo.', 'erro');
      if (!conteudo.trim()) return toast('O conteúdo do modelo está vazio.', 'erro');
      if (reg.padrao && !reg.ativo) return toast('O modelo padrão precisa estar ativo.', 'erro');
      try {
        if (reg.padrao) await q(sb.from('contrato_modelos').update({ padrao: false }).eq('padrao', true).neq('id', mm?.id || '00000000-0000-0000-0000-000000000000'));
        if (mm) await q(sb.from('contrato_modelos').update(reg).eq('id', mm.id)); else await q(sb.from('contrato_modelos').insert(reg));
        toast('Modelo salvo.'); m.fechar(); modelos();
      } catch (e) { toastErro(e); }
    }));
  }

  // ---------- Usuários (admin) ----------
  async function usuarios() {
    const lista = await apoio('equipe', true);
    mount(box, html`<section class="painel">
      <div class="painel-topo"><div><h2>Usuários</h2><p>Quem pode acessar o Admin. Usuários desativados perdem o acesso na hora.</p></div>
        <button class="btn btn-primario" data-novo>${raw(icon('plus', 16))}Novo usuário</button></div>
      <div class="tabela-wrap"><table class="tabela tabela-cards"><thead><tr><th>Usuário</th><th>Papel</th><th>Situação</th><th></th></tr></thead>
        <tbody>${lista.map((u) => html`<tr><td><b>${u.nome || '—'}${u.id === sessao.user.id ? ' (você)' : ''}</b><span class="sub">${u.email}</span></td>
          <td data-r="Papel">${u.id === sessao.user.id ? (u.role === 'admin' ? 'Administrador' : 'Usuário')
            : html`<select class="entrada" data-papel="${u.id}" style="width:auto;padding:6px 10px" aria-label="Papel de ${u.email}">${opcoes({ usuario: 'Usuário', admin: 'Administrador' }, u.role)}</select>`}</td>
          <td>${u.ativo ? html`<span class="badge badge-ok">Ativo</span>` : html`<span class="badge badge-erro">Desativado</span>`}</td>
          <td class="acoes-td">${u.id !== sessao.user.id ? html`
            <button class="btn btn-fantasma btn-p" data-senha="${u.id}">${raw(icon('lock', 14))}Redefinir senha</button>
            <button class="btn btn-fantasma btn-p ${u.ativo ? 'btn-texto-perigo' : ''}" data-ativo="${u.id}" data-valor="${!u.ativo}">${u.ativo ? 'Desativar' : 'Reativar'}</button>` : ''}</td></tr>`)}</tbody></table></div>
      <p style="color:var(--texto-3);font-size:12px;margin-top:12px">Criar usuários e redefinir senhas usa uma função segura no servidor. Ela precisa da variável SUPABASE_SERVICE_ROLE_KEY configurada na Vercel.</p>
    </section>`);
    const acao = async (corpo, msg) => { try { await api('/api/admin-users', corpo); invalidar('equipe'); toast(msg); usuarios(); } catch (e) { toastErro(e.status === 503 ? new Error('A gestão de usuários ainda não foi configurada na Vercel (SUPABASE_SERVICE_ROLE_KEY).') : e); usuarios(); } };
    box.onclick = async (ev) => {
      if (ev.target.closest('[data-novo]')) return formUsuario();
      const s = ev.target.closest('[data-senha]'); if (s) return formSenha(lista.find((u) => u.id === s.dataset.senha));
      const a = ev.target.closest('[data-ativo]');
      if (a) {
        const u = lista.find((x) => x.id === a.dataset.ativo), ativar = a.dataset.valor === 'true';
        if (!(await confirmar({ titulo: ativar ? 'Reativar usuário' : 'Desativar usuário', mensagem: ativar ? `${u.email} voltará a acessar o Admin.` : `${u.email} perde o acesso imediatamente. Os dados cadastrados por ele continuam no sistema.`, confirmar: ativar ? 'Reativar' : 'Desativar', perigo: !ativar }))) return;
        comBotao(a, () => acao({ acao: 'definir_ativo', id: u.id, ativo: ativar }, ativar ? 'Usuário reativado.' : 'Usuário desativado.'));
      }
    };
    $$('[data-papel]', box).forEach((sel) => sel.addEventListener('change', async () => {
      const u = lista.find((x) => x.id === sel.dataset.papel);
      if (!(await confirmar({ titulo: 'Alterar papel', mensagem: `${u.email} passará a ser ${sel.value === 'admin' ? 'administrador, com acesso a usuários, exclusões e auditoria' : 'usuário comum'}.`, confirmar: 'Alterar papel' }))) { sel.value = u.role; return; }
      acao({ acao: 'definir_papel', id: u.id, role: sel.value }, 'Papel alterado.');
    }));
  }
  function formUsuario() {
    const m = abrirModal({ titulo: 'Novo usuário', tamanho: 's',
      corpo: html`<form class="grade-2" novalidate>
        <label class="campo col-toda"><span>Nome</span><input name="nome" maxlength="120" required></label>
        <label class="campo col-toda"><span>E-mail</span><input name="email" type="email" required></label>
        <label class="campo col-toda"><span>Senha provisória</span><input name="senha" type="password" minlength="10" autocomplete="new-password" required><small>Mínimo de 10 caracteres. Peça para a pessoa trocar em Meu perfil.</small></label>
        <label class="campo col-toda"><span>Papel</span><select name="role">${opcoes({ usuario: 'Usuário', admin: 'Administrador' }, 'usuario')}</select></label></form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>Criar usuário</button>` });
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const f = $('form', m.el);
      const corpo = { acao: 'criar', nome: f.nome.value.trim(), email: f.email.value.trim().toLowerCase(), senha: f.senha.value, role: f.role.value };
      if (!corpo.nome || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(corpo.email)) return toast('Informe nome e e-mail válidos.', 'erro');
      if (corpo.senha.length < 10) return toast('A senha provisória precisa de pelo menos 10 caracteres.', 'erro');
      try { await api('/api/admin-users', corpo); invalidar('equipe'); toast('Usuário criado.'); m.fechar(); usuarios(); }
      catch (e) { toastErro(e.status === 503 ? new Error('A gestão de usuários ainda não foi configurada na Vercel (SUPABASE_SERVICE_ROLE_KEY).') : e); }
    }));
  }
  function formSenha(u) {
    const m = abrirModal({ titulo: 'Redefinir senha', tamanho: 's',
      corpo: html`<p style="color:var(--texto-2);margin-bottom:12px">Nova senha para ${u.email}.</p>
        <form novalidate><label class="campo"><span>Nova senha</span><input name="senha" type="password" minlength="10" autocomplete="new-password"><small>Mínimo de 10 caracteres.</small></label></form>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Cancelar</button><button class="btn btn-primario" data-salvar>Redefinir senha</button>` });
    $('[data-salvar]', m.el).addEventListener('click', (ev) => comBotao(ev.currentTarget, async () => {
      const senha = $('form', m.el).senha.value;
      if (senha.length < 10) return toast('A senha precisa de pelo menos 10 caracteres.', 'erro');
      try { await api('/api/admin-users', { acao: 'redefinir_senha', id: u.id, senha }); toast('Senha redefinida.'); m.fechar(); }
      catch (e) { toastErro(e.status === 503 ? new Error('A gestão de usuários ainda não foi configurada na Vercel (SUPABASE_SERVICE_ROLE_KEY).') : e); }
    }));
  }

  // ---------- Automações ----------
  async function automacoes() {
    const lista = await q(sb.from('automacoes').select('*').order('nome'));
    mount(box, html`<section class="painel" style="max-width:820px">
      <div class="painel-topo"><div><h2>Automações</h2><p>Estrutura pronta para automações futuras. Os alertas de prazo, parcelas e projetos parados já funcionam na central de notificações; envios automáticos (e-mail, WhatsApp) serão ligados aqui depois.</p></div></div>
      <ul class="lista">${lista.map((a) => html`<li><div class="principal-l"><b>${a.nome}</b><span>${a.descricao || ''}</span></div>
        <label class="check"><input type="checkbox" data-auto="${a.id}" ${a.ativo ? raw('checked') : ''} ${bloqueio}>${a.ativo ? 'Ligada' : 'Desligada'}</label></li>`)}</ul></section>`);
    $$('[data-auto]', box).forEach((el) => el.addEventListener('change', async () => {
      try { await q(sb.from('automacoes').update({ ativo: el.checked }).eq('id', el.dataset.auto)); el.parentElement.lastChild.textContent = el.checked ? 'Ligada' : 'Desligada'; toast('Automação atualizada.'); }
      catch (e) { el.checked = !el.checked; toastErro(e); }
    }));
  }

  // ---------- Auditoria (admin) ----------
  let paginaAud = 0, filtroEnt = '';
  async function auditoria() {
    const POR = 30;
    const equipe = await apoio('equipe');
    let c = sb.from('auditoria').select('*', { count: 'exact' });
    if (filtroEnt) c = c.eq('entidade', filtroEnt);
    const { data: lista, count } = await qc(c.order('created_at', { ascending: false }).range(paginaAud * POR, (paginaAud + 1) * POR - 1));
    const nome = (uid) => { const u = equipe.find((x) => x.id === uid); return u ? (u.nome || u.email) : 'Sistema'; };
    const ENT = { projetos: 'Projetos', clientes: 'Clientes', parcelas: 'Parcelas', contratos: 'Contratos', contrato_versoes: 'Versões de contrato', servicos: 'Serviços', crm_etapas: 'Etapas', contrato_modelos: 'Modelos', configuracoes: 'Configurações', profiles: 'Usuários', automacoes: 'Automações' };
    const ACAO = { insert: 'Criou', update: 'Alterou', delete: 'Apagou', excluir: 'Excluiu', mover_etapa: 'Moveu etapa' };
    const resumo = (a) => {
      if (a.descricao) return a.descricao;
      if (a.acao === 'update' && a.alteracoes) return Object.entries(a.alteracoes).slice(0, 4).map(([k, v]) => `${k}: ${fmt(v.de)} → ${fmt(v.para)}`).join(' · ');
      const d = a.alteracoes || {};
      return d.nome || d.titulo || d.numero || (d.codigo ? `#${d.codigo}` : '') || (d.numero && d.valor ? `parcela ${d.numero}` : '') || '';
    };
    const fmt = (v) => { if (v === null || v === undefined) return '—'; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 40 ? s.slice(0, 40) + '…' : s; };
    const paginas = Math.max(1, Math.ceil(count / POR));
    mount(box, html`<section class="painel">
      <div class="painel-topo"><div><h2>Auditoria</h2><p>Principais ações administrativas. Finanças pessoais não são registradas aqui.</p></div>
        <select class="entrada" data-ent style="width:auto" aria-label="Filtrar por entidade">${opcoes(ENT, filtroEnt, 'Todas as áreas')}</select></div>
      ${lista.length ? html`<div class="tabela-wrap"><table class="tabela tabela-cards"><thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Área</th><th>Detalhe</th></tr></thead>
        <tbody>${lista.map((a) => html`<tr><td data-r="Data">${dataHora(a.created_at)}</td><td data-r="Usuário">${nome(a.usuario_id)}</td>
          <td data-r="Ação">${ACAO[a.acao] || a.acao}</td><td data-r="Área">${ENT[a.entidade] || a.entidade}<span class="sub">${a.entidade_id ? String(a.entidade_id).slice(0, 8) : ''}</span></td>
          <td style="max-width:420px;overflow-wrap:anywhere;font-size:13px;color:var(--texto-2)">${resumo(a)}</td></tr>`)}</tbody></table></div>
        <div class="paginacao"><span>${num(count)} registro(s) · página ${paginaAud + 1} de ${paginas}</span><div class="acoes">
          <button class="btn btn-secundario btn-p" data-pag="-1" ${paginaAud === 0 ? raw('disabled') : ''}>Anterior</button>
          <button class="btn btn-secundario btn-p" data-pag="1" ${paginaAud + 1 >= paginas ? raw('disabled') : ''}>Próxima</button></div></div>`
        : vazio({ titulo: 'Nenhum registro ainda' })}</section>`);
    $('[data-ent]', box).addEventListener('change', (ev) => { filtroEnt = ev.target.value; paginaAud = 0; auditoria().catch((e) => mount(box, erroBox(e))); });
    box.onclick = (ev) => { const p = ev.target.closest('[data-pag]'); if (p) { paginaAud += Number(p.dataset.pag); auditoria().catch((e) => mount(box, erroBox(e))); } };
  }

  renderAba();
}
