// Meu perfil: nome e troca de senha (confirma a senha atual antes).
import { sb, q } from '../core/supabase.js';
import { sessao, invalidar } from '../core/store.js';
import { html, raw, mount, $, toast, toastErro, comBotao, iniciais } from '../core/ui.js';
import { icon } from '../core/icons.js';

export async function render(view) {
  const p = sessao.perfil;
  mount(view, html`
    <div class="pagina-topo"><div><h1>Meu perfil</h1><p>${p.email} · ${p.role === 'admin' ? 'Administrador' : 'Usuário'}</p></div></div>
    <div class="metade" style="margin-top:0;max-width:980px">
      <section class="painel">
        <div class="painel-topo"><h2>Dados</h2></div>
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px"><span class="avatar avatar-l" data-avatar>${iniciais(p.nome || p.email)}</span><div><b>${p.email}</b><br><span style="color:var(--texto-3);font-size:13px">O e-mail só pode ser alterado por um administrador.</span></div></div>
        <form data-dados novalidate>
          <label class="campo"><span>Nome</span><input name="nome" value="${p.nome || ''}" maxlength="120" autocomplete="name"></label>
          <div class="form-acoes"><button class="btn btn-primario" type="submit">Salvar nome</button></div>
        </form>
      </section>
      <section class="painel">
        <div class="painel-topo"><h2>Trocar senha</h2></div>
        <form data-senha novalidate>
          <div class="grade" style="grid-template-columns:1fr">
            <label class="campo"><span>Senha atual</span><input name="atual" type="password" autocomplete="current-password" required></label>
            <label class="campo"><span>Nova senha</span><input name="nova" type="password" autocomplete="new-password" minlength="10" required><small>Mínimo de 10 caracteres, misturando letras e números.</small></label>
            <label class="campo"><span>Confirmar nova senha</span><input name="confirma" type="password" autocomplete="new-password" required></label>
          </div>
          <div class="form-acoes"><button class="btn btn-primario" type="submit">${raw(icon('lock', 16))}Trocar senha</button></div>
        </form>
      </section>
    </div>`);

  $('[data-dados]', view).addEventListener('submit', (ev) => { ev.preventDefault(); comBotao($('button', ev.target), async () => {
    const nome = ev.target.nome.value.trim();
    if (!nome) return toast('Informe seu nome.', 'erro');
    try {
      await q(sb.from('profiles').update({ nome }).eq('id', p.id));
      sessao.perfil.nome = nome; invalidar('equipe');
      $('.usuario-btn .nome')?.replaceChildren(nome);
      $('[data-avatar]', view).textContent = iniciais(nome);
      toast('Nome salvo.');
    } catch (e) { toastErro(e); }
  }); });

  $('[data-senha]', view).addEventListener('submit', (ev) => { ev.preventDefault(); const f = ev.target; comBotao($('button', f), async () => {
    const { atual, nova, confirma } = { atual: f.atual.value, nova: f.nova.value, confirma: f.confirma.value };
    if (!atual) return toast('Informe a senha atual.', 'erro');
    if (nova.length < 10 || !/[A-Za-z]/.test(nova) || !/\d/.test(nova)) return toast('A nova senha precisa ter 10 caracteres ou mais, com letras e números.', 'erro');
    if (nova !== confirma) return toast('A confirmação não bate com a nova senha.', 'erro');
    if (nova === atual) return toast('A nova senha deve ser diferente da atual.', 'erro');
    const { error: erroLogin } = await sb.auth.signInWithPassword({ email: p.email, password: atual });
    if (erroLogin) return toast('Senha atual incorreta.', 'erro');
    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) return toast(/same|different/i.test(error.message) ? 'A nova senha deve ser diferente da atual.' : /weak|pwned|leaked/i.test(error.message) ? 'Essa senha é fraca ou já apareceu em vazamentos. Escolha outra.' : error.message, 'erro');
    f.reset(); toast('Senha trocada.');
  }); });
}
