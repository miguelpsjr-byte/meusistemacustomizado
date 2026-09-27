// SDR — rotina diária (Vercel Cron, dias úteis ~08h de Brasília; ver vercel.json).
// 1. lê as respostas da caixa e pausa quem respondeu
// 2. envia os e-mails já aprovados que ficaram para trás (respeitando o limite do dia)
// 3. gera os rascunhos da fila de hoje
// 4. manda um resumo por e-mail para o Miguel
//
// Proteção: se a variável CRON_SECRET existir na Vercel, só a chamada da própria
// Vercel (Authorization: Bearer <CRON_SECRET>) é aceita. Mesmo sem ela, a rotina só
// faz o que é seguro repetir: nada sai sem ter sido aprovado.
const S = require('./_sdr');

let ultimaExecucao = 0;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  const segredo = process.env.CRON_SECRET;
  if (segredo && req.headers.authorization !== `Bearer ${segredo}`) return res.status(401).json({ error: 'unauthorized' });
  if (Date.now() - ultimaExecucao < 5 * 60 * 1000) return res.status(429).json({ error: 'limite', mensagem: 'Rotina executada há pouco.' });
  ultimaExecucao = Date.now();

  const relatorio = { respostas: null, envio: null, rascunhos: null, erros: [] };
  const etapa = async (nome, fn) => {
    try { relatorio[nome] = await fn(); } catch (e) { relatorio.erros.push(`${nome}: ${e.message}`); console.error('SDR cron', nome, e); }
  };

  await etapa('respostas', () => S.lerRespostas({ prazoMs: 25000 }));
  await etapa('envio', () => S.enviarAprovados());
  await etapa('rascunhos', () => S.gerarRascunhos({ max: 10, prazoMs: 25000 }));

  try {
    const fila = await S.db('vw_fila_hoje?select=nome,canal,mensagem_status');
    const pendentes = await S.db('mensagens?direcao=eq.saida&status=in.(rascunho,falhou)&select=canal');
    const emails = pendentes.filter((m) => m.canal === 'email').length;
    const manuais = pendentes.length - emails;
    const r = relatorio;
    const linhas = [
      `Bom dia! Resumo da prospecção de hoje (${S.hojeSP().split('-').reverse().join('/')}):`,
      '',
      `• ${emails} e-mail(s) esperando sua aprovação`,
      `• ${manuais} mensagem(ns) de WhatsApp/Instagram/ligação para você fazer`,
      r.envio ? `• ${r.envio.enviados} e-mail(s) aprovado(s) enviado(s) agora${r.envio.restantes ? ` (${r.envio.restantes} ficaram para amanhã pelo limite diário)` : ''}` : '',
      r.respostas ? `• ${r.respostas.novas} resposta(s) nova(s)${r.respostas.interessados ? `, ${r.respostas.interessados} com interesse` : ''}` : '',
      `• ${fila.length} clínica(s) na fila de hoje`,
      r.erros.length ? `\nAtenção:\n${r.erros.map((e) => `- ${e}`).join('\n')}` : '',
      '',
      'Abrir: https://www.meusistemacustomizado.com/admin/#/sdr'
    ].filter((l) => l !== '');
    if (pendentes.length || r.erros.length || (r.respostas && r.respostas.novas)) {
      await S.enviarAviso(pendentes.length ? `${pendentes.length} tarefa(s) de prospecção hoje` : 'Resumo do dia', linhas.join('\n'));
    }
  } catch (e) { relatorio.erros.push(`resumo: ${e.message}`); }

  return res.status(200).json(relatorio);
};
