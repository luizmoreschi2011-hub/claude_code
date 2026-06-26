// examdoc.js — Gera a PROVA impressa (enunciados + alternativas) para os alunos.
//
// Diferente do cartão-resposta (card.js, geometria fixa p/ o leitor), a prova é
// texto que flui em várias páginas A4. Não mostra a resposta correta.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildExamHTML(exam) {
  const opcLetra = (o) => o;
  const blocks = (exam.questions || []).map((q, i) => {
    const num = i + 1;
    const enun = q.statement && q.statement.trim() ? esc(q.statement) : `<span class="vazio">(enunciado da questão ${num})</span>`;
    const alts = (q.options || []).map((o) => {
      const txt = q.optionTexts && q.optionTexts[o] ? esc(q.optionTexts[o]) : '';
      return `<div class="alt"><span class="altletra">${esc(opcLetra(o))})</span> <span class="alttxt">${txt || '<span class="vazio">…</span>'}</span></div>`;
    }).join('');
    return `<div class="questao">
      <div class="enun"><span class="qnum">${num}.</span> ${enun}</div>
      <div class="alts">${alts}</div>
    </div>`;
  }).join('');

  const css = `
    @page { size: A4; margin: 16mm 14mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11pt; line-height: 1.35; margin: 0; }
    .cab { text-align: center; border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 10px; }
    .cab h1 { font-size: 15pt; margin: 0; }
    .cab .sub { font-size: 11pt; color: #333; }
    .ident { display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 10pt; margin: 8px 0 6px; }
    .ident .campo { flex: 1 1 45%; border-bottom: 1px solid #000; min-height: 18px; }
    .instr { font-size: 9.5pt; color: #444; margin-bottom: 12px; }
    .questao { margin: 0 0 12px; page-break-inside: avoid; }
    .enun { font-weight: 600; margin-bottom: 4px; }
    .qnum { font-weight: 700; }
    .alts { margin-left: 14px; }
    .alt { margin: 2px 0; }
    .altletra { font-weight: 700; }
    .vazio { color: #999; font-style: italic; font-weight: 400; }
    @media screen { body { background:#fff; max-width: 800px; margin: 0 auto; padding: 24px; } }
    @media print { .noprint { display: none; } }
    .noprint { position: fixed; top: 8px; right: 8px; }
  `;

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(exam.title || exam.name || 'Prova')}</title><style>${css}</style></head>
  <body>
    <button class="noprint" onclick="window.print()">Imprimir / PDF</button>
    <div class="cab">
      <h1>${esc(exam.title || exam.name || 'Prova')}</h1>
      ${exam.subtitle ? `<div class="sub">${esc(exam.subtitle)}</div>` : ''}
    </div>
    <div class="ident">
      <div>Nome: <span class="campo"></span></div>
      <div>Data: <span class="campo"></span></div>
      <div>Empresa: <span class="campo"></span></div>
      <div>Nota: <span class="campo"></span></div>
    </div>
    <div class="instr">Leia atentamente e marque a alternativa correta no cartão-resposta. Use caneta azul ou preta.</div>
    ${blocks || '<p class="vazio">Nenhuma questão cadastrada.</p>'}
  </body></html>`;
}

export function printExam(exam) {
  const html = buildExamHTML(exam);
  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para gerar a prova.'); return; }
  win.document.write(html);
  win.document.close();
}
