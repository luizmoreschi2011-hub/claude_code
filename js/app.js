// app.js — Controlador da interface (navegação, câmera, correção e telas).

import {
  getActiveExam, getActiveId, setActiveProfile, saveActiveExam,
  listProfiles, hasProfiles, createProfile, deleteProfile, renameProfile, makeQuestions, badgeText,
  OPTION_SETS,
} from './config.js';
import * as auth from './auth.js';
import { loadOpenCV } from './opencv-loader.js';
import { Camera } from './camera.js';
import { findDocumentQuad, gradeFromSource, summarize, CANON_W, CANON_H } from './omr.js';
import { printCard } from './card.js';
import { printExam } from './examdoc.js';
import { listResults, saveResult, deleteResult, clearResults, downloadCSV, getLastTrace, saveLastTrace } from './storage.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
  exam: getActiveExam(),
  view: 'home',
  lastResult: null,        // retorno de gradeFromSource
  overrides: {},           // ajuste manual da leitura (opcional): { qid: option|null }
  manualWritten: {},       // marcação das dissertativas (opcional): { writtenId: bool }
  trace: { name: '', cpf: '', cnpj: '', empresa: '' }, // rastreabilidade (obrigatório p/ salvar)
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
  home: 'Corretor',
  scan: 'Corrigir prova',
  result: 'Resultado',
  corretores: 'Provas',
  gabarito: 'Gabarito',
  resultados: 'Resultados',
  'montar-prova': 'Montar prova',
  login: 'Entrar',
  assinatura: 'Minha conta',
};

function updateBadge() {
  const b = $('#badgeBtn');
  if (b) b.textContent = badgeText(state.exam) + ' ▾';
}

function updateAccountBtn() {
  const b = $('#accountBtn');
  if (!b) return;
  const u = auth.currentUser();
  b.hidden = !u || state.view === 'login';
  b.textContent = u ? (u.mode === 'local' ? '👤 Local' : '👤 Conta') : '';
}

// Garante que existe uma prova ativa antes de ações que dependem dela.
function requireExam() {
  if (state.exam) return true;
  toast('Crie ou selecione uma prova primeiro.');
  showView('corretores');
  return false;
}

function showView(name) {
  // Encerra a câmera ao sair da tela de leitura.
  if (state.view === 'scan' && name !== 'scan') stopScan();
  state.view = name;
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  $('#topTitle').textContent = VIEW_TITLES[name] || 'Corretor';
  $('#backBtn').hidden = name === 'home' || name === 'login';
  updateAccountBtn();
  if (name === 'home') updateBadge();
  if (name === 'scan') startScan();
  if (name === 'corretores') renderCorretores();
  if (name === 'gabarito') renderGabarito();
  if (name === 'resultados') renderResultados();
  if (name === 'montar-prova') renderMontar();
  if (name === 'login') renderLogin();
  if (name === 'assinatura') renderAssinatura();
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
  if (!state.exam) { showView('corretores'); toast('Crie ou selecione uma prova primeiro.'); return; }
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
  // Reinicia identificação; pré-preenche Empresa/CNPJ (costumam repetir na turma).
  const last = getLastTrace();
  state.trace = { name: '', cpf: '', cnpj: last.cnpj || '', empresa: last.empresa || '' };
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

  // Identificação para salvar / rastreabilidade (obrigatório).
  const idTitle = document.createElement('div');
  idTitle.className = 'section-title';
  idTitle.innerHTML = 'Identificação <span class="req-star">*obrigatório para salvar</span>';
  root.appendChild(idTitle);

  const idWrap = document.createElement('div');
  idWrap.className = 'pad';
  const fields = [
    { key: 'name', label: 'Nome', ph: 'Ex.: João da Silva', mode: 'text' },
    { key: 'cpf', label: 'CPF', ph: '000.000.000-00', mode: 'numeric' },
    { key: 'cnpj', label: 'CNPJ', ph: '00.000.000/0000-00', mode: 'numeric' },
    { key: 'empresa', label: 'Empresa', ph: 'Razão social', mode: 'text' },
  ];
  fields.forEach((f) => {
    const fb = document.createElement('div');
    fb.className = 'form-field field-required';
    const lb = document.createElement('label');
    lb.setAttribute('for', `tr_${f.key}`);
    lb.innerHTML = `${f.label} <span class="req-star">*</span>`;
    const inp = document.createElement('input');
    inp.id = `tr_${f.key}`;
    inp.type = 'text';
    if (f.mode === 'numeric') inp.inputMode = 'numeric';
    inp.placeholder = f.ph;
    inp.value = state.trace[f.key] || '';
    inp.addEventListener('input', () => { state.trace[f.key] = inp.value; inp.classList.remove('missing'); });
    fb.append(lb, inp);
    idWrap.appendChild(fb);
  });
  root.appendChild(idWrap);

  // Ações.
  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="btn primary" id="saveBtn">💾 Salvar</button>
    <button class="btn ghost" id="redoBtn">📷 Corrigir outro</button>
    <button class="btn ghost" id="homeBtn2">🏠 Início</button>`;
  root.appendChild(actions);

  $('#saveBtn').onclick = onSaveResult;
  $('#redoBtn').onclick = () => showView('scan');
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

const onlyDigits = (s) => (s || '').replace(/\D/g, '');

// Valida os campos obrigatórios. Retorna lista de chaves inválidas.
function validateTrace(t) {
  const bad = [];
  if (!String(t.name || '').trim()) bad.push('name');
  if (onlyDigits(t.cpf).length !== 11) bad.push('cpf');
  if (onlyDigits(t.cnpj).length !== 14) bad.push('cnpj');
  if (!String(t.empresa || '').trim()) bad.push('empresa');
  return bad;
}

function onSaveResult() {
  const bad = validateTrace(state.trace);
  if (bad.length) {
    bad.forEach((k) => $(`#tr_${k}`)?.classList.add('missing'));
    $(`#tr_${bad[0]}`)?.focus();
    const msg = (bad.includes('cpf') || bad.includes('cnpj'))
      ? 'Preencha Nome, CPF (11 dígitos), CNPJ (14 dígitos) e Empresa.'
      : 'Preencha todos os campos de identificação.';
    toast(msg);
    return;
  }
  const sum = computeSummary();
  const now = new Date();
  saveResult({
    id: `${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
    name: state.trace.name.trim(),
    cpf: state.trace.cpf.trim(),
    cnpj: state.trace.cnpj.trim(),
    empresa: state.trace.empresa.trim(),
    corretor: state.exam.name || state.exam.title || '',
    examId: state.exam.id || '',
    date: now.toLocaleString('pt-BR'),
    objCorrect: sum.objCorrect, objTotal: sum.objTotal,
    writtenCorrect: sum.writtenCorrect, writtenTotal: sum.writtenTotal,
    totalCorrect: sum.totalCorrect, totalItems: sum.totalItems,
    percent: sum.percent, passed: sum.passed,
  });
  saveLastTrace({ empresa: state.trace.empresa.trim(), cnpj: state.trace.cnpj.trim() });
  toast('Resultado salvo ✓');
  showView('resultados');
}

// ---------- Gabarito / configurações ----------
function isAutoExam(exam) {
  return !exam.questions.some((q) => q.column === 'left' || q.column === 'right');
}

function renderGabarito() {
  const root = $('#gabaritoContent');
  const exam = state.exam;
  root.innerHTML = '';
  if (!exam) {
    root.innerHTML = `<div class="empty">Nenhuma prova selecionada.<br><br><button class="btn primary" onclick="document.getElementById('badgeBtn').click()">Selecionar / criar prova</button></div>`;
    return;
  }
  const auto = isAutoExam(exam);

  // Configurações: nome do corretor, nota mínima e (provas novas) nº de questões + alternativas.
  const cfg = document.createElement('div');
  cfg.className = 'field-block';
  cfg.innerHTML = `<h3>Configurações — ${esc(exam.name || exam.title || '')}</h3>
    <div class="form-field">
      <label for="nameInput">Nome do corretor</label>
      <input id="nameInput" type="text" value="${esc(exam.name || exam.title || '')}">
    </div>
    <div class="num-field">
      <label for="passInput">Nota mínima para aprovação (%)</label>
      <input id="passInput" type="number" min="0" max="100" value="${exam.passPercent}">
    </div>`;
  if (auto) {
    const optSel = Object.entries(OPTION_SETS)
      .map(([k, v]) => `<option value="${k}"${exam.optionsKey === k ? ' selected' : ''}>${v.label}</option>`).join('');
    const extra = document.createElement('div');
    extra.innerHTML = `
      <div class="num-field">
        <label for="numQInput">Número de questões</label>
        <input id="numQInput" type="number" min="1" max="60" value="${exam.questions.length}">
      </div>
      <div class="form-field">
        <label for="optsSel">Alternativas (todas as questões)</label>
        <select id="optsSel">${optSel}</select>
      </div>`;
    cfg.appendChild(extra);
  }
  root.appendChild(cfg);

  // Gabarito (respostas) — uma linha por questão.
  const objBlock = document.createElement('div');
  objBlock.className = 'field-block';
  objBlock.innerHTML = `<h3>Gabarito — toque na alternativa correta</h3>`;
  exam.questions.forEach((q) => {
    const row = document.createElement('div');
    row.className = 'gab-row';
    const id = document.createElement('div');
    id.className = 'gab-id';
    id.textContent = q.type === 'tf' && /\./.test(q.id) ? q.id : `${q.id}.`;
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
    <button class="btn ghost" id="gabEdit">📝 Editar perguntas</button>
    <button class="btn ghost" id="gabPrintExam">🖨️ Imprimir prova</button>
    <button class="btn ghost" id="gabPrint">🖨️ Imprimir cartão</button>`;
  root.appendChild(actions);

  // Aplica nome/nota em memória (persistido no Salvar).
  const applyMeta = () => {
    const nm = $('#nameInput').value.trim();
    if (nm) { exam.name = nm; exam.title = nm; }
    const pv = parseInt($('#passInput').value, 10);
    if (!isNaN(pv)) exam.passPercent = Math.max(0, Math.min(100, pv));
  };

  if (auto) {
    const regen = () => {
      applyMeta();
      const n = Math.max(1, Math.min(60, parseInt($('#numQInput').value, 10) || exam.questions.length));
      const key = $('#optsSel').value;
      exam.optionsKey = key;
      exam.questions = makeQuestions(n, key, exam.questions);
      renderGabarito();
    };
    $('#numQInput').addEventListener('change', regen);
    $('#optsSel').addEventListener('change', regen);
  }

  $('#gabSave').onclick = () => { applyMeta(); saveActiveExam(exam); updateBadge(); toast('Gabarito salvo ✓'); };
  $('#gabEdit').onclick = () => { applyMeta(); saveActiveExam(exam); showView('montar-prova'); };
  $('#gabPrintExam').onclick = () => { applyMeta(); printExam(state.exam); };
  $('#gabPrint').onclick = () => { applyMeta(); printCard(state.exam); };
}

// ---------- Corretores (perfis de prova) ----------
function renderCorretores() {
  const root = $('#corretoresContent');
  root.innerHTML = '';

  const profiles = listProfiles();
  const intro = document.createElement('p');
  intro.className = 'install-hint';
  intro.style.margin = '0 0 12px';
  intro.textContent = profiles.length
    ? 'Selecione uma prova para usar, ou crie/monte uma nova.'
    : 'Você ainda não tem provas. Crie uma rápida abaixo, ou use “Montar prova” para cadastrar as perguntas.';
  root.appendChild(intro);

  // Lista de provas.
  profiles.forEach((p) => {
    const row = document.createElement('div');
    row.className = 'corretor-row' + (p.active ? ' active' : '');
    const main = document.createElement('div');
    main.className = 'corretor-main';
    main.innerHTML = `<div class="nm">${esc(p.name)} ${p.active ? '<span class="tag-active">✓ ativa</span>' : ''}</div>
      <div class="meta">${p.count} ${p.count === 1 ? 'questão' : 'questões'}</div>`;
    main.onclick = () => {
      state.exam = setActiveProfile(p.id);
      updateBadge();
      toast(`Prova: ${p.name}`);
      showView('home');
    };
    row.appendChild(main);

    const renBtn = document.createElement('button');
    renBtn.className = 'icon-btn';
    renBtn.textContent = '✎';
    renBtn.title = 'Renomear';
    renBtn.onclick = () => {
      const nm = prompt('Novo nome da prova:', p.name);
      if (nm && nm.trim()) {
        renameProfile(p.id, nm.trim());
        if (p.active) { state.exam = getActiveExam(); updateBadge(); }
        renderCorretores();
      }
    };
    row.appendChild(renBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Excluir';
    delBtn.onclick = () => {
      if (confirm(`Excluir a prova "${p.name}"?`)) {
        state.exam = deleteProfile(p.id);
        updateBadge();
        renderCorretores();
      }
    };
    row.appendChild(delBtn);
    root.appendChild(row);
  });

  // Atalho: montar prova com perguntas.
  const montarBtn = document.createElement('button');
  montarBtn.className = 'btn ghost';
  montarBtn.style.width = '100%';
  montarBtn.style.margin = '4px 0 14px';
  montarBtn.textContent = '📝 Montar prova (cadastrar perguntas)';
  montarBtn.onclick = () => {
    if (!state.exam) state.exam = createProfile({ name: 'Nova prova', numQuestions: 5, optionsKey: 'A-E' });
    updateBadge();
    showView('montar-prova');
  };
  root.appendChild(montarBtn);

  // Formulário: nova prova rápida.
  const form = document.createElement('div');
  form.className = 'field-block';
  const optSel = Object.entries(OPTION_SETS)
    .map(([k, v]) => `<option value="${k}"${k === 'A-E' ? ' selected' : ''}>${v.label}</option>`).join('');
  form.innerHTML = `<h3>➕ Nova prova rápida</h3>
    <div class="form-field"><label for="newName">Nome da prova</label>
      <input id="newName" type="text" placeholder="Ex.: NR-10 Básico"></div>
    <div class="num-field"><label for="newNum">Número de questões</label>
      <input id="newNum" type="number" min="1" max="60" value="20"></div>
    <div class="form-field"><label for="newOpts">Alternativas</label>
      <select id="newOpts">${optSel}</select></div>`;
  const createBtn = document.createElement('button');
  createBtn.className = 'btn primary';
  createBtn.style.width = '100%';
  createBtn.textContent = 'Criar e abrir Gabarito';
  createBtn.onclick = () => {
    const name = $('#newName').value.trim();
    if (!name) { $('#newName').classList.add('missing'); $('#newName').focus(); toast('Dê um nome à prova.'); return; }
    const num = parseInt($('#newNum').value, 10) || 20;
    const opts = $('#newOpts').value;
    state.exam = createProfile({ name, numQuestions: num, optionsKey: opts });
    updateBadge();
    toast(`Prova "${name}" criada`);
    showView('gabarito');
  };
  form.appendChild(createBtn);
  root.appendChild(form);
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
        <div class="nm">${r.name || '(sem nome)'}${r.empresa ? ' · ' + r.empresa : ''}</div>
        <div class="dt">${r.corretor ? r.corretor + ' · ' : ''}${r.date} · ${r.totalCorrect}/${r.totalItems} · ${r.passed ? 'Aprovado' : 'Reprovado'}</div>
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

// ---------- Montar prova (autoria de perguntas) ----------
function renderMontar() {
  const root = $('#montarContent');
  root.innerHTML = '';
  if (!state.exam) {
    state.exam = createProfile({ name: 'Nova prova', numQuestions: 3, optionsKey: 'A-E' });
    updateBadge();
  }
  const exam = state.exam;

  const head = document.createElement('div');
  head.className = 'field-block';
  const optSel = Object.entries(OPTION_SETS)
    .map(([k, v]) => `<option value="${k}"${exam.optionsKey === k ? ' selected' : ''}>${v.label}</option>`).join('');
  head.innerHTML = `<h3>Dados da prova</h3>
    <div class="form-field"><label for="mTitle">Título</label>
      <input id="mTitle" type="text" value="${esc(exam.title || exam.name || '')}"></div>
    <div class="form-field"><label for="mSub">Subtítulo (opcional)</label>
      <input id="mSub" type="text" value="${esc(exam.subtitle || '')}"></div>
    <div class="form-field"><label for="mOpts">Alternativas (todas as questões)</label>
      <select id="mOpts">${optSel}</select></div>`;
  root.appendChild(head);

  const applyMeta = () => {
    const t = $('#mTitle').value.trim();
    exam.title = t; exam.name = t || exam.name;
    exam.subtitle = $('#mSub').value.trim();
  };
  $('#mOpts').addEventListener('change', () => {
    applyMeta();
    exam.optionsKey = $('#mOpts').value;
    exam.questions = makeQuestions(exam.questions.length, exam.optionsKey, exam.questions);
    renderMontar();
  });

  // Lista de questões.
  const list = document.createElement('div');
  exam.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'field-block q-edit';
    const altRows = q.options.map((o) => `
      <div class="alt-edit">
        <button type="button" class="opt-pill mark${q.answer === o ? ' sel key' : ''}" data-opt="${o}" title="Marcar correta">${o}</button>
        <input type="text" class="alt-text" data-opt="${o}" placeholder="Texto da alternativa ${o}" value="${esc(q.optionTexts && q.optionTexts[o] || '')}">
      </div>`).join('');
    card.innerHTML = `
      <div class="q-edit-head"><strong>Questão ${idx + 1}</strong>
        <button type="button" class="icon-btn q-del" title="Remover">✕</button></div>
      <textarea class="q-stmt" rows="2" placeholder="Enunciado da questão ${idx + 1}">${esc(q.statement || '')}</textarea>
      <div class="alts-edit">${altRows}</div>
      <div class="alt-hint">Toque na letra para marcar a alternativa <b>correta</b> (atual: ${esc(q.answer)}).</div>`;
    // enunciado
    card.querySelector('.q-stmt').addEventListener('input', (e) => { q.statement = e.target.value; });
    // textos das alternativas
    $$('.alt-text', card).forEach((inp) => {
      inp.addEventListener('input', () => { q.optionTexts = q.optionTexts || {}; q.optionTexts[inp.dataset.opt] = inp.value; });
    });
    // marcar correta
    $$('.mark', card).forEach((b) => {
      b.onclick = () => {
        q.answer = b.dataset.opt;
        $$('.mark', card).forEach((x) => x.classList.toggle('sel', x.dataset.opt === q.answer));
        $$('.mark', card).forEach((x) => x.classList.toggle('key', x.dataset.opt === q.answer));
        card.querySelector('.alt-hint').innerHTML = `Toque na letra para marcar a alternativa <b>correta</b> (atual: ${esc(q.answer)}).`;
      };
    });
    card.querySelector('.q-del').onclick = () => {
      if (exam.questions.length <= 1) { toast('A prova precisa de ao menos 1 questão.'); return; }
      applyMeta();
      exam.questions.splice(idx, 1);
      exam.questions.forEach((qq, i) => (qq.id = String(i + 1)));
      renderMontar();
    };
    list.appendChild(card);
  });
  root.appendChild(list);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn ghost';
  addBtn.style.width = '100%';
  addBtn.textContent = '➕ Adicionar questão';
  addBtn.onclick = () => {
    applyMeta();
    const set = OPTION_SETS[exam.optionsKey] || OPTION_SETS['A-E'];
    const optionTexts = {}; set.options.forEach((o) => (optionTexts[o] = ''));
    exam.questions.push({ id: String(exam.questions.length + 1), type: set.type, statement: '', options: [...set.options], optionTexts, answer: set.options[0] });
    renderMontar();
  };
  root.appendChild(addBtn);

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `
    <button class="btn primary" id="mSave">💾 Salvar prova</button>
    <button class="btn ghost" id="mPrintExam">🖨️ Imprimir prova</button>
    <button class="btn ghost" id="mPrintCard">🖨️ Imprimir cartão</button>`;
  root.appendChild(actions);
  $('#mSave').onclick = () => { applyMeta(); saveActiveExam(exam); updateBadge(); toast('Prova salva ✓'); };
  $('#mPrintExam').onclick = () => { applyMeta(); printExam(exam); };
  $('#mPrintCard').onclick = () => { applyMeta(); printCard(exam); };
}

// ---------- Login (stub local na Fase 1) ----------
function renderLogin() {
  const root = $('#loginContent');
  root.innerHTML = `
    <div class="auth-box">
      <h2>Entrar</h2>
      <div class="form-field"><label for="auEmail">E-mail</label><input id="auEmail" type="email" inputmode="email" placeholder="voce@email.com"></div>
      <div class="form-field"><label for="auPw">Senha</label><input id="auPw" type="password" placeholder="mínimo 6 caracteres"></div>
      <div class="actions">
        <button class="btn primary" id="auLogin">Entrar</button>
        <button class="btn ghost" id="auSignup">Criar conta</button>
      </div>
      <button class="btn ghost" id="auLocal" style="width:100%;margin-top:8px">Usar sem conta (modo local)</button>
      <p class="install-hint" style="margin-top:14px">Demonstração: o login e o pagamento reais entram na próxima fase (servidor). No modo local o app funciona normalmente neste aparelho.</p>
    </div>`;
  const email = () => $('#auEmail').value, pw = () => $('#auPw').value;
  $('#auLogin').onclick = () => {
    const r = auth.login(email(), pw());
    if (!r.ok) { toast(r.error); return; }
    afterAuth();
  };
  $('#auSignup').onclick = () => {
    const r = auth.signup(email(), pw());
    if (!r.ok) { toast(r.error); return; }
    toast('Conta criada ✓'); afterAuth();
  };
  $('#auLocal').onclick = () => { auth.useLocalMode(); afterAuth(); };
}

function afterAuth() {
  updateAccountBtn();
  state.exam = getActiveExam();
  updateBadge();
  showView('home');
}

// ---------- Minha conta / assinatura (stub) ----------
function renderAssinatura() {
  const root = $('#assinaturaContent');
  const u = auth.currentUser();
  const lic = auth.licenseStatus();
  root.innerHTML = '';

  const box = document.createElement('div');
  box.className = 'field-block';
  const ident = u ? (u.mode === 'local' ? 'Modo local (sem conta)' : esc(u.email)) : '—';
  let licHtml;
  if (lic.mode === 'local') licHtml = '<span class="tag-active">Liberado (modo local)</span>';
  else if (lic.active) licHtml = `<span class="tag-active">Ativa</span> · chave <code>${esc(lic.key || '')}</code> · até ${new Date(lic.until).toLocaleDateString('pt-BR')}`;
  else licHtml = '<span style="color:var(--red);font-weight:700">Inativa</span>';
  box.innerHTML = `<h3>Minha conta</h3>
    <p><b>Usuário:</b> ${ident}</p>
    <p><b>Licença:</b> ${licHtml}</p>`;
  root.appendChild(box);

  if (u && u.mode === 'account' && !lic.active) {
    const pay = document.createElement('div');
    pay.className = 'field-block';
    pay.innerHTML = `<h3>Assinar (PIX)</h3>
      <p class="install-hint">Demonstração — pagamento real entra na próxima fase (servidor + AbacatePay).</p>
      <div id="pixArea"></div>`;
    root.appendChild(pay);
    const area = $('#pixArea', pay);
    const startBtn = document.createElement('button');
    startBtn.className = 'btn primary'; startBtn.style.width = '100%';
    startBtn.textContent = 'Gerar PIX';
    startBtn.onclick = () => {
      const p = auth.startPayment();
      area.innerHTML = `<p>Valor: <b>R$ ${p.amount.toFixed(2)}</b></p>
        <p>PIX copia-e-cola (demo):</p>
        <textarea readonly rows="2" style="width:100%">${esc(p.pixCode)}</textarea>`;
      const chk = document.createElement('button');
      chk.className = 'btn primary'; chk.style.width = '100%'; chk.style.marginTop = '8px';
      chk.textContent = '✅ Checar pagamento';
      chk.onclick = () => {
        const r = auth.checkPayment();
        if (r.active) { toast('Pagamento confirmado! Chave gerada.'); renderAssinatura(); }
        else toast('Pagamento ainda não identificado.');
      };
      area.appendChild(chk);
    };
    area.appendChild(startBtn);
  }

  const out = document.createElement('div');
  out.className = 'actions';
  out.innerHTML = `<button class="btn ghost" id="logoutBtn">🚪 Sair</button>`;
  root.appendChild(out);
  $('#logoutBtn').onclick = () => { auth.logout(); updateAccountBtn(); showView('login'); };
}

// ---------- Eventos globais ----------
function wireUp() {
  $$('[data-go]').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.go)));
  $('#backBtn').addEventListener('click', () => showView('home'));
  $('#accountBtn').addEventListener('click', () => showView('assinatura'));
  $('#badgeBtn').addEventListener('click', () => showView('corretores'));
  $('#printCardBtn').addEventListener('click', () => { if (requireExam()) printCard(state.exam); });
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

// Boot: mostra o login na 1ª vez; depois vai direto p/ a home.
function boot() {
  updateBadge();
  if (auth.currentUser()) { updateAccountBtn(); showView('home'); }
  else showView('login');
}

wireUp();
boot();

// API de automação/integração: corrige uma imagem (canvas/<img>) por código e
// permite gerenciar provas. Útil para testes e integrações futuras.
window.CorretorNR33 = {
  ensureOpenCV: ensureCV,
  loadExam: () => state.exam,
  gradeCanvas: (canvas) => processCanvas(canvas),
  setTrace: (t) => { state.trace = { ...state.trace, ...t }; },
  save: () => onSaveResult(),
  listProfiles,
  createProfile: (opts) => { state.exam = createProfile(opts); updateBadge(); return state.exam; },
  switchProfile: (id) => { state.exam = setActiveProfile(id); updateBadge(); return state.exam; },
  activeId: getActiveId,
  auth,
};
