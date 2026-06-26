// camera.js — Acesso à câmera (getUserMedia), troca de câmera e lanterna.

export class Camera {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.track = null;
    this.facingMode = 'environment';
  }

  async start(facingMode = this.facingMode) {
    this.stop();
    this.facingMode = facingMode;
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    await this.video.play();
    return this.track;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.track = null;
    }
  }

  async switchCamera() {
    const next = this.facingMode === 'environment' ? 'user' : 'environment';
    await this.start(next);
  }

  hasTorch() {
    if (!this.track) return false;
    const caps = this.track.getCapabilities ? this.track.getCapabilities() : {};
    return !!caps.torch;
  }

  async setTorch(on) {
    if (!this.hasTorch()) return false;
    try {
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      return true;
    } catch (e) {
      return false;
    }
  }

  // Captura o frame atual num canvas na resolução real do vídeo.
  grabFrame(canvas) {
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.video, 0, 0, w, h);
    return canvas;
  }
}
