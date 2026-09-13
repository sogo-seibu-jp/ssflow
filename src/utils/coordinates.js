const MIN_SIZE = 24;

export function screenPointToCanvasPoint(event, element) {
  const bounds = element.getBoundingClientRect();
  return {
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  };
}

export function defaultRect(width, height) {
  return {
    x: width * 0.18,
    y: height * 0.18,
    width: width * 0.48,
    height: height * 0.26,
  };
}

export function normalizeRect(rect, width, height) {
  return {
    xRatio: clamp(rect.x / width, 0, 1),
    yRatio: clamp(rect.y / height, 0, 1),
    widthRatio: clamp(rect.width / width, 0, 1),
    heightRatio: clamp(rect.height / height, 0, 1),
  };
}

export function ratioRectToPixels(rect, width, height) {
  return {
    x: rect.xRatio * width,
    y: rect.yRatio * height,
    width: rect.widthRatio * width,
    height: rect.heightRatio * height,
  };
}

export function rectFromPoints(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function pdfCropBoxFromRatios(rect, pdfWidth, pdfHeight) {
  const x = rect.xRatio * pdfWidth;
  const height = rect.heightRatio * pdfHeight;
  return {
    x,
    y: pdfHeight - (rect.yRatio * pdfHeight) - height,
    width: rect.widthRatio * pdfWidth,
    height,
  };
}

export function resizedRect(initial, start, point, mode, minSize = MIN_SIZE) {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  if (mode === "move") {
    return { ...initial, x: initial.x + dx, y: initial.y + dy };
  }
  const next = { ...initial };
  if (mode.includes("e")) next.width = initial.width + dx;
  if (mode.includes("s")) next.height = initial.height + dy;
  if (mode.includes("w")) {
    next.x = initial.x + dx;
    next.width = initial.width - dx;
  }
  if (mode.includes("n")) {
    next.y = initial.y + dy;
    next.height = initial.height - dy;
  }
  return normalizeDragRect(next, minSize);
}

export function clampRect(rect, width, height, minSize = MIN_SIZE) {
  const next = normalizeDragRect(rect, minSize);
  next.width = Math.min(next.width, width);
  next.height = Math.min(next.height, height);
  next.x = clamp(next.x, 0, width - next.width);
  next.y = clamp(next.y, 0, height - next.height);
  return next;
}

function normalizeDragRect(rect, minSize = MIN_SIZE) {
  const next = { ...rect };
  if (next.width < minSize) next.width = minSize;
  if (next.height < minSize) next.height = minSize;
  return next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
