// config.js — Perfis de prova ("corretores") e gabaritos.
//
// O app é 100% genérico: cada usuário monta as próprias provas (nº de questões e
// conteúdo). Não há prova embutida. Suporta enunciado (statement) e texto das
// alternativas (optionTexts) para gerar a PROVA impressa; o leitor (OMR) usa só
// a LETRA da alternativa.
//
// Persistência (localStorage):
//   nr33.profiles.v3 = { activeId, order:[ids], profiles:{ [id]: exam } }

// Conjuntos de alternativas disponíveis ao criar/editar uma prova.
export const OPTION_SETS = {
  'A-E': { label: 'A a E (5)', options: ['A', 'B', 'C', 'D', 'E'], type: 'choice' },
  'A-D': { label: 'A a D (4)', options: ['A', 'B', 'C', 'D'], type: 'choice' },
  'A-C': { label: 'A a C (3)', options: ['A', 'B', 'C'], type: 'choice' },
  'VF':  { label: 'V / F', options: ['V', 'F'], type: 'tf' },
};

const PROFILES_KEY = 'nr33.profiles.v3';
const LEGACY_KEYS = ['nr33.profiles.v2'];

const clone = (o) => JSON.parse(JSON.stringify(o));

function genId() {
  return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

// Texto curto para a etiqueta de troca de prova.
export function badgeText(exam) {
  if (!exam) return 'Selecionar prova';
  const s = exam.name || exam.title || 'Prova';
  return s.length > 14 ? s.slice(0, 13) + '…' : s;
}

// 1ª carga: começa vazio. Reaproveita perfis criados pelo usuário em versões
// anteriores (descartando qualquer prova "embutida" antiga, como o NR-33).
function migrate() {
  const store = { activeId: null, order: [], profiles: {} };
  for (const key of LEGACY_KEYS) {
    try {
      const old = JSON.parse(localStorage.getItem(key) || 'null');
      if (old && old.profiles) {
        for (const id of (old.order || Object.keys(old.profiles))) {
          const ex = old.profiles[id];
          if (ex && !ex.builtin && Array.isArray(ex.questions)) {
            const nid = ex.id || id;
            ex.id = nid; delete ex.builtin;
            store.profiles[nid] = ex;
            store.order.push(nid);
          }
        }
      }
    } catch (e) { /* ignora */ }
  }
  if (store.order.length) store.activeId = store.order[0];
  return store;
}

function getStore() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.profiles && Array.isArray(s.order)) {
        if (s.activeId && !s.profiles[s.activeId]) s.activeId = s.order[0] || null;
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
      count: (s.profiles[id].questions || []).length,
      active: id === s.activeId,
    }));
}

export function hasProfiles() {
  return getStore().order.length > 0;
}

// Exame ativo (cópia). Retorna null se nenhuma prova existir/estiver ativa.
export function getActiveExam() {
  const s = getStore();
  return s.activeId && s.profiles[s.activeId] ? clone(s.profiles[s.activeId]) : null;
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
  const id = exam.id || s.activeId || genId();
  exam.id = id;
  s.profiles[id] = clone(exam);
  if (!s.order.includes(id)) s.order.push(id);
  s.activeId = id;
  saveStore(s);
}

// Gera N questões a partir de um conjunto de alternativas, preservando respostas
// e textos já definidos (por índice) quando possível.
export function makeQuestions(numQuestions, optionsKey, prev = []) {
  const set = OPTION_SETS[optionsKey] || OPTION_SETS['A-E'];
  const out = [];
  for (let i = 0; i < numQuestions; i++) {
    const old = prev[i] || {};
    const prevAns = set.options.includes(old.answer) ? old.answer : set.options[0];
    const optionTexts = {};
    for (const o of set.options) optionTexts[o] = (old.optionTexts && old.optionTexts[o]) || '';
    out.push({
      id: String(i + 1), type: set.type,
      statement: old.statement || '',
      options: [...set.options], optionTexts,
      answer: prevAns,
    });
  }
  return out;
}

export function createProfile({ name, numQuestions = 20, optionsKey = 'A-E' }) {
  const s = getStore();
  const id = genId();
  const nm = (name || '').trim() || `Prova ${s.order.length + 1}`;
  const n = Math.max(1, Math.min(60, parseInt(numQuestions, 10) || 20));
  const exam = {
    id, name: nm, title: nm, subtitle: '',
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
  if (!s.profiles[id]) return getActiveExam();
  delete s.profiles[id];
  s.order = s.order.filter((x) => x !== id);
  if (s.activeId === id) s.activeId = s.order[0] || null;
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
