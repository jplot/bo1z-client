// Sized once, before the transfer to the engine thread: it keeps its render targets at this resolution,
// so a resize only changes the CSS rectangle.
export function sizeGameCanvas(canvas: HTMLCanvasElement) {
  const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
  const density = Math.min(devicePixelRatio || 1, 1920 / width, 1440 / height);
  const scale = Math.max(density, 800 / width, 600 / height);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const size = { width: canvas.width, height: canvas.height };
  function fit() {
    const fitScale = Math.min(innerWidth / size.width, innerHeight / size.height);
    canvas.style.width = `${size.width * fitScale}px`;
    canvas.style.height = `${size.height * fitScale}px`;
  }
  fit();
  addEventListener('resize', fit);
  return size;
}
