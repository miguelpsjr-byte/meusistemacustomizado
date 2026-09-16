// Utilitários de interface compartilhados.
// Toda interpolação em html`` é escapada automaticamente (proteção contra XSS).
// Use raw() apenas para HTML já confiável (ícones, markup gerado por nós, HTML sanitizado).
import { icon } from './icons.js';

export class Raw { constructor(s) { this.s = String(s ?? ''); } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

function val(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(val).join('');
  if (v === false || v === null || v === undefined) return '';
  return esc(v);
}
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return new Raw(out);
}
export function mount(el, content) { el.innerHTML = val(content); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Formatação ----------
const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (n) => brlFmt.format(Number(n || 0));
export const num = (n) => new Intl.NumberFormat('pt-BR').format(Number(n || 0));

export function hojeISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDiasISO(iso, dias) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + dias);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
export function data(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
export function dataHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' —');
}
export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const MESES_CURTOS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export function mesLabel(iso, curto = false) {
  const [y, m] = String(iso).split('-').map(Number);
  return `${(curto ? MESES_CURTOS : MESES)[m - 1]}${curto ? '/' + String(y).slice(2) : ' ' + y}`;
}
export function duracao(segundos) {
  if (segundos == null) return '—';
  const s = Math.max(0, Number(segundos));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
export const plural = (n, um, varios) => `${n} ${Math.abs(n) === 1 ? um : varios}`;
export const iniciais = (nome) => String(nome || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// ---------- Rótulos ----------
export const FORMAS_PAGAMENTO = { pix: 'PIX', transferencia: 'Transferência', cartao: 'Cartão', boleto: 'Boleto', dinheiro: 'Dinheiro', outro: 'Outro' };
export const PERIODICIDADES = { unica: 'Pagamento único', semanal: 'Semanal', quinzenal: 'Quinzenal', mensal: 'Mensal', personalizada: 'Personalizada' };
export const PRIORIDADES = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
export const STATUS_PROJETO = { ativo: 'Ativo', pausado: 'Pausado', concluido: 'Concluído', cancelado: 'Cancelado', perdido: 'Perdido' };
export const STATUS_PARCELA = { pendente: 'Pendente', pago: 'Pago', vencido: 'Vencido', cancelado: 'Cancelado' };
export const STATUS_CONTRATO = { rascunho: 'Rascunho', em_revisao: 'Em revisão', finalizado: 'Finalizado', cancelado: 'Cancelado' };

export function slaBadge(p) {
  const map = {
    no_prazo: ['ok', 'check', 'Dentro do prazo'],
    proximo: ['alerta', 'clock', 'Próximo do vencimento'],
    atrasado: ['erro', 'alert', 'Atrasado'],
    entregue_no_prazo: ['ok', 'check', 'Entregue no prazo'],
    entregue_com_atraso: ['alerta', 'alert', 'Entregue com atraso'],
    sem_sla: ['neutro', 'minus', 'Sem SLA']
  };
  const [tom, ic, txt] = map[p.sla_status] || map.sem_sla;
  let detalhe = '';
  if (p.sla_status === 'atrasado') detalhe = `há ${plural(-p.dias_restantes, 'dia', 'dias')}`;
  else if (p.sla_status === 'no_prazo' || p.sla_status === 'proximo') detalhe = `${plural(p.dias_restantes, 'dia restante', 'dias restantes')}`;
  return html`<span class="badge badge-${tom}">${raw(icon(ic, 14))}<span>${txt}${detalhe ? ' · ' + detalhe : ''}</span></span>`;
}
export function statusParcelaBadge(st) {
  const tom = { pendente: 'neutro', pago: 'ok', vencido: 'erro', cancelado: 'apagado' }[st] || 'neutro';
  const ic = { pendente: 'clock', pago: 'check', vencido: 'alert', cancelado: 'x' }[st] || 'clock';
  return html`<span class="badge badge-${tom}">${raw(icon(ic, 14))}${STATUS_PARCELA[st] || st}</span>`;
}
export function prioridadeBadge(p) {
  return html`<span class="prio prio-${p}" title="Prioridade ${PRIORIDADES[p]}">${PRIORIDADES[p] || p}</span>`;
}
export function opcoes(map, selecionado, vazio) {
  const itens = Object.entries(map).map(([v, t]) => html`<option value="${v}" ${String(v) === String(selecionado ?? '') ? raw('selected') : ''}>${t}</option>`);
  return html`${vazio !== undefined ? html`<option value="">${vazio}</option>` : ''}${itens}`;
}
export function opcoesLista(lista, selecionado, vazio, { valor = 'id', texto = 'nome' } = {}) {
  return opcoes(Object.fromEntries(lista.map((i) => [i[valor], typeof texto === 'function' ? texto(i) : i[texto]])), selecionado, vazio);
}

// ---------- Estados ----------
export const carregando = (txt = 'Carregando…') => html`<div class="estado estado-carregando" role="status"><span class="spinner"></span>${txt}</div>`;
export function vazio({ titulo, texto = '', acao = '', acaoId = '' }) {
  return html`<div class="estado estado-vazio">
    <div class="vazio-blocos" aria-hidden="true"><i></i><i></i><i></i><i class="tracejado"></i></div>
    <strong>${titulo}</strong>${texto ? html`<p>${texto}</p>` : ''}
    ${acao ? html`<button class="btn btn-primario" data-acao="${acaoId}">${raw(icon('plus', 16))}${acao}</button>` : ''}
  </div>`;
}
export const erroBox = (e) => html`<div class="estado estado-erro" role="alert">${raw(icon('alert', 18))}<div><strong>Não foi possível carregar.</strong><p>${mensagemErro(e)}</p></div></div>`;

export function mensagemErro(e) {
  const msg = e?.message || String(e || '');
  const code = e?.code || '';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  if (code === '23505') return 'Já existe um registro com esses dados (por exemplo, CPF/CNPJ ou nome repetido).';
  if (code === '23503') return 'Este registro está vinculado a outros dados e não pode ser removido.';
  if (code === '42501' || /row-level security|permission denied/i.test(msg)) return 'Seu usuário não tem permissão para esta ação.';
  if (code === '23514') return 'Algum valor está fora do permitido. Confira os campos e tente de novo.';
  if (code === 'PGRST301' || /JWT/i.test(msg)) return 'Sua sessão expirou. Entre novamente.';
  return msg || 'Erro inesperado.';
}

// ---------- Toast ----------
export function toast(msg, tipo = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast toast-${tipo}`;
  mount(el, html`${raw(icon(tipo === 'erro' ? 'alert' : 'check', 16))}<span>${msg}</span>`);
  box.appendChild(el);
  setTimeout(() => { el.classList.add('saindo'); setTimeout(() => el.remove(), 250); }, tipo === 'erro' ? 6000 : 3200);
}
export const toastErro = (e) => toast(mensagemErro(e), 'erro');

// ---------- Modal ----------
const pilha = [];
export function abrirModal({ titulo, corpo, rodape = '', tamanho = 'm', aoFechar, classe = '' }) {
  const anterior = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  mount(wrap, html`<div class="modal modal-${tamanho} ${classe}" role="dialog" aria-modal="true" aria-labelledby="mt-${pilha.length}">
    <header class="modal-topo"><h2 id="mt-${pilha.length}">${titulo}</h2>
      <button class="btn-icone" data-fechar aria-label="Fechar">${raw(icon('x', 20))}</button></header>
    <div class="modal-corpo">${corpo}</div>
    ${rodape ? html`<footer class="modal-rodape">${rodape}</footer>` : ''}
  </div>`);
  document.body.appendChild(wrap);
  document.body.classList.add('sem-rolagem');
  let fechado = false;
  const api = {
    el: wrap.querySelector('.modal'),
    corpo: wrap.querySelector('.modal-corpo'),
    rodape: wrap.querySelector('.modal-rodape'),
    fechar(resultado) {
      if (fechado) return; fechado = true;
      wrap.remove(); pilha.splice(pilha.indexOf(api), 1);
      if (!pilha.length) document.body.classList.remove('sem-rolagem');
      document.removeEventListener('keydown', onKey);
      anterior?.focus?.();
      aoFechar?.(resultado);
    }
  };
  const onKey = (ev) => {
    if (pilha[pilha.length - 1] !== api) return;
    if (ev.key === 'Escape') { ev.preventDefault(); api.fechar(); }
    if (ev.key === 'Tab') {
      const f = $$('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[contenteditable="true"],[tabindex]:not([tabindex="-1"])', api.el).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (ev.shiftKey && document.activeElement === f[0]) { ev.preventDefault(); f[f.length - 1].focus(); }
      else if (!ev.shiftKey && document.activeElement === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) api.fechar(); });
  wrap.addEventListener('click', (ev) => { if (ev.target.closest('[data-fechar]')) api.fechar(); });
  pilha.push(api);
  setTimeout(() => ($('[autofocus]', api.el) || $('input,select,textarea', api.corpo) || $('[data-fechar]', api.el))?.focus(), 30);
  return api;
}

export function confirmar({ titulo = 'Confirmar ação', mensagem, confirmar: txt = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    let ok = false;
    const m = abrirModal({
      titulo, tamanho: 's',
      corpo: html`<p class="texto-confirmacao">${mensagem}</p>`,
      rodape: html`<button class="btn btn-secundario" data-fechar>Voltar</button>
        <button class="btn ${perigo ? 'btn-perigo' : 'btn-primario'}" data-ok autofocus>${txt}</button>`,
      aoFechar: () => resolve(ok)
    });
    m.el.querySelector('[data-ok]').addEventListener('click', () => { ok = true; m.fechar(); });
  });
}

// ---------- Formulários ----------
export function lerForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') { out[el.name] = el.checked; continue; }
    if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; continue; }
    let v = typeof el.value === 'string' ? el.value.trim() : el.value;
    if (v === '') v = null;
    else if (el.dataset.tipo === 'numero') v = Number(String(v).replace(/\./g, '').replace(',', '.'));
    else if (el.dataset.tipo === 'inteiro') v = parseInt(v, 10);
    out[el.name] = v;
  }
  return out;
}
export async function comBotao(btn, fn) {
  if (btn.disabled) return;
  const original = btn.innerHTML;
  btn.disabled = true; btn.classList.add('ocupado');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('ocupado'); btn.innerHTML = original; }
}
export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
// Valor numérico digitado em formato brasileiro (1.234,56) ou com ponto decimal
export function parseValor(txt) {
  if (txt == null || txt === '') return 0;
  const s = String(txt).trim();
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
export const valorInput = (n) => (n == null ? '' : Number(n).toFixed(2).replace('.', ','));

export function documentoValido(doc) {
  const d = String(doc || '').replace(/\D/g, '');
  if (!d) return true;
  if (/^(\d)\1+$/.test(d)) return false;
  if (d.length === 11) {
    for (const t of [9, 10]) {
      let s = 0; for (let i = 0; i < t; i++) s += Number(d[i]) * (t + 1 - i);
      if (((s * 10) % 11) % 10 !== Number(d[t])) return false;
    }
    return true;
  }
  if (d.length === 14) {
    const calc = (len) => {
      const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
      const r = s % 11; return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}
// Remove caracteres que alteram a sintaxe de filtros do PostgREST
export const termoBusca = (s) => String(s || '').replace(/[,()*%\\:"']/g, ' ').trim().slice(0, 60);
