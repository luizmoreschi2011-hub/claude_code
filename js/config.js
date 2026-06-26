// config.js — Fonte única do gabarito e das configurações.
//
// O gabarito padrão abaixo foi extraído da "AVALIAÇÃO DE APROVEITAMENTO – NR-33"
// (Segurança e Saúde no Trabalho em Espaço Confinado). Apenas as questões
// objetivas (assinaláveis) são corrigidas pela câmera. As questões dissertativas
// (3, 6 e 7) são pontuadas manualmente na tela de resultado.
//
// Mapa das respostas objetivas:
//   Q1  -> B      Q2  -> C      Q4  -> B      Q5  -> E
//   Q8  -> V,V,F,V,V,V,V,F,V (9 itens)
//   Q9  -> 3      Q10 -> C

export const DEFAULT_EXAM = {
  title: 'AVALIAÇÃO NR-33 — Espaço Confinado',
  subtitle: 'Trabalhador Autorizado e Vigia',
  // Percentual mínimo para aprovação.
  passPercent: 70,
  // Questões objetivas (corrigidas pela câmera).
  // column: 'left' | 'right' define em qual coluna do cartão a questão aparece.
  questions: [
    { id: '1',  type: 'choice', options: ['A', 'B', 'C'],                 answer: 'B', column: 'left' },
    { id: '2',  type: 'choice', options: ['A', 'B', 'C'],                 answer: 'C', column: 'left' },
    { id: '4',  type: 'choice', options: ['A', 'B', 'C', 'D'],            answer: 'B', column: 'left' },
    { id: '5',  type: 'choice', options: ['A', 'B', 'C', 'D', 'E'],       answer: 'E', column: 'left' },
    { id: '9',  type: 'choice', options: ['1', '2', '3', '4', '5'],       answer: '3', column: 'left' },
    { id: '10', type: 'choice', options: ['A', 'B', 'C', 'D', 'E'],       answer: 'C', column: 'left' },
    { id: '8.1', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.2', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.3', type: 'tf', options: ['V', 'F'], answer: 'F', column: 'right', group: '8' },
    { id: '8.4', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.5', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.6', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.7', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
    { id: '8.8', type: 'tf', options: ['V', 'F'], answer: 'F', column: 'right', group: '8' },
    { id: '8.9', type: 'tf', options: ['V', 'F'], answer: 'V', column: 'right', group: '8' },
  ],
  // Questões dissertativas (pontuação manual).
  written: [
    { id: '3', label: 'Q3 — Funções da equipe (Trabalhador, Supervisor, Vigia, Resgate)' },
    { id: '6', label: 'Q6 — Cite 5 objetos proibidos' },
    { id: '7', label: 'Q7 — Cite 5 EPIs necessários' },
  ],
};

const STORAGE_KEY = 'nr33.exam.v1';

// Carrega o gabarito (com eventuais edições salvas pelo usuário).
export function loadExam() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // Mescla de forma defensiva: estrutura das questões vem do salvo se válida.
      if (saved && Array.isArray(saved.questions) && saved.questions.length) {
        return { ...DEFAULT_EXAM, ...saved };
      }
    }
  } catch (e) {
    console.warn('Falha ao carregar gabarito salvo, usando padrão.', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_EXAM));
}

export function saveExam(exam) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(exam));
}

export function resetExam() {
  localStorage.removeItem(STORAGE_KEY);
  return JSON.parse(JSON.stringify(DEFAULT_EXAM));
}
