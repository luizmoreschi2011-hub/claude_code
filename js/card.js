// card.js — Gera o cartão-resposta imprimível (SVG, tamanho A4).
//
// Usa buildLayout() para posicionar as bolhas EXATAMENTE nas mesmas coordenadas
// normalizadas que o leitor por câmera irá amostrar.

import { buildLayout, BUBBLE_R, FIDUCIAL, ORIENT_MARK, HEADER } from './layout.js';

// A4 retrato, em milímetros.
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 8;
const FRAME = { x: MARGIN, y: MARGIN, w: PAGE_W - 2 * MARGIN, h: PAGE_H - 2 * MARGIN };

// Normalizado (relativo à moldura) -> mm (página).
function nx(x) { return FRAME.x + x * FRAME.w; }
function ny(y) { return FRAME.y + y * FRAME.h; }

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildCardSVG(exam) {
  const layout = buildLayout(exam);
  const rBubble = BUBBLE_R * FRAME.w; // mm

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}" font-family="Arial, Helvetica, sans-serif">`);
  parts.push(`<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#ffffff"/>`);

  // Borda fina (apenas visual; o leitor NÃO depende dela).
  parts.push(`<rect x="${FRAME.x}" y="${FRAME.y}" width="${FRAME.w}" height="${FRAME.h}" fill="none" stroke="#000000" stroke-width="0.4"/>`);

  // Marcadores fiduciais: 4 quadrados pretos sólidos nos cantos.
  const F = FIDUCIAL;
  const fS = F.size * FRAME.w; // lado em mm
  const fids = [[F.x0, F.y0], [F.x1, F.y0], [F.x1, F.y1], [F.x0, F.y1]];
  for (const [fx, fy] of fids) {
    parts.push(`<rect x="${nx(fx) - fS / 2}" y="${ny(fy) - fS / 2}" width="${fS}" height="${fS}" fill="#000000"/>`);
  }

  // Marcador de orientação (assimétrico, ao lado do fiducial superior-esquerdo).
  const om = ORIENT_MARK;
  const omS = om.size * FRAME.w;
  parts.push(`<rect x="${nx(om.x) - omS / 2}" y="${ny(om.y) - omS / 2}" width="${omS}" height="${omS}" fill="#000000"/>`);

  // Cabeçalho.
  const hX = nx(HEADER.x0);
  parts.push(`<text x="${nx(0.5)}" y="${ny(0.035)}" text-anchor="middle" font-size="4.6" font-weight="bold">${esc(exam.title)}</text>`);
  parts.push(`<text x="${nx(0.5)}" y="${ny(0.058)}" text-anchor="middle" font-size="3.0">${esc(exam.subtitle || '')}</text>`);
  parts.push(`<text x="${nx(0.5)}" y="${ny(0.080)}" text-anchor="middle" font-size="2.6" fill="#444">CARTÃO-RESPOSTA — preencha completamente a bolha da alternativa</text>`);

  // Campos Nome / Empresa / Data / Nota.
  const fieldY = ny(0.115);
  parts.push(`<text x="${hX}" y="${fieldY}" font-size="3.0">Nome:</text>`);
  parts.push(`<line x1="${hX + 14}" y1="${fieldY + 0.8}" x2="${nx(0.62)}" y2="${fieldY + 0.8}" stroke="#000" stroke-width="0.3"/>`);
  parts.push(`<text x="${nx(0.66)}" y="${fieldY}" font-size="3.0">Data:</text>`);
  parts.push(`<line x1="${nx(0.73)}" y1="${fieldY + 0.8}" x2="${nx(0.96)}" y2="${fieldY + 0.8}" stroke="#000" stroke-width="0.3"/>`);
  const field2Y = ny(0.140);
  parts.push(`<text x="${hX}" y="${field2Y}" font-size="3.0">Empresa:</text>`);
  parts.push(`<line x1="${hX + 18}" y1="${field2Y + 0.8}" x2="${nx(0.62)}" y2="${field2Y + 0.8}" stroke="#000" stroke-width="0.3"/>`);
  parts.push(`<text x="${nx(0.66)}" y="${field2Y}" font-size="3.0">Nota:</text>`);
  parts.push(`<line x1="${nx(0.73)}" y1="${field2Y + 0.8}" x2="${nx(0.96)}" y2="${field2Y + 0.8}" stroke="#000" stroke-width="0.3"/>`);

  // Títulos de coluna.
  parts.push(`<text x="${nx(0.04)}" y="${ny(0.185)}" font-size="3.2" font-weight="bold">Questões objetivas</text>`);
  parts.push(`<text x="${nx(0.555)}" y="${ny(0.185)}" font-size="3.2" font-weight="bold">8. Verdadeiro (V) / Falso (F)</text>`);

  // Linha divisória sutil entre colunas.
  parts.push(`<line x1="${nx(0.52)}" y1="${ny(0.20)}" x2="${nx(0.52)}" y2="${ny(0.96)}" stroke="#bbbbbb" stroke-width="0.2"/>`);

  // Bolhas + rótulos.
  for (const row of layout.rows) {
    const labelText = row.type === 'tf' ? row.qid : `${row.qid}.`;
    parts.push(`<text x="${nx(row.labelX)}" y="${ny(row.y) + 1.4}" font-size="3.4" font-weight="bold">${esc(labelText)}</text>`);
    for (const b of row.bubbles) {
      const cx = nx(b.x);
      const cy = ny(b.y);
      // Letra da alternativa à esquerda da bolha.
      parts.push(`<text x="${cx - rBubble - 1.4}" y="${cy + 1.2}" text-anchor="middle" font-size="2.9" fill="#222">${esc(b.option)}</text>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${rBubble}" fill="#ffffff" stroke="#000000" stroke-width="0.45"/>`);
    }
  }

  // Rodapé/instruções.
  parts.push(`<text x="${nx(0.5)}" y="${ny(0.985)}" text-anchor="middle" font-size="2.4" fill="#555">Use caneta azul/preta ou lápis. Não rasure. Marque apenas uma alternativa por questão.</text>`);

  parts.push('</svg>');
  return parts.join('\n');
}

// Abre uma janela de impressão com o cartão.
export function printCard(exam) {
  const svg = buildCardSVG(exam);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Permita pop-ups para imprimir o cartão.');
    return;
  }
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Cartão-resposta</title>
    <style>@page{size:A4;margin:0} html,body{margin:0;padding:0} svg{display:block;width:210mm;height:297mm}
    @media print{.noprint{display:none}} .noprint{position:fixed;top:8px;right:8px;font-family:Arial}</style>
    </head><body>
    <button class="noprint" onclick="window.print()">Imprimir</button>
    ${svg}
    </body></html>`);
  win.document.close();
}
