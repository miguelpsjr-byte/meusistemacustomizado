// Admin — ponto de entrada: autenticação, layout (sidebar + topo), rotas, busca e notificações.
import { sb, q } from './core/supabase.js';
import { sessao, ehAdmin, invalidar, ao } from './core/store.js';
import { html, raw, mount, $, $$, toastErro, carregando, erroBox, debounce, iniciais } from './core/ui.js';
import { icon, logo } from './core/icons.js';

const raiz = document.getElementById('raiz');
const NAV = [
  { rota: 'dashboard', txt: 'Dashboard', ic: 'dashboard' },
  { rota: 'crm', txt: 'CRM', ic: 'kanban' },
  { rota: 'projetos', txt: 'Projetos', ic: 'projetos' },
  { rota: 'clientes', txt: 'Clientes', ic: 'clientes' },
  { rota: 'financeiro', txt: 'Financeiro', ic: 'financeiro' },
  { rota: 'pessoal', txt: 'Finanças Pessoais', ic: 'pessoal' },
  { rota: 'contratos', txt: 'Contratos', ic: 'contratos' },
  { sep: true },
  { rota: 'configuracoes', txt: 'Configurações', ic: 'config' }
];
const PAGINAS = {
  dashboard: () => import('./pages/dashboard.js'),
  crm: () => import('./pages/crm.js'),
  projetos: () => import('./pages/projetos.js'),
  clientes: () => import('./pages/clientes.js'),
  financeiro: () => import('./pages/financeiro.js'),
  pessoal: () => import('./pages/pessoal.js'),
  contratos: () => import('./pages/contratos.js'),
  configuracoes: () => import('./pages/configuracoes.js'),
  perfil: () => import('./pages/perfil.js')
};

let paginaAtual = null;   // { destruir?, podeSair? }
let rotaAnterior = location.hash;
let intervaloAlertas = null;

// ================= AUTENTICAÇÃO =================
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return telaLogin();
  await entrar(session.user);
}

async function entrar(user) {
  try {
    const perfil = await q(sb.from('profiles').select('id,nome,email,role,ativo').eq('id', user.id).maybeSingle());
    if (!perfil || !perfil.ativo) {
      await sb.auth.signOut();
      return telaLogin('Seu acesso está desativado. Fale com um administrador.');
    }
    sessao.user = user; sessao.perfil = perfil;
    montarLayout();
    window.addEventListener('hashchange', navegar);
    await navegar();
    atualizarAlertas();
    intervaloAlertas = setInterval(atualizarAlertas, 5 * 60 * 1000);
  } catch (e) {
    mount(raiz, html`<div class="conteudo">${erroBox(e)}<button class="btn btn-secundario" data-recarregar>Tentar de novo</button></div>`);
    $('[data-recarregar]', raiz)?.addEventListener('click', () => location.reload());
  }
}

sb.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT' && sessao.user) {
    sessao.user = null; sessao.perfil = null; invalidar();
    clearInterval(intervaloAlertas);
    window.removeEventListener('hashchange', navegar);
    telaLogin();
  }
});

function telaLogin(mensagem = '') {
  document.title = 'Entrar · Admin';
  mount(raiz, html`<main class="login">
    <section class="login-lado" aria-hidden="true">
      <div class="login-marca">${raw(logo(40))}<div class="marca-texto"><span>Meu Sistema</span><b>Customizado</b></div></div>
      <div><h1>O centro de gestão da empresa.</h1><p>CRM, projetos, contratos e financeiro em um só lugar.</p></div>
      <div class="login-blocos"><i></i><i></i><i></i><i></i></div>
    </section>
    <section class="login-form">
      <form novalidate>
        <div><h2>Entrar no Admin</h2><p class="sub">Use o e-mail e a senha cadastrados.</p></div>
        <p class="aviso-form" role="alert" ${mensagem ? '' : raw('hidden')}>${mensagem}</p>
        <label class="campo"><span>E-mail</span><input name="email" type="email" autocomplete="username" required autofocus></label>
        <label class="campo"><span>Senha</span><input name="senha" type="password" autocomplete="current-password" required></label>
        <button class="btn btn-primario" type="submit">Entrar</button>
        <small style="color:var(--texto-3)">Esqueceu a senha? Peça a um administrador para redefinir.</small>
      </form>
    </section>
  </main>`);
  const form = $('form', raiz);
  const aviso = $('.aviso-form', raiz);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = form.email.value.trim(), senha = form.senha.value;
    if (!email || !senha) { aviso.textContent = 'Preencha e-mail e senha.'; aviso.hidden = false; return; }
    const btn = $('button[type=submit]', form);
    btn.disabled = true; btn.classList.add('ocupado'); aviso.hidden = true;
    const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
    btn.disabled = false; btn.classList.remove('ocupado');
    if (error) {
      aviso.textContent = /Invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.'
        : /rate|too many/i.test(error.message) ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'
        : 'Não foi possível entrar. Verifique a conexão e tente de novo.';
      aviso.hidden = false; form.senha.value = ''; form.senha.focus();
      return;
    }
    if (!location.hash || location.hash === '#/') history.replaceState(null, '', '#/dashboard');
    entrar(data.user);
  });
}

export async function sair() {
  if (paginaAtual?.podeSair && !(await paginaAtual.podeSair())) return;
  await sb.auth.signOut();
}

// ================= LAYOUT =================
function montarLayout() {
  const fixada = localStorage.getItem('msc-sidebar-fixada') === '1';
  const p = sessao.perfil;
  mount(raiz, html`<div class="app ${fixada ? 'fixada' : ''}">
    <aside class="sidebar ${fixada ? 'expandida' : ''}" aria-label="Menu principal">
      <a class="sidebar-topo" href="#/dashboard" aria-label="Dashboard">${raw(logo(34))}<div class="marca-texto"><span>Meu Sistema</span><b>Customizado</b></div></a>
      <ul class="nav">${NAV.map((n) => n.sep ? html`<li class="nav-sep" role="separator"></li>`
        : html`<li><a href="#/${n.rota}" data-rota="${n.rota}" title="${n.txt}">${raw(icon(n.ic, 20))}<span class="nav-txt">${n.txt}</span></a></li>`)}</ul>
      <div class="sidebar-rodape"><button class="fixar" aria-pressed="${fixada}" title="Fixar menu">${raw(icon('pin', 20))}<span class="fixar-txt">${fixada ? 'Menu fixado' : 'Fixar menu'}</span></button></div>
    </aside>
    <div class="sidebar-fundo"></div>
    <div class="principal">
      <header class="topo">
        <button class="btn-icone btn-menu" aria-label="Abrir menu">${raw(icon('menu', 20))}</button>
        <div class="busca" role="search">
          ${raw(icon('search', 16))}
          <input type="search" placeholder="Pesquisar clientes, projetos, contratos…" aria-label="Pesquisa global" autocomplete="off">
          <div class="popover" hidden></div>
        </div>
        <div class="topo-direita">
          <button class="btn-icone btn-notif" aria-label="Notificações" aria-haspopup="true">${raw(icon('bell', 20))}<span class="contador" hidden></span></button>
          <div class="popover notif" hidden>
            <div class="notif-topo"><h3>Notificações</h3><button class="btn btn-fantasma btn-p" data-marcar-todas>Marcar todas como lidas</button></div>
            <div class="notif-lista">${carregando()}</div>
          </div>
          <button class="usuario-btn" aria-haspopup="true" aria-label="Menu do usuário"><span class="avatar">${iniciais(p.nome || p.email)}</span><span class="nome">${p.nome || p.email}</span>${raw(icon('chevronDown', 16))}</button>
          <div class="popover menu-usuario" hidden>
            <div class="quem"><b>${p.nome || 'Sem nome'}</b><span>${p.email} · ${p.role === 'admin' ? 'Administrador' : 'Usuário'}</span></div>
            <a class="menu-item" href="#/perfil">${raw(icon('user', 16))}Meu perfil</a>
            ${ehAdmin() ? html`<a class="menu-item" href="#/configuracoes/usuarios">${raw(icon('clientes', 16))}Usuários</a>` : ''}
            <button class="menu-item btn-texto-perigo" data-sair>${raw(icon('logout', 16))}Sair</button>
          </div>
        </div>
      </header>
      <main class="conteudo" id="view" tabindex="-1"></main>
    </div>
  </div>`);

  const app = $('.app'), sidebar = $('.sidebar');
  const mobile = () => matchMedia('(max-width: 900px)').matches;
  // Sidebar recolhida expande ao passar o mouse (desktop)
  sidebar.addEventListener('mouseenter', () => { if (!mobile() && !app.classList.contains('fixada')) sidebar.classList.add('expandida'); });
  sidebar.addEventListener('mouseleave', () => { if (!mobile() && !app.classList.contains('fixada')) sidebar.classList.remove('expandida'); });
  sidebar.addEventListener('focusin', () => { if (!mobile()) sidebar.classList.add('expandida'); });
  sidebar.addEventListener('focusout', (ev) => { if (!mobile() && !app.classList.contains('fixada') && !sidebar.contains(ev.relatedTarget)) sidebar.classList.remove('expandida'); });
  $('.fixar').addEventListener('click', (ev) => {
    const on = !app.classList.contains('fixada');
    app.classList.toggle('fixada', on); sidebar.classList.toggle('expandida', on);
    ev.currentTarget.setAttribute('aria-pressed', on);
    $('.fixar-txt').textContent = on ? 'Menu fixado' : 'Fixar menu';
    localStorage.setItem('msc-sidebar-fixada', on ? '1' : '0');
  });
  $('.btn-menu').addEventListener('click', () => app.classList.add('menu-aberto'));
  $('.sidebar-fundo').addEventListener('click', () => app.classList.remove('menu-aberto'));
  sidebar.addEventListener('click', (ev) => { if (ev.target.closest('a')) app.classList.remove('menu-aberto'); });

  // Popovers
  const alternar = (botao, pop, aoAbrir) => {
    botao.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const abrir = pop.hidden;
      $$('.topo .popover').forEach((x) => { x.hidden = true; });
      pop.hidden = !abrir;
      if (abrir) aoAbrir?.();
    });
  };
  alternar($('.usuario-btn'), $('.menu-usuario'));
  alternar($('.btn-notif'), $('.notif'), renderAlertas);
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.topo .popover') && !ev.target.closest('.busca')) $$('.topo .popover').forEach((x) => { x.hidden = true; });
  });
  $('.menu-usuario').addEventListener('click', (ev) => { if (ev.target.closest('a')) $('.menu-usuario').hidden = true; });
  $('[data-sair]').addEventListener('click', sair);
  $('[data-marcar-todas]').addEventListener('click', marcarTodasLidas);
  configurarBusca();
  ao('dados-alterados', debounce(atualizarAlertas, 800));
}

// ================= ROTAS =================
async function navegar() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [rota, ...params] = hash.split('/');
  if (paginaAtual?.podeSair && location.hash !== rotaAnterior) {
    if (!(await paginaAtual.podeSair())) { history.replaceState(null, '', rotaAnterior); return; }
  }
  rotaAnterior = location.hash;
  const carregar = PAGINAS[rota];
  $$('.nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === rota));
  const view = $('#view');
  if (!view) return;
  paginaAtual?.destruir?.();
  paginaAtual = null;
  if (!carregar) { mount(view, html`<div class="estado estado-vazio"><strong>Página não encontrada</strong><a class="btn btn-secundario" href="#/dashboard">Ir para o Dashboard</a></div>`); return; }
  mount(view, carregando());
  try {
    const mod = await carregar();
    const titulo = NAV.find((n) => n.rota === rota)?.txt || (rota === 'perfil' ? 'Meu perfil' : 'Admin');
    document.title = `${titulo} · Admin`;
    paginaAtual = (await mod.render(view, params.map(decodeURIComponent))) || null;
    view.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    mount(view, erroBox(e));
  }
}

// ================= BUSCA GLOBAL =================
function configurarBusca() {
  const input = $('.busca input'), pop = $('.busca .popover');
  const ROTULOS = { cliente: 'Clientes', projeto: 'Projetos', contrato: 'Contratos', servico: 'Serviços' };
  let ultimo = '';
  const buscar = debounce(async () => {
    const termo = input.value.trim();
    if (termo.length < 2) { pop.hidden = true; return; }
    ultimo = termo;
    try {
      const res = await q(sb.rpc('busca_global', { p_termo: termo }));
      if (termo !== ultimo) return;
      const grupos = Object.keys(ROTULOS).map((t) => [t, res.filter((r) => r.tipo === t)]).filter(([, l]) => l.length);
      mount(pop, grupos.length ? grupos.map(([t, lista]) => html`<div class="res-grupo"><h4>${ROTULOS[t]}</h4>
        ${lista.map((r) => html`<button class="res-item" data-tipo="${r.tipo}" data-id="${r.id}"><b>${r.titulo}</b>${r.subtitulo ? html`<span>${r.subtitulo}</span>` : ''}</button>`)}</div>`)
        : html`<div class="res-vazio">Nada encontrado para "${termo}".</div>`);
      pop.hidden = false;
    } catch (e) { mount(pop, html`<div class="res-vazio">${e.message}</div>`); pop.hidden = false; }
  }, 250);
  input.addEventListener('input', buscar);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) buscar(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { pop.hidden = true; input.blur(); }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); $('.res-item', pop)?.focus(); }
  });
  pop.addEventListener('keydown', (ev) => {
    const itens = $$('.res-item', pop); const i = itens.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); itens[Math.min(i + 1, itens.length - 1)]?.focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); i <= 0 ? input.focus() : itens[i - 1].focus(); }
    if (ev.key === 'Escape') { pop.hidden = true; input.focus(); }
  });
  pop.addEventListener('click', (ev) => {
    const b = ev.target.closest('.res-item'); if (!b) return;
    pop.hidden = true; input.value = '';
    abrirEntidade(b.dataset.tipo, b.dataset.id);
  });
}

export async function abrirEntidade(tipo, id, opcoes = {}) {
  if (tipo === 'projeto') { const m = await import('./pages/projeto.js'); return m.abrirProjeto(id, opcoes); }
  if (tipo === 'cliente') { const m = await import('./pages/clientes.js'); return m.abrirCliente(id); }
  if (tipo === 'contrato') { location.hash = `#/contratos/${id}`; return; }
  if (tipo === 'servico') { location.hash = '#/configuracoes/servicos'; return; }
  if (tipo === 'parcela') {
    const p = await q(sb.from('parcelas').select('projeto_id').eq('id', id).maybeSingle());
    if (p) { const m = await import('./pages/projeto.js'); return m.abrirProjeto(p.projeto_id, { aba: 'financeiro' }); }
  }
}

// ================= NOTIFICAÇÕES =================
let alertas = [], lidas = new Set();
async function atualizarAlertas() {
  if (!sessao.user) return;
  try {
    const [a, l] = await Promise.all([
      q(sb.from('vw_alertas').select('*').order('data_ref', { ascending: true }).limit(100)),
      q(sb.from('notificacoes_lidas').select('chave'))
    ]);
    alertas = a; lidas = new Set(l.map((x) => x.chave));
    const naoLidas = alertas.filter((x) => !lidas.has(x.chave)).length;
    const c = $('.btn-notif .contador');
    if (c) { c.hidden = !naoLidas; c.textContent = naoLidas > 99 ? '99+' : naoLidas; }
    if (!$('.notif')?.hidden) renderAlertas();
  } catch (e) { console.warn('Alertas', e); }
}
function renderAlertas() {
  const lista = $('.notif-lista'); if (!lista) return;
  const ordem = { alta: 0, media: 1, baixa: 2 };
  const itens = [...alertas].sort((a, b) => (lidas.has(a.chave) - lidas.has(b.chave)) || (ordem[a.severidade] - ordem[b.severidade]));
  const ic = { projeto_atrasado: 'alert', projeto_proximo: 'clock', projeto_parado: 'history', parcela_vencida: 'money', parcela_vencendo: 'calendar', contrato_pendente: 'contratos' };
  mount(lista, itens.length ? itens.map((a) => html`<button class="notif-item ${lidas.has(a.chave) ? 'lida' : ''}" data-chave="${a.chave}" data-entidade="${a.entidade}" data-id="${a.entidade_id}">
      <span class="sev sev-${a.severidade}">${raw(icon(ic[a.tipo] || 'bell', 16))}</span>
      <div><b>${a.titulo}</b><span>${a.descricao}</span></div></button>`)
    : html`<div class="estado">${raw(icon('check', 18))}Nenhum alerta no momento.</div>`);
  lista.onclick = async (ev) => {
    const b = ev.target.closest('.notif-item'); if (!b) return;
    $('.notif').hidden = true;
    marcarLida(b.dataset.chave);
    abrirEntidade(b.dataset.entidade, b.dataset.id, b.dataset.entidade === 'projeto' && b.dataset.chave.startsWith('projeto_') ? { aba: 'sla' } : {});
  };
}
async function marcarLida(chave) {
  if (lidas.has(chave)) return;
  lidas.add(chave); atualizarContador();
  const { error } = await sb.from('notificacoes_lidas').upsert({ chave, usuario_id: sessao.user.id });
  if (error) console.warn(error);
}
async function marcarTodasLidas() {
  const novas = alertas.filter((a) => !lidas.has(a.chave)).map((a) => ({ chave: a.chave, usuario_id: sessao.user.id }));
  if (!novas.length) return;
  novas.forEach((n) => lidas.add(n.chave)); atualizarContador(); renderAlertas();
  const { error } = await sb.from('notificacoes_lidas').upsert(novas);
  if (error) toastErro(error);
}
function atualizarContador() {
  const n = alertas.filter((x) => !lidas.has(x.chave)).length;
  const c = $('.btn-notif .contador'); if (c) { c.hidden = !n; c.textContent = n; }
}


window.addEventListener('beforeunload', (ev) => {
  if (paginaAtual?.temAlteracoes?.()) { ev.preventDefault(); ev.returnValue = ''; }
});

iniciar().catch((e) => { console.error(e); mount(raiz, erroBox(e)); });
