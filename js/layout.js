// layout.js — Geometria do cartão-resposta.
//
// Define a posição de cada bolha em COORDENADAS NORMALIZADAS (0..1) relativas ao
// retângulo EXTERNO da moldura preta do cartão. Tanto o gerador do cartão
// impresso (card.js) quanto o leitor por câmera (omr.js) usam ESTA mesma função,
// garantindo que o ponto amostrado pela câmera caia exatamente sobre a bolha
// impressa. Esta é a peça central que torna a correção confiável.
//
// Sistema de coordenadas: (0,0) = canto superior esquerdo externo da moldura,
// (1,1) = canto inferior direito externo da moldura.

// Proporção da área de referência (largura/altura). O leitor "desentorta" (warp)
// para um retângulo canônico com esta mesma proporção.
export const FRAME_ASPECT = 194 / 281; // ~0.690  (A4 com margem de 8mm)

// Raio da bolha, normalizado pela LARGURA da área de referência.
export const BUBBLE_R = 0.021;

// Fração do raio impresso efetivamente amostrada (evita tocar no anel do círculo).
export const SAMPLE_R_FRAC = 0.62;

// Marcadores fiduciais (quadrados pretos sólidos) nos 4 cantos. O leitor detecta
// seus CENTRÓIDES e calcula a homografia a partir deles — método robusto a
// sombras e fundo. (x0,y0)=centro do marcador superior-esquerdo, etc.
export const FIDUCIAL = { x0: 0.060, y0: 0.050, x1: 0.940, y1: 0.955, size: 0.050 };

// Marcador de orientação: quadrado sólido assimétrico próximo ao canto superior
// esquerdo (à direita do fiducial TL). Permite corrigir cartões de cabeça p/ baixo.
export const ORIENT_MARK = { x: 0.150, y: 0.050, size: 0.028 };

// Faixa do cabeçalho (nome/empresa/data) — não é amostrada.
export const HEADER = { x0: 0.045, y0: 0.020, x1: 0.955, y1: 0.150 };

// Parâmetros internos das colunas.
const COLUMN = {
  left: {
    labelX: 0.075,
    firstBubbleX: 0.150,
    bubbleStepX: 0.066,
    y0: 0.225,
    y1: 0.945,
  },
  right: {
    labelX: 0.560,
    firstBubbleX: 0.760,
    bubbleStepX: 0.085,
    y0: 0.225,
    y1: 0.945,
  },
};

// Constrói o layout completo a partir do gabarito.
// Retorna { rows, columns, bubbleR } onde cada row descreve uma questão.
export function buildLayout(exam) {
  const rows = [];

  for (const colKey of ['left', 'right']) {
    const col = COLUMN[colKey];
    const qs = exam.questions.filter((q) => q.column === colKey);
    const n = qs.length;
    const span = col.y1 - col.y0;
    // Espaçamento entre linhas (centraliza a primeira/última nas bordas da faixa).
    const step = n > 1 ? span / (n - 1) : 0;

    qs.forEach((q, i) => {
      const y = n > 1 ? col.y0 + i * step : (col.y0 + col.y1) / 2;
      const bubbles = q.options.map((opt, j) => ({
        qid: q.id,
        option: opt,
        x: col.firstBubbleX + j * col.bubbleStepX,
        y,
        isAnswer: opt === q.answer,
      }));
      rows.push({
        qid: q.id,
        type: q.type,
        group: q.group || null,
        column: colKey,
        labelX: col.labelX,
        y,
        bubbles,
        answer: q.answer,
      });
    });
  }

  return { rows, columns: COLUMN, bubbleR: BUBBLE_R };
}

// Lista plana de todas as bolhas com suas coordenadas normalizadas.
export function allBubbles(exam) {
  return buildLayout(exam).rows.flatMap((r) => r.bubbles);
}
