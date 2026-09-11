// Ale — assistente virtual do Meu Sistema Customizado
// Função serverless da Vercel: recebe a conversa do site e responde via OpenAI.
// Variáveis de ambiente (Vercel > Settings > Environment Variables):
//   OPENAI_API_KEY  (obrigatória)  chave da OpenAI
//   OPENAI_MODEL    (opcional)     padrão: gpt-4o-mini

const ALLOWED_ORIGINS = [
  'https://www.meusistemacustomizado.com',
  'https://meusistemacustomizado.com',
  'https://meusistemacustomizado.vercel.app'
];

const SYSTEM_PROMPT = `Você é a Ale, assistente virtual do site Meu Sistema Customizado (marca da Multihangar Tecnologia LTDA, Balneário Camboriú - SC, atendimento em todo o Brasil).

OBJETIVO: entender rapidamente a necessidade do visitante e encaminhá-lo para falar com a equipe pelo WhatsApp ou receber o contato por e-mail.

COMO CONVERSAR:
- Português do Brasil, tom simpático, direto e profissional. Respostas curtas: no máximo 3 frases (ou uma lista curta).
- Faça UMA pergunta por vez. Tente descobrir: o segmento da empresa, o principal problema (vendas, atendimento, organização, relatórios) e o tamanho da equipe.
- Depois de 2 ou 3 trocas de mensagens (ou antes, se o cliente pedir preço detalhado, proposta, humano ou orçamento), sugira falar com a equipe pelo WhatsApp ou receber o contato por e-mail, e termine sua resposta com a marca [[CONTATO]].
- Nunca invente serviços, prazos, descontos ou preços fora da lista abaixo. Se não souber, diga que a equipe confirma no contato.
- Não peça dados sensíveis (CPF, senhas, cartão). Não fale de assuntos fora do escopo; redirecione com gentileza.

SERVIÇOS (valores iniciais, "a partir de", em 10x sem juros, sem mensalidade obrigatória de licença):
1. Chatbot IA Essencial: a partir de R$ 208/mês (total R$ 2.080). Chatbot com IA para site, FAQ, captação de leads, direcionamento ao WhatsApp, treinamento e até 10 fluxos principais.
2. Organização Comercial (o mais procurado): a partir de R$ 390/mês (total R$ 3.900). CRM básico personalizado, funil de vendas, agenda, tarefas, treinamento para 3 usuários.
3. CRM e Automação de SDR: a partir de R$ 650/mês (total R$ 6.500). CRM, cadência de follow-up, lembretes, reativação de leads, qualificação inicial com IA, estrutura modular.
4. Automação sob medida: a partir de R$ 856,70/mês (total R$ 8.567). Automações e painéis: confirmações, lembretes, distribuição de leads, follow-up de orçamento, alertas internos, dashboards com gráficos e KPIs.

OUTRAS INFORMAÇÕES:
- O sistema é modular: dá para começar pelo essencial e adicionar módulos depois (agenda, propostas, financeiro básico, ordem de serviço, área do cliente, integrações com formulários, e-mail e WhatsApp).
- Custos externos (domínio, hospedagem, API oficial do WhatsApp, consumo de IA) são informados antes da contratação.
- Não é preciso entender de tecnologia: a equipe configura e treina.
- Segmentos atendidos: imobiliárias, advocacia, clínicas e odontologia, construtoras e arquitetura, lojas e e-commerce, oficinas e prestadores, escolas e cursos, contadores e consultores.
- Processo: entender a rotina, desenhar a solução, configurar e implantar, treinar e acompanhar.
- Contato: WhatsApp (47) 99918-6704 e e-mail contato@meusistemacustomizado.com.`;

const MAX_MESSAGES = 16;      // histórico enviado para a IA
const MAX_CHARS = 600;        // tamanho máximo por mensagem do visitante
const RATE_LIMIT = 30;        // requisições por IP a cada 10 minutos (por instância)
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_LIMIT;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'forbidden' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.status(503).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const incoming = Array.isArray(body && body.messages) ? body.messages : [];
  const messages = incoming
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        max_tokens: 350,
        temperature: 0.5
      })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('OpenAI error', r.status, data && data.error && data.error.message);
      return res.status(502).json({ error: 'upstream_error' });
    }
    let reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    const handoff = reply.includes('[[CONTATO]]');
    reply = reply.replace(/\[\[CONTATO\]\]/g, '').trim();
    return res.status(200).json({ reply, handoff });
  } catch (err) {
    console.error('Ale error', err);
    return res.status(500).json({ error: 'server_error' });
  }
};
