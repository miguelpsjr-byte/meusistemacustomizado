// Estado da sessão e cache de tabelas de apoio (serviços, etapas, equipe, empresa).
import { sb, q } from './supabase.js';

export const sessao = { user: null, perfil: null };
export const ehAdmin = () => sessao.perfil?.role === 'admin';

const cache = new Map();
const carregadores = {
  servicos: () => q(sb.from('servicos').select('*').order('ordem').order('nome')),
  etapas: () => q(sb.from('crm_etapas').select('*').order('ordem')),
  equipe: () => q(sb.from('profiles').select('id,nome,email,role,ativo').order('nome')),
  config: async () => Object.fromEntries((await q(sb.from('configuracoes').select('chave,valor'))).map((c) => [c.chave, c.valor]))
};

export async function apoio(nome, forcar = false) {
  if (!forcar && cache.has(nome)) return cache.get(nome);
  const p = carregadores[nome]().catch((e) => { cache.delete(nome); throw e; });
  cache.set(nome, p);
  return p;
}
export function invalidar(...nomes) { (nomes.length ? nomes : [...cache.keys()]).forEach((n) => cache.delete(n)); }

// Pequeno barramento de eventos para atualizar telas/indicadores após mudanças.
const ouvintes = new Map();
export function ao(evento, fn) {
  if (!ouvintes.has(evento)) ouvintes.set(evento, new Set());
  ouvintes.get(evento).add(fn);
  return () => ouvintes.get(evento)?.delete(fn);
}
export function emitir(evento, dados) { ouvintes.get(evento)?.forEach((fn) => { try { fn(dados); } catch (e) { console.error(e); } }); }
