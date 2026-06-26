// app.js — Controlador da interface (navegação, câmera, correção e telas).

import { loadExam, saveExam, resetExam } from './config.js';
import { loadOpenCV } from './opencv-loader.js';
import { Camera } from './camera.js';
import { findDocumentQuad, gradeFromSource, summarize, CANON_W, CANON_H } from './omr.js';
import { printCard } from './card.js';
import { listResults, saveResult, deleteResult, clearResults, downloadCSV } from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  exam: loadExam(),
  view: 'home',
  lastResult: null,        // retorno de gradeFromSource
  overrides: {},           // ajuste manual da leitura (opcional): { qid: option|null }
  manualWritten: {},       // marcação das dissertativas (opcional): { writtenId: bool }
  nameValue: '',           // nome do aluno (opcional)
  summary: null,
  cvReady: false,
  deferredInstall: null,
};

const camera = new Camera($('#video'));

// ---------- Utilitários de UI ----------
function showLoading(text = 'Carregando…') {
  $('#loadingText').textContent = text;
  $('#loading').hidden = false;
}
function hideLoading() { $('#loading').hidden = true; }

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

const VIEW_TITLES = {
  home: 'Corretor NR-33',
  scan: 'Corrigir prova',
  result: 'Resultado',
  gabarito: 'Gabarito',
  resultados: 'Resultados',
};

function showView(name) {
  // Encerra a câmera ao sair da tela de leitura.
  if (state.view === 'scan' && name !== 'scan') stopScan();
  state.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $('#topTitle').textContent = VIEW_TITLES[name] || 'Corretor NR-33';
  $('#backBtn').hidden = name === 'home';
  if (name === 'scan') startScan();
  if (name === 'gabarito') renderGabarito();
  if (name === 'resultados') renderResultados();
  window.scrollTo(0, 0);
  document.querySelector('.view.active')?.scrollTo(0, 0);
}

// ---------- Garantir OpenCV ----------
async function ensureCV() {
  if (state.cvReady) return true;
  showLoading('Baixando módulo de visão (OpenCV)…');
  try {
    await loadOpenCV((m) => showLoading(m));
    state.cvReady = true;
    return true;
  } catch (e) {
    hideLoading();
    toast('Não foi possível carregar o OpenCV. Verifique a internet.');
    console.error(e);
    return false;
  } finally {
    if (state.cvReady) hideLoading();
  }
}

// ---------- Tela de leitura (scan) ----------
let scanRAF = null;
let stableCount = 0;
let lastQuadForCapture = null;

async function startScan() {
  const ok = await ensureCV();
  if (!ok) { showView('home'); return; }
  try {
    await camera.start('environment');
  } catch (e) {
    toast('Não foi possível acessar a câmera. Use HTTPS e permita o acesso.');
    console.error(e);
    showView('home');
    return;
  }
  // Botão de lanterna, se suportado.
  $('#torchBtn').hidden = !camera.hasTorch();
  $('#torchBtn').classList.remove('on');
  stableCount = 0;
  lastQuadForCapture = null;
  scanLoop();
}

function stopScan() {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
  camera.stop();
}

function scanLoop() {
  const video = $('#video');
  if (!video.videoWidth) { scanRAF = requestAnimationFrame(scanLoop); return; }

  const detect = $('#detectCanvas');
  const DW = 480;
  const scaleDet = DW / video.videoWidth;
  const DH = Math.round(video.videoHeight * scaleDet);
  detect.width = DW; detect.height = DH;
  const dctx = detect.getContext('2d', { willReadFrequently: true });
  dctx.drawImage(video, 0, 0, DW, DH);

  let quad = null;
  try {
    const src = window.cv.imread(detect);
    quad = findDocumentQuad(src);
    src.delete();
  } catch (e) { /* ignora frames com falha */ }

  drawOverlay(quad, DW, DH);

  const status = $('#scanStatus');
  if (quad) {
    // Converte para coords do vídeo (full-res) para captura.
    lastQuadForCapture = quad.map((p) => ({ x: p.x / scaleDet, y: p.y / scaleDet }));
    stableCount++;
    if (stableCount >= 6) {
      status.textContent = '✓ Cartão detectado — segure firme';
      status.classList.add('ready');
      if (stableCount === 9) doCapture(); // auto-captura
    } else {
      status.textContent = 'Cartão encontrado…';
      status.classList.remove('ready');
    }
  } else {
    stableCount = 0;
    lastQuadForCapture = null;
    status.textContent = 'Aponte para o cartão (preencha a tela)';
    status.classList.remove('ready');
  }

  scanRAF = requestAnimationFrame(scanLoop);
}

// Mapeia ponto do vídeo para a tela considerando object-fit: cover.
function videoToDisplay(vx, vy, video, box) {
  const scale = Math.max(box.w / video.videoWidth, box.h / video.videoHeight);
  const dispW = video.videoWidth * scale;
  const dispH = video.videoHeight * scale;
  const offX = (dispW - box.w) / 2;
  const offY = (dispH - box.h) / 2;
  return { x: vx * scale - offX, y: vy * scale - offY };
}

function drawOverlay(quadDet, DW, DH) {
  const overlay = $('#overlay');
  const video = $('#video');
  const rect = overlay.getBoundingClientRect();
  if (overlay.width !== Math.round(rect.width) || overlay.height !== Math.round(rect.height)) {
    overlay.width = Math.round(rect.width);
    overlay.height = Math.round(rect.height);
  }
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!quadDet) return;
  const box = { w: overlay.width, h: overlay.height };
  // quadDet está em coords do detectCanvas (DW×DH); converte p/ vídeo e depois display.
  const sx = video.videoWidth / DW, sy = video.videoHeight / DH;
  const pts = quadDet.map((p) => videoToDisplay(p.x * sx, p.y * sy, video, box));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.strokeStyle = stableCount >= 6 ? '#1f9d55' : '#ffd23b';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = stableCount >= 6 ? 'rgba(31,157,85,0.15)' : 'rgba(255,210,59,0.10)';
  ctx.fill();
}

async function doCapture() {
  if (state.view !== 'scan') return;
  stopScanRAF();
  showLoading('Processando cartão…');
  await new Promise((r) => setTimeout(r, 30)); // deixa o overlay aparecer
  const cap = $('#captureCanvas');
  camera.grabFrame(cap);
  const ok = processCanvas(cap);
  if (!ok) { stableCount = 0; scanLoop(); }
}

// Corrige um canvas já capturado e exibe o resultado. Retorna true se reconheceu
// o cartão. Separado de doCapture para reuso e testabilidade.
function processCanvas(canvas) {
  let res;
  try {
    res = gradeFromSource(canvas, state.exam);
  } catch (e) {
    console.error(e);
    res = { ok: false, reason: 'error' };
  }
  hideLoading();
  if (!res.ok) {
    toast(res.reason === 'no-card' ? 'Cartão não localizado. Aproxime e centralize.' : 'Erro ao processar. Tente novamente.');
    return false;
  }
  camera.stop();
  state.lastResult = res;
  state.overrides = {};
  state.manualWritten = {};
  state.nameValue = '';
  renderResult();
  showView('result');
  return true;
}

function stopScanRAF() {
  if (scanRAF) cancelAnimationFrame(scanRAF);
  scanRAF = null;
}

// ---------- Tela de resultado (correção por imagem + opcionais) ----------
function computeSummary() {
  state.summary = summarize(state.exam, state.lastResult.results, state.manualWritten, state.overrides);
  return state.summary;
}

function renderResult() {
  const sum = computeSummary();
  const root = $('#resultContent');
  root.innerHTML = '';

  // Cabeçalho com a nota.
  const head = document.createElement('div');
  head.className = 'score-head ' + (sum.passed ? 'pass' : 'fail');
  head.innerHTML = `
    <div class="score-pct" id="scorePct">${sum.percent}%</div>
    <div class="score-label" id="scoreLabel">${sum.passed ? 'APROVADO' : 'REPROVADO'}</div>
    <div class="score-sub" id="scoreSub">${summaryText(sum)}</div>`;
  root.appendChild(head);

  // Miniatura do cartão desentortado, com a correção marcada.
  const thumb = document.createElement('canvas');
  thumb.className = 'result-thumb';
  drawAnnotated(thumb);
  root.appendChild(thumb);

  // Leitura das objetivas (toque para ajustar, se necessário).
  const title = document.createElement('div');
  title.className = 'section-title';
  title.textContent = 'Conferência da leitura — toque para ajustar, se necessário';
  root.appendChild(title);

  const list = document.createElement('div');
  list.className = 'q-list';
  sum.perQuestion.forEach((q) => list.appendChild(renderQItem(q)));
  root.appendChild(list);

  // Dissertativas (opcional — marcação manual).
  if (state.exam.written && state.exam.written.length) {
    const wt = document.createElement('div');
    wt.className = 'section-title';
    wt.textContent = 'Questões dissertativas (opcional — marque as corretas)';
    root.appendChild(wt);
    state.exam.written.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'written-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `w_${w.id}`;
      cb.checked = !!state.manualWritten[w.id];
      cb.addEventListener('change', () => { state.manualWritten[w.id] = cb.checked; refreshHeader(); });
      const lb = document.createElement('label');
      lb.setAttribute('for', `w_${w.id}`);
      lb.textContent = w.label;
      row.append(cb, lb);
      root.appendChild(row);
    });
  }

  // Nome do aluno (opcional).
  const nameWrap = document.createElement('div');
  nameWrap.className = 'name-field';
  nameWrap.innerHTML = `<label for="stuName">Nome do aluno (opcional)</label>`;
  const inp = document.createElement('input');
  inp.id = 'stuName';
  inp.type = 'text';
  inp.placeholder = 'Ex.: João da Silva';
  inp.value = state.nameValue;
  inp.addEventListener('input', () => { state.nameValue = inp.value; });
  nameWrap.appendChild(inp);
  root.appendChild(nameWrap);

  // Ações.
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="btn primary" id="redoBtn">📷 Corrigir outro</button>
    <button class="btn ghost" id="saveBtn">💾 Salvar (opcional)</button>
    <button class="btn ghost" id="homeBtn2">🏠 Início</button>`;
  root.appendChild(actions);

  $('#redoBtn').onclick = () => showView('scan');
  $('#saveBtn').onclick = onSaveResult;
  $('#homeBtn2').onclick = () => showView('home');
}

function summaryText(sum) {
  let t = `Objetivas: ${sum.objCorrect}/${sum.objTotal}`;
  if (sum.writtenTotal) t += ` · Dissertativas: ${sum.writtenCorrect}/${sum.writtenTotal}`;
  t += ` · Total: ${sum.totalCorrect}/${sum.totalItems} · mínimo ${state.exam.passPercent || 70}%`;
  return t;
}

function refreshHeader() {
  const sum = computeSummary();
  const head = $('.score-head');
  head.className = 'score-head ' + (sum.passed ? 'pass' : 'fail');
  $('#scorePct').textContent = `${sum.percent}%`;
  $('#scoreLabel').textContent = sum.passed ? 'APROVADO' : 'REPROVADO';
  $('#scoreSub').textContent = summaryText(sum);
}

function renderQItem(q) {
  const item = document.createElement('div');
  item.className = 'q-item';
  item.dataset.qid = q.qid;

  const badge = document.createElement('div');
  badge.className = 'q-badge ' + qBadgeClass(q);
  badge.textContent = q.correct ? '✓' : (q.marked == null ? '–' : '✕');

  const main = document.createElement('div');
  main.className = 'q-main';
  main.innerHTML = qDetailHTML(q);

  // Ajuste manual da leitura (opcional): toque numa alternativa para corrigir.
  const ov = document.createElement('div');
  ov.className = 'override-row';
  optionListFor(q.qid).forEach((opt) => {
    const pill = document.createElement('button');
    pill.className = 'opt-pill' + (q.marked === opt ? ' sel' : '') + (opt === q.answer ? ' key' : '');
    pill.textContent = opt;
    pill.onclick = () => {
      // Toque na opção já marcada limpa (deixa em branco).
      state.overrides[q.qid] = (q.marked === opt) ? null : opt;
      const sum = computeSummary();
      replaceQItem(item, sum.perQuestion.find((x) => x.qid === q.qid));
      refreshHeader();
      redrawThumb();
    };
    ov.appendChild(pill);
  });
  main.appendChild(ov);

  item.append(badge, main);
  return item;
}

function replaceQItem(oldEl, q) { oldEl.replaceWith(renderQItem(q)); }

function qBadgeClass(q) {
  if (q.correct) return 'correct';
  if (q.marked == null) return 'blank';
  return 'wrong';
}

function qDetailHTML(q) {
  const label = q.type === 'tf' ? `Item ${q.qid}` : `Questão ${q.qid}`;
  let markedTxt;
  if (q.marked == null) markedTxt = q.status === 'multiple' ? '<b>Múltiplas marcas</b>' : '<b>Em branco</b>';
  else markedTxt = `Marcado: <b>${q.marked}</b>`;
  return `<div class="q-id">${label}</div><div class="q-detail">${markedTxt} · Gabarito: <b>${q.answer}</b>${q.overridden ? ' · <i>ajustado</i>' : ''}</div>`;
}

function optionListFor(qid) {
  const q = state.exam.questions.find((x) => x.id === qid);
  return q ? q.options : [];
}

// Desenha a miniatura desentortada com a correção sobreposta às bolhas.
function drawAnnotated(canvas) {
  const sum = state.summary || computeSummary();
  const warped = state.lastResult.warpedCanvas;
  const Wt = 320;
  const scale = Wt / CANON_W;
  canvas.width = Wt;
  canvas.height = Math.round(CANON_H * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(warped, 0, 0, canvas.width, canvas.height);

  const r = 0.020 * CANON_W * scale * 1.25;
  sum.perQuestion.forEach((q) => {
    const res = state.lastResult.results.find((x) => x.qid === q.qid);
    if (!res) return;
    // Bolha do gabarito (verde).
    const ansB = res.bubbles.find((b) => b.option === q.answer);
    if (ansB) ring(ctx, ansB.x * CANON_W * scale, ansB.y * CANON_H * scale, r, '#1f9d55', q.correct ? 3 : 2, !q.correct);
    // Bolha marcada errada (vermelho).
    if (q.marked != null && q.marked !== q.answer) {
      const mb = res.bubbles.find((b) => b.option === q.marked);
      if (mb) ring(ctx, mb.x * CANON_W * scale, mb.y * CANON_H * scale, r, '#d23b3b', 3, false);
    }
  });
}

function ring(ctx, x, y, r, color, lw, dashed) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = color;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function redrawThumb() {
  const thumb = $('#resultContent .result-thumb');
  if (thumb) drawAnnotated(thumb);
}

function onSaveResult() {
  const sum = computeSummary();
  const now = new Date();
  saveResult({
    id: `${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
    name: state.nameValue.trim(),
    date: now.toLocaleString('pt-BR'),
    objCorrect: sum.objCorrect, objTotal: sum.objTotal,
    writtenCorrect: sum.writtenCorrect, writtenTotal: sum.writtenTotal,
    totalCorrect: sum.totalCorrect, totalItems: sum.totalItems,
    percent: sum.percent, passed: sum.passed,
  });
  toast('Resultado salvo ✓');
  showView('resultados');
}

// ---------- Gabarito / configurações ----------
function renderGabarito() {
  const root = $('#gabaritoContent');
  const exam = state.exam;
  root.innerHTML = '';

  const cfg = document.createElement('div');
  cfg.className = 'field-block';
  cfg.innerHTML = `<h3>Configurações</h3>
    <div class="num-field">
      <label for="passInput">Nota mínima para aprovação (%)</label>
      <input id="passInput" type="number" min="0" max="100" value="${exam.passPercent}">
    </div>`;
  root.appendChild(cfg);

  const objBlock = document.createElement('div');
  objBlock.className = 'field-block';
  objBlock.innerHTML = `<h3>Gabarito — questões objetivas</h3>`;
  exam.questions.forEach((q) => {
    const row = document.createElement('div');
    row.className = 'gab-row';
    const id = document.createElement('div');
    id.className = 'gab-id';
    id.textContent = q.type === 'tf' ? q.id : `${q.id}.`;
    const opts = document.createElement('div');
    opts.className = 'gab-opts';
    q.options.forEach((opt) => {
      const pill = document.createElement('button');
      pill.className = 'opt-pill' + (q.answer === opt ? ' sel' : '');
      pill.textContent = opt;
      pill.onclick = () => {
        q.answer = opt;
        $$('.opt-pill', opts).forEach((p) => p.classList.toggle('sel', p.textContent === opt));
      };
      opts.appendChild(pill);
    });
    row.append(id, opts);
    objBlock.appendChild(row);
  });
  root.appendChild(objBlock);

  if (exam.written && exam.written.length) {
    const wBlock = document.createElement('div');
    wBlock.className = 'field-block';
    wBlock.innerHTML = `<h3>Questões dissertativas (corrigidas à mão)</h3>` +
      exam.written.map((w) => `<div class="gab-row"><span>${w.label}</span></div>`).join('');
    root.appendChild(wBlock);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="btn primary" id="gabSave">💾 Salvar gabarito</button>
    <button class="btn ghost" id="gabPrint">🖨️ Imprimir cartão</button>
    <button class="btn danger" id="gabReset">↺ Restaurar padrão</button>`;
  root.appendChild(actions);

  $('#gabSave').onclick = () => {
    const pv = parseInt($('#passInput').value, 10);
    if (!isNaN(pv)) exam.passPercent = Math.max(0, Math.min(100, pv));
    saveExam(exam);
    toast('Gabarito salvo ✓');
  };
  $('#gabPrint').onclick = () => printCard(state.exam);
  $('#gabReset').onclick = () => {
    if (confirm('Restaurar o gabarito padrão da NR-33?')) {
      state.exam = resetExam();
      renderGabarito();
      toast('Gabarito restaurado');
    }
  };
}

// ---------- Resultados salvos (opcional) ----------
function renderResultados() {
  const root = $('#resultadosContent');
  const results = listResults();
  root.innerHTML = '';

  if (!results.length) {
    root.innerHTML = `<div class="empty">Nenhum resultado salvo.<br>Ao corrigir, toque em “Salvar” para guardar aqui (opcional).</div>`;
    return;
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="btn primary" id="csvBtn">⬇️ Exportar CSV</button>
    <button class="btn danger" id="clearBtn">🗑️ Limpar tudo</button>`;
  root.appendChild(actions);

  results.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'res-row';
    row.innerHTML = `
      <div class="res-pct ${r.passed ? 'pass' : 'fail'}">${r.percent}%</div>
      <div class="res-info">
        <div class="nm">${r.name || '(sem nome)'}</div>
        <div class="dt">${r.date} · ${r.totalCorrect}/${r.totalItems} · ${r.passed ? 'Aprovado' : 'Reprovado'}</div>
      </div>
      <button class="icon-btn" style="background:#eee;color:#333" aria-label="Excluir">✕</button>`;
    row.querySelector('button').onclick = () => { deleteResult(r.id); renderResultados(); };
    root.appendChild(row);
  });

  $('#csvBtn').onclick = () => downloadCSV(listResults());
  $('#clearBtn').onclick = () => {
    if (confirm('Apagar todos os resultados salvos?')) { clearResults(); renderResultados(); }
  };
}

// ---------- Eventos globais ----------
function wireUp() {
  $$('[data-go]').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.go)));
  $('#backBtn').addEventListener('click', () => showView('home'));
  $('#printCardBtn').addEventListener('click', () => printCard(state.exam));
  $('#captureBtn').addEventListener('click', () => doCapture());
  $('#switchCamBtn').addEventListener('click', async () => {
    try { await camera.switchCamera(); $('#torchBtn').hidden = !camera.hasTorch(); }
    catch (e) { toast('Falha ao trocar de câmera'); }
  });
  $('#torchBtn').addEventListener('click', async () => {
    const btn = $('#torchBtn');
    const on = !btn.classList.contains('on');
    const ok = await camera.setTorch(on);
    if (ok) btn.classList.toggle('on', on);
  });

  // Instalação PWA.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstall = e;
    const hint = $('#installHint');
    hint.hidden = false;
    hint.style.cursor = 'pointer';
    hint.onclick = async () => {
      state.deferredInstall.prompt();
      await state.deferredInstall.userChoice;
      state.deferredInstall = null;
      hint.hidden = true;
    };
  });
}

// Service worker (uso offline).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW falhou', e));
  });
}

wireUp();
showView('home');

// API de automação/integração: permite corrigir uma imagem (canvas/<img>) por
// código, sem passar pela câmera. Útil para testes e para integrações futuras.
window.CorretorNR33 = {
  ensureOpenCV: ensureCV,
  loadExam: () => state.exam,
  gradeCanvas: (canvas) => processCanvas(canvas),
};
