// Cliente único do Supabase + helper que transforma erros em exceções.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'msc-admin-auth' }
});

// Executa uma consulta do supabase-js e lança o erro, se houver.
export async function q(consulta) {
  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}
// Igual a q(), mas devolve também o total (para paginação).
export async function qc(consulta) {
  const { data, error, count } = await consulta;
  if (error) throw error;
  return { data, count: count ?? 0 };
}

// Chamada autenticada às funções serverless do próprio site (/api/*).
export async function api(caminho, corpo) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Sua sessão expirou. Entre novamente.');
  let resp;
  try {
    resp = await fetch(caminho, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(corpo)
    });
  } catch { throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.'); }
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(json.mensagem || `Erro ${resp.status}`);
    e.status = resp.status; e.codigo = json.error;
    throw e;
  }
  return json;
}
