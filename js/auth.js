// auth.js — Autenticação e licença (abstração plugável).
//
// A INTERFACE abaixo é a mesma nas duas fases. Na FASE 1 a implementação é um
// STUB LOCAL (localStorage), só para deixar as telas prontas e o fluxo navegável
// — NÃO há cobrança real nem segurança. Na FASE 2, troca-se o corpo destas
// funções por Firebase Auth + Cloud Functions (AbacatePay), mantendo a mesma
// interface, sem mexer na UI.
//
// Interface:
//   currentUser() -> { email, mode } | null      (mode: 'account' | 'local')
//   signup(email, senha) -> { ok, error? }
//   login(email, senha)  -> { ok, error? }
//   useLocalMode()       -> entra sem conta (modo local)
//   logout()
//   isAdmin() -> bool
//   licenseStatus() -> { active, mode, key?, until?, trial? }
//   startPayment() -> { pixCode, amount, demo }   (gera cobrança PIX)
//   checkPayment() -> { active, key?, until? }     (botão "Checar pagamento")

const AUTH_KEY = 'nr33.auth.v1';
const USERS_KEY = 'nr33.users.v1';     // só no stub local
const LICENSE_KEY = 'nr33.license.v1'; // só no stub local

const read = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? def; } catch { return def; } };
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// "Hash" trivial só para o stub (NÃO é segurança real — Fase 2 usa Firebase).
function weakHash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return String(h); }

export const IS_STUB = true; // Fase 1. Vira false quando o Firebase entrar.

export function currentUser() {
  return read(AUTH_KEY, null);
}

export function signup(email, senha) {
  email = (email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'E-mail inválido.' };
  if ((senha || '').length < 6) return { ok: false, error: 'Senha de no mínimo 6 caracteres.' };
  const users = read(USERS_KEY, {});
  if (users[email]) return { ok: false, error: 'E-mail já cadastrado.' };
  users[email] = { pw: weakHash(senha) };
  write(USERS_KEY, users);
  write(AUTH_KEY, { email, mode: 'account' });
  return { ok: true };
}

export function login(email, senha) {
  email = (email || '').trim().toLowerCase();
  const users = read(USERS_KEY, {});
  if (!users[email] || users[email].pw !== weakHash(senha || '')) return { ok: false, error: 'E-mail ou senha incorretos.' };
  write(AUTH_KEY, { email, mode: 'account' });
  return { ok: true };
}

export function useLocalMode() {
  write(AUTH_KEY, { email: '', mode: 'local' });
  return { ok: true };
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
}

export function isAdmin() {
  // Stub: marque localStorage['nr33.admin']='1' para simular admin.
  return localStorage.getItem('nr33.admin') === '1';
}

// Licença do usuário atual. Modo local = sempre liberado (uso offline/grátis na
// Fase 1). Conta = depende do "pagamento" (stub).
export function licenseStatus() {
  const u = currentUser();
  if (!u) return { active: false, mode: 'none' };
  if (u.mode === 'local') return { active: true, mode: 'local' };
  const lic = read(LICENSE_KEY, {})[u.email];
  if (lic && lic.until && new Date(lic.until).getTime() > Date.now()) {
    return { active: true, mode: 'account', key: lic.key, until: lic.until };
  }
  return { active: false, mode: 'account', trial: true };
}

// Gera uma "cobrança PIX" (stub). Fase 2: Cloud Function chama o PSP.
export function startPayment() {
  const u = currentUser();
  const pending = { at: Date.now(), email: u && u.email };
  write('nr33.pix.pending', pending);
  return {
    demo: true,
    amount: 49.9,
    pixCode: '00020126...DEMO-PIX-COPIA-E-COLA...6304ABCD',
  };
}

// Confirma o pagamento (stub: libera após startPayment). Fase 2: consulta a
// Cloud Function que verificou o webhook do PSP.
export function checkPayment() {
  const u = currentUser();
  if (!u || u.mode !== 'account') return { active: false };
  const pending = read('nr33.pix.pending', null);
  if (!pending) return licenseStatus();
  // Demonstração: considera pago e gera a chave única + validade de 12 meses.
  const key = 'DEMO-' + Math.random().toString(36).slice(2, 8).toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
  const until = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const all = read(LICENSE_KEY, {});
  all[u.email] = { key, until };
  write(LICENSE_KEY, all);
  localStorage.removeItem('nr33.pix.pending');
  return { active: true, key, until };
}
