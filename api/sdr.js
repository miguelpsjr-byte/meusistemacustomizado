// SDR — ações da tela SDR do Admin. Só administradores logados.
// POST /api/sdr  { acao: '...', ...dados }
const { cors, limitado, autenticar, lerCorpo } = require('./_auth');
const S = require('./_sdr');
const { db, rpc, enc, erro } = S;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v, nome = 'id') => { if (!UUID.test(String(v || ''))) throw erro('entrada', `Parâmetro ${nome} inválido.`, 400); return v; };
const texto = (v, max) => (v == null ? null : String(v).slice(0, max));
const STATUS_EMPRESA = ['novo', 'enriquecido', 'em_cadencia', 'respondeu', 'interessado', 'reuniao', 'ganho', 'perdido', 'descartado'];
const CAMPOS_EMPRESA = { email: 200, whatsapp: 40, telefone: 40, instagram: 60, site: 300, responsavel: 120, gancho: 400, notas: 2000, fato: 400, prioridade: 1 };

async function mensagemSaida(mensagemId) {
  const [m] = await db(`mensagens?id=eq.${enc(id(mensagemId, 'mensagem_id'))}&direcao=eq.saida&select=*`);
  if (!m) throw erro('nao_encontrado', 'Mensagem não encontrada.', 404);
  return m;
}

const ACOES = {
  // Tudo que a tela precisa em uma chamada
  async painel() {
    const [fila, pendentes, respostas, funil, empresas, testes, enviados, historico] = await Promise.all([
      db('vw_fila_hoje?order=prioridade,proxima_acao_em'),
      db('mensagens?direcao=eq.saida&status=in.(rascunho,aprovado,falhou)&select=*,empresas(id,nome,cidade,prioridade,email,whatsapp,telefone,instagram,responsavel),cadencia_passos(ordem,dia,canal)&order=created_at.asc&limit=100'),
      db('mensagens?direcao=eq.entrada&select=*,empresas(id,nome,cidade,status)&order=recebido_em.desc.nullslast&limit=40'),
      db('vw_funil'),
      db('empresas?select=*,inscricoes(id,status,passo_atual,proxima_acao_em,motivo_parada)&order=prioridade,nome'),
      db('testes_atendimento?select=*&order=enviado_em.desc'),
      S.enviadosHoje(),
      db('mensagens?direcao=eq.saida&status=eq.enviado&select=id,empresa_id,canal,assunto,enviado_em,empresas(nome)&order=enviado_em.desc&limit=30')
    ]);
    return {
      fila, pendentes, respostas, funil, empresas, testes, historico,
      envio: { hoje: enviados, limite: S.limiteDia() },
      config: { smtp: !!(process.env.SMTP_USER && process.env.SMTP_PASS), ia: !!process.env.OPENAI_API_KEY, remetente: process.env.SMTP_USER || null }
    };
  },

  async gerar({ max }) { return S.gerarRascunhos({ max: Math.min(10, Math.max(1, Number(max) || 6)), prazoMs: 40000 }); },

  // Refaz o texto de um rascunho com a IA
  async regerar({ mensagem_id }) {
    const m = await mensagemSaida(mensagem_id);
    if (!['rascunho', 'aprovado', 'falhou'].includes(m.status)) throw erro('status', 'Essa mensagem já saiu.', 400);
    const [f] = await db(`vw_fila_hoje?inscricao_id=eq.${enc(m.inscricao_id)}`);
    if (!f) throw erro('fila', 'Esse passo não está na fila de hoje.', 400);
    const canalTexto = m.canal === 'tarefa' ? 'whatsapp_manual' : m.canal;
    const { assunto, corpo } = await S.gerarTexto(f, { canalEntrega: canalTexto });
    const [nova] = await db(`mensagens?id=eq.${enc(m.id)}`, { method: 'PATCH', body: { assunto, corpo, status: 'rascunho', erro: null } });
    return { mensagem: nova };
  },

  async salvar({ mensagem_id, assunto, corpo, para }) {
    const m = await mensagemSaida(mensagem_id);
    if (!['rascunho', 'aprovado', 'falhou'].includes(m.status)) throw erro('status', 'Essa mensagem já saiu.', 400);
    const patch = {};
    if (assunto !== undefined) patch.assunto = texto(assunto, 200);
    if (corpo !== undefined) { if (!String(corpo).trim()) throw erro('entrada', 'O texto não pode ficar vazio.', 400); patch.corpo = texto(corpo, 8000); }
    if (para !== undefined) patch.para = texto(para, 200);
    const [nova] = await db(`mensagens?id=eq.${enc(m.id)}`, { method: 'PATCH', body: patch });
    return { mensagem: nova };
  },

  // Aprova (e, se for e-mail, já tenta enviar dentro do limite do dia)
  async aprovar({ mensagem_id, assunto, corpo, para }) {
    const m = await mensagemSaida(mensagem_id);
    if (m.canal !== 'email') throw erro('canal', 'Mensagens de WhatsApp, Instagram e ligação você envia e depois marca como feitas.', 400);
    if (!['rascunho', 'falhou', 'aprovado'].includes(m.status)) throw erro('status', 'Essa mensagem já saiu.', 400);
    const patch = { status: 'aprovado', aprovado_em: new Date().toISOString(), erro: null };
    if (assunto !== undefined) patch.assunto = texto(assunto, 200);
    if (corpo !== undefined) patch.corpo = texto(corpo, 8000);
    if (para !== undefined) patch.para = texto(para, 200);
    if (!String(patch.corpo ?? m.corpo).includes('"sair"')) throw erro('entrada', 'Mantenha a linha para a pessoa responder "sair" (LGPD).', 400);
    await db(`mensagens?id=eq.${enc(m.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    const envio = await S.enviarMensagem(m.id);
    return { envio };
  },

  async descartar({ mensagem_id }) {
    const m = await mensagemSaida(mensagem_id);
    if (m.status === 'enviado') throw erro('status', 'Essa mensagem já saiu.', 400);
    await db(`mensagens?id=eq.${enc(m.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado' } });
    return { ok: true };
  },

  // WhatsApp / Instagram / ligação / tarefa feitos à mão: registra e avança a cadência
  async concluir({ mensagem_id, inscricao_id, corpo, resultado }) {
    let insc = inscricao_id;
    if (mensagem_id) {
      const m = await mensagemSaida(mensagem_id);
      if (m.canal === 'email') throw erro('canal', 'E-mails são enviados pelo botão Aprovar e enviar.', 400);
      if (m.status === 'enviado') return { ok: true };
      await db(`mensagens?id=eq.${enc(m.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: {
        status: 'enviado', enviado_em: new Date().toISOString(),
        ...(corpo !== undefined ? { corpo: texto(corpo, 8000) } : {}),
        ...(resultado ? { resumo_ia: texto(`Resultado: ${resultado}`, 600) } : {}) } });
      insc = m.inscricao_id;
    } else {
      const [f] = await db(`vw_fila_hoje?inscricao_id=eq.${enc(id(inscricao_id, 'inscricao_id'))}`);
      if (!f) throw erro('fila', 'Esse passo não está na fila de hoje.', 400);
      await db('mensagens', { method: 'POST', prefer: 'return=minimal', body: {
        empresa_id: f.empresa_id, inscricao_id: f.inscricao_id, passo_id: f.passo_id, canal: f.canal, direcao: 'saida',
        status: 'enviado', enviado_em: new Date().toISOString(), corpo: texto(corpo || resultado || 'Feito', 8000) } });
    }
    if (insc) await rpc('avancar', { p_inscricao: insc });
    return { ok: true };
  },

  // Pula o passo atual sem enviar nada
  async pular({ inscricao_id }) {
    id(inscricao_id, 'inscricao_id');
    await db(`mensagens?inscricao_id=eq.${enc(inscricao_id)}&direcao=eq.saida&status=in.(rascunho,aprovado,falhou)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado', erro: 'Passo pulado.' } });
    const [i] = await rpc('avancar', { p_inscricao: inscricao_id }).then((r) => (Array.isArray(r) ? r : [r]));
    return { inscricao: i };
  },

  async inscrever({ empresa_ids }) {
    const ids = (Array.isArray(empresa_ids) ? empresa_ids : []).slice(0, 30).map((x) => id(x, 'empresa_id'));
    const ok = [], falhas = [];
    for (const e of ids) {
      try { await rpc('inscrever', { p_empresa: e }); ok.push(e); } catch (er) { falhas.push({ empresa_id: e, erro: er.message }); }
    }
    return { inscritas: ok.length, falhas };
  },

  async pausar({ inscricao_id, motivo }) {
    await db(`inscricoes?id=eq.${enc(id(inscricao_id, 'inscricao_id'))}&status=eq.ativa`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', motivo_parada: texto(motivo || 'pausada à mão', 200) } });
    return { ok: true };
  },
  async retomar({ inscricao_id }) {
    await db(`inscricoes?id=eq.${enc(id(inscricao_id, 'inscricao_id'))}&status=eq.pausada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ativa', motivo_parada: null, proxima_acao_em: new Date().toISOString() } });
    return { ok: true };
  },

  async status_empresa({ empresa_id, status, motivo }) {
    if (!STATUS_EMPRESA.includes(status)) throw erro('entrada', 'Status inválido.', 400);
    const e = id(empresa_id, 'empresa_id');
    const [atual] = await db(`empresas?id=eq.${enc(e)}&select=status`);
    if (!atual) throw erro('entrada', 'Clínica não encontrada.', 404);
    if (atual.status === 'opt_out') throw erro('status', 'Essa clínica pediu para sair (opt-out) e não pode voltar para a prospecção.', 400);
    await db(`empresas?id=eq.${enc(e)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status, ...(motivo ? { motivo_perda: texto(motivo, 300) } : {}) } });
    if (status === 'em_cadencia') {
      // Voltou para "Aguardando resposta" no quadro: retoma a cadência pausada.
      await db(`inscricoes?empresa_id=eq.${enc(e)}&status=eq.pausada`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'ativa', motivo_parada: null, proxima_acao_em: new Date().toISOString() } });
    } else {
      // Qualquer outro status tira a clínica da cadência automática: pausa (pode voltar) ou interrompe (fechada).
      await db(`inscricoes?empresa_id=eq.${enc(e)}&status=eq.ativa`, { method: 'PATCH', prefer: 'return=minimal', body: { status: ['ganho', 'perdido', 'descartado'].includes(status) ? 'interrompida' : 'pausada', motivo_parada: `status: ${status}` } });
      await db(`mensagens?empresa_id=eq.${enc(e)}&direcao=eq.saida&status=in.(rascunho,aprovado)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado', erro: `Status mudou para ${status}.` } });
    }
    return { ok: true };
  },

  async salvar_empresa({ empresa_id, campos }) {
    const patch = {};
    for (const [k, max] of Object.entries(CAMPOS_EMPRESA)) {
      if (campos && Object.prototype.hasOwnProperty.call(campos, k)) {
        const v = campos[k] == null || String(campos[k]).trim() === '' ? null : String(campos[k]).trim().slice(0, max);
        patch[k] = v;
      }
    }
    if (patch.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw erro('entrada', 'E-mail inválido.', 400);
    if (patch.prioridade && !['A', 'B', 'C'].includes(patch.prioridade)) throw erro('entrada', 'Prioridade inválida.', 400);
    if (patch.instagram && !patch.instagram.startsWith('@')) patch.instagram = '@' + patch.instagram.replace(/^.*instagram\.com\//i, '').replace(/\/.*$/, '');
    if (!Object.keys(patch).length) return { ok: true };
    const [nova] = await db(`empresas?id=eq.${enc(id(empresa_id, 'empresa_id'))}`, { method: 'PATCH', body: patch });
    // Atualiza o destinatário de rascunhos de e-mail ainda não enviados
    if ('email' in patch) await db(`mensagens?empresa_id=eq.${enc(empresa_id)}&canal=eq.email&direcao=eq.saida&status=in.(rascunho,aprovado,falhou)`, { method: 'PATCH', prefer: 'return=minimal', body: { para: patch.email } });
    return { empresa: nova };
  },

  async optout({ empresa_id }) {
    const [e] = await db(`empresas?id=eq.${enc(id(empresa_id, 'empresa_id'))}&select=id,email,whatsapp`);
    if (!e) throw erro('nao_encontrado', 'Clínica não encontrada.', 404);
    await S.registrarOptOut({ empresaId: e.id, email: e.email, telefone: e.whatsapp, motivo: 'marcado à mão' });
    await db(`mensagens?empresa_id=eq.${enc(e.id)}&direcao=eq.saida&status=in.(rascunho,aprovado)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado', erro: 'Opt-out.' } });
    return { ok: true };
  },

  async enriquecer({ empresa_id }) { return S.enriquecer(id(empresa_id, 'empresa_id')); },
  async ler_respostas() { return S.lerRespostas({ prazoMs: 40000 }); },
  async enviar_aprovados() { return S.enviarAprovados(); },

  // Manda um e-mail de teste para a própria caixa (confere SMTP_USER/SMTP_PASS)
  async teste_smtp() {
    const para = process.env.SMTP_USER;
    await S.smtp().sendMail({ from: S.remetente(), to: para, subject: '[SDR] Teste de envio', text: 'Se este e-mail chegou, o envio pelo SMTP da GoDaddy está funcionando.\n\nMeu Sistema Customizado · SDR' });
    return { ok: true, para };
  },

  async teste_oculto({ id: testeId, empresa_id, canal, enviado_em, primeira_resposta_em, passou_preco, followup_d3, followup_d7, notas }) {
    const corpo = {
      empresa_id: id(empresa_id, 'empresa_id'),
      canal: ['whatsapp', 'instagram', 'site', 'telefone'].includes(canal) ? canal : 'whatsapp',
      enviado_em: enviado_em ? new Date(enviado_em).toISOString() : null,
      primeira_resposta_em: primeira_resposta_em ? new Date(primeira_resposta_em).toISOString() : null,
      passou_preco: typeof passou_preco === 'boolean' ? passou_preco : null,
      followup_d3: typeof followup_d3 === 'boolean' ? followup_d3 : null,
      followup_d7: typeof followup_d7 === 'boolean' ? followup_d7 : null,
      notas: texto(notas, 1000)
    };
    if (!corpo.enviado_em) throw erro('entrada', 'Informe quando a mensagem foi enviada.', 400);
    if (corpo.primeira_resposta_em && corpo.primeira_resposta_em < corpo.enviado_em) throw erro('entrada', 'A resposta não pode ser antes do envio.', 400);
    const r = testeId
      ? await db(`testes_atendimento?id=eq.${enc(id(testeId))}`, { method: 'PATCH', body: corpo })
      : await db('testes_atendimento', { method: 'POST', body: corpo });
    return { teste: r[0] };
  }
};

// Ações que chamam serviços externos (IA, SMTP, IMAP, sites) têm limite próprio
const PESADAS = new Set(['gerar', 'regerar', 'aprovar', 'enriquecer', 'ler_respostas', 'enviar_aprovados', 'teste_smtp']);

module.exports = async (req, res) => {
  if (!cors(req, res)) return;
  const quem = await autenticar(req, res);
  if (!quem) return;
  if (quem.perfil.role !== 'admin') return res.status(403).json({ error: 'forbidden', mensagem: 'Só administradores usam o SDR.' });

  let corpo;
  try { corpo = await lerCorpo(req, 60000); } catch { return res.status(400).json({ error: 'entrada', mensagem: 'Dados inválidos.' }); }
  const acao = String(corpo.acao || '');
  const fn = Object.prototype.hasOwnProperty.call(ACOES, acao) ? ACOES[acao] : null;
  if (!fn) return res.status(400).json({ error: 'acao', mensagem: 'Ação desconhecida.' });
  if (limitado(`sdr:${quem.user.id}`, 120, 5) || (PESADAS.has(acao) && limitado(`sdr-p:${quem.user.id}`, 40, 10))) {
    return res.status(429).json({ error: 'limite', mensagem: 'Muitas ações seguidas. Aguarde alguns minutos.' });
  }
  try {
    const r = await fn(corpo);
    return res.status(200).json(r || { ok: true });
  } catch (e) {
    console.error('SDR', acao, e.message, e.detalhe || '');
    return res.status(e.status || 500).json({ error: e.codigo || 'erro', mensagem: e.message || 'Erro inesperado.' });
  }
};
