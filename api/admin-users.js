// Gestão de usuários do Admin (somente administradores).
// Variável obrigatória na Vercel: SUPABASE_SERVICE_ROLE_KEY (nunca exposta ao navegador).
const { SUPABASE_URL, cors, limitado, autenticar, lerCorpo } = require('./_auth.js');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

module.exports = async (req, res) => {
  if (!cors(req, res)) return;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service) return res.status(503).json({ error: 'not_configured', mensagem: 'Gestão de usuários não configurada.' });

  const sessao = await autenticar(req, res); if (!sessao) return;
  if (sessao.perfil.role !== 'admin') return res.status(403).json({ error: 'forbidden', mensagem: 'Somente administradores podem gerenciar usuários.' });
  if (limitado(`users:${sessao.user.id}`, 30, 10)) return res.status(429).json({ error: 'rate_limited', mensagem: 'Muitas ações seguidas. Aguarde alguns minutos.' });

  let corpo;
  try { corpo = await lerCorpo(req, 5000); } catch { return res.status(400).json({ error: 'bad_request', mensagem: 'Requisição inválida.' }); }
  const h = { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' };
  const authAdmin = (caminho, metodo, body) => fetch(`${SUPABASE_URL}/auth/v1/admin/${caminho}`, { method: metodo, headers: h, body: body ? JSON.stringify(body) : undefined });
  const perfis = (filtro, metodo = 'GET', body) => fetch(`${SUPABASE_URL}/rest/v1/profiles?${filtro}`, { method: metodo, headers: { ...h, Prefer: 'return=representation' }, body: body ? JSON.stringify(body) : undefined });
  const falha = async (r, padrao) => { const j = await r.json().catch(() => ({})); return res.status(r.status >= 500 ? 502 : 400).json({ error: 'upstream', mensagem: traduzir(j.msg || j.message || j.error_description || padrao) }); };

  try {
    const { acao } = corpo;

    if (acao === 'criar') {
      const nome = String(corpo.nome || '').trim().slice(0, 120);
      const email = String(corpo.email || '').trim().toLowerCase();
      const senha = String(corpo.senha || '');
      const role = corpo.role === 'admin' ? 'admin' : 'usuario';
      if (!nome || !EMAIL.test(email)) return res.status(400).json({ error: 'bad_request', mensagem: 'Informe nome e e-mail válidos.' });
      if (senha.length < 10 || senha.length > 72) return res.status(400).json({ error: 'bad_request', mensagem: 'A senha deve ter entre 10 e 72 caracteres.' });
      const r = await authAdmin('users', 'POST', { email, password: senha, email_confirm: true, user_metadata: { nome } });
      if (!r.ok) return falha(r, 'Não foi possível criar o usuário.');
      const novo = await r.json();
      if (role === 'admin') await perfis(`id=eq.${novo.id}`, 'PATCH', { role: 'admin' });
      return res.status(200).json({ ok: true, id: novo.id });
    }

    const id = String(corpo.id || '');
    if (!UUID.test(id)) return res.status(400).json({ error: 'bad_request', mensagem: 'Usuário inválido.' });
    if (id === sessao.user.id) return res.status(400).json({ error: 'bad_request', mensagem: 'Use Meu perfil para alterar a sua própria conta.' });
    const alvoResp = await perfis(`id=eq.${id}&select=id,role,ativo`);
    const [alvo] = alvoResp.ok ? await alvoResp.json() : [];
    if (!alvo) return res.status(404).json({ error: 'not_found', mensagem: 'Usuário não encontrado.' });

    const ultimoAdmin = async () => {
      const r = await perfis('role=eq.admin&ativo=eq.true&select=id');
      const lista = r.ok ? await r.json() : [];
      return lista.length <= 1 && lista.some((x) => x.id === id);
    };

    if (acao === 'redefinir_senha') {
      const senha = String(corpo.senha || '');
      if (senha.length < 10 || senha.length > 72) return res.status(400).json({ error: 'bad_request', mensagem: 'A senha deve ter entre 10 e 72 caracteres.' });
      const r = await authAdmin(`users/${id}`, 'PUT', { password: senha });
      if (!r.ok) return falha(r, 'Não foi possível redefinir a senha.');
      return res.status(200).json({ ok: true });
    }

    if (acao === 'definir_ativo') {
      const ativo = corpo.ativo === true;
      if (!ativo && alvo.role === 'admin' && await ultimoAdmin()) return res.status(400).json({ error: 'bad_request', mensagem: 'Não é possível desativar o último administrador.' });
      const p = await perfis(`id=eq.${id}`, 'PATCH', { ativo });
      if (!p.ok) return falha(p, 'Não foi possível atualizar o usuário.');
      // Bloqueia também o login no Supabase Auth (o RLS já corta o acesso aos dados imediatamente)
      const r = await authAdmin(`users/${id}`, 'PUT', { ban_duration: ativo ? 'none' : '876000h' });
      if (!r.ok) return falha(r, 'Usuário atualizado, mas o bloqueio de login falhou.');
      return res.status(200).json({ ok: true });
    }

    if (acao === 'definir_papel') {
      const role = corpo.role === 'admin' ? 'admin' : corpo.role === 'usuario' ? 'usuario' : null;
      if (!role) return res.status(400).json({ error: 'bad_request', mensagem: 'Papel inválido.' });
      if (role === 'usuario' && alvo.role === 'admin' && await ultimoAdmin()) return res.status(400).json({ error: 'bad_request', mensagem: 'É preciso manter ao menos um administrador ativo.' });
      const p = await perfis(`id=eq.${id}`, 'PATCH', { role });
      if (!p.ok) return falha(p, 'Não foi possível alterar o papel.');
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'bad_request', mensagem: 'Ação desconhecida.' });
  } catch (e) {
    console.error('admin-users', e);
    return res.status(500).json({ error: 'internal', mensagem: 'Erro interno. Tente de novo.' });
  }
};

function traduzir(msg) {
  const m = String(msg || '');
  if (/already (been )?registered|already exists/i.test(m)) return 'Já existe um usuário com esse e-mail.';
  if (/password/i.test(m) && /weak|short|pwned|leaked/i.test(m)) return 'Senha fraca ou já vazada. Escolha outra.';
  return m.slice(0, 200);
}
