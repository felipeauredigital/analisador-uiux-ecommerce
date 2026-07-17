const app = document.getElementById('app');

// ---------------- TEMA (claro/escuro) ----------------
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('theme', theme); } catch {}
  document.querySelectorAll('.theme-toggle').forEach((b) => {
    b.textContent = theme === 'light' ? '🌙' : '☀️';
    b.title = theme === 'light' ? 'Mudar para tema escuro' : 'Mudar para tema claro';
  });
}
function toggleTheme() {
  applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
}
function themeToggleHtml() {
  return `<button class="secondary theme-toggle" id="themeToggle" aria-label="Alternar tema"></button>`;
}

// Escapa também aspas para ser seguro em contexto de atributo além de texto.
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let _toastTimer = null;
function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

// ---------------- API ----------------
let authToken = '';
try { authToken = localStorage.getItem('uiux_token') || ''; } catch {}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const resp = await fetch(path, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401) {
    authToken = '';
    try { localStorage.removeItem('uiux_token'); } catch {}
    renderLogin();
    throw new Error(data.error || 'Sessão expirada. Faça login novamente.');
  }
  if (!resp.ok) throw new Error(data.error || 'Erro desconhecido.');
  return data;
}

// ---------------- ESTADO ----------------
const CRO_STATUS = {
  '': { label: 'Não avaliado', icon: '○', cls: 'st-none' },
  feito: { label: 'Feito', icon: '✔', cls: 'st-feito' },
  pendente: { label: 'A ajustar', icon: '!', cls: 'st-pendente' },
  nao_aplica: { label: 'Não se aplica', icon: '–', cls: 'st-na' },
  nao_avaliavel: { label: 'Verificar', icon: '?', cls: 'st-nav' },
};

const state = {
  config: { aiConfigured: false, requiresPassword: false, model: 'gpt-4o' },
  checklist: null,
  store: { name: '', url: '' },
  data: {}, // sectionId -> { images: [{id,dataUrl}], itens: [...] }
};
let imgSeq = 1;

function initData() {
  state.data = {};
  for (const s of state.checklist.sections) {
    state.data[s.id] = {
      images: [],
      url: '',
      itens: s.items.map((it) => ({
        acao: it.acao,
        dica: it.dica || '',
        obs: it.obs || '',
        status: '',
        observacao: '',
        recomendacao: '',
      })),
    };
  }
}

// ---------------- INICIALIZAÇÃO ----------------
async function init() {
  try {
    state.config = await api('/api/config');
  } catch (err) {
    app.innerHTML = `<div class="boot-error">Não foi possível conectar ao servidor: ${escapeHtml(err.message)}</div>`;
    return;
  }
  if (state.config.requiresPassword && !authToken) {
    renderLogin();
    return;
  }
  await loadAndRender();
}

async function loadAndRender() {
  try {
    state.checklist = await api('/api/checklist');
    if (!Object.keys(state.data).length) initData();
    renderEditor();
  } catch (err) {
    if (err.message.includes('login')) return; // já foi para a tela de login
    app.innerHTML = `<div class="boot-error">Erro ao carregar: ${escapeHtml(err.message)}</div>`;
  }
}

// ---------------- LOGIN (opcional) ----------------
function renderLogin() {
  app.innerHTML = `
    <div class="login-box">
      <div class="login-logo">🎯</div>
      <h1>Análise de UI/UX</h1>
      <p class="login-subtitle">Diagnóstico de conversão (CRO) do seu e-commerce</p>
      <input type="password" id="password" placeholder="Senha de acesso" />
      <button id="loginBtn">Entrar</button>
      <div class="error" id="loginError"></div>
    </div>
  `;
  applyTheme(currentTheme());
  const doLogin = async () => {
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = '';
    if (!password) return;
    try {
      await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Senha incorreta.');
      });
      authToken = password;
      try { localStorage.setItem('uiux_token', authToken); } catch {}
      await loadAndRender();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };
  document.getElementById('loginBtn').onclick = doLogin;
  document.getElementById('password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
}

function logout() {
  authToken = '';
  try { localStorage.removeItem('uiux_token'); } catch {}
  renderLogin();
}

// ---------------- SCORES ----------------
function sectionScore(sectionId) {
  const itens = state.data[sectionId].itens;
  const feito = itens.filter((i) => i.status === 'feito').length;
  const pendente = itens.filter((i) => i.status === 'pendente').length;
  const aplicaveis = feito + pendente;
  const pct = aplicaveis ? Math.round((feito / aplicaveis) * 100) : null;
  return { feito, pendente, aplicaveis, pct, total: itens.length };
}

function overallScore() {
  let feito = 0, aplicaveis = 0, pendente = 0, imagens = 0;
  for (const s of state.checklist.sections) {
    const sc = sectionScore(s.id);
    feito += sc.feito; pendente += sc.pendente; aplicaveis += sc.aplicaveis;
    imagens += state.data[s.id].images.length;
  }
  const pct = aplicaveis ? Math.round((feito / aplicaveis) * 100) : null;
  return { feito, pendente, aplicaveis, pct, imagens };
}

// ---------------- EDITOR ----------------
function renderEditor() {
  const aiWarn = state.config.aiConfigured
    ? ''
    : `<div class="cro-warn">⚠️ A análise por IA está desligada — a chave da OpenAI não foi configurada no servidor (variável <b>OPENAI_API_KEY</b>). Você pode preencher a análise manualmente e gerar a apresentação normalmente.</div>`;

  app.innerHTML = `
    <div class="container">
      <header>
        <div class="brand">
          <span class="brand-icon">🎯</span>
          <h1>Análise de UI/UX</h1>
        </div>
        <div class="user-info">
          <span class="badge-ai ${state.config.aiConfigured ? 'on' : 'off'}">${state.config.aiConfigured ? '🤖 IA ativa · ' + escapeHtml(state.config.model) : '🤖 IA desligada'}</span>
          ${themeToggleHtml()}
          ${state.config.requiresPassword ? '<button class="secondary" id="logoutBtn">Sair</button>' : ''}
        </div>
      </header>

      ${aiWarn}

      <div class="intro">
        <h2>Diagnóstico de conversão (CRO) com imagens reais da loja</h2>
        <p>Envie os prints do e-commerce em cada seção, deixe a IA analisar contra o checklist, revise e gere a apresentação <b>“como está hoje × como deveria ser”</b>.</p>
      </div>

      <div class="cro-toolbar">
        <div class="cro-store">
          <input type="text" id="storeName" placeholder="Nome da loja / cliente" value="${escapeHtml(state.store.name)}" />
          <input type="text" id="storeUrl" placeholder="URL do e-commerce (ex: https://...)" value="${escapeHtml(state.store.url)}" />
        </div>
        <div class="cro-actions">
          <button id="analyzeAll" ${state.config.aiConfigured ? '' : 'disabled'} title="${state.config.aiConfigured ? 'Analisa com IA todas as seções que têm prints' : 'A IA está desligada no servidor'}">🤖 Analisar tudo com IA</button>
          <button id="presentBtn" class="primary">📊 Gerar apresentação</button>
          <button class="secondary" id="saveBtn">💾 Salvar projeto</button>
          <button class="secondary" id="openBtn">📂 Abrir projeto</button>
          <input type="file" id="openInput" accept="application/json,.json" class="hidden" />
        </div>
      </div>

      <div id="scoreBar" class="cro-overall"></div>
      <div id="sections">
        ${state.checklist.sections.map((s) => `<div class="cro-section" id="sec-card-${s.id}">${sectionCardInner(s)}</div>`).join('')}
      </div>
      <footer class="foot">Análise de UI/UX &amp; CRO · gerado com apoio de IA · revise sempre antes de entregar ao cliente.</footer>
    </div>
  `;

  applyTheme(currentTheme());
  document.getElementById('themeToggle').onclick = toggleTheme;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = logout;
  document.getElementById('storeName').oninput = (e) => { state.store.name = e.target.value; };
  document.getElementById('storeUrl').oninput = (e) => {
    state.store.url = e.target.value;
    // Preenche automaticamente o campo de captura das seções da home (só as que
    // o usuário ainda não personalizou), para não precisar colar a URL de novo.
    HOME_SECTIONS.forEach((id) => {
      if (!state.data[id] || state.data[id].url) return;
      const inp = document.getElementById(`url-${id}`);
      if (inp) inp.value = e.target.value;
    });
  };
  document.getElementById('presentBtn').onclick = renderPresentation;
  document.getElementById('analyzeAll').onclick = analyzeAllSections;
  document.getElementById('saveBtn').onclick = saveProject;
  const openInput = document.getElementById('openInput');
  document.getElementById('openBtn').onclick = () => openInput.click();
  openInput.onchange = () => { if (openInput.files[0]) openProject(openInput.files[0]); };

  state.checklist.sections.forEach((s) => wireSectionCard(s));
  renderOverall();
}

function renderOverall() {
  const el = document.getElementById('scoreBar');
  if (!el) return;
  const o = overallScore();
  const pct = o.pct === null ? 0 : o.pct;
  el.innerHTML = `
    <div class="cro-overall-inner">
      <div class="cro-gauge" style="--pct:${pct}">
        <span class="cro-gauge-val">${o.pct === null ? '—' : pct + '%'}</span>
      </div>
      <div class="cro-overall-info">
        <div class="cro-overall-title">Conformidade geral de CRO</div>
        <div class="cro-overall-sub">
          <span class="pill st-feito">${o.feito} ok</span>
          <span class="pill st-pendente">${o.pendente} a ajustar</span>
          <span class="pill">${o.imagens} imagem(ns)</span>
        </div>
      </div>
    </div>
  `;
}

// Seções cuja URL padrão é a home da loja (as demais precisam de link específico).
const HOME_SECTIONS = ['geral', 'pagina-inicial', 'rodape'];
function sectionUrlValue(sectionId) {
  const saved = state.data[sectionId].url;
  if (saved) return saved;
  return HOME_SECTIONS.includes(sectionId) ? (state.store.url || '') : '';
}

function sectionCardInner(section) {
  const d = state.data[section.id];
  const sc = sectionScore(section.id);
  const pctTxt = sc.pct === null ? '—' : sc.pct + '%';
  return `
    <div class="cro-sec-head">
      <div class="cro-sec-title"><span class="cro-sec-icon">${section.icon}</span>${escapeHtml(section.titulo)}</div>
      <div class="cro-sec-prog" id="prog-${section.id}">
        <div class="cro-sec-prog-bar"><span style="width:${sc.pct === null ? 0 : sc.pct}%"></span></div>
        <span class="cro-sec-prog-txt">${pctTxt}</span>
      </div>
    </div>
    <div class="cro-sec-resume">${escapeHtml(section.resumo || '')}</div>
    <div class="cro-capture">
      <input type="url" class="cro-url" id="url-${section.id}" placeholder="Cole aqui a URL desta página para capturar automaticamente" value="${escapeHtml(sectionUrlValue(section.id))}" />
      <button class="cro-capture-btn" data-sec="${section.id}">📸 Capturar do site</button>
      <span class="cro-capture-status" id="capstat-${section.id}"></span>
    </div>
    <div class="cro-drop" id="drop-${section.id}">
      <div class="cro-drop-hint">📷 ${escapeHtml(section.instrucaoImagem || 'Envie os prints desta seção.')}<br><span>Ou clique para escolher / arraste as imagens aqui</span></div>
      <input type="file" id="file-${section.id}" accept="image/*" multiple class="hidden" />
    </div>
    <div class="cro-thumbs">
      ${d.images.map((img) => `
        <div class="cro-thumb">
          <img src="${img.dataUrl}" alt="" />
          <button class="cro-thumb-del" data-sec="${section.id}" data-img="${img.id}" title="Remover">✕</button>
        </div>`).join('')}
    </div>
    <div class="cro-sec-actions">
      <button class="cro-analyze-btn" data-sec="${section.id}" ${state.config.aiConfigured ? '' : 'disabled'}>🤖 Analisar esta seção com IA</button>
      <span class="cro-analyze-status" id="anstat-${section.id}"></span>
    </div>
    <div class="cro-items">
      ${d.itens.map((it, idx) => itemRowHtml(section.id, it, idx)).join('')}
    </div>
  `;
}

function itemRowHtml(sectionId, it, idx) {
  const st = CRO_STATUS[it.status] || CRO_STATUS[''];
  return `
    <div class="cro-item ${st.cls}" data-sec="${sectionId}" data-idx="${idx}">
      <div class="cro-item-top">
        <span class="cro-dot ${st.cls}">${st.icon}</span>
        <span class="cro-item-acao">${escapeHtml(it.acao)}</span>
        <select class="cro-status-sel" data-sec="${sectionId}" data-idx="${idx}">
          ${Object.keys(CRO_STATUS).map((k) => `<option value="${k}" ${k === it.status ? 'selected' : ''}>${CRO_STATUS[k].label}</option>`).join('')}
        </select>
      </div>
      <div class="cro-item-fields">
        <label>Como está hoje
          <textarea class="cro-obs" rows="2" data-sec="${sectionId}" data-idx="${idx}" placeholder="O que se vê no print sobre este item...">${escapeHtml(it.observacao)}</textarea>
        </label>
        <label>Como deveria ser
          <textarea class="cro-rec" rows="2" data-sec="${sectionId}" data-idx="${idx}" placeholder="${escapeHtml(it.dica || 'Recomendação de melhoria...')}">${escapeHtml(it.recomendacao)}</textarea>
        </label>
      </div>
    </div>
  `;
}

function wireSectionCard(section) {
  const id = section.id;
  const fileInput = document.getElementById(`file-${id}`);
  const drop = document.getElementById(`drop-${id}`);
  if (drop && fileInput) {
    drop.onclick = () => fileInput.click();
    fileInput.onchange = () => { if (fileInput.files.length) addImages(id, fileInput.files); };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragover'); };
    drop.ondragleave = () => drop.classList.remove('dragover');
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove('dragover');
      if (e.dataTransfer.files.length) addImages(id, e.dataTransfer.files);
    };
  }
  const card = document.getElementById(`sec-card-${id}`);
  card.querySelectorAll('.cro-thumb-del').forEach((b) => {
    b.onclick = () => removeImage(b.dataset.sec, Number(b.dataset.img));
  });
  const urlInput = card.querySelector('.cro-url');
  if (urlInput) urlInput.oninput = () => { state.data[id].url = urlInput.value; };
  const captureBtn = card.querySelector('.cro-capture-btn');
  if (captureBtn) captureBtn.onclick = () => captureSection(id);
  card.querySelector('.cro-analyze-btn').onclick = () => analyzeSection(id);

  card.querySelectorAll('.cro-status-sel').forEach((sel) => {
    sel.onchange = () => {
      const idx = Number(sel.dataset.idx);
      state.data[id].itens[idx].status = sel.value;
      const row = card.querySelector(`.cro-item[data-idx="${idx}"]`);
      const st = CRO_STATUS[sel.value] || CRO_STATUS[''];
      row.className = `cro-item ${st.cls}`;
      const dot = row.querySelector('.cro-dot');
      dot.className = `cro-dot ${st.cls}`;
      dot.textContent = st.icon;
      updateSectionProgress(id);
      renderOverall();
    };
  });
  card.querySelectorAll('.cro-obs').forEach((t) => {
    t.oninput = () => { state.data[id].itens[Number(t.dataset.idx)].observacao = t.value; };
  });
  card.querySelectorAll('.cro-rec').forEach((t) => {
    t.oninput = () => { state.data[id].itens[Number(t.dataset.idx)].recomendacao = t.value; };
  });
}

function updateSectionProgress(sectionId) {
  const sc = sectionScore(sectionId);
  const el = document.getElementById(`prog-${sectionId}`);
  if (!el) return;
  el.querySelector('.cro-sec-prog-bar span').style.width = (sc.pct === null ? 0 : sc.pct) + '%';
  el.querySelector('.cro-sec-prog-txt').textContent = sc.pct === null ? '—' : sc.pct + '%';
}

function refreshSection(sectionId) {
  const section = state.checklist.sections.find((s) => s.id === sectionId);
  const wrap = document.getElementById(`sec-card-${sectionId}`);
  if (!wrap || !section) return;
  wrap.innerHTML = sectionCardInner(section);
  wireSectionCard(section);
  renderOverall();
}

// ---------------- IMAGENS ----------------
function downscaleImage(file, maxDim = 2200, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

// Reduz uma imagem já em dataURL (usada nas capturas vindas do servidor).
function downscaleDataUrl(dataUrl, maxDim = 2200, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl); // se falhar, mantém a original
    img.src = dataUrl;
  });
}

// Captura o print da página pela URL (via servidor) e adiciona à seção.
async function captureSection(sectionId) {
  const input = document.getElementById(`url-${sectionId}`);
  const statusEl = document.getElementById(`capstat-${sectionId}`);
  const url = (input && input.value || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    if (statusEl) statusEl.textContent = 'Cole uma URL começando com https://';
    return;
  }
  state.data[sectionId].url = url;
  const btn = document.querySelector(`.cro-capture-btn[data-sec="${sectionId}"]`);
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = '📸 Capturando a página... (pode levar alguns segundos)';
  try {
    const { dataUrl } = await api('/api/capture', { method: 'POST', body: JSON.stringify({ url }) });
    const small = await downscaleDataUrl(dataUrl);
    state.data[sectionId].images.push({ id: imgSeq++, dataUrl: small });
    refreshSection(sectionId);
    const after = document.getElementById(`capstat-${sectionId}`);
    if (after) after.textContent = '✅ Captura adicionada.';
  } catch (err) {
    if (btn) btn.disabled = false;
    if (statusEl) statusEl.textContent = '';
    showToast('Captura: ' + err.message);
  }
}

async function addImages(sectionId, fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
  for (const f of files) {
    try {
      const dataUrl = await downscaleImage(f);
      state.data[sectionId].images.push({ id: imgSeq++, dataUrl });
    } catch (err) {
      showToast('Erro ao processar imagem: ' + err.message);
    }
  }
  refreshSection(sectionId);
}

function removeImage(sectionId, imgId) {
  const d = state.data[sectionId];
  d.images = d.images.filter((i) => i.id !== imgId);
  refreshSection(sectionId);
}

// ---------------- ANÁLISE POR IA ----------------
async function analyzeSection(sectionId) {
  const d = state.data[sectionId];
  const statusEl = document.getElementById(`anstat-${sectionId}`);
  if (d.images.length === 0) {
    if (statusEl) statusEl.textContent = 'Envie ao menos um print antes de analisar.';
    return;
  }
  const btn = document.querySelector(`.cro-analyze-btn[data-sec="${sectionId}"]`);
  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = '🤖 Analisando com IA...';
  try {
    const { itens } = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({
        sectionId,
        storeName: state.store.name,
        storeUrl: state.store.url,
        images: d.images.map((i) => i.dataUrl),
      }),
    });
    d.itens = itens.map((it) => ({
      acao: it.acao,
      dica: it.dica || '',
      obs: it.obs || '',
      status: it.status || '',
      observacao: it.observacao || '',
      recomendacao: it.recomendacao || '',
    }));
    refreshSection(sectionId);
    const after = document.getElementById(`anstat-${sectionId}`);
    if (after) after.textContent = '✅ Análise concluída — revise e ajuste o que quiser.';
  } catch (err) {
    if (btn) btn.disabled = false;
    const after = document.getElementById(`anstat-${sectionId}`);
    if (after) after.textContent = '';
    showToast('Erro na análise: ' + err.message);
  }
}

async function analyzeAllSections() {
  const withImgs = state.checklist.sections.filter((s) => state.data[s.id].images.length > 0);
  if (withImgs.length === 0) {
    showToast('Envie prints em pelo menos uma seção antes de analisar.');
    return;
  }
  const btn = document.getElementById('analyzeAll');
  if (btn) btn.disabled = true;
  let done = 0;
  for (const s of withImgs) {
    if (btn) btn.textContent = `🤖 Analisando ${done + 1}/${withImgs.length}...`;
    await analyzeSection(s.id);
    done++;
  }
  if (btn) { btn.disabled = false; btn.textContent = '🤖 Analisar tudo com IA'; }
  showToast(`Análise concluída em ${withImgs.length} seção(ões).`);
}

// ---------------- SALVAR / ABRIR PROJETO ----------------
function saveProject() {
  const project = {
    _type: 'cro-analysis',
    version: 1,
    savedAt: new Date().toISOString(),
    store: state.store,
    data: state.data,
  };
  const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safe = (state.store.name || 'analise-uiux').replace(/[^\w\-]+/g, '_').replace(/_+/g, '_').slice(0, 50) || 'analise-uiux';
  a.href = url;
  a.download = `${safe}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Projeto salvo.');
}

function openProject(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const project = JSON.parse(reader.result);
      if (project._type !== 'cro-analysis' || !project.data) throw new Error('Arquivo inválido.');
      state.store = project.store || { name: '', url: '' };
      initData();
      for (const s of state.checklist.sections) {
        const saved = project.data[s.id];
        if (!saved) continue;
        if (typeof saved.url === 'string') state.data[s.id].url = saved.url;
        if (Array.isArray(saved.images)) {
          state.data[s.id].images = saved.images.map((img) => ({ id: imgSeq++, dataUrl: img.dataUrl }));
        }
        if (Array.isArray(saved.itens)) {
          saved.itens.forEach((si, i) => {
            const target = state.data[s.id].itens.find((t) => t.acao === si.acao) || state.data[s.id].itens[i];
            if (target) {
              target.status = si.status || '';
              target.observacao = si.observacao || '';
              target.recomendacao = si.recomendacao || '';
            }
          });
        }
      }
      renderEditor();
      showToast('Projeto carregado.');
    } catch (err) {
      showToast('Erro ao abrir projeto: ' + err.message);
    }
  };
  reader.onerror = () => showToast('Falha ao ler o arquivo.');
  reader.readAsText(file);
}

// ==================== APRESENTAÇÃO ====================
function formatDate() {
  try {
    return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function renderPresentation() {
  const o = overallScore();
  const store = state.store.name || 'E-commerce';
  const sectionsWithData = state.checklist.sections.filter((s) => {
    const d = state.data[s.id];
    return d.images.length > 0 || d.itens.some((i) => i.status);
  });

  const prioridades = [];
  for (const s of state.checklist.sections) {
    state.data[s.id].itens.forEach((it) => {
      if (it.status === 'pendente') {
        prioridades.push({ secao: s.titulo, icon: s.icon, acao: it.acao, rec: it.recomendacao || it.dica });
      }
    });
  }

  const slides = [];

  slides.push(`
    <section class="slide slide-cover">
      <div class="cover-tag">Análise de UI/UX &amp; CRO</div>
      <h1 class="cover-title">${escapeHtml(store)}</h1>
      ${state.store.url ? `<div class="cover-url">${escapeHtml(state.store.url)}</div>` : ''}
      <div class="cover-meta">Diagnóstico de conversão e experiência · ${formatDate()}</div>
      <div class="cover-score">
        <div class="cro-gauge big" style="--pct:${o.pct === null ? 0 : o.pct}"><span class="cro-gauge-val">${o.pct === null ? '—' : o.pct + '%'}</span></div>
        <div class="cover-score-label">Conformidade geral<br><b>${o.feito}</b> pontos ok · <b>${o.pendente}</b> oportunidades</div>
      </div>
    </section>
  `);

  slides.push(`
    <section class="slide">
      <h2 class="slide-h2">📋 Resumo por seção</h2>
      <div class="resumo-grid">
        ${state.checklist.sections.map((s) => {
          const sc = sectionScore(s.id);
          return `
          <div class="resumo-card">
            <div class="resumo-card-top"><span>${s.icon}</span>${escapeHtml(s.titulo)}</div>
            <div class="resumo-bar"><span style="width:${sc.pct === null ? 0 : sc.pct}%"></span></div>
            <div class="resumo-nums">${sc.pct === null ? 'sem dados' : sc.pct + '% · ' + sc.feito + ' ok / ' + sc.pendente + ' a ajustar'}</div>
          </div>`;
        }).join('')}
      </div>
    </section>
  `);

  if (prioridades.length) {
    slides.push(`
      <section class="slide">
        <h2 class="slide-h2">🚀 Principais oportunidades de melhoria</h2>
        <ol class="prio-list">
          ${prioridades.slice(0, 18).map((p) => `
            <li>
              <span class="prio-sec">${p.icon} ${escapeHtml(p.secao)}</span>
              <span class="prio-acao">${escapeHtml(p.acao)}</span>
              ${p.rec ? `<span class="prio-rec">${escapeHtml(p.rec)}</span>` : ''}
            </li>`).join('')}
        </ol>
        ${prioridades.length > 18 ? `<div class="prio-more">+ ${prioridades.length - 18} outras oportunidades detalhadas nas próximas páginas.</div>` : ''}
      </section>
    `);
  }

  for (const s of sectionsWithData) {
    const d = state.data[s.id];
    const sc = sectionScore(s.id);
    const itensRelevantes = d.itens.filter((i) => i.status && i.status !== 'nao_aplica');
    slides.push(`
      <section class="slide slide-section">
        <div class="slide-section-head">
          <h2 class="slide-h2">${s.icon} ${escapeHtml(s.titulo)}</h2>
          <span class="slide-section-score">${sc.pct === null ? '' : sc.pct + '% de conformidade'}</span>
        </div>
        <div class="compare">
          <div class="compare-col compare-atual">
            <div class="compare-label">📷 Como está hoje</div>
            <div class="compare-imgs">
              ${d.images.length
                ? d.images.map((img) => `<img src="${img.dataUrl}" alt="Print de ${escapeHtml(s.titulo)}" />`).join('')
                : '<div class="compare-noimg">Sem print enviado para esta seção.</div>'}
            </div>
          </div>
          <div class="compare-col compare-ideal">
            <div class="compare-label">✅ Como deveria ser</div>
            <div class="compare-items">
              ${(itensRelevantes.length ? itensRelevantes : d.itens).map((it) => {
                const st = CRO_STATUS[it.status] || CRO_STATUS[''];
                const detail = it.status === 'feito'
                  ? (it.observacao || 'Boa prática já aplicada.')
                  : (it.recomendacao || it.dica || it.observacao || '');
                return `
                  <div class="compare-item ${st.cls}">
                    <span class="cro-dot ${st.cls}">${st.icon}</span>
                    <div class="compare-item-body">
                      <div class="compare-item-acao">${escapeHtml(it.acao)}</div>
                      ${detail ? `<div class="compare-item-detail">${escapeHtml(detail)}</div>` : ''}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </section>
    `);
  }

  slides.push(`
    <section class="slide slide-cover slide-end">
      <div class="cover-tag">Próximos passos</div>
      <h1 class="cover-title">Vamos elevar sua conversão</h1>
      <div class="cover-meta">Priorize as oportunidades marcadas como “a ajustar” e acompanhe a evolução da conformidade.</div>
    </section>
  `);

  app.innerHTML = `
    <div class="cro-present-wrap">
      <div class="cro-present-bar no-print">
        <button class="secondary" id="backBtn">← Voltar ao editor</button>
        <div class="cro-present-title">Apresentação — ${escapeHtml(store)}</div>
        <button class="primary" id="printBtn">🖨️ Exportar PDF</button>
      </div>
      <div class="cro-slides">${slides.join('')}</div>
    </div>
  `;
  applyTheme(currentTheme());
  document.getElementById('backBtn').onclick = renderEditor;
  document.getElementById('printBtn').onclick = () => window.print();
}

init();
