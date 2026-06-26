// opencv-loader.js — Carrega o OpenCV.js sob demanda (apenas quando a câmera é
// usada, evitando baixar ~10 MB para imprimir o cartão ou ver o gabarito).
//
// Carregado de um CDN; após o primeiro uso o Service Worker mantém em cache para
// funcionar offline. A build expõe `cv` como "thenable": aguarda-se `cv.then(...)`
// (ou `cv.onRuntimeInitialized`) para obter o módulo já inicializado.

const OPENCV_URL = 'https://docs.opencv.org/4.9.0/opencv.js';

let loadPromise = null;

function ready() {
  return !!(window.cv && window.cv.Mat && typeof window.cv.imread === 'function');
}

export function loadOpenCV(onProgress) {
  if (ready()) return Promise.resolve(window.cv);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      resolve(window.cv);
    };
    const fail = (msg) => {
      if (done) return;
      done = true;
      clearInterval(poll);
      clearTimeout(timer);
      reject(new Error(msg));
    };

    const check = () => {
      const cv = window.cv;
      if (!cv) return;
      if (cv.Mat) { finish(); return; }
      if (typeof cv.then === 'function') {
        clearInterval(poll);
        cv.then((m) => { if (m && m.Mat) window.cv = m; finish(); });
        return;
      }
      cv.onRuntimeInitialized = finish;
    };

    // Verifica periodicamente (independe do onload, mais robusto p/ scripts grandes).
    const poll = setInterval(check, 100);
    const timer = setTimeout(() => fail('Timeout ao inicializar OpenCV.'), 60000);

    const script = document.createElement('script');
    script.src = OPENCV_URL;
    script.async = true;
    script.onload = () => { if (onProgress) onProgress('Inicializando OpenCV…'); check(); };
    script.onerror = () => fail('Falha ao baixar OpenCV.js (sem internet?).');

    if (onProgress) onProgress('Baixando OpenCV…');
    document.head.appendChild(script);
  });

  return loadPromise;
}
