const PROJECT_KEY = "template-printing-mvp-project";
const STORAGE_KEYS = [
  PROJECT_KEY,
  "template-print-language",
  "template-print-work-mode",
  "print-preview-manual-hint-dismissed",
];

export function saveProject(project) {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
    return true;
  } catch (error) {
    console.error("Failed to save project", error);
    return false;
  }
}

export function clearProject() {
  STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
}

export function loadProject() {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
