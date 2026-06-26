// opencv-loader.js — Aguarda o OpenCV.js ficar pronto.
//
// O OpenCV é declarado no index.html (<script async src=".../opencv.js">), o que
// faz o navegador compilar o WebAssembly em 2º plano de forma confiável (injetar
// o script por JS trava a inicialização em alguns navegadores).
//
// IMPORTANTE: a build do OpenCV expõe `cv` como um objeto "thenable" que resolve
// para si mesmo. Fazer `Promise.resolve(window.cv)` ou `await window.cv` faz o
// motor de Promises entrar em loop tentando "adotar" esse thenable — e a página
// trava em "Inicializando OpenCV…". Por isso aqui detectamos a prontidão por
// POLLING de `window.cv.Mat` e REMOVEMOS o `.then` auto-referente antes de
// resolver. Nenhum `await window.cv`/`Promise.resolve(cv)` deve ser usado.

const OPENCV_URL = 'https://docs.opencv.org/4.9.0/opencv.js';

let loadPromise = null;

function ok() {
  return !!(window.cv && window.cv.Mat && typeof window.cv.imread === 'function');
}

// Remove o `.then` auto-referente que trava o motor de Promises.
function stripThenable() {
  if (window.cv && typeof window.cv.then === 'function') {
    try { delete window.cv.then; } catch (e) { try { window.cv.then = undefined; } catch (_) {} }
  }
}

export function loadOpenCV(onProgress) {
  if (ok()) { stripThenable(); return Promise.resolve(true); }
  if (loadPromise) return loadPromise;

  if (onProgress) onProgress('Preparando o leitor (OpenCV)…');

  loadPromise = new Promise((resolve, reject) => {
    let done = false;
    let injected = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(injectTimer);
      clearTimeout(timer);
      stripThenable();
      resolve(true); // resolve com booleano — NUNCA com o thenable window.cv
    };

    // Detecta a prontidão sem tocar no `.then` (evita o loop de adoção).
    const check = () => { if (ok()) finish(); };
    const poll = setInterval(check, 100);
    check();

    // Fallback: se a tag do index.html não existir (window.cv nunca aparece),
    // injeta o script após uma curta espera.
    const injectTimer = setTimeout(() => {
      if (!window.cv && !injected) {
        injected = true;
        const s = document.createElement('script');
        s.src = OPENCV_URL;
        s.async = true;
        s.onerror = () => {
          if (!done) { done = true; clearInterval(poll); clearTimeout(timer); reject(new Error('Falha ao baixar OpenCV.js (sem internet?).')); }
        };
        document.head.appendChild(s);
      }
    }, 1500);

    // Tempo amplo: em celulares mais lentos a compilação do módulo demora.
    const timer = setTimeout(() => {
      if (!done) { done = true; clearInterval(poll); clearTimeout(injectTimer); reject(new Error('Tempo esgotado ao iniciar o OpenCV. Recarregue a página e tente de novo.')); }
    }, 90000);
  });

  return loadPromise;
}
