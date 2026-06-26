// layout.js — Geometria do cartão-resposta.
//
// Define a posição de cada bolha em COORDENADAS NORMALIZADAS (0..1). Tanto o
// gerador do cartão (card.js) quanto o leitor por câmera (omr.js) usam ESTA mesma
// função — é o que garante que o ponto amostrado caia sobre a bolha impressa.
//
// Há dois modos:
//  - LEGADO: quando as questões têm `column` ('left'/'right') — usado pelo NR-33
//    (layout fixo, já verificado).
//  - AUTOMÁTICO: provas novas (sem `column`) — distribui N questões em colunas que
//    cabem na folha, com raio de bolha dinâmico para nunca sobrepor.
//
// Sistema de coordenadas: (0,0) = canto sup. esquerdo da área de referência,
// (1,1) = canto inf. direito.

// Proporção da área de referência (largura/altura).
export const FRAME_ASPECT = 194 / 281; // ~0.690  (A4 com margem de 8mm)

// Raio máximo da bolha, normalizado pela LARGURA.
export const BUBBLE_R = 0.021;

// Fração do raio impresso efetivamente amostrada (evita tocar no anel do círculo).
export const SAMPLE_R_FRAC = 0.62;

// Marcadores fiduciais (4 cantos) e de orientação — fixos para TODAS as provas.
export const FIDUCIAL = { x0: 0.060, y0: 0.050, x1: 0.940, y1: 0.955, size: 0.050 };
export const ORIENT_MARK = { x: 0.150, y: 0.050, size: 0.028 };

// Faixa do cabeçalho (nome/empresa/data) — não é amostrada.
export const HEADER = { x0: 0.045, y0: 0.020, x1: 0.955, y1: 0.150 };

// ---------- Modo LEGADO (NR-33) ----------
const COLUMN = {
  left:  { labelX: 0.075, firstBubbleX: 0.150, bubbleStepX: 0.066, y0: 0.225, y1: 0.945 },
  right: { labelX: 0.560, firstBubbleX: 0.760, bubbleStepX: 0.085, y0: 0.225, y1: 0.945 },
};

function legacyLayout(exam) {
  const rows = [];
  for (const colKey of ['left', 'right']) {
    const col = COLUMN[colKey];
    const qs = exam.questions.filter((q) => q.column === colKey);
    const n = qs.length;
    const span = col.y1 - col.y0;
    const step = n > 1 ? span / (n - 1) : 0;
    qs.forEach((q, i) => {
      const y = n > 1 ? col.y0 + i * step : (col.y0 + col.y1) / 2;
      const bubbles = q.options.map((opt, j) => ({
        qid: q.id, option: opt,
        x: col.firstBubbleX + j * col.bubbleStepX, y,
        isAnswer: opt === q.answer,
      }));
      rows.push({ qid: q.id, type: q.type, group: q.group || null, column: colKey, labelX: col.labelX, y, bubbles, answer: q.answer });
    });
  }
  return { rows, columns: COLUMN, bubbleR: BUBBLE_R, mode: 'legacy', colCount: 2 };
}

// ---------- Modo AUTOMÁTICO (provas novas) ----------
function autoLayout(exam) {
  const qs = exam.questions;
  const N = qs.length || 1;
  const maxOpt = Math.max(1, ...qs.map((q) => q.options.length));

  // Nº de colunas: limitado pela largura (mais opções → menos colunas).
  const maxColsByWidth = maxOpt >= 4 ? 2 : 3;
  const C = Math.max(1, Math.min(maxColsByWidth, Math.ceil(N / 13)));
  const rowsPerCol = Math.ceil(N / C);

  // Geometria horizontal.
  const xStart = 0.05, xEnd = 0.95, gap = 0.03;
  const colW = (xEnd - xStart - gap * (C - 1)) / C;
  const labelInset = colW * 0.16;
  const bubbleAreaW = colW - labelInset - colW * 0.06;
  const stepX = bubbleAreaW / maxOpt;
  const firstOffset = labelInset + stepX * 0.5;

  // Geometria vertical.
  const y0 = 0.225, y1 = 0.95;
  const stepY = rowsPerCol > 1 ? (y1 - y0) / (rowsPerCol - 1) : 0;

  // Raio dinâmico (folga horizontal e vertical). stepY é em altura; converte para
  // unidades de largura via aspecto para comparar com o raio (norm. pela largura).
  const aspectHW = 1 / FRAME_ASPECT; // altura/largura
  const rByX = 0.42 * stepX;
  const rByY = stepY ? 0.42 * stepY * aspectHW : BUBBLE_R;
  const bubbleR = Math.max(0.010, Math.min(BUBBLE_R, rByX, rByY));

  const colMeta = [];
  for (let k = 0; k < C; k++) {
    const colLeft = xStart + k * (colW + gap);
    colMeta.push({ left: colLeft, width: colW, labelX: colLeft + colW * 0.02, firstBubbleX: colLeft + firstOffset, stepX });
  }

  const rows = [];
  qs.forEach((q, i) => {
    const col = Math.min(C - 1, Math.floor(i / rowsPerCol));
    const rowInCol = i % rowsPerCol;
    const m = colMeta[col];
    const y = rowsPerCol > 1 ? y0 + rowInCol * stepY : (y0 + y1) / 2;
    const bubbles = q.options.map((opt, j) => ({
      qid: q.id, option: opt,
      x: m.firstBubbleX + j * m.stepX, y,
      isAnswer: opt === q.answer,
    }));
    rows.push({ qid: q.id, type: q.type, group: q.group || null, column: 'auto', colIndex: col, labelX: m.labelX, y, bubbles, answer: q.answer });
  });

  return { rows, columns: colMeta, bubbleR, mode: 'auto', colCount: C };
}

// Constrói o layout a partir do gabarito (escolhe o modo automaticamente).
export function buildLayout(exam) {
  const legacy = exam.questions.some((q) => q.column === 'left' || q.column === 'right');
  return legacy ? legacyLayout(exam) : autoLayout(exam);
}

// Lista plana de todas as bolhas com suas coordenadas normalizadas.
export function allBubbles(exam) {
  return buildLayout(exam).rows.flatMap((r) => r.bubbles);
}
