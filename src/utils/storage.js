const PROJECT_KEY = "template-printing-mvp-project";
const CSV_SESSION_KEY = "template-printing-mvp-csv-session";
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

export function saveCsvSession(csvState) {
  try {
    sessionStorage.setItem(CSV_SESSION_KEY, JSON.stringify(csvState));
    return true;
  } catch (error) {
    console.error("Failed to save CSV session", error);
    return false;
  }
}

export function loadCsvSession() {
  const raw = sessionStorage.getItem(CSV_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearProject() {
  STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
  sessionStorage.removeItem(CSV_SESSION_KEY);
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
