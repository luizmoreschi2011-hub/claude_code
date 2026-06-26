// config.js — Perfis de correção ("corretores") e gabaritos.
//
// O app suporta vários "corretores" (ambientes de prova). O NR-33 é o modelo
// embutido (extraído da "AVALIAÇÃO DE APROVEITAMENTO – NR-33"). O usuário pode
// criar novos corretores (ex.: 20 questões A–E) e alternar entre eles.
//
// Persistência (localStorage):
//   nr33.profiles.v2 = { activeId, order:[ids], profiles:{ [id]: exam } }
// Migração: a 1ª carga importa o NR-33 (e edições legadas de nr33.exam.v1).

// Gabarito embutido do NR-33. As questões objetivas têm `column` definido — isso
// mantém o leitor no MODO LEGADO (layout fixo já verificado). Provas novas NÃO
// definem `column`, ativando o layout automático.
export const DEFAULT_EXAM = {
  id: 'nr33',
  name: 'NR-33',
  builtin: true,
  title: 'AVALIAÇÃO NR-33 — Espaço Confinado',
  subtitle: 'Trabalhador Autorizado e Vigia',
  passPercent: 70,
  optionsKey: null, // legado (tipos mistos)
  questions: [
    { id: '1',  type: 'choice', options: ['A', 'B', 'C'],           answer: 'B', column: 'left' },
    { id: '2',  type: 'choice', options: ['A', 'B', 'C'],           answer: 'C', column: 'left' },
    { id: '4',  type: 'choice', options: ['A', 'B', 'C', 'D'],      answer: 'B', column: 'left' },
    { id: '5',  type: 'choice', options: ['A', 'B', 'C', 'D', 'E'], answer: 'E', column: 'left' },
    { id: '9',  type: 'choice', options: ['1', '2', '3', '4', '5'], answer: '3', column: 'left' },
    { id: '10', type: 'choice', options: ['A', 'B', 'C', 'D', 'E'], answer: 'C', column: 'left' },
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
  written: [
    { id: '3', label: 'Q3 — Funções da equipe (Trabalhador, Supervisor, Vigia, Resgate)' },
    { id: '6', label: 'Q6 — Cite 5 objetos proibidos' },
    { id: '7', label: 'Q7 — Cite 5 EPIs necessários' },
  ],
};

// Conjuntos de alternativas disponíveis ao criar/editar uma prova nova.
export const OPTION_SETS = {
  'A-E': { label: 'A a E (5)', options: ['A', 'B', 'C', 'D', 'E'], type: 'choice' },
  'A-D': { label: 'A a D (4)', options: ['A', 'B', 'C', 'D'], type: 'choice' },
  'A-C': { label: 'A a C (3)', options: ['A', 'B', 'C'], type: 'choice' },
  'VF':  { label: 'V / F', options: ['V', 'F'], type: 'tf' },
};

const PROFILES_KEY = 'nr33.profiles.v2';
const LEGACY_EXAM_KEY = 'nr33.exam.v1';

const clone = (o) => JSON.parse(JSON.stringify(o));

function genId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// Texto curto para a etiqueta de troca de corretor.
export function badgeText(exam) {
  const s = (exam && (exam.name || exam.title)) || 'Prova';
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}

function migrate() {
  const nr33 = clone(DEFAULT_EXAM);
  // Reaproveita edições antigas do gabarito único, se existirem.
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_EXAM_KEY) || 'null');
    if (legacy && Array.isArray(legacy.questions) && legacy.questions.length) {
      Object.assign(nr33, legacy, { id: 'nr33', name: 'NR-33', builtin: true });
    }
  } catch (e) { /* ignora */ }
  return { activeId: 'nr33', order: ['nr33'], profiles: { nr33 } };
}

function getStore() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.profiles && s.activeId && s.profiles[s.activeId]) {
        if (!Array.isArray(s.order)) s.order = Object.keys(s.profiles);
        return s;
      }
    }
  } catch (e) { console.warn('Perfis: falha ao carregar, recriando.', e); }
  const fresh = migrate();
  saveStore(fresh);
  return fresh;
}

function saveStore(store) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(store));
}

// Lista de perfis (na ordem), com metadados leves.
export function listProfiles() {
  const s = getStore();
  return s.order
    .filter((id) => s.profiles[id])
    .map((id) => ({
      id,
      name: s.profiles[id].name || s.profiles[id].title || id,
      builtin: !!s.profiles[id].builtin,
      count: (s.profiles[id].questions || []).length,
      active: id === s.activeId,
    }));
}

// Exame ativo (cópia — alterações só persistem via saveActiveExam).
export function getActiveExam() {
  const s = getStore();
  return clone(s.profiles[s.activeId]);
}

export function getActiveId() {
  return getStore().activeId;
}

export function setActiveProfile(id) {
  const s = getStore();
  if (s.profiles[id]) { s.activeId = id; saveStore(s); }
  return getActiveExam();
}

// Salva o exame (identificado por exam.id) no perfil correspondente.
export function saveActiveExam(exam) {
  const s = getStore();
  const id = exam.id || s.activeId;
  exam.id = id;
  s.profiles[id] = clone(exam);
  if (!s.order.includes(id)) s.order.push(id);
  saveStore(s);
}

// Gera N questões a partir de um conjunto de alternativas, preservando respostas
// já definidas (por índice) quando possível.
export function makeQuestions(numQuestions, optionsKey, prev = []) {
  const set = OPTION_SETS[optionsKey] || OPTION_SETS['A-E'];
  const out = [];
  for (let i = 0; i < numQuestions; i++) {
    const old = prev[i];
    const prevAns = old && set.options.includes(old.answer) ? old.answer : set.options[0];
    out.push({ id: String(i + 1), type: set.type, options: [...set.options], answer: prevAns });
  }
  return out;
}

export function createProfile({ name, numQuestions = 20, optionsKey = 'A-E' }) {
  const s = getStore();
  const id = genId();
  const nm = (name || '').trim() || `Prova ${s.order.length + 1}`;
  const n = Math.max(1, Math.min(60, parseInt(numQuestions, 10) || 20));
  const exam = {
    id, name: nm, builtin: false,
    title: nm, subtitle: '',
    passPercent: 70,
    optionsKey: OPTION_SETS[optionsKey] ? optionsKey : 'A-E',
    questions: makeQuestions(n, optionsKey),
    written: [],
  };
  s.profiles[id] = exam;
  s.order.push(id);
  s.activeId = id;
  saveStore(s);
  return clone(exam);
}

export function deleteProfile(id) {
  const s = getStore();
  if (!s.profiles[id] || s.profiles[id].builtin) return getActiveExam();
  delete s.profiles[id];
  s.order = s.order.filter((x) => x !== id);
  if (s.activeId === id) s.activeId = s.order[0] || 'nr33';
  if (!s.profiles[s.activeId]) { const m = migrate(); Object.assign(s, m); }
  saveStore(s);
  return getActiveExam();
}

export function renameProfile(id, name) {
  const s = getStore();
  if (s.profiles[id]) {
    const nm = (name || '').trim();
    if (nm) { s.profiles[id].name = nm; s.profiles[id].title = nm; saveStore(s); }
  }
}

// Restaura o gabarito padrão (somente para o NR-33 embutido).
export function resetActiveToDefault() {
  const s = getStore();
  if (s.activeId === 'nr33') {
    s.profiles.nr33 = clone(DEFAULT_EXAM);
    saveStore(s);
  }
  return getActiveExam();
}
