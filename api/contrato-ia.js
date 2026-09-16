// Ajuste de contrato com IA para o Admin (usuários ativos).
// Usa a mesma OPENAI_API_KEY da Ale. Opcional: OPENAI_MODEL (padrão gpt-4o-mini).
const { cors, limitado, autenticar, lerCorpo } = require('./_auth.js');

const MAX_HTML = 60000;
const MAX_SUGESTAO = 2000;

const SYSTEM = `Você revisa contratos de prestação de serviços de tecnologia em português do Brasil.
Recebe o HTML de um contrato e um pedido de alteração do administrador. Devolva o contrato completo já alterado.

REGRAS OBRIGATÓRIAS:
1. Aplique somente o que foi pedido. Mantenha todo o resto do texto, a numeração das cláusulas (renumere apenas se inserir uma cláusula nova), as partes, os valores e o bloco de assinaturas.
2. Envolva cada trecho novo ou alterado em <mark class="revisar">…</mark>.
3. Não invente multas, percentuais, juros, índices de reajuste, prazos, valores, leis, artigos ou obrigações que não estejam no texto ou no pedido. Se o pedido depender de um dado que não foi informado, escreva [A DEFINIR: descrição] dentro do trecho marcado.
4. Não inclua cláusulas que renunciem a direitos do consumidor ou que sejam claramente abusivas; se o pedido exigir isso, não aplique e explique em pontos_de_revisao.
5. Use apenas as tags h1, h2, h3, p, strong, em, u, ul, ol, li, br, div, span, section, mark e o atributo class. Sem scripts, estilos, links ou imagens.
6. Responda SOMENTE com JSON válido: {"html": "...", "alteracoes": ["frase curta por mudança"], "pontos_de_revisao": ["o que um advogado deve conferir"]}.`;

module.exports = async (req, res) => {
  if (!cors(req, res)) return;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured', mensagem: 'IA não configurada.' });

  const sessao = await autenticar(req, res); if (!sessao) return;
  if (limitado(`ia:${sessao.user.id}`, 20, 10)) return res.status(429).json({ error: 'rate_limited', mensagem: 'Muitas solicitações seguidas. Aguarde alguns minutos.' });

  let corpo;
  try { corpo = await lerCorpo(req, MAX_HTML + MAX_SUGESTAO + 2000); } catch { return res.status(400).json({ error: 'bad_request', mensagem: 'Requisição inválida.' }); }
  const html = String(corpo.html || '');
  const sugestoes = String(corpo.sugestoes || '').trim();
  if (!html || html.length > MAX_HTML) return res.status(400).json({ error: 'bad_request', mensagem: 'Documento vazio ou grande demais.' });
  if (sugestoes.length < 5 || sugestoes.length > MAX_SUGESTAO) return res.status(400).json({ error: 'bad_request', mensagem: 'Descreva a alteração (até 2.000 caracteres).' });

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 12000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `PEDIDO DE ALTERAÇÃO:\n${sugestoes}\n\nCONTRATO ATUAL (HTML):\n${html}` }
        ]
      })
    });
    if (!r.ok) {
      console.error('contrato-ia openai', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'upstream', mensagem: 'A IA não respondeu agora. Tente de novo em instantes.' });
    }
    const data = await r.json();
    let saida;
    try { saida = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { saida = {}; }
    if (!saida.html || typeof saida.html !== 'string') return res.status(502).json({ error: 'upstream', mensagem: 'A IA devolveu um formato inesperado. Tente reformular o pedido.' });
    const lista = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').map((x) => x.slice(0, 300)).slice(0, 15) : []);
    // O navegador sanitiza de novo com DOMPurify antes de exibir.
    return res.status(200).json({ html: saida.html.slice(0, MAX_HTML * 1.5), alteracoes: lista(saida.alteracoes), pontos_de_revisao: lista(saida.pontos_de_revisao) });
  } catch (e) {
    console.error('contrato-ia', e);
    return res.status(500).json({ error: 'internal', mensagem: 'Erro interno. Tente de novo.' });
  }
};
