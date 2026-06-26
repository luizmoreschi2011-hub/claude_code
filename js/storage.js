// storage.js — Persistência opcional dos resultados das correções (localStorage).
// Usado apenas se o instrutor optar por salvar; a correção em si não depende disto.

const KEY = 'nr33.results.v1';

export function listResults() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveResult(result) {
  const all = listResults();
  all.unshift(result);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function deleteResult(id) {
  const all = listResults().filter((r) => r.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function clearResults() {
  localStorage.removeItem(KEY);
}

// Exporta os resultados em CSV (separador ';' — compatível com Excel pt-BR).
export function toCSV(results) {
  const header = ['Nome', 'Data', 'Acertos objetivos', 'Total objetivo', 'Dissertativas', 'Total geral', 'Percentual', 'Situacao'];
  const rows = results.map((r) => [
    r.name || '',
    r.date || '',
    r.objCorrect,
    r.objTotal,
    `${r.writtenCorrect}/${r.writtenTotal}`,
    `${r.totalCorrect}/${r.totalItems}`,
    `${r.percent}%`,
    r.passed ? 'Aprovado' : 'Reprovado',
  ]);
  const all = [header, ...rows];
  return all.map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
}

export function downloadCSV(results, filename = 'resultados-nr33.csv') {
  const csv = '﻿' + toCSV(results); // BOM p/ acentuação no Excel
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
