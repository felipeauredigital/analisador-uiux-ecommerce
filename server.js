const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Configuração via variáveis de ambiente ----------
// OPENAI_API_KEY      -> chave da OpenAI (obrigatória para a análise por IA)
// OPENAI_MODEL        -> modelo com visão (padrão: gpt-4o)
// APP_PASSWORD        -> se definida, protege o app com uma senha única (opcional)
// SCREENSHOT_PROVIDER -> serviço de captura de tela por URL: 'microlink' (padrão) ou 'thumio'
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SCREENSHOT_PROVIDER = (process.env.SCREENSHOT_PROVIDER || 'microlink').toLowerCase();
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const CHECKLIST_PATH = path.join(__dirname, 'cro-checklist.json');

// Limite alto porque a análise envia os prints do e-commerce em base64.
app.use(express.json({ limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Checklist carregado do arquivo (fonte única do prompt da IA e do frontend).
let _checklist = null;
function loadChecklist() {
  if (!_checklist) _checklist = JSON.parse(fs.readFileSync(CHECKLIST_PATH, 'utf8'));
  return _checklist;
}

// Aborta chamadas externas presas para não travar a requisição do navegador.
async function fetchWithTimeout(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Autenticação simples (opcional, stateless) ----------
// Se APP_PASSWORD estiver definida, as rotas protegidas exigem o cabeçalho
// Authorization: Bearer <senha>. Sem APP_PASSWORD, o app fica aberto.
function requireAuth(req, res, next) {
  if (!APP_PASSWORD) return next();
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token && token === APP_PASSWORD) return next();
  return res.status(401).json({ error: 'Não autorizado. Faça login novamente.' });
}

app.get('/api/config', (req, res) => {
  res.json({
    aiConfigured: Boolean(OPENAI_API_KEY),
    requiresPassword: Boolean(APP_PASSWORD),
    model: OPENAI_MODEL,
  });
});

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true }); // app aberto
  const { password } = req.body || {};
  if (!password || password !== APP_PASSWORD) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }
  res.json({ ok: true });
});

app.get('/api/checklist', requireAuth, (req, res) => {
  try {
    res.json(loadChecklist());
  } catch (err) {
    res.status(500).json({ error: 'Falha ao carregar o checklist: ' + err.message });
  }
});

// ---------- Chamada à OpenAI (Chat Completions com visão) ----------
async function callOpenAIVision({ system, userText, images }) {
  const content = [{ type: 'text', text: userText }];
  for (const img of images) {
    content.push({ type: 'image_url', image_url: { url: img, detail: 'high' } });
  }

  const resp = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 4000,
    }),
  });

  // Lê como texto primeiro para evitar erro de parse confuso quando a resposta
  // não é JSON (erro de gateway/proxy, HTML de erro, etc.).
  const bodyText = await resp.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    const snippet = bodyText.slice(0, 200).replace(/\s+/g, ' ').trim();
    throw new Error(`Resposta inesperada da OpenAI (HTTP ${resp.status}). ${snippet || 'Sem corpo.'}`);
  }
  if (data.error) throw new Error(data.error.message || 'Erro na API da OpenAI.');
  if (!resp.ok) throw new Error(`OpenAI retornou HTTP ${resp.status}.`);
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error('A OpenAI retornou uma resposta vazia.');
  return text;
}

const STATUS_VALIDOS = ['feito', 'pendente', 'nao_aplica', 'nao_avaliavel'];

// ---------- Analisar uma seção contra o checklist ----------
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { sectionId, storeName, storeUrl, images } = req.body || {};

  if (!OPENAI_API_KEY) {
    return res.status(400).json({ error: 'A chave da OpenAI não foi configurada no servidor (variável OPENAI_API_KEY).' });
  }
  if (!sectionId) return res.status(400).json({ error: 'Informe a seção a ser analisada.' });
  if (!Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'Envie ao menos uma imagem (print) desta seção.' });
  }

  const checklist = loadChecklist();
  const section = checklist.sections.find((s) => s.id === sectionId);
  if (!section) return res.status(400).json({ error: 'Seção desconhecida.' });

  const imgs = images.slice(0, 6).filter((u) => typeof u === 'string' && u.startsWith('data:image'));
  if (imgs.length === 0) return res.status(400).json({ error: 'Formato de imagem inválido.' });

  const itensTexto = section.items
    .map((it, i) => `${i + 1}. ${it.acao}${it.dica ? ` (boa prática: ${it.dica})` : ''}`)
    .join('\n');

  const system =
    'Você é um especialista sênior em CRO (otimização de conversão) e UI/UX de e-commerce brasileiro. ' +
    'Você analisa capturas de tela reais de uma loja virtual e avalia, item a item, um checklist de boas práticas. ' +
    'Baseie-se ESTRITAMENTE no que é visível nas imagens enviadas. Não invente elementos que não aparecem. ' +
    'Responda SEMPRE em português do Brasil e SOMENTE com um objeto JSON válido, sem texto fora do JSON.';

  const userText =
    `Loja analisada: ${storeName || 'não informado'}${storeUrl ? ` (${storeUrl})` : ''}.\n` +
    `Seção do site: "${section.titulo}".\n\n` +
    `Avalie CADA um dos itens do checklist abaixo, na mesma ordem, com base nas imagens anexadas desta seção:\n\n` +
    `${itensTexto}\n\n` +
    `Para cada item, atribua um status:\n` +
    `- "feito": o elemento/boa prática está claramente presente e bem implementado na imagem.\n` +
    `- "pendente": está ausente, incompleto ou mal implementado (é uma oportunidade de melhoria).\n` +
    `- "nao_aplica": não faz sentido para este tipo de loja/produto.\n` +
    `- "nao_avaliavel": não dá para julgar apenas pela imagem (ex.: velocidade de carregamento, item de bastidor).\n\n` +
    `Regras da resposta:\n` +
    `- "observacao": 1 a 2 frases descrevendo o que você observou na imagem sobre esse item (concreto e específico da loja).\n` +
    `- "recomendacao": para status "pendente", explique de forma objetiva COMO deveria ser/o que ajustar. Para os demais status, pode ficar curto ou vazio.\n` +
    `- Retorne exatamente ${section.items.length} itens, um para cada item do checklist, na ordem, usando o campo "indice" (1 a ${section.items.length}).\n\n` +
    `Formato EXATO da resposta (JSON):\n` +
    `{"itens":[{"indice":1,"status":"feito|pendente|nao_aplica|nao_avaliavel","observacao":"...","recomendacao":"..."}]}`;

  try {
    const raw = await callOpenAIVision({ system, userText, images: imgs });

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Não foi possível interpretar a resposta da IA.');
      parsed = JSON.parse(match[0]);
    }

    const arr = Array.isArray(parsed.itens) ? parsed.itens : [];
    const byIndex = {};
    arr.forEach((it) => {
      const idx = Number(it.indice);
      if (idx >= 1 && idx <= section.items.length) byIndex[idx] = it;
    });

    const itens = section.items.map((orig, i) => {
      const ai = byIndex[i + 1] || {};
      let status = String(ai.status || '').toLowerCase();
      if (!STATUS_VALIDOS.includes(status)) status = 'nao_avaliavel';
      return {
        acao: orig.acao,
        dica: orig.dica || '',
        obs: orig.obs || '',
        status,
        observacao: typeof ai.observacao === 'string' ? ai.observacao : '',
        recomendacao: typeof ai.recomendacao === 'string' ? ai.recomendacao : '',
      };
    });

    res.json({ sectionId, itens });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Captura de tela de uma página pela URL ----------
// Usa um serviço externo (sem instalar navegador no servidor, para não pesar).
async function captureScreenshot(url) {
  if (SCREENSHOT_PROVIDER === 'thumio') {
    const api = `https://image.thum.io/get/width/1366/fullpage/wait/4/noanimate/${url}`;
    const r = await fetchWithTimeout(api, {}, 60000);
    const ct = r.headers.get('content-type') || '';
    if (!r.ok || !ct.startsWith('image/')) throw new Error(`o serviço de captura retornou HTTP ${r.status}.`);
    const buf = Buffer.from(await r.arrayBuffer());
    return `data:${ct};base64,${buf.toString('base64')}`;
  }

  // microlink (padrão): retorna JSON com a URL do screenshot; depois baixamos a imagem.
  const api =
    `https://api.microlink.io/?url=${encodeURIComponent(url)}` +
    `&screenshot=true&fullPage=true&meta=false&type=png&waitUntil=networkidle2`;
  const r = await fetchWithTimeout(api, { headers: { Accept: 'application/json' } }, 60000);
  const j = await r.json().catch(() => null);
  if (!j || j.status !== 'success' || !(j.data && j.data.screenshot && j.data.screenshot.url)) {
    const msg = (j && (j.message || (j.data && j.data.message))) || `o serviço de captura retornou HTTP ${r.status}.`;
    throw new Error(msg);
  }
  const imgResp = await fetchWithTimeout(j.data.screenshot.url, {}, 60000);
  if (!imgResp.ok) throw new Error('falha ao baixar a captura gerada.');
  const ct = imgResp.headers.get('content-type') || 'image/png';
  const buf = Buffer.from(await imgResp.arrayBuffer());
  return `data:${ct};base64,${buf.toString('base64')}`;
}

app.post('/api/capture', requireAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return res.status(400).json({ error: 'Informe uma URL válida começando com http:// ou https://.' });
  }
  try {
    const dataUrl = await captureScreenshot(String(url).trim());
    res.json({ dataUrl });
  } catch (err) {
    res.status(400).json({
      error: 'Não foi possível capturar esta página automaticamente (o site pode bloquear captura). Você ainda pode enviar o print manualmente. Detalhe: ' + err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Analisador de UI/UX rodando em http://localhost:${PORT}`);
});
