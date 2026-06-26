// omr.js — Motor de visão computacional (OpenCV.js).
//
// Responsável por: localizar a moldura do cartão na imagem, corrigir a
// perspectiva (warp), ler o preenchimento de cada bolha e comparar com o
// gabarito. Usa as MESMAS coordenadas normalizadas de layout.js.

import { buildLayout, FRAME_ASPECT, BUBBLE_R, SAMPLE_R_FRAC, ORIENT_MARK, FIDUCIAL } from './layout.js';

// Tamanho da imagem "desentortada" (canônica). Mantém a proporção da moldura.
export const CANON_W = 760;
export const CANON_H = Math.round(CANON_W / FRAME_ASPECT); // ~1101

function cv() {
  return window.cv;
}

// Ordena 4 pontos como [topo-esq, topo-dir, baixo-dir, baixo-esq].
function orderCorners(pts) {
  const sum = pts.map((p) => p.x + p.y);
  const diff = pts.map((p) => p.x - p.y);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.max(...diff))];
  const bl = pts[diff.indexOf(Math.min(...diff))];
  return [tl, tr, br, bl];
}

function quadArea(c) {
  // Área de polígono (shoelace).
  let a = 0;
  for (let i = 0; i < c.length; i++) {
    const j = (i + 1) % c.length;
    a += c[i].x * c[j].y - c[j].x * c[i].y;
  }
  return Math.abs(a) / 2;
}

// Verifica se um quadrilátero é "retangular o suficiente" (ângulos próximos de 90°).
function isRectish(corners) {
  const [tl, tr, br, bl] = corners;
  const side = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const top = side(tl, tr), bottom = side(bl, br);
  const left = side(tl, bl), right = side(tr, br);
  if (top < 1 || left < 1) return false;
  const ratioH = Math.min(top, bottom) / Math.max(top, bottom);
  const ratioV = Math.min(left, right) / Math.max(left, right);
  return ratioH > 0.6 && ratioV > 0.6;
}

// Coleta blobs escuros sólidos (candidatos a marcador fiducial) de uma máscara.
function collectSolidBlobs(C, bin, imgArea) {
  const blobs = [];
  const contours = new C.MatVector();
  const hierarchy = new C.Mat();
  // RETR_LIST: encontra marcadores mesmo "aninhados" (fundo escuro na foto).
  C.findContours(bin, contours, hierarchy, C.RETR_LIST, C.CHAIN_APPROX_SIMPLE);
  const minA = Math.max(36, imgArea * 0.00002);
  const maxA = imgArea * 0.04;
  for (let i = 0; i < contours.size(); i++) {
    const cnt = contours.get(i);
    const area = C.contourArea(cnt);
    if (area >= minA && area <= maxA) {
      const r = C.boundingRect(cnt);
      const ar = r.width / r.height;
      const solidity = area / (r.width * r.height);
      if (ar > 0.55 && ar < 1.8 && solidity > 0.68) {
        const M = C.moments(cnt, false);
        if (M.m00 > 0) blobs.push({ x: M.m10 / M.m00, y: M.m01 / M.m00, area });
      }
    }
    cnt.delete();
  }
  contours.delete();
  hierarchy.delete();
  return blobs;
}

// Escolhe, entre os candidatos, os 4 mais "extremos" (um por canto).
function pickCornerBlobs(blobs) {
  if (blobs.length < 4) return null;
  const tl = blobs.reduce((a, b) => (b.x + b.y < a.x + a.y ? b : a));
  const br = blobs.reduce((a, b) => (b.x + b.y > a.x + a.y ? b : a));
  const tr = blobs.reduce((a, b) => (b.x - b.y > a.x - a.y ? b : a));
  const bl = blobs.reduce((a, b) => (b.x - b.y < a.x - a.y ? b : a));
  const corners = [tl, tr, br, bl];
  // Precisam ser 4 distintos e formar uma área razoável.
  const uniq = new Set(corners.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`));
  if (uniq.size < 4) return null;
  if (quadArea(corners) < 1000) return null;
  if (!isRectish(corners)) return null;
  return corners;
}

// Localiza os 4 marcadores fiduciais e devolve seus centróides ordenados
// [topo-esq, topo-dir, baixo-dir, baixo-esq] (coords da imagem) ou null.
// 'src' é um cv.Mat RGBA. Robusto a sombras/fundo: procura quadrados sólidos.
export function findDocumentQuad(src) {
  const C = cv();
  const imgArea = src.cols * src.rows;
  const gray = new C.Mat();
  C.cvtColor(src, gray, C.COLOR_RGBA2GRAY);
  C.GaussianBlur(gray, gray, new C.Size(3, 3), 0);

  let corners = null;

  // 1) Limiar de Otsu (alto contraste: marcadores pretos em papel branco).
  const otsu = new C.Mat();
  C.threshold(gray, otsu, 0, 255, C.THRESH_BINARY_INV + C.THRESH_OTSU);
  corners = pickCornerBlobs(collectSolidBlobs(C, otsu, imgArea));
  otsu.delete();

  // 2) Fallback: limiar adaptativo (iluminação irregular).
  if (!corners) {
    const adapt = new C.Mat();
    C.adaptiveThreshold(gray, adapt, 255, C.ADAPTIVE_THRESH_MEAN_C, C.THRESH_BINARY_INV, 41, 10);
    const k = C.getStructuringElement(C.MORPH_RECT, new C.Size(3, 3));
    C.morphologyEx(adapt, adapt, C.MORPH_OPEN, k);
    corners = pickCornerBlobs(collectSolidBlobs(C, adapt, imgArea));
    k.delete();
    adapt.delete();
  }

  gray.delete();
  return corners;
}

// Desentorta a moldura para a imagem canônica. Retorna um cv.Mat (escala de cinza).
// Corrige automaticamente cartões fotografados de cabeça para baixo.
export function warpToCanonical(src, corners) {
  const C = cv();
  const [tl, tr, br, bl] = corners;
  // Os marcadores estão nos centróides FIDUCIAL (não nas bordas da folha).
  const F = FIDUCIAL;
  const dx0 = F.x0 * CANON_W, dx1 = F.x1 * CANON_W;
  const dy0 = F.y0 * CANON_H, dy1 = F.y1 * CANON_H;
  const srcTri = C.matFromArray(4, 1, C.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstTri = C.matFromArray(4, 1, C.CV_32FC2, [dx0, dy0, dx1, dy0, dx1, dy1, dx0, dy1]);
  const M = C.getPerspectiveTransform(srcTri, dstTri);

  const warpedRGBA = new C.Mat();
  C.warpPerspective(src, warpedRGBA, M, new C.Size(CANON_W, CANON_H), C.INTER_LINEAR, C.BORDER_CONSTANT, new C.Scalar(255, 255, 255, 255));

  const gray = new C.Mat();
  C.cvtColor(warpedRGBA, gray, C.COLOR_RGBA2GRAY);

  // Correção de orientação 180° via marcador no canto superior esquerdo.
  const m = ORIENT_MARK;
  const tlMean = meanRect(gray, m.x, m.y, m.size);
  const brMean = meanRect(gray, 1 - m.x, 1 - m.y, m.size);
  if (brMean < tlMean - 25) {
    // Marcador detectado embaixo: cartão está de cabeça para baixo.
    C.rotate(gray, gray, C.ROTATE_180);
    C.rotate(warpedRGBA, warpedRGBA, C.ROTATE_180);
  }

  srcTri.delete();
  dstTri.delete();
  M.delete();
  return { gray, rgba: warpedRGBA };
}

// Média de intensidade num pequeno retângulo centrado em coords normalizadas.
function meanRect(gray, nx, ny, nsize) {
  const C = cv();
  const cx = Math.round(nx * CANON_W);
  const cy = Math.round(ny * CANON_H);
  const half = Math.round((nsize * CANON_W) / 2);
  const x0 = Math.max(0, cx - half);
  const y0 = Math.max(0, cy - half);
  const w = Math.min(CANON_W - x0, half * 2);
  const h = Math.min(CANON_H - y0, half * 2);
  const roi = gray.roi(new C.Rect(x0, y0, Math.max(1, w), Math.max(1, h)));
  const m = C.mean(roi)[0];
  roi.delete();
  return m;
}

// Fração de pixels escuros dentro de um disco (medida de preenchimento).
function diskFill(gray, ncx, ncy, rpx, darkThresh) {
  const cx = ncx * CANON_W;
  const cy = ncy * CANON_H;
  const r2 = rpx * rpx;
  const x0 = Math.max(0, Math.floor(cx - rpx));
  const x1 = Math.min(CANON_W - 1, Math.ceil(cx + rpx));
  const y0 = Math.max(0, Math.floor(cy - rpx));
  const y1 = Math.min(CANON_H - 1, Math.ceil(cy + rpx));
  const data = gray.data;
  let total = 0, dark = 0, sum = 0;
  for (let y = y0; y <= y1; y++) {
    const row = y * CANON_W;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const v = data[row + x];
        total++;
        sum += v;
        if (v < darkThresh) dark++;
      }
    }
  }
  if (total === 0) return { darkFrac: 0, mean: 255 };
  return { darkFrac: dark / total, mean: sum / total };
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[idx];
}

// Lê todas as bolhas e devolve, por questão, a opção marcada e métricas.
// fill é normalizado contra o nível do papel (robusto a iluminação/sombra).
export function readBubbles(gray, exam) {
  const layout = buildLayout(exam);
  const rpx = SAMPLE_R_FRAC * layout.bubbleR * CANON_W;

  // 1ª passada: nível de cinza médio de cada bolha.
  const allMeans = [];
  for (const row of layout.rows) {
    for (const b of row.bubbles) {
      const { mean } = diskFill(gray, b.x, b.y, rpx, 128);
      b._mean = mean;
      allMeans.push(mean);
    }
  }

  // Calibração por cartão: papel (claro) vs tinta (escuro).
  const paper = percentile(allMeans, 80); // a maioria das bolhas está vazia (claras)
  const ink = percentile(allMeans, 5);
  const dynamic = Math.max(35, paper - ink); // amplitude útil
  const darkThresh = paper - dynamic * 0.45;

  const results = [];
  for (const row of layout.rows) {
    const scored = row.bubbles.map((b) => {
      const { darkFrac } = diskFill(gray, b.x, b.y, rpx, darkThresh);
      // fill 0..1: quão mais escura que o papel está a bolha.
      const fill = Math.max(0, (paper - b._mean) / dynamic);
      return { option: b.option, fill, darkFrac, isAnswer: b.isAnswer, x: b.x, y: b.y };
    });

    const sorted = [...scored].sort((a, b) => b.fill - a.fill);
    const best = sorted[0];
    const second = sorted[1] || { fill: 0 };
    const FILL_MIN = 0.42;     // mínimo para considerar marcado
    const MARGIN = 0.18;       // distância para o 2º colocado

    let marked = null;
    let status = 'blank';
    const filledCount = scored.filter((s) => s.fill >= FILL_MIN).length;
    if (filledCount >= 2 && (second.fill >= FILL_MIN) && (best.fill - second.fill) < MARGIN) {
      status = 'multiple';
    } else if (best.fill >= FILL_MIN) {
      marked = best.option;
      status = 'ok';
    } else {
      status = 'blank';
    }

    results.push({
      qid: row.qid,
      type: row.type,
      group: row.group,
      answer: row.answer,
      marked,
      status, // 'ok' | 'blank' | 'multiple'
      correct: status === 'ok' && marked === row.answer,
      bubbles: scored,
      confidence: Math.round(Math.min(1, best.fill) * 100) - Math.round(Math.min(1, second.fill) * 50),
    });
  }
  return results;
}

// Pipeline completo a partir de um canvas/imagem de origem.
// Retorna { ok, quad, warpedCanvas, results } ou { ok:false, reason }.
export function gradeFromSource(srcCanvas, exam) {
  const C = cv();
  const src = C.imread(srcCanvas);
  try {
    const corners = findDocumentQuad(src);
    if (!corners) {
      return { ok: false, reason: 'no-card' };
    }
    const { gray, rgba } = warpToCanonical(src, corners);
    const results = readBubbles(gray, exam);

    // Gera um canvas com a imagem desentortada para exibir/anotar.
    const warpedCanvas = document.createElement('canvas');
    warpedCanvas.width = CANON_W;
    warpedCanvas.height = CANON_H;
    C.imshow(warpedCanvas, rgba);

    gray.delete();
    rgba.delete();
    return { ok: true, quad: corners, warpedCanvas, results };
  } finally {
    src.delete();
  }
}

// Resumo da nota a partir da leitura automática + preenchimentos OPCIONAIS.
// overrides: { [qid]: option|null } ajuste manual da leitura (opcional)
// manualWritten: { [writtenId]: bool } marcação das dissertativas (opcional)
// A nota objetiva vem da imagem; as dissertativas só entram se o instrutor marcar.
export function summarize(exam, results, manualWritten = {}, overrides = {}) {
  let objCorrect = 0;
  const objTotal = results.length;
  const perQuestion = results.map((r) => {
    const ov = overrides[r.qid];
    const marked = ov !== undefined ? ov : r.marked;
    const correct = marked != null && marked === r.answer;
    if (correct) objCorrect++;
    return { ...r, marked, correct, overridden: ov !== undefined };
  });

  const writtenList = (exam.written || []).map((w) => ({
    id: w.id,
    label: w.label,
    correct: !!manualWritten[w.id],
  }));
  const writtenCorrect = writtenList.filter((w) => w.correct).length;
  const writtenTotal = writtenList.length;

  const totalCorrect = objCorrect + writtenCorrect;
  const totalItems = objTotal + writtenTotal;
  const percent = totalItems ? Math.round((totalCorrect / totalItems) * 100) : 0;
  const passed = percent >= (exam.passPercent || 70);

  return {
    perQuestion, writtenList,
    objCorrect, objTotal, writtenCorrect, writtenTotal,
    totalCorrect, totalItems, percent, passed,
  };
}
