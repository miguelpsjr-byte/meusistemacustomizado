// Utilitários compartilhados pelas funções do Admin (não é uma rota: o prefixo _ é ignorado pela Vercel).
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hebwwsgowdnttdevgrmo.supabase.co';
const SUPABASE_PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_d3QMEx24eJjEIZlRVnKOng_p9KQeZpw';

const ORIGENS_FIXAS = [
  'https://www.meusistemacustomizado.com',
  'https://meusistemacustomizado.com',
  'https://meusistemacustomizado.vercel.app'
];
// Previews da Vercel deste projeto
const ORIGEM_PREVIEW = /^https:\/\/meusistemacustomizado-[a-z0-9-]+-miguelpsjr(?:-[a-z0-9]+)?\.vercel\.app$/;
const origemPermitida = (o) => ORIGENS_FIXAS.includes(o) || ORIGEM_PREVIEW.test(o);

function cors(req, res, metodos = 'POST, OPTIONS') {
  const origin = req.headers.origin || '';
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', 'no-store');
  if (origemPermitida(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', metodos);
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return false; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed', mensagem: 'Método não permitido.' }); return false; }
  if (origin && !origemPermitida(origin)) { res.status(403).json({ error: 'forbidden', mensagem: 'Origem não permitida.' }); return false; }
  return true;
}

const janelas = new Map();
function limitado(chave, max, minutos) {
  const agora = Date.now();
  const lista = (janelas.get(chave) || []).filter((t) => agora - t < minutos * 60000);
  lista.push(agora); janelas.set(chave, lista);
  return lista.length > max;
}

// Valida o token do usuário no Supabase e devolve { user, perfil } ou responde com erro.
async function autenticar(req, res) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || token.length > 4096) { res.status(401).json({ error: 'unauthorized', mensagem: 'Sessão inválida. Entre novamente.' }); return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) { res.status(401).json({ error: 'unauthorized', mensagem: 'Sessão expirada. Entre novamente.' }); return null; }
    const user = await r.json();
    // Consulta o próprio perfil com o token do usuário (o RLS garante que é o dele)
    const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,role,ativo,email`, { headers: { apikey: SUPABASE_PUBLIC_KEY, Authorization: `Bearer ${token}` } });
    const [perfil] = p.ok ? await p.json() : [];
    if (!perfil || !perfil.ativo) { res.status(403).json({ error: 'forbidden', mensagem: 'Seu acesso está desativado.' }); return null; }
    return { user, perfil };
  } catch {
    res.status(502).json({ error: 'upstream', mensagem: 'Não foi possível validar a sessão. Tente de novo.' });
    return null;
  }
}

async function lerCorpo(req, limiteBytes = 100000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { if (req.body.length > limiteBytes) throw new Error('grande'); return JSON.parse(req.body || '{}'); }
  return {};
}

module.exports = { SUPABASE_URL, cors, limitado, autenticar, lerCorpo };
