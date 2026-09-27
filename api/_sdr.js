// SDR — núcleo compartilhado (não é rota: o prefixo _ é ignorado pela Vercel).
// Usado por api/sdr.js (tela SDR do Admin) e api/sdr-cron.js (rotina diária).
//
// Variáveis na Vercel:
//   SUPABASE_SERVICE_ROLE_KEY  chave secreta do Supabase (sb_secret_... ou service_role)
//   SMTP_USER / SMTP_PASS      caixa da GoDaddy que envia e recebe (Workspace Email)
//   OPENAI_API_KEY             gera rascunhos e classifica respostas
//   OPENAI_MODEL               opcional (padrão gpt-4o-mini)
//   SDR_LIMITE_DIA             opcional: máximo de e-mails frios por dia (padrão 5)
//   SDR_AVISO_PARA             opcional: onde avisar quando alguém responder (padrão SMTP_USER)
const { SUPABASE_URL } = require('./_auth');

const SMTP_HOST = 'smtpout.secureserver.net';
const IMAP_HOST = 'imap.secureserver.net';
const TZ = 'America/Sao_Paulo';

const limiteDia = () => Math.max(1, Math.min(50, parseInt(process.env.SDR_LIMITE_DIA || '5', 10) || 5));
const avisoPara = () => process.env.SDR_AVISO_PARA || process.env.SMTP_USER;

// ---------------------------------------------------------------------
// Banco (PostgREST no schema "sdr", com a chave secreta)
// ---------------------------------------------------------------------
function chave() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw erro('config', 'Falta a variável SUPABASE_SERVICE_ROLE_KEY na Vercel.');
  return k;
}
function erro(codigo, mensagem, status = 500) {
  const e = new Error(mensagem); e.codigo = codigo; e.status = status; return e;
}

async function db(caminho, { method = 'GET', body, prefer } = {}) {
  const k = chave();
  const headers = {
    apikey: k, Authorization: `Bearer ${k}`,
    'Accept-Profile': 'sdr', 'Content-Profile': 'sdr',
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  else if (method !== 'GET') headers.Prefer = 'return=representation';
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${caminho}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const texto = await r.text();
  const json = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    const e = erro(json?.code || 'db', json?.message || `Erro ${r.status} no banco`, r.status >= 500 ? 502 : 400);
    e.detalhe = json; throw e;
  }
  return json;
}
const rpc = (fn, args) => db(`rpc/${fn}`, { method: 'POST', body: args || {} });
const enc = encodeURIComponent;

// ---------------------------------------------------------------------
// Datas
// ---------------------------------------------------------------------
function hojeSP() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
// Início do dia de hoje em Brasília, em ISO UTC (Brasília é UTC-3 o ano todo desde 2019)
const inicioHojeISO = () => new Date(`${hojeSP()}T00:00:00-03:00`).toISOString();

// ---------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------
async function ia(mensagens, { json = true, max = 700, temperatura = 0.6 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw erro('config', 'Falta a variável OPENAI_API_KEY na Vercel.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: mensagens, max_tokens: max, temperature: temperatura,
        ...(json ? { response_format: { type: 'json_object' } } : {})
      })
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) throw erro('ia', `A IA não respondeu (${out?.error?.message || r.status}).`, 502);
    const txt = out.choices?.[0]?.message?.content || '';
    return json ? JSON.parse(txt) : txt;
  } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------------
// Rascunhos personalizados
// ---------------------------------------------------------------------
const ASSINATURA = 'Miguel\nMeu Sistema Customizado · Balneário Camboriú\nwww.meusistemacustomizado.com';
const RODAPE_OPTOUT = 'Se não quiser mais receber, é só responder "sair".';

const SISTEMA_RASCUNHO = `Você escreve mensagens de prospecção B2B do Miguel, dono da Meu Sistema Customizado (Balneário Camboriú/SC), empresa que cria chatbot com IA, CRM e automações para pequenas empresas.
Destinatário: uma clínica de estética de Balneário Camboriú ou Itajaí.

Regras:
- Português do Brasil, tom de vizinho de negócio: direto, educado, sem bajulação, sem emoji, sem exclamações em excesso.
- Siga o MODELO do passo e a INSTRUÇÃO do passo. Mantenha a ideia, o tamanho e a pergunta final do modelo.
- Substitua {{nome}} pelo "Nome da clínica para usar no texto" dos dados, exatamente como está.
- Comece a mensagem com o "Cumprimento de abertura" dos dados (troca o "Oi, tudo bem?" do modelo).
- {{gancho}}: 1 frase citando algo REAL dos dados (fato, procedimento, cidade, resultado do cliente oculto). Nunca invente números, prêmios, anos ou elogios que não estejam nos dados.
- Se houver resultado de cliente oculto, ele é o melhor gancho, mas cite com tato ("mandei uma mensagem pelo WhatsApp de vocês na terça, às 14h10, e..."), sem acusar. Use o dia e a hora que vierem nos dados, de forma natural; nunca invente datas.
- Não cite avaliações negativas do Google. Não fale de concorrentes pelo nome.
- Nada de links inventados. Se o modelo tiver [link do vídeo], mantenha exatamente "[link do vídeo]".
- Preço só se o modelo já trouxer.
- Nunca diga que mandou e-mail quando os dados disserem que a clínica não tem e-mail: nesse caso os contatos anteriores foram por WhatsApp/Instagram, então trate como continuação da conversa ("te chamei aqui na segunda...") ou como primeiro contato, conforme o toque.
- Não inclua assinatura nem rodapé: eles são adicionados depois.
Responda em JSON: {"assunto": "...", "corpo": "..."} (assunto vazio quando o canal não for e-mail).`;

// Nome como aparece no texto: sem "TESTE -", sem sufixo de cidade/rede
function nomeTexto(nome) {
  return String(nome || '').replace(/^TESTE\s*-\s*/i, '').replace(/\s+-\s+(Balneário Camboriú|Itajaí|Estética Avançada|Harmonização.*)$/i, '').replace(/\s+(Balneário Camboriú|Itajaí)$/i, '').trim();
}
// "Dr. Rafael Lucci" -> "Dr. Rafael"; "Laís Loraine" -> "Laís"; vários nomes -> sem nome
function cumprimento(resp) {
  const r = String(resp || '').trim();
  if (!r || /\se\s/.test(r)) return 'Oi, tudo bem?';
  const m = r.match(/^(Dra?\.)\s+(\S+)/i);
  return m ? `Oi, ${m[1]} ${m[2]}, tudo bem?` : `Oi, ${r.split(/\s+/)[0]}, tudo bem?`;
}

// "terça, 23/09 às 14:10" no fuso de Brasília
function quandoSP(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long' }).format(d).replace('-feira', '');
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(d);
  return `${dia}, ${data} às ${hora}`;
}

function dadosClinica(f) {
  const canalOc = f.oculto_canal === 'instagram' ? 'pelo Instagram' : f.oculto_canal === 'telefone' ? 'por telefone' : f.oculto_canal === 'site' ? 'pelo site' : 'pelo WhatsApp';
  const envio = f.oculto_enviado_em ? `mandamos mensagem ${canalOc} ${quandoSP(f.oculto_enviado_em)}` : 'mandamos mensagem';
  const oculto = f.oculto_sem_resposta ? `Cliente oculto: ${envio} e a clínica NÃO respondeu até hoje.`
    : f.oculto_minutos != null ? `Cliente oculto: ${envio}; a clínica respondeu ${f.oculto_resposta_em ? `${quandoSP(f.oculto_resposta_em)} ` : ''}(${f.oculto_minutos} minutos depois)${f.oculto_passou_preco === false ? ', sem passar preço' : ''}${f.oculto_followup_d3 === false ? ', e não voltou a chamar depois' : ''}.`
      : 'Cliente oculto: ainda não testado.';
  return [
    `Clínica: ${f.nome} (${f.cidade})`,
    `Nome da clínica para usar no texto e no assunto: ${nomeTexto(f.nome)}`,
    `Cumprimento de abertura (use exatamente): ${cumprimento(f.responsavel)}`,
    f.responsavel ? `Responsável: ${f.responsavel}` : '',
    f.procedimentos?.length ? `Procedimentos: ${f.procedimentos.join(', ')}` : '',
    f.fato ? `Fato verificável: ${f.fato}` : '',
    f.gancho ? `Gancho definido pelo Miguel (use este): ${f.gancho}` : '',
    f.email ? 'E-mail da clínica: cadastrado (os toques de e-mail foram por e-mail).' : 'E-mail da clínica: NÃO temos. Todos os toques saem por WhatsApp/Instagram/ligação.',
    f.ordem ? `Toque atual: ${f.ordem} (dia ${f.dia} da cadência)${f.ordem === 1 ? ', é o PRIMEIRO contato' : ''}` : '',
    f.porte ? `Porte: ${f.porte === 'equipe' ? 'clínica com equipe/recepção' : 'profissional solo'}` : '',
    f.notas ? `Notas: ${f.notas}` : '',
    oculto
  ].filter(Boolean).join('\n');
}

// Gera o texto de um passo (e-mail ou mensagem manual) para um item da fila.
async function gerarTexto(f, { canalEntrega } = {}) {
  const canal = canalEntrega || f.canal;
  const instrucaoCanal = canal === 'email'
    ? 'Canal: e-mail. Até 120 palavras no corpo.'
    : canal === 'whatsapp_manual'
      ? 'Canal: WhatsApp, enviado à mão pelo Miguel. Até 60 palavras, sem assunto, sem formatação, sem link. Se o modelo era de e-mail, adapte para conversa de WhatsApp.'
      : canal === 'instagram_manual'
        ? 'Canal: direct do Instagram, enviado à mão. Até 50 palavras, sem assunto, sem link.'
        : 'Canal: roteiro de ligação para o Miguel. Tópicos curtos: abertura, 1 pergunta, gancho, pedido de 10 minutos.';
  const r = await ia([
    { role: 'system', content: SISTEMA_RASCUNHO },
    { role: 'user', content: `${instrucaoCanal}\n\nMODELO:\nAssunto: ${f.assunto_modelo || '(sem assunto)'}\n${f.corpo_modelo || ''}\n\nINSTRUÇÃO DO PASSO:\n${f.instrucao_ia || '-'}\n\nDADOS DA CLÍNICA:\n${dadosClinica(f)}` }
  ], { max: 600 });
  let corpo = String(r.corpo || '').replace(/\n{3,}/g, '\n\n').trim();
  // Tira assinatura/rodapé que a IA possa ter copiado do modelo
  corpo = corpo.replace(/\n+Miguel[\s\S]*$/i, '').replace(/\n+(Se não quiser|Para não receber)[\s\S]*$/i, '').trim();
  if (!corpo) throw erro('ia', 'A IA devolveu um texto vazio.', 502);
  if (canal === 'email') corpo += `\n\n${ASSINATURA}\n\n${RODAPE_OPTOUT}`;
  return { assunto: canal === 'email' ? String(r.assunto || f.assunto_modelo || '').slice(0, 150) : null, corpo };
}

// Canal de entrega real: passo de e-mail vira tarefa manual quando não há e-mail.
function canalEntrega(f) {
  if (f.canal !== 'email') return f.canal;
  if (f.email) return 'email';
  if (f.whatsapp) return 'whatsapp_manual';
  if (f.instagram) return 'instagram_manual';
  return 'tarefa';
}

// Gera rascunhos para os itens da fila que ainda não têm mensagem.
// Acrescenta data/hora do último teste de cliente oculto (a view só traz os minutos).
async function comDatasOculto(f) {
  const [t] = await db(`testes_atendimento?empresa_id=eq.${enc(f.empresa_id)}&select=canal,enviado_em,primeira_resposta_em&order=enviado_em.desc&limit=1`).catch(() => []);
  return t ? { ...f, oculto_canal: t.canal, oculto_enviado_em: t.enviado_em, oculto_resposta_em: t.primeira_resposta_em } : f;
}

async function gerarRascunhos({ max = 8, prazoMs = 45000, empresaId } = {}) {
  const inicio = Date.now();
  const fila = await db(`vw_fila_hoje?mensagem_id=is.null${empresaId ? `&empresa_id=eq.${enc(empresaId)}` : ''}&order=prioridade,proxima_acao_em&limit=50`);
  let gerados = 0; const falhas = [];
  for (const item of fila) {
    if (gerados >= max || Date.now() - inicio > prazoMs) break;
    const f = await comDatasOculto(item);
    const canal = canalEntrega(f);
    try {
      const { assunto, corpo } = await gerarTexto(f, { canalEntrega: canal === 'tarefa' ? 'whatsapp_manual' : canal });
      await db('mensagens', {
        method: 'POST', prefer: 'return=minimal',
        body: { empresa_id: f.empresa_id, inscricao_id: f.inscricao_id, passo_id: f.passo_id, canal: canal === 'tarefa' ? 'tarefa' : canal,
          direcao: 'saida', status: 'rascunho', assunto, corpo,
          para: canal === 'email' ? f.email : canal === 'ligacao' ? (f.telefone || f.whatsapp) : canal === 'instagram_manual' ? f.instagram : (f.whatsapp || f.instagram || null) }
      });
      gerados++;
    } catch (e) {
      if (e.codigo === '23505') continue; // outro processo já gerou
      falhas.push({ empresa: f.nome, erro: e.message });
      if (e.codigo === 'config') break;
    }
  }
  return { gerados, falhas, pendentes: fila.length - gerados };
}

// ---------------------------------------------------------------------
// Opt-out
// ---------------------------------------------------------------------
async function bloqueado({ email, telefone }) {
  const filtros = [];
  if (email) filtros.push(`email.ilike.${enc(email.replace(/[%_*,()]/g, ''))}`);
  if (telefone) filtros.push(`telefone.eq.${enc(telefone)}`);
  if (!filtros.length) return false;
  const r = await db(`opt_outs?select=id&or=(${filtros.join(',')})&limit=1`);
  return r.length > 0;
}

async function registrarOptOut({ empresaId, email, telefone, motivo }) {
  // Os índices únicos (e-mail em minúsculas, telefone) barram duplicados: o erro 23505 é esperado e ignorado
  if (email && !(await bloqueado({ email }))) await db('opt_outs', { method: 'POST', prefer: 'return=minimal', body: { email: email.toLowerCase(), motivo } }).catch((e) => { if (e.codigo !== '23505') throw e; });
  if (telefone && !(await bloqueado({ telefone }))) await db('opt_outs', { method: 'POST', prefer: 'return=minimal', body: { telefone, motivo } }).catch((e) => { if (e.codigo !== '23505') throw e; });
  if (empresaId) {
    await db(`empresas?id=eq.${enc(empresaId)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'opt_out', motivo_perda: motivo || 'pediu para sair' } });
    await db(`inscricoes?empresa_id=eq.${enc(empresaId)}&status=in.(ativa,pausada)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'interrompida', motivo_parada: 'opt-out' } });
  }
}

// ---------------------------------------------------------------------
// E-mail (SMTP da GoDaddy)
// ---------------------------------------------------------------------
let transporte = null;
function smtp() {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw erro('config', 'Faltam as variáveis SMTP_USER e SMTP_PASS na Vercel.');
  if (!transporte) {
    const nodemailer = require('nodemailer');
    transporte = nodemailer.createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: { user, pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000 });
  }
  return transporte;
}
const remetente = () => ({ name: 'Miguel · Meu Sistema Customizado', address: process.env.SMTP_USER });

async function enviadosHoje() {
  const r = await db(`mensagens?select=id&canal=eq.email&direcao=eq.saida&status=eq.enviado&enviado_em=gte.${enc(inicioHojeISO())}`);
  return r.length;
}

// Envia um e-mail aprovado. Respeita opt-out e o limite diário; avança a cadência.
async function enviarMensagem(id) {
  const [m] = await db(`mensagens?id=eq.${enc(id)}&select=*,empresas(id,nome,email,status)`);
  if (!m) throw erro('nao_encontrado', 'Mensagem não encontrada.', 404);
  if (m.canal !== 'email') throw erro('canal', 'Só e-mails são enviados pelo sistema. WhatsApp e ligação você faz e marca como feito.', 400);
  if (m.status === 'enviado') return { enviado: false, motivo: 'já enviado' };
  if (m.status !== 'aprovado') throw erro('status', 'Aprove o rascunho antes de enviar.', 400);
  const para = (m.para || m.empresas?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw erro('email', 'E-mail do destinatário inválido.', 400);
  if (['opt_out', 'descartado', 'perdido', 'ganho'].includes(m.empresas?.status) || await bloqueado({ email: para })) {
    await db(`mensagens?id=eq.${enc(id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado', erro: 'Destinatário em opt-out ou fora da prospecção.' } });
    return { enviado: false, motivo: 'opt-out' };
  }
  if (await enviadosHoje() >= limiteDia()) return { enviado: false, motivo: 'limite', limite: limiteDia() };

  // "Trava" otimista: só um processo muda de aprovado para enviado
  const trava = await db(`mensagens?id=eq.${enc(id)}&status=eq.aprovado`, { method: 'PATCH', body: { status: 'enviado', enviado_em: new Date().toISOString(), para } });
  if (!trava.length) return { enviado: false, motivo: 'já em envio' };
  try {
    const info = await smtp().sendMail({
      from: remetente(), to: para, replyTo: process.env.SMTP_USER,
      subject: m.assunto || 'Contato', text: m.corpo,
      headers: { 'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=sair>` }
    });
    await db(`mensagens?id=eq.${enc(id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { message_id: info.messageId || null, provedor_id: info.messageId || null, erro: null } });
    if (m.inscricao_id) await rpc('avancar', { p_inscricao: m.inscricao_id });
    return { enviado: true };
  } catch (e) {
    await db(`mensagens?id=eq.${enc(id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'falhou', erro: String(e.message || e).slice(0, 500), enviado_em: null } });
    throw erro('smtp', `O e-mail não saiu: ${e.message}`, 502);
  }
}

// Envia os aprovados que ficaram para trás (limite do dia), do mais antigo ao mais novo.
async function enviarAprovados() {
  const aprovados = await db('mensagens?select=id&canal=eq.email&direcao=eq.saida&status=eq.aprovado&order=aprovado_em.asc.nullsfirst&limit=50');
  let enviados = 0; const falhas = [];
  for (const { id } of aprovados) {
    try {
      const r = await enviarMensagem(id);
      if (r.enviado) enviados++;
      if (r.motivo === 'limite') break;
    } catch (e) { falhas.push(e.message); if (e.codigo === 'config') break; }
  }
  return { enviados, falhas, restantes: aprovados.length - enviados };
}

async function enviarAviso(assunto, texto) {
  const para = avisoPara();
  if (!para) return;
  try { await smtp().sendMail({ from: remetente(), to: para, subject: `[SDR] ${assunto}`, text: texto }); }
  catch (e) { console.warn('Aviso não enviado:', e.message); }
}

// ---------------------------------------------------------------------
// Respostas (IMAP da GoDaddy) + classificação pela IA
// ---------------------------------------------------------------------
const SISTEMA_CLASSIFICA = `Você classifica respostas de clínicas de estética a um e-mail de prospecção (venda de chatbot/CRM/automação).
Categorias:
- interessado: quer conversar, pediu vídeo, proposta, preço, reunião, ou deu telefone/horário.
- duvida: fez pergunta sem decidir.
- agora_nao: não é o momento, pediu para chamar depois.
- nao_quero: não tem interesse, OU pediu para sair/parar/remover (qualquer pedido de descadastro).
- resposta_automatica: resposta automática, férias, ausência, "recebemos seu e-mail".
- fora_do_escopo: não tem relação com a prospecção.
Responda em JSON: {"classificacao": "...", "pediu_sair": true|false, "resumo": "1 frase em português", "proximo_passo": "sugestão curta para o Miguel"}`;

function limparCorpo(txt) {
  // Tira a parte citada (o e-mail original) para a IA ler só a resposta
  const linhas = String(txt || '').split('\n');
  const corte = linhas.findIndex((l) => /^(Em .+escreveu:|On .+wrote:|-----Original Message|De: |From: )/i.test(l.trim()) || /^>/.test(l));
  return (corte > 0 ? linhas.slice(0, corte) : linhas).join('\n').trim().slice(0, 3000);
}

async function lerRespostas({ dias = 7, prazoMs = 40000 } = {}) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) throw erro('config', 'Faltam as variáveis SMTP_USER e SMTP_PASS na Vercel.');
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');
  const inicio = Date.now();

  // Quem a gente está prospectando (e-mail -> empresa) e o que já enviamos (Message-ID -> mensagem)
  const empresas = await db('empresas?select=id,nome,email,status&email=not.is.null');
  const porEmail = new Map(empresas.map((e) => [e.email.toLowerCase(), e]));
  const enviados = await db('mensagens?select=id,empresa_id,inscricao_id,message_id&direcao=eq.saida&message_id=not.is.null');
  const porMsgId = new Map(enviados.map((m) => [m.message_id, m]));
  const dominios = new Map(empresas.map((e) => [e.email.split('@')[1].toLowerCase(), e]));
  const GENERICOS = new Set(['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'live.com', 'uol.com.br', 'bol.com.br', 'terra.com.br']);

  const cliente = new ImapFlow({ host: IMAP_HOST, port: 993, secure: true, auth: { user, pass }, logger: false, socketTimeout: 30000 });
  const achados = [];
  await cliente.connect();
  try {
    const trava = await cliente.getMailboxLock('INBOX');
    try {
      const desde = new Date(Date.now() - dias * 86400000);
      const uids = (await cliente.search({ since: desde }, { uid: true })) || [];
      if (!uids.length) return { lidas: 0, novas: 0, interessados: 0 };
      for await (const msg of cliente.fetch(uids.slice(-200), { envelope: true, source: true }, { uid: true })) {
        if (Date.now() - inicio > prazoMs) break;
        const env = msg.envelope || {};
        const de = env.from?.[0]?.address?.toLowerCase() || '';
        if (!de || de === user.toLowerCase()) continue;
        const inReply = env.inReplyTo || '';
        const origem = porMsgId.get(inReply);
        const dominio = de.split('@')[1] || '';
        const empresa = origem ? empresas.find((e) => e.id === origem.empresa_id) || { id: origem.empresa_id }
          : porEmail.get(de) || (!GENERICOS.has(dominio) ? dominios.get(dominio) : null);
        if (!empresa) continue;
        achados.push({ msg, env, de, origem, empresa });
      }
    } finally { trava.release(); }
  } finally { await cliente.logout().catch(() => {}); }

  let novas = 0, interessados = 0; const avisos = [];
  for (const { msg, env, de, origem, empresa } of achados) {
    if (Date.now() - inicio > prazoMs + 10000) break;
    const messageId = env.messageId || `uid-${msg.uid}@${de}`;
    const ja = await db(`mensagens?select=id&message_id=eq.${enc(messageId)}&limit=1`);
    if (ja.length) continue;
    const parsed = await simpleParser(msg.source);
    const corpo = limparCorpo(parsed.text || '');
    let cls = { classificacao: 'duvida', pediu_sair: false, resumo: '', proximo_passo: '' };
    try {
      cls = await ia([{ role: 'system', content: SISTEMA_CLASSIFICA }, { role: 'user', content: `Assunto: ${env.subject || ''}\n\n${corpo}` }], { max: 200, temperatura: 0 });
    } catch (e) { cls.resumo = 'Não foi possível classificar automaticamente.'; }
    const sair = cls.pediu_sair || /^\s*(sair|remover|descadastrar|pare|parar)\b/i.test(corpo);
    const validas = ['interessado', 'agora_nao', 'nao_quero', 'duvida', 'fora_do_escopo', 'resposta_automatica'];
    const classificacao = sair ? 'nao_quero' : (validas.includes(cls.classificacao) ? cls.classificacao : 'duvida');

    await db('mensagens', { method: 'POST', prefer: 'return=minimal', body: {
      empresa_id: empresa.id, inscricao_id: origem?.inscricao_id || null, canal: 'email', direcao: 'entrada', status: 'recebido',
      assunto: (env.subject || '').slice(0, 300), corpo, de, message_id: messageId, in_reply_to: env.inReplyTo || null,
      classificacao, resumo_ia: [cls.resumo, cls.proximo_passo && `Próximo passo: ${cls.proximo_passo}`].filter(Boolean).join(' · ').slice(0, 600),
      recebido_em: (env.date ? new Date(env.date) : new Date()).toISOString()
    } });
    novas++;

    if (classificacao === 'resposta_automatica' || classificacao === 'fora_do_escopo') continue;
    if (sair) { await registrarOptOut({ empresaId: empresa.id, email: de, motivo: 'pediu para sair por e-mail' }); continue; }

    // Resposta humana: pausa a cadência e atualiza o funil
    await db(`inscricoes?empresa_id=eq.${enc(empresa.id)}&status=eq.ativa`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'pausada', motivo_parada: `respondeu (${classificacao})` } });
    // descarta rascunhos pendentes dessa empresa: a conversa agora é humana
    await db(`mensagens?empresa_id=eq.${enc(empresa.id)}&direcao=eq.saida&status=in.(rascunho,aprovado)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'descartado', erro: 'Cadência pausada: a clínica respondeu.' } });
    const novoStatus = classificacao === 'interessado' ? 'interessado' : classificacao === 'nao_quero' ? 'perdido' : 'respondeu';
    await db(`empresas?id=eq.${enc(empresa.id)}&status=not.in.(ganho,reuniao)`, { method: 'PATCH', prefer: 'return=minimal', body: { status: novoStatus, ...(novoStatus === 'perdido' ? { motivo_perda: 'sem interesse (respondeu)' } : {}) } });
    if (classificacao === 'interessado') interessados++;
    avisos.push(`• ${empresa.nome || de} — ${classificacao.replace('_', ' ')}\n  ${cls.resumo || ''}${cls.proximo_passo ? `\n  Próximo passo: ${cls.proximo_passo}` : ''}`);
  }

  if (avisos.length) {
    await enviarAviso(interessados ? `${interessados} clínica(s) com interesse!` : `${avisos.length} resposta(s) nova(s)`,
      `Respostas novas na prospecção:\n\n${avisos.join('\n\n')}\n\nAbra o Admin → SDR para ver a conversa completa:\nhttps://www.meusistemacustomizado.com/admin/#/sdr`);
  }
  return { lidas: achados.length, novas, interessados };
}

// ---------------------------------------------------------------------
// Enriquecimento: lê o site da clínica atrás de e-mail e Instagram
// ---------------------------------------------------------------------
function decodificarCfEmail(hex) {
  try {
    const k = parseInt(hex.slice(0, 2), 16); let s = '';
    for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
    return s;
  } catch { return ''; }
}
async function baixar(url) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MSC-SDR/1.0; +https://www.meusistemacustomizado.com)' } });
    if (!r.ok || !/text\/html/i.test(r.headers.get('content-type') || '')) return '';
    return (await r.text()).slice(0, 600000);
  } catch { return ''; } finally { clearTimeout(t); }
}
function extrair(htmlTxt) {
  const emails = new Set(), instas = new Set();
  for (const m of htmlTxt.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) { const e = decodificarCfEmail(m[1]); if (e.includes('@')) emails.add(e.toLowerCase()); }
  for (const m of htmlTxt.matchAll(/mailto:([^"'?\s>]+)/gi)) emails.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of htmlTxt.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) emails.add(m[0].toLowerCase());
  for (const m of htmlTxt.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,30})/gi)) {
    const u = m[1].toLowerCase(); if (!['p', 'reel', 'reels', 'explore', 'accounts', 'stories', 'tv'].includes(u)) instas.add('@' + u);
  }
  const lixo = /(example|sentry|wixpress|domain\.com|email\.com|seuemail|\.png|\.jpg|\.webp|\.svg|godaddy|wordpress)/i;
  return { emails: [...emails].filter((e) => !lixo.test(e) && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)), instagrams: [...instas] };
}

async function enriquecer(empresaId) {
  const [e] = await db(`empresas?id=eq.${enc(empresaId)}&select=id,nome,site,email,instagram,status`);
  if (!e) throw erro('nao_encontrado', 'Clínica não encontrada.', 404);
  if (!e.site) return { alterado: false, motivo: 'Sem site cadastrado. Preencha o site ou o e-mail à mão.' };
  let base; try { base = new URL(e.site); } catch { return { alterado: false, motivo: 'Site inválido.' }; }
  const paginas = [base.href, ...['/contato', '/contato/', '/fale-conosco', '/contact'].map((p) => new URL(p, base).href)];
  const achados = { emails: new Set(), instagrams: new Set() };
  for (const url of paginas) {
    const h = await baixar(url);
    if (!h) continue;
    const r = extrair(h);
    r.emails.forEach((x) => achados.emails.add(x)); r.instagrams.forEach((x) => achados.instagrams.add(x));
    if (achados.emails.size) break;
  }
  const dominio = base.hostname.replace(/^www\./, '');
  const emails = [...achados.emails].sort((a, b) => (b.endsWith(dominio) - a.endsWith(dominio)));
  const patch = {};
  if (!e.email && emails[0]) patch.email = emails[0];
  if (!e.instagram && achados.instagrams.size) patch.instagram = [...achados.instagrams][0];
  if (Object.keys(patch).length) {
    patch.enriquecido_em = new Date().toISOString();
    if (e.status === 'novo') patch.status = 'enriquecido';
    await db(`empresas?id=eq.${enc(e.id)}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
  }
  return { alterado: Object.keys(patch).length > 0, encontrados: { emails, instagrams: [...achados.instagrams] }, salvo: patch };
}

module.exports = {
  db, rpc, enc, erro, ia, hojeSP, inicioHojeISO, limiteDia,
  gerarTexto, gerarRascunhos, comDatasOculto, canalEntrega, dadosClinica, nomeTexto, cumprimento,
  bloqueado, registrarOptOut, enviarMensagem, enviarAprovados, enviadosHoje, enviarAviso, smtp, remetente,
  lerRespostas, enriquecer, extrair, decodificarCfEmail, limparCorpo
};
