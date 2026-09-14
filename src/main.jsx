import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import Papa from "papaparse";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  ArrowDownToLine,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Eye,
  FileText,
  Grid2X2,
  Layers,
  ListChecks,
  MousePointer2,
  Plus,
  Rows3,
  Save,
  SlidersHorizontal,
  Table,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  clampRect,
  normalizeRect,
  pdfCropBoxFromRatios,
  ratioRectToPixels,
  rectFromPoints,
  resizedRect,
  screenPointToCanvasPoint,
} from "./utils/coordinates";
import { clearProject, loadCsvSession, loadProject, saveCsvSession, saveProject } from "./utils/storage";
import uiText from "./i18n/ui-text.json";
import "./styles.css";

// pdfjs-dist 5.x may call proposed Map helpers that are missing in older browsers.
if (typeof Map.prototype.getOrInsert !== "function") {
  Map.prototype.getOrInsert = function getOrInsert(key, defaultValue) {
    if (this.has(key)) return this.get(key);
    this.set(key, defaultValue);
    return defaultValue;
  };
}

if (typeof Map.prototype.getOrInsertComputed !== "function") {
  Map.prototype.getOrInsertComputed = function getOrInsertComputed(key, compute) {
    if (this.has(key)) return this.get(key);
    const value = compute(key);
    this.set(key, value);
    return value;
  };
}

// Some browsers do not yet ship TypedArray.prototype.toHex used by pdfjs-dist 5.x.
if (typeof Uint8Array.prototype.toHex !== "function") {
  Uint8Array.prototype.toHex = function toHex() {
    let out = "";
    for (let i = 0; i < this.length; i += 1) {
      out += this[i].toString(16).padStart(2, "0");
    }
    return out;
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).toString();
const PDFJS_WASM_URL = `${import.meta.env.BASE_URL}pdfjs/wasm/`;

const PAPER_SIZES = {
  A4: { width: 595.28, height: 841.89 },
  A3: { width: 841.89, height: 1190.55 },
  A5: { width: 419.53, height: 595.28 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 },
  B5: { width: 515.91, height: 728.5 },
};

const CSV_ENCODINGS = [
  { value: "auto", labelKey: "csv.encodingOption.auto" },
  { value: "utf-8", labelKey: "csv.encodingOption.utf8" },
  { value: "shift_jis", labelKey: "csv.encodingOption.shiftJis" },
  { value: "big5", labelKey: "csv.encodingOption.big5" },
  { value: "gb18030", labelKey: "csv.encodingOption.gb18030" },
];

const PDF_FONTS = {
  regular: `${import.meta.env.BASE_URL}fonts/NotoSansCJKjp-Regular.otf`,
  bold: `${import.meta.env.BASE_URL}fonts/NotoSansCJKjp-Bold.otf`,
};

const VARIABLE_MIN_PIXELS = 6;
const MAPPING_FUNCTION_PREFIX = "__fn__";
const RULE_SOURCE_PREFIX = "__rule__";
const MAPPING_FUNCTIONS = [
  { key: `${MAPPING_FUNCTION_PREFIX}today_yyyy_mm_dd`, labelKey: "mapping.function.todayYyyyMmDd" },
  { key: `${MAPPING_FUNCTION_PREFIX}today_yyyymmdd`, labelKey: "mapping.function.todayYyyymmdd" },
];
const ROW_RULE_ACTIONS = [
  { value: "first-token", labelKey: "rules.action.firstToken" },
  { value: "last-token", labelKey: "rules.action.lastToken" },
  { value: "index-token", labelKey: "rules.action.indexToken" },
  { value: "first-nonempty", labelKey: "rules.action.firstNonEmpty" },
];
const FUNCTION_FIELD_NAMES = {
  [`${MAPPING_FUNCTION_PREFIX}today_yyyy_mm_dd`]: "YYYY/MM/DD",
  [`${MAPPING_FUNCTION_PREFIX}today_yyyymmdd`]: "YYYYMMDD",
};
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/svg+xml", "image/webp"]);
const IMAGE_FILE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "svg", "webp"]);
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const APP_VERSION = "v1.5003";
const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const SNAP_GRID_SIZE = 8;
const SNAP_THRESHOLD = 6;
const HISTORY_LIMIT = 80;
const PT_PER_CM = 72 / 2.54;
const CSS_PX_PER_PT = 96 / 72;
const PREVIEW_RULER_LEFT_PX = 36;
const PREVIEW_RULER_TOP_PX = 30;
const TEMPLATE_THUMBNAIL_MAX_WIDTH = 220;

const NAV_DESIGN = [
  { id: "setup", titleKey: "page.setup.title", flowKey: "nav.setup", icon: Layers },
  { id: "designer", titleKey: "page.designer.title", flowKey: "nav.designer", icon: MousePointer2 },
  { id: "rules", titleKey: "page.rules.title", flowKey: "nav.rules", icon: Rows3 },
  { id: "layout", titleKey: "page.printSetup.title", flowKey: "nav.printSetup", icon: Grid2X2 },
  { id: "template", titleKey: "page.templatePackage.title", flowKey: "nav.template", icon: FileText },
];

const NAV_PRINT = [
  { id: "template", titleKey: "page.templatePackage.title", flowKey: "nav.template", icon: FileText },
  { id: "csv", titleKey: "page.csv.title", flowKey: "nav.csv", icon: Table },
  { id: "layout", titleKey: "page.printSetup.title", flowKey: "nav.printSetup", icon: Grid2X2 },
];

const FLOW_DESIGN = [
  { id: "setup", labelKey: "nav.setup" },
  { id: "designer", labelKey: "nav.designer" },
  { id: "rules", labelKey: "nav.rules" },
  { id: "layout", labelKey: "nav.printSetup" },
  { id: "template", labelKey: "nav.template" },
];

const FLOW_PRINT = [
  { id: "template", labelKey: "nav.template" },
  { id: "csv", labelKey: "nav.csv" },
  { id: "layout", labelKey: "nav.printSetup" },
];

const defaultStyle = {
  fontFamily: "NotoSansCJK",
  fontSize: 18,
  fontWeight: "normal",
  textAlign: "center",
  verticalAlign: "middle",
  textRotation: 0,
  color: "#000000",
  backgroundColor: "transparent",
  autoFit: true,
};

const defaultLayout = {
  paperSize: "A4",
  orientation: "portrait",
  customPaperWidth: 595.28,
  customPaperHeight: 841.89,
  rows: 4,
  columns: 2,
  marginX: 24,
  marginY: 24,
  gapX: 10,
  gapY: 10,
  copiesPerRecord: 1,
  sizeMode: "fit",
  printMode: "auto",
  manualTemplateWidth: 9 * PT_PER_CM,
  manualTemplateHeight: 5.5 * PT_PER_CM,
  manualTop: 1.2 * PT_PER_CM,
  manualLeft: 1.5 * PT_PER_CM,
  manualRight: 1.4 * PT_PER_CM,
  manualGapX: 0,
  manualGapY: 0,
  manualAutoGapX: false,
  printBorderEnabled: false,
  printBorderStyle: "solid",
  printBorderWidth: 0.1,
};

function makeTranslator(language) {
  return (key, params = {}) => {
    const template = uiText[language]?.[key] || uiText.en[key] || key;
    return template.replace(/\{(\w+)\}/g, (_match, token) => String(params[token] ?? `{${token}}`));
  };
}

async function createThumbnailDataUrl(sourceUrl, maxWidth = TEMPLATE_THUMBNAIL_MAX_WIDTH) {
  if (!sourceUrl) return "";
  const image = await loadImageElement(sourceUrl);
  const sourceWidth = image.naturalWidth || image.width || 0;
  const sourceHeight = image.naturalHeight || image.height || 0;
  if (!sourceWidth || !sourceHeight) return "";
  const scale = Math.min(1, maxWidth / sourceWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function runtimeT(key, params = {}) {
  const language = typeof window === "undefined"
    ? "en"
    : localStorage.getItem("template-print-language") || document.documentElement.getAttribute("data-ui-lang") || "en";
  return makeTranslator(language === "ja" ? "ja" : "en")(key, params);
}

function parseAppRoute(search) {
  const params = new URLSearchParams(search || "");
  const mode = params.get("mode");
  const view = params.get("view");
  const normalizedMode = mode === "design" || mode === "print" ? mode : "";
  const allowedViews = normalizedMode === "print"
    ? new Set(["template", "csv", "layout"])
    : new Set(["setup", "designer", "rules", "layout", "template"]);
  const defaultView = normalizedMode === "print" ? "template" : "setup";
  return {
    workMode: normalizedMode,
    view: view && allowedViews.has(view) ? view : defaultView,
  };
}

function buildAppUrl(workMode, view) {
  if (!workMode) return window.location.pathname;
  const params = new URLSearchParams();
  params.set("mode", workMode);
  if (view) params.set("view", view);
  return `${window.location.pathname}?${params.toString()}`;
}

function App() {
  const [workMode, setWorkMode] = useState(() => {
    const route = parseAppRoute(window.location.search);
    if (route.workMode) return route.workMode;
    return localStorage.getItem("template-print-work-mode") || "";
  });
  const [view, setView] = useState(() => {
    const route = parseAppRoute(window.location.search);
    if (route.workMode) return route.view;
    const savedMode = localStorage.getItem("template-print-work-mode") || "";
    return savedMode === "print" ? "template" : "setup";
  });
  const [setupSourceKind, setSetupSourceKind] = useState("pdf");
  const [designerMode, setDesignerMode] = useState("crop");
  const [language, setLanguage] = useState(() => localStorage.getItem("template-print-language") || "en");
  const [csvUploadEncoding, setCsvUploadEncoding] = useState("auto");
  const [templates, setTemplates] = useState([]);
  const [activeTemplateId, setActiveTemplateId] = useState("");
  const [csvDatasets, setCsvDatasets] = useState([]);
  const [activeCsvId, setActiveCsvId] = useState("");
  const [selectedRowIds, setSelectedRowIds] = useState([]);
  const [rowCopies, setRowCopies] = useState({});
  const [previewCsvId, setPreviewCsvId] = useState("");
  const [mappingPreviewOpen, setMappingPreviewOpen] = useState(false);
  const [printPreviewOpen, setPrintPreviewOpen] = useState(() => window.innerWidth > 720);
  const [mappings, setMappings] = useState({});
  const [templatePreviewUrls, setTemplatePreviewUrls] = useState({});
  const [layout, setLayout] = useState(defaultLayout);
  const [designLayout, setDesignLayout] = useState(defaultLayout);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState(null);
  const [pdfZoom, setPdfZoom] = useState(1);
  const [fieldZoom, setFieldZoom] = useState(1);
  const [renderBox, setRenderBox] = useState({ width: 0, height: 0, scale: 1 });
  const [cropRect, setCropRect] = useState(null);
  const [cropPreviewImageUrl, setCropPreviewImageUrl] = useState("");
  const [cropPreviewDisplaySize, setCropPreviewDisplaySize] = useState(null);
  const [selectedVariableId, setSelectedVariableId] = useState("");
  const [selectedVariableIds, setSelectedVariableIds] = useState([]);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [dragGuides, setDragGuides] = useState({ x: [], y: [] });
  const [historyState, setHistoryState] = useState({ undoCount: 0, redoCount: 0 });
  const [exportUrl, setExportUrl] = useState("");
  const [status, setStatus] = useState("");
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [setupDropActive, setSetupDropActive] = useState(false);
  const [designerDropActive, setDesignerDropActive] = useState(false);

  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const cropPreviewRef = useRef(null);
  const topChromeRef = useRef(null);
  const dragRef = useRef(null);
  const setupDragDepthRef = useRef(0);
  const designerDragDepthRef = useRef(0);
  const historyPastRef = useRef([]);
  const historyFutureRef = useRef([]);
  const applyingHistoryRef = useRef(false);

  const activeTemplate = templates.find((template) => template.templateId === activeTemplateId) ?? null;
  const activeCsv = csvDatasets.find((dataset) => dataset.id === activeCsvId) ?? null;
  const effectivePrintLayout = useMemo(
    () => normalizeLayout(activeTemplate?.savedLayout ?? layout),
    [activeTemplate?.savedLayout, layout],
  );
  const activeMapping = useMemo(
    () => resolveTemplateCsvHeaderMapping(activeTemplate, activeCsv, activeCsvId, mappings),
    [activeTemplate, activeCsv, activeCsvId, mappings],
  );
  const selectedVariable = activeTemplate?.variables.find((item) => item.id === selectedVariableId) ?? null;
  const t = useMemo(() => makeTranslator(language), [language]);

  useEffect(() => {
    if (!templates.length) {
      if (activeTemplateId) setActiveTemplateId("");
      return;
    }
    if (!activeTemplateId || !activeTemplate) {
      setActiveTemplateId(templates[0].templateId);
    }
  }, [templates, activeTemplateId, activeTemplate]);

  useEffect(() => {
    if (workMode !== "design") return;
    if (!activeTemplate) return;
    const nextLayout = activeTemplate.savedLayout
      ? normalizeLayout(activeTemplate.savedLayout)
      : normalizeLayout(defaultLayout);
    setDesignLayout(nextLayout);
  }, [workMode, activeTemplateId, activeTemplate]);

  useEffect(() => {
    if (workMode !== "design" || view !== "layout") return;
    if (!activeTemplate?.savedLayout) return;
    const nextLayout = normalizeLayout(activeTemplate.savedLayout);
    setDesignLayout((current) => {
      const currentNormalized = normalizeLayout(current);
      return JSON.stringify(currentNormalized) === JSON.stringify(nextLayout) ? current : nextLayout;
    });
  }, [workMode, view, activeTemplateId, activeTemplate?.savedLayout]);

  useEffect(() => {
    const saved = loadProject();
    if (!saved) return;
    const migratedTemplates = migrateTemplatesWithLegacyMappings(saved.templates ?? [], saved.mappings ?? {}, saved.activeCsvId ?? "");
    setTemplates(migratedTemplates.map(({ savedPreviewImageUrl, ...template }) => template));
    setActiveTemplateId(saved.activeTemplateId ?? saved.templates?.[0]?.templateId ?? "");
    setMappings(saved.mappings ?? {});
    setLayout(normalizeLayout(saved.printLayout ?? saved.layout ?? {}));
    setDesignLayout(normalizeLayout(saved.designLayout ?? saved.layout ?? {}));

    const csvSession = loadCsvSession();
    const sessionCsvDatasets = csvSession?.csvDatasets ?? [];
    const sessionActiveCsvId = csvSession?.activeCsvId ?? sessionCsvDatasets[0]?.id ?? "";
    setCsvDatasets(sessionCsvDatasets);
    setActiveCsvId(sessionActiveCsvId);
    setSelectedRowIds(csvSession?.selectedRowIds ?? []);
    setRowCopies(csvSession?.rowCopies ?? {});
  }, []);

  useEffect(() => {
    const ok = saveProject({
      templates,
      activeTemplateId,
      mappings,
      layout,
      printLayout: layout,
      designLayout,
    });
    if (!ok) {
      setStatus(t("status.storageQuotaExceeded"));
    }
  }, [templates, activeTemplateId, mappings, layout, designLayout, t]);

  useEffect(() => {
    const csvSession = {
      csvDatasets,
      activeCsvId,
      selectedRowIds,
      rowCopies,
    };
    const ok = saveCsvSession(csvSession);
    if (!ok) {
      setStatus(t("status.storageQuotaExceeded"));
    }
  }, [csvDatasets, activeCsvId, selectedRowIds, rowCopies, t]);

  useEffect(() => {
    localStorage.setItem("template-print-language", language);
  }, [language]);

  useEffect(() => {
    if (!workMode) return;
    localStorage.setItem("template-print-work-mode", workMode);
  }, [workMode]);

  useEffect(() => {
    const target = buildAppUrl(workMode, view);
    const current = `${window.location.pathname}${window.location.search}`;
    if (target !== current) {
      window.history.pushState({ workMode, view }, "", target);
    }
  }, [workMode, view]);

  useEffect(() => {
    function onPopState() {
      const route = parseAppRoute(window.location.search);
      setWorkMode(route.workMode);
      setView(route.view);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!workMode) {
      document.documentElement.style.removeProperty("--top-chrome-offset");
      return;
    }
    const topChrome = topChromeRef.current;
    if (!topChrome) return;

    const updateTopChromeOffset = () => {
      const height = Math.ceil(topChrome.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--top-chrome-offset", `${height}px`);
    };

    updateTopChromeOffset();
    window.addEventListener("resize", updateTopChromeOffset);

    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateTopChromeOffset)
      : null;
    resizeObserver?.observe(topChrome);

    return () => {
      window.removeEventListener("resize", updateTopChromeOffset);
      resizeObserver?.disconnect();
    };
  }, [workMode, view, status, language]);

  useEffect(() => {
    if (workMode !== "print") return;
    if (view === "setup" || view === "designer" || view === "mapping") {
      setView("template");
    }
  }, [workMode, view]);

  useEffect(() => {
    if (workMode !== "design") return;
    if (view === "csv") {
      setView("layout");
    }
    if (view === "mapping") {
      setView("designer");
    }
  }, [workMode, view]);

  useEffect(() => {
    const doc = document.documentElement;
    doc.lang = language === "ja" ? "ja" : "en";
    doc.setAttribute("data-ui-lang", language === "ja" ? "ja" : "en");
  }, [language]);

  useEffect(() => {
    if (!status) return undefined;
    const timeout = window.setTimeout(() => setStatus(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [status]);

  function setSelection(variableId, selectedIds = [variableId]) {
    setSelectedVariableId(variableId);
    setSelectedVariableIds(Array.from(new Set(selectedIds.filter(Boolean))));
  }

  function clearAllSavedData() {
    if (!window.confirm(t("status.clearDataConfirm"))) return;
    clearProject();
    setTemplates([]);
    setActiveTemplateId("");
    setCsvDatasets([]);
    setActiveCsvId("");
    setSelectedRowIds([]);
    setRowCopies({});
    setMappings({});
    setLayout(normalizeLayout(defaultLayout));
    setDesignLayout(normalizeLayout(defaultLayout));
    setStatus(t("status.clearDataDone"));
  }

  function syncHistoryState() {
    setHistoryState({ undoCount: historyPastRef.current.length, redoCount: historyFutureRef.current.length });
  }

  function cloneTemplatesForHistory(items) {
    return JSON.parse(JSON.stringify(items));
  }

  function captureHistorySnapshot() {
    return {
      templates: cloneTemplatesForHistory(templates),
      activeTemplateId,
      selectedVariableId,
      selectedVariableIds: [...selectedVariableIds],
      designerMode,
      cropRect: cropRect ? { ...cropRect } : null,
    };
  }

  function restoreHistorySnapshot(snapshot) {
    applyingHistoryRef.current = true;
    setTemplates(snapshot.templates);
    setActiveTemplateId(snapshot.activeTemplateId);
    setSelectedVariableId(snapshot.selectedVariableId);
    setSelectedVariableIds(snapshot.selectedVariableIds ?? (snapshot.selectedVariableId ? [snapshot.selectedVariableId] : []));
    setDesignerMode(snapshot.designerMode ?? "fields");
    setCropRect(snapshot.cropRect ?? null);
    setDragGuides({ x: [], y: [] });
    queueMicrotask(() => {
      applyingHistoryRef.current = false;
    });
  }

  function pushHistorySnapshot() {
    if (applyingHistoryRef.current) return;
    historyPastRef.current.push(captureHistorySnapshot());
    if (historyPastRef.current.length > HISTORY_LIMIT) historyPastRef.current.shift();
    historyFutureRef.current = [];
    syncHistoryState();
  }

  function undoChange() {
    const snapshot = historyPastRef.current.pop();
    if (!snapshot) return;
    historyFutureRef.current.push(captureHistorySnapshot());
    restoreHistorySnapshot(snapshot);
    syncHistoryState();
  }

  function redoChange() {
    const snapshot = historyFutureRef.current.pop();
    if (!snapshot) return;
    historyPastRef.current.push(captureHistorySnapshot());
    restoreHistorySnapshot(snapshot);
    syncHistoryState();
  }

  useEffect(() => {
    const canHandle = view === "designer" && designerMode === "fields";
    if (!canHandle) return undefined;

    function onKeyDown(event) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
      ) {
        return;
      }

      const isMeta = event.ctrlKey || event.metaKey;
      if (isMeta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoChange(); else undoChange();
        return;
      }
      if (isMeta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoChange();
        return;
      }

      if (!selectedVariableIds.length || !cropPreviewRef.current) return;
      const step = event.shiftKey ? 10 : 1;
      const keyMap = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      const delta = keyMap[event.key];
      if (!delta) return;
      event.preventDefault();
      nudgeSelectedVariables(delta.x, delta.y);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, designerMode, selectedVariableIds, templates, activeTemplateId]);

  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll("button, .button"));
    buttons.forEach((element) => {
      if (element.getAttribute("title")) return;
      const text = (element.textContent || "").replace(/\s+/g, " ").trim();
      if (text) {
        element.setAttribute("title", buildButtonTooltip(text, t));
        return;
      }
      const aria = element.getAttribute("aria-label") || "";
      if (aria.trim()) {
        element.setAttribute("title", buildButtonTooltip(aria.trim(), t));
        return;
      }
      element.setAttribute("title", t("common.buttonAction"));
    });
  }, [t, view, templates, csvDatasets, activeTemplateId, activeCsvId, status, mappingPreviewOpen, printPreviewOpen]);

  useEffect(() => {
    let cancelled = false;
    async function loadSource() {
      setPdfDoc(null);
      setPageCount(0);
      setPageSize(null);
      const source = activeTemplate?.sourcePdf;
      if (!source?.dataBase64) return;
      const sourceType = source.sourceType ?? "pdf";
      if (sourceType === "image") {
        const sourceUrl = sourceDataUrl(source);
        const image = await loadImageElement(sourceUrl);
        if (cancelled) return;
        const nextPageSize = { width: image.naturalWidth, height: image.naturalHeight };
        setPageCount(1);
        setPageNumber(1);
        setPageSize(nextPageSize);
        if (!source.pageSize || source.pageSize.width !== nextPageSize.width || source.pageSize.height !== nextPageSize.height) {
          updateTemplate(activeTemplate.templateId, {
            sourcePdf: { ...source, pageNumber: 1, pageSize: nextPageSize },
          });
        }
        return;
      }
      const bytes = base64ToArrayBuffer(source.dataBase64);
      const { loaded, normalizedBytes } = await loadPdfJsDocumentWithFallback(bytes.slice(0));
      if (cancelled) return;
      const nextPageNumber = source.pageNumber ?? 1;
      const page = await loaded.getPage(nextPageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const nextPageSize = { width: viewport.width, height: viewport.height };
      if (cancelled) return;
      setPdfDoc(loaded);
      setPageCount(loaded.numPages);
      setPageNumber(nextPageNumber);
      setPageSize(nextPageSize);
      if (normalizedBytes && activeTemplate?.templateId) {
        updateTemplate(activeTemplate.templateId, {
          sourcePdf: {
            ...source,
            dataBase64: arrayBufferToBase64(normalizedBytes),
          },
        });
      }
      if (!source.pageSize) {
        updateTemplate(activeTemplate.templateId, {
          sourcePdf: { ...source, pageSize: nextPageSize },
        });
      }
    }
    loadSource().catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [
    activeTemplateId,
    activeTemplate?.templateId,
    activeTemplate?.sourcePdf?.dataBase64,
    activeTemplate?.sourcePdf?.sourceType,
    activeTemplate?.sourcePdf?.pageNumber,
  ]);

  useEffect(() => {
    let cancelled = false;
    async function renderPage() {
      if (!canvasRef.current || !activeTemplate?.sourcePdf?.dataBase64) return;
      const sourceType = activeTemplate.sourcePdf.sourceType ?? "pdf";
      const sourcePageSize = sourceType === "image"
        ? (activeTemplate.sourcePdf.pageSize ?? pageSize)
        : null;
      if (sourceType === "pdf" && !pdfDoc) return;
      if (sourceType === "image" && !sourcePageSize) return;
      let page = null;
      let resolvedBaseViewport = { width: sourcePageSize?.width ?? 0, height: sourcePageSize?.height ?? 0 };
      if (sourceType === "pdf") {
        page = await pdfDoc.getPage(pageNumber);
        resolvedBaseViewport = page.getViewport({ scale: 1 });
      }
      const cropWorkspaceReserve = view === "designer" && designerMode === "crop" ? 300 : 240;
      const minCanvasWidth = window.innerWidth < 720 ? Math.max(240, window.innerWidth - 32) : 420;
      const maxWidth = Math.min(1240, Math.max(minCanvasWidth, window.innerWidth - cropWorkspaceReserve));
      const fitScale = Math.max(0.35, Math.min(1.8, maxWidth / resolvedBaseViewport.width));
      const scale = Math.max(0.35, Math.min(3, fitScale * pdfZoom));
      const viewport = sourceType === "pdf"
        ? page.getViewport({ scale })
        : { width: resolvedBaseViewport.width * scale, height: resolvedBaseViewport.height * scale };
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(viewport.width * dpr);
      canvas.height = Math.round(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (sourceType === "pdf") {
        await page.render({
          canvasContext: context,
          viewport,
          annotationMode: pdfjsLib.AnnotationMode?.ENABLE_FORMS,
        }).promise;
      } else {
        const image = await loadImageElement(sourceDataUrl(activeTemplate.sourcePdf));
        context.clearRect(0, 0, viewport.width, viewport.height);
        context.drawImage(image, 0, 0, viewport.width, viewport.height);
      }
      if (cancelled) return;
      const nextPageSize = { width: resolvedBaseViewport.width, height: resolvedBaseViewport.height };
      const nextRenderBox = { width: viewport.width, height: viewport.height, scale };
      setPageSize(nextPageSize);
      setRenderBox(nextRenderBox);
      setCropRect(activeTemplate?.cropArea ? ratioRectToPixels(activeTemplate.cropArea, viewport.width, viewport.height) : null);
    }
    renderPage().catch((error) => setStatus(error.message));
    return () => {
      cancelled = true;
    };
  }, [
    view,
    designerMode,
    pdfDoc,
    pageNumber,
    activeTemplateId,
    activeTemplate?.sourcePdf?.sourceType,
    activeTemplate?.sourcePdf?.dataBase64,
    activeTemplate?.sourcePdf?.pageSize?.width,
    activeTemplate?.sourcePdf?.pageSize?.height,
    activeTemplate?.cropArea,
    pageSize?.width,
    pageSize?.height,
    pdfZoom,
  ]);

  const drawCropPreview = useCallback(async () => {
    if (!activeTemplate?.cropArea || !activeTemplate?.sourcePdf?.dataBase64) {
      setCropPreviewImageUrl("");
      setCropPreviewDisplaySize(null);
      return;
    }
    try {
      const sourceType = activeTemplate.sourcePdf.sourceType ?? "pdf";
      let baseViewport = null;
      let renderToCanvas = null;
      if (sourceType === "pdf") {
        if (!pdfDoc) {
          setCropPreviewImageUrl("");
          setCropPreviewDisplaySize(null);
          return;
        }
        const previewPageNumber = activeTemplate.sourcePdf?.pageNumber ?? pageNumber;
        const page = await pdfDoc.getPage(previewPageNumber);
        baseViewport = page.getViewport({ scale: 1 });
        renderToCanvas = async (targetCanvas, scale) => {
          const viewport = page.getViewport({ scale });
          targetCanvas.width = viewport.width;
          targetCanvas.height = viewport.height;
          await page.render({
            canvasContext: targetCanvas.getContext("2d"),
            viewport,
            annotationMode: pdfjsLib.AnnotationMode?.ENABLE_FORMS,
          }).promise;
        };
      } else {
        const image = await loadImageElement(sourceDataUrl(activeTemplate.sourcePdf));
        baseViewport = { width: image.naturalWidth, height: image.naturalHeight };
        renderToCanvas = async (targetCanvas, scale) => {
          targetCanvas.width = Math.round(baseViewport.width * scale);
          targetCanvas.height = Math.round(baseViewport.height * scale);
          const targetContext = targetCanvas.getContext("2d");
          targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
          targetContext.drawImage(image, 0, 0, targetCanvas.width, targetCanvas.height);
        };
      }
      const cropPixels = ratioRectToPixels(activeTemplate.cropArea, baseViewport.width, baseViewport.height);
      const previewZoom = designerMode === "fields" ? fieldZoom : 1;
      const minPreviewWidth = window.innerWidth < 720 ? Math.max(220, window.innerWidth - 44) : 520;
      const baseWidth = cropPixels.width * Math.max(renderBox.scale, 1) * previewZoom;
      const displayWidth = Math.min(1100, Math.max(minPreviewWidth, baseWidth));
      const displayScale = displayWidth / cropPixels.width;
      const qualityScale = Math.max(1.5, Math.min(2.25, window.devicePixelRatio || 1.5));
      const scale = displayScale * qualityScale;
      const offscreen = document.createElement("canvas");
      await renderToCanvas(offscreen, scale);
      const targetWidth = Math.round(cropPixels.width * scale);
      const targetHeight = Math.round(cropPixels.height * scale);
      const displayHeight = Math.round(cropPixels.height * displayScale);
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = targetWidth;
      cropCanvas.height = targetHeight;
      const cropContext = cropCanvas.getContext("2d");
      cropContext.drawImage(
        offscreen,
        cropPixels.x * scale,
        cropPixels.y * scale,
        cropPixels.width * scale,
        cropPixels.height * scale,
        0,
        0,
        targetWidth,
        targetHeight,
      );
      const nextSize = { width: Math.round(displayWidth), height: displayHeight };
      setCropPreviewDisplaySize((current) => {
        if (current && current.width === nextSize.width && current.height === nextSize.height) return current;
        return nextSize;
      });
      setCropPreviewImageUrl(cropCanvas.toDataURL("image/png"));
      const canvas = cropPreviewRef.current?.querySelector(".crop-preview-canvas");
      if (!canvas) return;
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.style.width = `${Math.round(displayWidth)}px`;
      canvas.style.height = `${displayHeight}px`;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(cropCanvas, 0, 0);
    } catch (error) {
      setCropPreviewImageUrl("");
      setCropPreviewDisplaySize(null);
      setStatus(t("status.cropPreviewFailed", { message: error.message }));
    }
  }, [activeTemplate, designerMode, fieldZoom, pageNumber, pdfDoc, renderBox, t]);

  const setCropPreviewNode = useCallback((node) => {
    cropPreviewRef.current = node;
    if (node) {
      window.requestAnimationFrame(() => {
        drawCropPreview();
      });
    }
  }, [drawCropPreview]);

  useEffect(() => {
    requestAnimationFrame(() => drawCropPreview());
  }, [view, designerMode, fieldZoom, activeTemplate?.cropArea, activeTemplate?.variables, renderBox, pdfDoc, pageNumber, drawCropPreview]);

  useEffect(() => {
    const canPasteSource = (view === "setup" && setupSourceKind === "image") || (view === "designer" && designerMode === "crop");
    if (!canPasteSource) return undefined;

    function onPaste(event) {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
      ) {
        return;
      }

      const clipboardItems = Array.from(event.clipboardData?.items ?? []);
      if (!clipboardItems.length) return;

      const imageItem = clipboardItems.find((item) => item.kind === "file" && IMAGE_MIME_TYPES.has(item.type));
      const clipboardFiles = Array.from(event.clipboardData?.files ?? []);
      let pastedFile = clipboardFiles.find((file) => IMAGE_MIME_TYPES.has(file.type)) ?? null;

      if (!pastedFile && imageItem) {
        pastedFile = imageItem.getAsFile();
      }

      if (!pastedFile) {
        setStatus(t("status.clipboardImageMissing"));
        return;
      }

      event.preventDefault();
      const extMap = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/svg+xml": "svg",
        "image/webp": "webp",
      };
      const mimeType = pastedFile.type || imageItem?.type || "image/png";
      const extension = extMap[mimeType] ?? "png";
      if (!pastedFile.name) {
        pastedFile = new File([pastedFile], `pasted-source.${extension}`, { type: mimeType });
      }

      ingestTemplateSourceFile(pastedFile).catch((error) => setStatus(error?.message || t("status.sourceUploadUnsupported")));
    }

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [view, designerMode, setupSourceKind, t]);

  async function ingestTemplateSourceFile(file) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus(t("status.fileTooLarge"));
      return;
    }
    const extension = String(file.name || "").toLowerCase().split(".").pop() || "";
    const isPdf = file.type === "application/pdf" || extension === "pdf";
    const isImage = IMAGE_MIME_TYPES.has(file.type) || IMAGE_FILE_EXTENSIONS.has(extension);
    if (!isPdf && !isImage) {
      setStatus(t("status.sourceUploadUnsupported"));
      return;
    }
    const bytes = await file.arrayBuffer();
    const templateId = crypto.randomUUID();
    const sourceType = isPdf ? "pdf" : "image";
    const template = {
      templateId,
      templateName: file.name.replace(/\.[^.]+$/i, ""),
      sourcePdf: {
        fileName: file.name,
        sourceType,
        mimeType: file.type,
        pageNumber: 1,
        dataBase64: arrayBufferToBase64(bytes),
      },
      cropArea: null,
      printSizeCm: null,
      savedLayout: null,
      csvHeaderMapping: {},
      rules: [],
      savedAt: "",
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTemplates((items) => [template, ...items]);
    setActiveTemplateId(templateId);
    setPageNumber(1);
    setPageCount(0);
    setPdfDoc(null);
    setRenderBox({ width: 0, height: 0, scale: 1 });
    setCropRect(null);
    setSelection("", []);
    setDesignerMode("crop");
    setView("designer");
    setStatus(isPdf ? t("status.pdfUploaded") : t("status.imageUploaded"));
  }

  async function handleTemplateSourceUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    await ingestTemplateSourceFile(file);
  }

  function isFileDragEvent(event) {
    const types = Array.from(event.dataTransfer?.types ?? []);
    return types.includes("Files");
  }

  function handleSourceDragEnter(event, setDropActive, dragDepthRef) {
    event.preventDefault();
    event.stopPropagation();
    if (!setDropActive || !dragDepthRef || !isFileDragEvent(event)) return;
    dragDepthRef.current += 1;
    setDropActive(true);
  }

  function handleSourceDragOver(event, setDropActive) {
    event.preventDefault();
    event.stopPropagation();
    if (!setDropActive || !isFileDragEvent(event)) return;
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }

  function handleSourceDragLeave(event, setDropActive, dragDepthRef) {
    event.preventDefault();
    event.stopPropagation();
    if (!setDropActive || !dragDepthRef || !isFileDragEvent(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDropActive(false);
    }
  }

  function handleSourceDrop(event, setDropActive, dragDepthRef) {
    event.preventDefault();
    event.stopPropagation();
    if (!isFileDragEvent(event)) return;
    if (dragDepthRef) dragDepthRef.current = 0;
    if (setDropActive) setDropActive(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    ingestTemplateSourceFile(file).catch((error) => setStatus(error?.message || t("status.sourceUploadUnsupported")));
  }

  function updateTemplate(templateId, patch) {
    setTemplates((items) =>
      items.map((item) =>
        item.templateId === templateId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item,
      ),
    );
  }

  async function setTemplatePreviewUrl(templateId, sourceUrl) {
    if (!templateId || !sourceUrl) return;
    try {
      const thumbnailUrl = await createThumbnailDataUrl(sourceUrl);
      if (!thumbnailUrl) return;
      setTemplatePreviewUrls((current) => ({ ...current, [templateId]: thumbnailUrl }));
    } catch {
      // Ignore thumbnail failures; templates remain usable without previews.
    }
  }

  function createTemplateFromActivePdf() {
    if (!activeTemplate?.sourcePdf?.dataBase64) {
      setStatus(t("status.selectPdfFirst"));
      return;
    }
    const sourceType = activeTemplate.sourcePdf.sourceType ?? "pdf";
    const existingForPdf = templates.filter((template) => template.sourcePdf.fileName === activeTemplate.sourcePdf.fileName).length;
    const templateId = crypto.randomUUID();
    const template = {
      templateId,
      templateName: `${activeTemplate.sourcePdf.fileName.replace(/\.[^.]+$/i, "")} ${t("template.cropSuffix", { count: existingForPdf + 1 })}`,
      sourcePdf: {
        ...activeTemplate.sourcePdf,
        pageNumber: sourceType === "pdf" ? pageNumber : 1,
      },
      cropArea: null,
      printSizeCm: activeTemplate.printSizeCm ?? null,
      savedLayout: activeTemplate.savedLayout ?? null,
      csvHeaderMapping: { ...(activeTemplate.csvHeaderMapping ?? {}) },
      rules: Array.isArray(activeTemplate.rules) ? activeTemplate.rules.map((rule) => ({ ...rule })) : [],
      savedAt: activeTemplate.savedAt ?? "",
      variables: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setTemplates((items) => [template, ...items]);
    setActiveTemplateId(templateId);
    setCropRect(null);
    setSelection("", []);
    setDesignerMode("crop");
    setView("designer");
    setStatus(t("status.newTemplateFromPdf"));
  }

  function saveCrop() {
    if (!activeTemplate || !cropRect || !renderBox.width || !renderBox.height) return;
    pushHistorySnapshot();
    const cropArea = normalizeRect(cropRect, renderBox.width, renderBox.height);
    const sourceType = activeTemplate.sourcePdf?.sourceType ?? "pdf";
    const cropPoints = pageSize
      ? {
        width: cropArea.widthRatio * pageSize.width,
        height: cropArea.heightRatio * pageSize.height,
      }
      : null;
    updateTemplate(activeTemplate.templateId, {
      cropArea,
      sourcePdf: { ...activeTemplate.sourcePdf, pageNumber: sourceType === "pdf" ? pageNumber : 1, pageSize },
      printSizeCm: cropPoints
        ? {
          width: Number(pointsToCmNumber(cropPoints.width).toFixed(2)),
          height: Number(pointsToCmNumber(cropPoints.height).toFixed(2)),
        }
        : activeTemplate.printSizeCm ?? null,
    });
    if (cropPreviewImageUrl) {
      void setTemplatePreviewUrl(activeTemplate.templateId, cropPreviewImageUrl);
    }
    setDesignerMode("fields");
    setView("designer");
    setStatus(t("status.cropSavedAddVariables"));
  }

  function saveCropWithPrintSize(nextPrintSizeCm) {
    if (!activeTemplate || !cropRect || !renderBox.width || !renderBox.height) return;
    pushHistorySnapshot();
    const cropArea = normalizeRect(cropRect, renderBox.width, renderBox.height);
    const sourceType = activeTemplate.sourcePdf?.sourceType ?? "pdf";
    const cropPoints = pageSize
      ? {
        width: cropArea.widthRatio * pageSize.width,
        height: cropArea.heightRatio * pageSize.height,
      }
      : null;
    const fallbackPrintSize = cropPoints
      ? {
        width: Number(pointsToCmNumber(cropPoints.width).toFixed(2)),
        height: Number(pointsToCmNumber(cropPoints.height).toFixed(2)),
      }
      : activeTemplate.printSizeCm ?? null;
    updateTemplate(activeTemplate.templateId, {
      cropArea,
      sourcePdf: { ...activeTemplate.sourcePdf, pageNumber: sourceType === "pdf" ? pageNumber : 1, pageSize },
      printSizeCm: nextPrintSizeCm ?? fallbackPrintSize,
    });
    if (cropPreviewImageUrl) {
      void setTemplatePreviewUrl(activeTemplate.templateId, cropPreviewImageUrl);
    }
    setDesignerMode("fields");
    setView("designer");
    setStatus(t("status.cropSavedAddVariables"));
  }

  function beginCropCreate(event) {
    if (!overlayRef.current || event.target !== event.currentTarget) return;
    pushHistorySnapshot();
    event.preventDefault();
    const start = screenPointToCanvasPoint(event, overlayRef.current);
    dragRef.current = { kind: "crop-create", start };
    setCropRect({ x: start.x, y: start.y, width: 1, height: 1 });
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endPointerDrag);
  }

  function beginCropDrag(event, mode = "move") {
    if (!cropRect || !overlayRef.current) return;
    pushHistorySnapshot();
    event.preventDefault();
    event.stopPropagation();
    const point = screenPointToCanvasPoint(event, overlayRef.current);
    dragRef.current = { kind: "crop", mode, start: point, initial: cropRect };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endPointerDrag);
  }

  function beginVariableDrag(event, variableId, mode = "move") {
    if (!cropPreviewRef.current || !activeTemplate) return;
    event.preventDefault();
    event.stopPropagation();
    const variable = activeTemplate.variables.find((item) => item.id === variableId);
    if (!variable) return;
    const effectiveSelectedIds = selectedVariableIds.includes(variableId)
      ? selectedVariableIds
      : [variableId];
    setSelection(variableId, effectiveSelectedIds);
    pushHistorySnapshot();
    const point = screenPointToCanvasPoint(event, cropPreviewRef.current);
    const pixelRect = ratioRectToPixels(variable, cropPreviewRef.current.clientWidth, cropPreviewRef.current.clientHeight);
    if (mode === "move" && effectiveSelectedIds.length > 1) {
      const initialRects = Object.fromEntries(
        activeTemplate.variables
          .filter((item) => effectiveSelectedIds.includes(item.id))
          .map((item) => [item.id, ratioRectToPixels(item, cropPreviewRef.current.clientWidth, cropPreviewRef.current.clientHeight)]),
      );
      dragRef.current = {
        kind: "variable-group",
        mode,
        variableIds: effectiveSelectedIds,
        start: point,
        initialRects,
      };
    } else {
      dragRef.current = { kind: "variable", mode, variableId, start: point, initial: pixelRect };
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endPointerDrag);
  }

  function handlePointerMove(event) {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "crop-create" && overlayRef.current) {
      const point = screenPointToCanvasPoint(event, overlayRef.current);
      setCropRect(clampRect(rectFromPoints(drag.start, point), renderBox.width, renderBox.height));
    }
    if (drag.kind === "crop" && overlayRef.current) {
      const point = screenPointToCanvasPoint(event, overlayRef.current);
      setCropRect(clampRect(resizedRect(drag.initial, drag.start, point, drag.mode), renderBox.width, renderBox.height));
    }
    if (drag.kind === "variable" && cropPreviewRef.current && activeTemplate) {
      const point = screenPointToCanvasPoint(event, cropPreviewRef.current);
      let next = clampRect(
        resizedRect(drag.initial, drag.start, point, drag.mode, VARIABLE_MIN_PIXELS),
        cropPreviewRef.current.clientWidth,
        cropPreviewRef.current.clientHeight,
        VARIABLE_MIN_PIXELS,
      );
      if (snapEnabled) {
        const snapContext = getVariableSnapContext(activeTemplate.variables, [drag.variableId]);
        if (drag.mode === "move") {
          const snapped = snapMoveRect(next, snapContext, cropPreviewRef.current.clientWidth, cropPreviewRef.current.clientHeight);
          next = snapped.rect;
          setDragGuides(snapped.guides);
        } else {
          next = snapRectToGrid(next, drag.mode);
          setDragGuides({ x: [], y: [] });
        }
      }
      const normalized = normalizeRect(next, cropPreviewRef.current.clientWidth, cropPreviewRef.current.clientHeight);
      updateVariable(drag.variableId, normalized);
    }
    if (drag.kind === "variable-group" && cropPreviewRef.current && activeTemplate) {
      const point = screenPointToCanvasPoint(event, cropPreviewRef.current);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      const initialRects = Object.values(drag.initialRects);
      const bounds = rectBounds(initialRects);
      let snappedDx = dx;
      let snappedDy = dy;
      let guides = { x: [], y: [] };
      if (snapEnabled) {
        const movedBounds = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
        const snapContext = getVariableSnapContext(activeTemplate.variables, drag.variableIds);
        const snapped = snapMoveRect(movedBounds, snapContext, cropPreviewRef.current.clientWidth, cropPreviewRef.current.clientHeight);
        snappedDx = snapped.rect.x - bounds.x;
        snappedDy = snapped.rect.y - bounds.y;
        guides = snapped.guides;
      }
      setDragGuides(guides);
      const width = cropPreviewRef.current.clientWidth;
      const height = cropPreviewRef.current.clientHeight;
      updateTemplate(activeTemplate.templateId, {
        variables: activeTemplate.variables.map((item) => {
          const initial = drag.initialRects[item.id];
          if (!initial) return item;
          const moved = clampRect({ ...initial, x: initial.x + snappedDx, y: initial.y + snappedDy }, width, height, VARIABLE_MIN_PIXELS);
          return { ...item, ...normalizeRect(moved, width, height) };
        }),
      });
    }
  }

  function endPointerDrag() {
    setDragGuides({ x: [], y: [] });
    dragRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", endPointerDrag);
  }

  function addVariable() {
    if (!activeTemplate?.cropArea) {
      setStatus(t("status.saveCropBeforeVariables"));
      return;
    }
    const id = crypto.randomUUID();
    const fieldName = `field_${activeTemplate.variables.length + 1}`;
    const next = {
      id,
      key: fieldName,
      displayName: fieldName,
      type: "text",
      xRatio: 0.1,
      yRatio: 0.1,
      widthRatio: 0.35,
      heightRatio: 0.16,
      style: { ...defaultStyle },
    };
    pushHistorySnapshot();
    updateTemplate(activeTemplate.templateId, { variables: [...activeTemplate.variables, next] });
    setSelection(id, [id]);
  }

  function duplicateVariable(variableId = selectedVariableId) {
    if (!activeTemplate?.cropArea || !variableId) return;
    const source = activeTemplate.variables.find((item) => item.id === variableId);
    if (!source) return;
    const id = crypto.randomUUID();
    const fieldName = `field_${activeTemplate.variables.length + 1}`;
    const step = 0.05;
    let xRatio = source.xRatio;
    let yRatio = source.yRatio;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const nextX = clampNumber(source.xRatio + step * (attempt + 1), 0, Math.max(0, 1 - source.widthRatio));
      const nextY = clampNumber(source.yRatio + step * (attempt + 1), 0, Math.max(0, 1 - source.heightRatio));
      const heavilyOverlaps = activeTemplate.variables.some((item) => {
        const overlapX = Math.max(0, Math.min(nextX + source.widthRatio, item.xRatio + item.widthRatio) - Math.max(nextX, item.xRatio));
        const overlapY = Math.max(0, Math.min(nextY + source.heightRatio, item.yRatio + item.heightRatio) - Math.max(nextY, item.yRatio));
        const overlapArea = overlapX * overlapY;
        const sourceArea = source.widthRatio * source.heightRatio;
        return overlapArea > sourceArea * 0.55;
      });
      xRatio = nextX;
      yRatio = nextY;
      if (!heavilyOverlaps) break;
    }
    const next = {
      ...source,
      id,
      key: fieldName,
      displayName: fieldName,
      xRatio,
      yRatio,
      style: { ...source.style },
    };
    pushHistorySnapshot();
    updateTemplate(activeTemplate.templateId, { variables: [...activeTemplate.variables, next] });
    setSelection(id, [id]);
  }

  function updateVariable(variableId, patch) {
    if (!activeTemplate) return;
    const nextTemplatePatch = {
      variables: activeTemplate.variables.map((item) => (item.id === variableId ? { ...item, ...patch } : item)),
    };
    const shouldSyncHeader = typeof patch?.key === "string" && typeof patch?.displayName === "string" && patch.key === patch.displayName;
    if (shouldSyncHeader) {
      const nextHeader = patch.key.trim();
      const nextMapping = sanitizeTemplateCsvHeaderMapping(activeTemplate.csvHeaderMapping);
      if (nextHeader) nextMapping[variableId] = nextHeader;
      else delete nextMapping[variableId];
      nextTemplatePatch.csvHeaderMapping = nextMapping;
    }
    updateTemplate(activeTemplate.templateId, nextTemplatePatch);
  }

  function updateSelectedVariable(patch) {
    pushHistorySnapshot();
    if (selectedVariableId) updateVariable(selectedVariableId, patch);
  }

  function updateSelectedVariableStyle(patch) {
    if (!selectedVariableId || !selectedVariable) return;
    pushHistorySnapshot();
    updateVariable(selectedVariableId, { style: { ...selectedVariable.style, ...patch } });
  }

  function updateSelectedVariableSource(source) {
    if (!selectedVariableId || !activeTemplate) return;
    pushHistorySnapshot();
    const nextMapping = sanitizeTemplateCsvHeaderMapping(activeTemplate.csvHeaderMapping);
    const normalizedSource = String(source ?? "").trim();
    const selectedItem = activeTemplate.variables.find((item) => item.id === selectedVariableId);
    let nextVariables = activeTemplate.variables;
    if (normalizedSource) nextMapping[selectedVariableId] = normalizedSource;
    else delete nextMapping[selectedVariableId];
    if (selectedItem && isMappingFunction(normalizedSource)) {
      const nextFieldName = FUNCTION_FIELD_NAMES[normalizedSource];
      if (nextFieldName) {
        nextVariables = activeTemplate.variables.map((item) => (
          item.id === selectedVariableId
            ? { ...item, key: nextFieldName, displayName: nextFieldName }
            : item
        ));
      }
    }
    updateTemplate(activeTemplate.templateId, {
      csvHeaderMapping: nextMapping,
      variables: nextVariables,
    });
  }

  function deleteVariable(variableId) {
    if (!activeTemplate) return;
    pushHistorySnapshot();
    updateTemplate(activeTemplate.templateId, {
      variables: activeTemplate.variables.filter((item) => item.id !== variableId),
    });
    if (selectedVariableId === variableId) setSelectedVariableId("");
    setSelectedVariableIds((current) => current.filter((id) => id !== variableId));
  }

  function getVariableSnapContext(variables, excludedIds = []) {
    const x = [];
    const y = [];
    variables
      .filter((item) => !excludedIds.includes(item.id))
      .forEach((item) => {
        x.push(item.xRatio, item.xRatio + item.widthRatio / 2, item.xRatio + item.widthRatio);
        y.push(item.yRatio, item.yRatio + item.heightRatio / 2, item.yRatio + item.heightRatio);
      });
    return { x, y };
  }

  function rectBounds(rectangles) {
    if (!rectangles.length) return { x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(...rectangles.map((rect) => rect.x));
    const minY = Math.min(...rectangles.map((rect) => rect.y));
    const maxX = Math.max(...rectangles.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rectangles.map((rect) => rect.y + rect.height));
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function snapMoveRect(rect, snapContext, width, height) {
    const normalizeX = (value) => value / width;
    const normalizeY = (value) => value / height;
    const denormalizeX = (ratio) => ratio * width;
    const denormalizeY = (ratio) => ratio * height;

    const rectPointsX = [
      { value: normalizeX(rect.x), offset: 0 },
      { value: normalizeX(rect.x + rect.width / 2), offset: -rect.width / 2 },
      { value: normalizeX(rect.x + rect.width), offset: -rect.width },
    ];
    const rectPointsY = [
      { value: normalizeY(rect.y), offset: 0 },
      { value: normalizeY(rect.y + rect.height / 2), offset: -rect.height / 2 },
      { value: normalizeY(rect.y + rect.height), offset: -rect.height },
    ];

    const thresholdX = SNAP_THRESHOLD / width;
    const thresholdY = SNAP_THRESHOLD / height;

    let bestX = null;
    rectPointsX.forEach((point) => {
      snapContext.x.forEach((target) => {
        const diff = Math.abs(target - point.value);
        if (diff <= thresholdX && (!bestX || diff < bestX.diff)) {
          bestX = { diff, x: denormalizeX(target) + point.offset, guide: denormalizeX(target) };
        }
      });
    });

    let bestY = null;
    rectPointsY.forEach((point) => {
      snapContext.y.forEach((target) => {
        const diff = Math.abs(target - point.value);
        if (diff <= thresholdY && (!bestY || diff < bestY.diff)) {
          bestY = { diff, y: denormalizeY(target) + point.offset, guide: denormalizeY(target) };
        }
      });
    });

    const snapped = { ...rect };
    const guides = { x: [], y: [] };
    if (bestX) {
      snapped.x = bestX.x;
      guides.x.push(bestX.guide);
    }
    if (bestY) {
      snapped.y = bestY.y;
      guides.y.push(bestY.guide);
    }

    return { rect: clampRect(snapped, width, height, VARIABLE_MIN_PIXELS), guides };
  }

  function snapRectToGrid(rect, mode = "move") {
    const snapped = { ...rect };
    if (mode === "move" || mode.includes("w") || mode.includes("e")) {
      snapped.x = Math.round(snapped.x / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
      snapped.width = Math.round(snapped.width / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
    }
    if (mode === "move" || mode.includes("n") || mode.includes("s")) {
      snapped.y = Math.round(snapped.y / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
      snapped.height = Math.round(snapped.height / SNAP_GRID_SIZE) * SNAP_GRID_SIZE;
    }
    return snapped;
  }

  function nudgeSelectedVariables(dxPixels, dyPixels) {
    if (!activeTemplate || !selectedVariableIds.length || !cropPreviewRef.current) return;
    pushHistorySnapshot();
    const width = cropPreviewRef.current.clientWidth || cropPreviewDisplaySize?.width;
    const height = cropPreviewRef.current.clientHeight || cropPreviewDisplaySize?.height;
    if (!width || !height) return;
    const dxRatio = dxPixels / width;
    const dyRatio = dyPixels / height;
    const selectedIds = new Set(selectedVariableIds);
    updateTemplate(activeTemplate.templateId, {
      variables: activeTemplate.variables.map((item) => {
        if (!selectedIds.has(item.id)) return item;
        return {
          ...item,
          xRatio: clampNumber(item.xRatio + dxRatio, 0, 1 - item.widthRatio),
          yRatio: clampNumber(item.yRatio + dyRatio, 0, 1 - item.heightRatio),
        };
      }),
    });
  }

  function applySelectedVariableLayout(action) {
    if (!activeTemplate || !selectedVariableIds.length) return;
    const selectedSet = new Set(selectedVariableIds);
    const selected = activeTemplate.variables.filter((item) => selectedSet.has(item.id));
    if (!selected.length) return;
    const isDistribute = action === "distribute-h" || action === "distribute-v";
    if (isDistribute && selected.length < 3) return;
    pushHistorySnapshot();

    if (selected.length === 1 && !isDistribute) {
      const single = selected[0];
      let nextX = single.xRatio;
      let nextY = single.yRatio;
      if (action === "align-left") nextX = 0;
      if (action === "align-center") nextX = (1 - single.widthRatio) / 2;
      if (action === "align-right") nextX = 1 - single.widthRatio;
      if (action === "align-top") nextY = 0;
      if (action === "align-middle") nextY = (1 - single.heightRatio) / 2;
      if (action === "align-bottom") nextY = 1 - single.heightRatio;

      updateTemplate(activeTemplate.templateId, {
        variables: activeTemplate.variables.map((item) =>
          item.id === single.id
            ? {
              ...item,
              xRatio: clampNumber(nextX, 0, 1 - item.widthRatio),
              yRatio: clampNumber(nextY, 0, 1 - item.heightRatio),
            }
            : item,
        ),
      });
      return;
    }

    const minX = Math.min(...selected.map((item) => item.xRatio));
    const maxRight = Math.max(...selected.map((item) => item.xRatio + item.widthRatio));
    const minY = Math.min(...selected.map((item) => item.yRatio));
    const maxBottom = Math.max(...selected.map((item) => item.yRatio + item.heightRatio));
    const centerX = (minX + maxRight) / 2;
    const centerY = (minY + maxBottom) / 2;

    const nextById = Object.fromEntries(selected.map((item) => [item.id, { ...item }]));

    if (action === "align-left") selected.forEach((item) => { nextById[item.id].xRatio = minX; });
    if (action === "align-center") selected.forEach((item) => { nextById[item.id].xRatio = centerX - item.widthRatio / 2; });
    if (action === "align-right") selected.forEach((item) => { nextById[item.id].xRatio = maxRight - item.widthRatio; });
    if (action === "align-top") selected.forEach((item) => { nextById[item.id].yRatio = minY; });
    if (action === "align-middle") selected.forEach((item) => { nextById[item.id].yRatio = centerY - item.heightRatio / 2; });
    if (action === "align-bottom") selected.forEach((item) => { nextById[item.id].yRatio = maxBottom - item.heightRatio; });

    if (action === "distribute-h") {
      const sorted = [...selected].sort((a, b) => a.xRatio - b.xRatio);
      const firstCenter = sorted[0].xRatio + sorted[0].widthRatio / 2;
      const lastCenter = sorted[sorted.length - 1].xRatio + sorted[sorted.length - 1].widthRatio / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);
      sorted.forEach((item, index) => {
        nextById[item.id].xRatio = firstCenter + step * index - item.widthRatio / 2;
      });
    }

    if (action === "distribute-v") {
      const sorted = [...selected].sort((a, b) => a.yRatio - b.yRatio);
      const firstCenter = sorted[0].yRatio + sorted[0].heightRatio / 2;
      const lastCenter = sorted[sorted.length - 1].yRatio + sorted[sorted.length - 1].heightRatio / 2;
      const step = (lastCenter - firstCenter) / (sorted.length - 1);
      sorted.forEach((item, index) => {
        nextById[item.id].yRatio = firstCenter + step * index - item.heightRatio / 2;
      });
    }

    updateTemplate(activeTemplate.templateId, {
      variables: activeTemplate.variables.map((item) => {
        const next = nextById[item.id];
        if (!next) return item;
        return {
          ...item,
          xRatio: clampNumber(next.xRatio, 0, 1 - item.widthRatio),
          yRatio: clampNumber(next.yRatio, 0, 1 - item.heightRatio),
        };
      }),
    });
  }

  async function handleCsvUpload(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      setStatus(t("status.fileTooLarge"));
      return;
    }
    try {
      const decoded = await decodeCsvFile(file, csvUploadEncoding);
      const result = Papa.parse(decoded.text, { header: true, skipEmptyLines: true });
      if (result.errors?.length) throw new Error(result.errors[0].message);
      const id = crypto.randomUUID();
      const fields = result.meta.fields ?? [];
      const dataset = {
        id,
        name: file.name.replace(/\.csv$/i, ""),
        fileName: file.name,
        headers: fields,
        rows: result.data,
        encoding: decoded.encoding,
        encodingDetected: decoded.detected,
        createdAt: new Date().toISOString(),
      };
      setCsvDatasets((items) => [dataset, ...items]);
      setActiveCsvId(id);
      setPreviewCsvId("");
      setSelectedRowIds(result.data.map((_, index) => String(index)));
      setRowCopies(result.data.reduce((copies, _row, index) => ({ ...copies, [index]: 1 }), {}));
      setView(workMode === "print" ? "csv" : "designer");
      setStatus(t("status.csvSaved", { count: result.data.length, encoding: encodingLabel(decoded.encoding, t) }));
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function getActiveTemplatePageSize() {
    if (!activeTemplate?.sourcePdf?.dataBase64) return null;
    const sourceType = activeTemplate.sourcePdf.sourceType ?? "pdf";
    if (sourceType === "image") return activeTemplate.sourcePdf.pageSize ?? pageSize;
    if (pageSize) return pageSize;
    const loadingTask = loadPdfJsDocumentTask(base64ToArrayBuffer(activeTemplate.sourcePdf.dataBase64).slice(0));
    const loaded = await loadingTask.promise;
    const page = await loaded.getPage(activeTemplate.sourcePdf.pageNumber ?? 1);
    const viewport = page.getViewport({ scale: 1 });
    return { width: viewport.width, height: viewport.height };
  }

  async function autoLayout(layoutValue = layout, setLayoutValue = setLayout) {
    if (!activeTemplate?.cropArea) return;
    const templatePageSize = await getActiveTemplatePageSize();
    if (!templatePageSize) return;
    const cropPoints = {
      width: activeTemplate.cropArea.widthRatio * templatePageSize.width,
      height: activeTemplate.cropArea.heightRatio * templatePageSize.height,
    };
    const margin = 18;
    const gap = 8;
    const candidates = ["portrait", "landscape"].map((orientation) => {
      const paper = orientedPaper({ ...layoutValue, orientation });
      const columns = Math.max(1, Math.floor((paper.width - margin * 2 + gap) / (cropPoints.width + gap)));
      const rows = Math.max(1, Math.floor((paper.height - margin * 2 + gap) / (cropPoints.height + gap)));
      return { orientation, rows, columns, slots: rows * columns };
    });
    const best = candidates.sort((a, b) => b.slots - a.slots)[0];
    setLayoutValue((current) => ({
      ...current,
      orientation: best.orientation,
      rows: best.rows,
      columns: best.columns,
      marginX: margin,
      marginY: margin,
      gapX: gap,
      gapY: gap,
      sizeMode: "actual",
      printMode: "auto",
    }));
  }

  function saveDesignTemplateSetup(layoutSnapshot = designLayout) {
    if (!activeTemplate?.templateId) {
      setStatus(t("status.selectTemplateBeforeExport"));
      return;
    }
    const normalizedSnapshot = normalizeLayout(layoutSnapshot);
    updateTemplate(activeTemplate.templateId, {
      savedLayout: normalizedSnapshot,
      savedAt: new Date().toISOString(),
    });
    setDesignLayout(normalizedSnapshot);
    setStatus(t("status.templateSetupSaved", { name: activeTemplate.templateName }));
    setView("template");
  }

  function openDesignerForTemplate(templateId, mode = "crop") {
    const template = templates.find((item) => item.templateId === templateId);
    setActiveTemplateId(templateId);
    if (template?.sourcePdf?.pageNumber) {
      const sourceType = template.sourcePdf.sourceType ?? "pdf";
      setPageNumber(sourceType === "pdf" ? template.sourcePdf.pageNumber : 1);
    }
    setSelection("", []);
    setDragGuides({ x: [], y: [] });
    setDesignerMode(mode);
    setView("designer");
  }

  function removeCrop(templateId) {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) return;
    const ok = window.confirm(t("confirm.removeCrop"));
    if (!ok) return;
    updateTemplate(templateId, { cropArea: null, variables: [] });
    if (templateId === activeTemplateId) {
      setCropRect(null);
      setSelection("", []);
      setDesignerMode("crop");
    }
    setStatus(t("status.cropRemoved"));
  }

  function deleteTemplate(templateId) {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) return;
    const ok = window.confirm(t("confirm.deleteTemplate", { name: template.templateName }));
    if (!ok) return;
    const remaining = templates.filter((item) => item.templateId !== templateId);
    setTemplates(remaining);
    setTemplatePreviewUrls((current) => {
      if (!current[templateId]) return current;
      const next = { ...current };
      delete next[templateId];
      return next;
    });
    setMappings((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`${templateId}::`)),
    ));
    if (activeTemplateId === templateId) {
      const nextTemplate = remaining[0] ?? null;
      setActiveTemplateId(nextTemplate?.templateId ?? "");
      setSelection("", []);
      setCropRect(null);
      setCropPreviewImageUrl("");
      setPdfDoc(null);
      const nextType = nextTemplate?.sourcePdf?.sourceType ?? "pdf";
      setPageNumber(nextType === "pdf" ? (nextTemplate?.sourcePdf?.pageNumber ?? 1) : 1);
      setPageCount(0);
      setPageSize(null);
    }
    setStatus(t("status.templateDeleted", { name: template.templateName }));
  }

  function deleteCsvDataset(csvId) {
    const dataset = csvDatasets.find((item) => item.id === csvId);
    if (!dataset) return;
    const ok = window.confirm(t("confirm.deleteCsv", { name: dataset.name }));
    if (!ok) return;
    const remaining = csvDatasets.filter((item) => item.id !== csvId);
    setCsvDatasets(remaining);
    setMappings((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.endsWith(`::${csvId}`)),
    ));
    if (previewCsvId === csvId) setPreviewCsvId("");
    if (activeCsvId === csvId) {
      const nextDataset = remaining[0] ?? null;
      setActiveCsvId(nextDataset?.id ?? "");
      setSelectedRowIds(nextDataset ? nextDataset.rows.map((_, index) => String(index)) : []);
      setRowCopies(nextDataset ? nextDataset.rows.reduce((copies, _row, index) => ({ ...copies, [index]: 1 }), {}) : {});
    }
    setStatus(t("status.csvDeleted", { name: dataset.name }));
  }

  function exportTemplateFile(templateId) {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) return;
    const templateMappingEntries = Object.fromEntries(
      Object.entries(mappings).filter(([key]) => key === templateId || key.startsWith(`${templateId}::`)),
    );
    const packageData = {
      format: "printtpl-json-v2",
      exportedAt: new Date().toISOString(),
      template: {
        templateId: template.templateId,
        templateName: template.templateName,
        sourcePdf: template.sourcePdf,
        cropArea: template.cropArea,
        printSizeCm: template.printSizeCm ?? null,
        savedLayout: template.savedLayout ?? null,
        csvHeaderMapping: sanitizeTemplateCsvHeaderMapping(template.csvHeaderMapping ?? {}),
        rules: Array.isArray(template.rules) ? template.rules : [],
        savedAt: template.savedAt ?? "",
        variables: template.variables,
      },
      settings: {
        layout: normalizeLayout(template.savedLayout ?? (workMode === "design" ? designLayout : layout)),
        mappings: templateMappingEntries,
      },
    };
    const blob = new Blob([JSON.stringify(packageData, null, 2)], { type: "application/json" });
    const fileName = `${safeFileName(template.templateName || "template")}.printtpl`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importTemplateFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const imported = parsed?.template;
      if (!imported?.sourcePdf?.dataBase64 || !Array.isArray(imported?.variables)) {
        throw new Error(t("status.templateImportInvalid"));
      }
      const importedLayout = normalizeLayout(imported.savedLayout ?? parsed?.settings?.layout ?? parsed?.layout ?? null);
      const nextTemplateId = crypto.randomUUID();
      const importedTemplateId = imported.templateId || "";
      const directMapping = sanitizeTemplateCsvHeaderMapping(imported.csvHeaderMapping);
      const legacyFallbackMapping = extractLegacyTemplateMapping(parsed?.settings?.mappings, importedTemplateId);
      const nextTemplate = {
        templateId: nextTemplateId,
        templateName: imported.templateName || file.name.replace(/\.printtpl$/i, ""),
        sourcePdf: imported.sourcePdf,
        cropArea: imported.cropArea ?? null,
        printSizeCm: imported.printSizeCm ?? null,
        savedLayout: importedLayout,
        csvHeaderMapping: Object.keys(directMapping).length ? directMapping : legacyFallbackMapping,
        rules: Array.isArray(imported.rules) ? imported.rules : [],
        savedAt: imported.savedAt ?? "",
        variables: imported.variables,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setTemplates((items) => [nextTemplate, ...items]);
      if (imported.savedPreviewImageUrl) {
        void setTemplatePreviewUrl(nextTemplateId, imported.savedPreviewImageUrl);
      }
      setActiveTemplateId(nextTemplate.templateId);
      if (importedLayout) {
        if (workMode === "design") setDesignLayout(importedLayout);
        else setLayout(importedLayout);
      }
      setStatus(t("status.templateImported", { name: nextTemplate.templateName }));
    } catch (error) {
      setStatus(error.message || t("status.templateImportInvalid"));
    }
  }

  async function generatePdf({ openAfter = false, downloadAfter = false } = {}) {
    if (!activeTemplate?.sourcePdf?.dataBase64 || !activeTemplate.cropArea) {
      setStatus(t("status.selectTemplateBeforeExport"));
      return "";
    }
    const sourceType = activeTemplate.sourcePdf.sourceType ?? "pdf";
    if (!activeTemplate.variables.length) {
      setStatus(t("status.addVariableBeforeExport"));
      return "";
    }
    setIsGeneratingPdf(true);
    try {
    setStatus(t("status.preparingSourcePdf"));
    const outputDoc = await PDFDocument.create();
    outputDoc.registerFontkit(fontkit);
    setStatus(t("status.loadingExportFonts"));
    const { regularFont, boldFont } = await loadPdfFonts(outputDoc);
    setStatus(t("status.composingPrintablePdf"));
    let cropSize;
    let drawTemplate;
    if (sourceType === "pdf") {
      const sourcePageNumber = activeTemplate.sourcePdf.pageNumber ?? 1;
      let usedRasterCrop = false;
      if (pdfDoc) {
        try {
          const rasterCrop = await renderPdfCropToPng(pdfDoc, sourcePageNumber, activeTemplate.cropArea);
          const embeddedImage = await outputDoc.embedPng(dataUrlToArrayBuffer(rasterCrop.dataUrl));
          cropSize = { width: rasterCrop.width, height: rasterCrop.height };
          drawTemplate = (page, position, metrics) => {
            page.drawImage(embeddedImage, {
              x: position.x,
              y: position.y,
              width: metrics.itemWidth,
              height: metrics.itemHeight,
            });
          };
          usedRasterCrop = true;
        } catch {
          // Fall back to vector embedding below.
        }
      }

      if (!usedRasterCrop) {
        const sourceDoc = await PDFDocument.load(base64ToArrayBuffer(activeTemplate.sourcePdf.dataBase64));
        const sourcePage = sourceDoc.getPages()[sourcePageNumber - 1];
        const sourcePageSize = sourcePage.getSize();
        let crop = pdfCropBoxFromRatios(activeTemplate.cropArea, sourcePageSize.width, sourcePageSize.height);
        if (pdfDoc) {
          try {
            const previewPage = await pdfDoc.getPage(sourcePageNumber);
            const previewViewport = previewPage.getViewport({ scale: 1 });
            crop = pdfCropBoxFromViewport(activeTemplate.cropArea, previewViewport, sourcePageSize.width, sourcePageSize.height);
          } catch {
            // Keep default crop mapping when preview viewport lookup fails.
          }
        }
        const embeddedPage = await outputDoc.embedPage(sourcePage, {
          left: crop.x,
          bottom: crop.y,
          right: crop.x + crop.width,
          top: crop.y + crop.height,
        });
        cropSize = { width: crop.width, height: crop.height };
        drawTemplate = (page, position, metrics) => {
          page.drawPage(embeddedPage, {
            x: position.x,
            y: position.y,
            width: metrics.itemWidth,
            height: metrics.itemHeight,
          });
        };
      }
    } else {
      const sourceImage = await loadImageElement(sourceDataUrl(activeTemplate.sourcePdf));
      const imageWidth = Math.max(1, sourceImage.naturalWidth || sourceImage.width || 1);
      const imageHeight = Math.max(1, sourceImage.naturalHeight || sourceImage.height || 1);
      const cropX = clampNumber(Math.round(activeTemplate.cropArea.xRatio * imageWidth), 0, imageWidth - 1);
      const cropY = clampNumber(Math.round(activeTemplate.cropArea.yRatio * imageHeight), 0, imageHeight - 1);
      const cropWidth = clampNumber(Math.round(activeTemplate.cropArea.widthRatio * imageWidth), 1, imageWidth - cropX);
      const cropHeight = clampNumber(Math.round(activeTemplate.cropArea.heightRatio * imageHeight), 1, imageHeight - cropY);
      const cropCanvas = document.createElement("canvas");
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropContext = cropCanvas.getContext("2d", { willReadFrequently: false });
      if (!cropContext) throw new Error(t("status.imageCropExportFailed"));
      cropContext.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const croppedDataUrl = cropCanvas.toDataURL("image/png");
      const embeddedImage = await outputDoc.embedPng(dataUrlToArrayBuffer(croppedDataUrl));
      cropSize = { width: cropWidth, height: cropHeight };
      drawTemplate = (page, position, metrics) => {
        page.drawImage(embeddedImage, {
          x: position.x,
          y: position.y,
          width: metrics.itemWidth,
          height: metrics.itemHeight,
        });
      };
    }
    const layoutForOutput = workMode === "print"
      ? normalizeLayout(activeTemplate?.savedLayout ?? layout)
      : normalizeLayout(layout);
    const printMetrics = getPrintMetrics(layoutForOutput, cropSize, activeTemplate.printSizeCm);
    if (!printMetrics.valid) {
      setStatus(t("status.layoutInvalid", { message: printMetrics.errors.join(" ") }));
      return "";
    }
    const printableRows = getPrintableRowEntries(activeCsv, selectedRowIds);
    const records = expandRowEntries(printableRows.length ? printableRows : [{ row: {}, index: 0 }], rowCopies).map((entry) => entry.row);
    let outputPage = outputDoc.addPage([printMetrics.paper.width, printMetrics.paper.height]);
    records.forEach((row, index) => {
      const slot = index % printMetrics.slotsPerPage;
      if (index > 0 && slot === 0) outputPage = outputDoc.addPage([printMetrics.paper.width, printMetrics.paper.height]);
      const position = printMetrics.slotPosition(slot);
      drawTemplate(outputPage, position, printMetrics);
      if (layoutForOutput.printBorderEnabled) {
        drawTemplateBorder(outputPage, position.x, position.y, printMetrics.itemWidth, printMetrics.itemHeight, layoutForOutput.printBorderStyle, layoutForOutput.printBorderWidth);
      }
      activeTemplate.variables.forEach((variable) => {
        const source = activeMapping[variable.id];
        const value = resolveMappedValue(source, row, activeTemplate.rules ?? [], variable.key);
        const text = String(value !== "" ? value : variable.displayName ?? "");
        const drawFont = variable.style.fontWeight === "bold" ? boldFont : regularFont;
        const textRotation = normalizeTextRotation(variable.style.textRotation);
        const box = {
          x: position.x + variable.xRatio * printMetrics.itemWidth,
          y: position.y + printMetrics.itemHeight - (variable.yRatio + variable.heightRatio) * printMetrics.itemHeight,
          width: variable.widthRatio * printMetrics.itemWidth,
          height: variable.heightRatio * printMetrics.itemHeight,
        };
        const baseSize = Math.max(4, variable.style.fontSize * printMetrics.variableScale);
        const fitWidth = textRotation === 90 || textRotation === 270 ? box.height : box.width;
        const fitHeight = textRotation === 90 || textRotation === 270 ? box.width : box.height;
        const size = fitFontSize(text, baseSize, fitWidth, fitHeight, variable.style.autoFit, drawFont);
        const textWidth = drawFont.widthOfTextAtSize(text, size);
        if (variable.style.backgroundColor && variable.style.backgroundColor !== "transparent") {
          outputPage.drawRectangle({
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            color: hexToRgb(variable.style.backgroundColor),
          });
        }
        const textOrigin = rotatedTextOrigin(box, textWidth, size, variable.style.textAlign, variable.style.verticalAlign, textRotation);
        outputPage.drawText(text, {
          x: textOrigin.x,
          y: textOrigin.y,
          size,
          font: drawFont,
          rotate: degrees(textRotation),
          color: hexToRgb(variable.style.color),
        });
      });
    });
    const bytes = await outputDoc.save();
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    const nextUrl = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setExportUrl(nextUrl);
    setStatus(t("status.printablePdfGenerated"));
    if (openAfter) {
      const printWindow = window.open(nextUrl, "_blank");
      if (printWindow) {
        const triggerPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {
            // Browser PDF viewers may delay readiness; best-effort only.
          }
        };
        printWindow.addEventListener("load", triggerPrint, { once: true });
        window.setTimeout(triggerPrint, 800);
      } else {
        setStatus(t("status.printTabBlocked"));
      }
    }
    if (downloadAfter) downloadBlobUrl(nextUrl, "template-print-output.pdf");
    return nextUrl;
    } finally {
      setIsGeneratingPdf(false);
    }
  }

  const cropDebug = cropRect && pageSize ? {
    screen: cropRect,
    ratios: normalizeRect(cropRect, renderBox.width || 1, renderBox.height || 1),
    pdf: pdfCropBoxFromRatios(normalizeRect(cropRect, renderBox.width || 1, renderBox.height || 1), pageSize.width, pageSize.height),
  } : null;

  const navItems = workMode === "print" ? NAV_PRINT : NAV_DESIGN;
  const flowItems = workMode === "print" ? FLOW_PRINT : FLOW_DESIGN;
  const pageTitle = t(navItems.find((item) => item.id === view)?.titleKey ?? "page.templates.title");
  const flowStatus = getFlowStatus(workMode, activeTemplate, activeCsv, activeMapping, selectedRowIds);

  if (!workMode) {
    return (
      <div className="app-shell">
        <main className="main mode-home-main">
          <HomeModePage
            t={t}
            language={language}
            setLanguage={setLanguage}
            onDesign={() => {
              setWorkMode("design");
              setView("setup");
            }}
            onPrint={() => {
              setWorkMode("print");
              setView("template");
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <main className="main">
        <div className="top-chrome" ref={topChromeRef}>
          <header className="page-header">
            <div className="page-heading">
              <FileText size={28} />
              <div>
                <p className="eyebrow">
                  {t("app.title")}
                  <span className="app-version">{APP_VERSION}</span>
                </p>
                <h2>{pageTitle}</h2>
              </div>
            </div>
            <div className="header-actions">
              {status && <p className="status">{status}</p>}
              <button onClick={() => setWorkMode("")}>{t("button.switchMode")}</button>
              <button className="danger" onClick={clearAllSavedData}>{t("button.clearAllData")}</button>
              <label className="language-select">
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="en">{t("language.en")}</option>
                  <option value="ja">{t("language.ja")}</option>
                </select>
              </label>
            </div>
          </header>
          <FlowBar view={view} setView={setView} flowStatus={flowStatus} steps={flowItems} t={t} />
        </div>

        {workMode === "design" && view === "setup" && (
          <SetupPage
            templates={templates}
            activeTemplateId={activeTemplateId}
            setActiveTemplateId={setActiveTemplateId}
            updateTemplate={updateTemplate}
            onPdfUpload={handleTemplateSourceUpload}
            setupSourceKind={setupSourceKind}
            setSetupSourceKind={setSetupSourceKind}
            onCreateTemplateFromActivePdf={createTemplateFromActivePdf}
            canCreateFromActivePdf={Boolean(activeTemplate?.sourcePdf?.dataBase64)}
            openDesignerForTemplate={openDesignerForTemplate}
            removeCrop={removeCrop}
            deleteTemplate={deleteTemplate}
            setupDropActive={setupDropActive}
            onSourceDragEnter={(event) => handleSourceDragEnter(event, setSetupDropActive, setupDragDepthRef)}
            onSourceDragOver={(event) => handleSourceDragOver(event, setSetupDropActive)}
            onSourceDragLeave={(event) => handleSourceDragLeave(event, setSetupDropActive, setupDragDepthRef)}
            onSourceDrop={(event) => handleSourceDrop(event, setSetupDropActive, setupDragDepthRef)}
            t={t}
          />
        )}
        {workMode === "design" && view === "designer" && (
          <DesignerPage
            templates={templates}
            activeTemplateId={activeTemplateId}
            setActiveTemplateId={setActiveTemplateId}
            template={activeTemplate}
            designerMode={designerMode}
            setDesignerMode={setDesignerMode}
            canvasRef={canvasRef}
            overlayRef={overlayRef}
            renderBox={renderBox}
            cropRect={cropRect}
            cropDebug={cropDebug}
            pdfZoom={pdfZoom}
            setPdfZoom={setPdfZoom}
            fieldZoom={fieldZoom}
            setFieldZoom={setFieldZoom}
            pageNumber={pageNumber}
            pageCount={pageCount}
            setPageNumber={setPageNumber}
            beginCropCreate={beginCropCreate}
            beginCropDrag={beginCropDrag}
            saveCrop={saveCropWithPrintSize}
            clearCrop={() => setCropRect(null)}
            onPdfUpload={handleTemplateSourceUpload}
            cropPreviewRef={setCropPreviewNode}
            selectedVariableId={selectedVariableId}
            selectedVariableIds={selectedVariableIds}
            setSelectedVariableId={setSelectedVariableId}
            setSelection={setSelection}
            selectedVariable={selectedVariable}
            beginVariableDrag={beginVariableDrag}
            addVariable={addVariable}
            duplicateVariable={duplicateVariable}
            deleteVariable={deleteVariable}
            updateVariable={updateSelectedVariable}
            mapping={activeMapping}
            updateVariableSource={updateSelectedVariableSource}
            updateVariableStyle={updateSelectedVariableStyle}
            rules={activeTemplate?.rules ?? []}
            cropPreviewImageUrl={cropPreviewImageUrl}
            cropPreviewDisplaySize={cropPreviewDisplaySize}
            dragGuides={dragGuides}
            snapEnabled={snapEnabled}
            setSnapEnabled={setSnapEnabled}
            canUndo={historyState.undoCount > 0}
            canRedo={historyState.redoCount > 0}
            undoChange={undoChange}
            redoChange={redoChange}
            alignSelected={applySelectedVariableLayout}
            designerDropActive={designerDropActive}
            onSourceDragEnter={(event) => handleSourceDragEnter(event, setDesignerDropActive, designerDragDepthRef)}
            onSourceDragOver={(event) => handleSourceDragOver(event, setDesignerDropActive)}
            onSourceDragLeave={(event) => handleSourceDragLeave(event, setDesignerDropActive, designerDragDepthRef)}
            onSourceDrop={(event) => handleSourceDrop(event, setDesignerDropActive, designerDragDepthRef)}
            printSizeCm={activeTemplate?.printSizeCm ?? null}
            resizeCropRectToPrintSize={(next) => {
              if (!cropRect || !pageSize || !renderBox.width || !renderBox.height) return;
              const width = Math.max(1, (cmToPoints(next.width) / pageSize.width) * renderBox.width);
              const height = Math.max(1, (cmToPoints(next.height) / pageSize.height) * renderBox.height);
              setCropRect(clampRect({ ...cropRect, width, height }, renderBox.width, renderBox.height));
            }}
            pageSize={pageSize}
            t={t}
          />
        )}
        {workMode === "design" && view === "rules" && (
          <RulesPage
            template={activeTemplate}
            updateTemplate={updateTemplate}
            activeTemplateId={activeTemplateId}
            t={t}
          />
        )}
        {workMode === "print" && view === "csv" && (
          <CsvPage
            datasets={csvDatasets}
            activeCsvId={activeCsvId}
            setActiveCsvId={setActiveCsvId}
            previewCsvId={previewCsvId}
            setPreviewCsvId={setPreviewCsvId}
            onCsvUpload={handleCsvUpload}
            deleteCsvDataset={deleteCsvDataset}
            csvUploadEncoding={csvUploadEncoding}
            setCsvUploadEncoding={setCsvUploadEncoding}
            t={t}
          />
        )}
        {view === "layout" && (
          <LayoutPage
            workMode={workMode}
            template={activeTemplate}
            dataset={workMode === "print" ? activeCsv : null}
            mapping={workMode === "print" ? activeMapping : {}}
            templates={templates}
            activeTemplateId={activeTemplateId}
            setActiveTemplateId={setActiveTemplateId}
            csvDatasets={csvDatasets}
            activeCsvId={activeCsvId}
            setActiveCsvId={setActiveCsvId}
            selectedRowIds={workMode === "print" ? selectedRowIds : []}
            setSelectedRowIds={setSelectedRowIds}
            rowCopies={workMode === "print" ? rowCopies : {}}
            setRowCopies={setRowCopies}
            cropPreviewRef={setCropPreviewNode}
            layout={workMode === "print" ? effectivePrintLayout : designLayout}
            setLayout={workMode === "print" ? setLayout : setDesignLayout}
            autoLayout={() => autoLayout(workMode === "print" ? layout : designLayout, workMode === "print" ? setLayout : setDesignLayout)}
            generatePdf={generatePdf}
            saveDesignTemplateSetup={saveDesignTemplateSetup}
            exportUrl={exportUrl}
            isGeneratingPdf={isGeneratingPdf}
            previewOpen={printPreviewOpen}
            setPreviewOpen={setPrintPreviewOpen}
            cropPreviewImageUrl={cropPreviewImageUrl}
            setView={setView}
            pageSize={pageSize}
            t={t}
          />
        )}
        {view === "template" && (
          <TemplatePackagePage
            workMode={workMode}
            language={language}
            templates={templates}
            templatePreviewUrls={templatePreviewUrls}
            activeTemplateId={activeTemplateId}
            setActiveTemplateId={setActiveTemplateId}
            updateTemplate={updateTemplate}
            deleteTemplate={deleteTemplate}
            exportTemplateFile={exportTemplateFile}
            importTemplateFile={importTemplateFile}
            flowStatus={flowStatus}
            t={t}
          />
        )}
      </main>
    </div>
  );
}

function RulesPage({ template, updateTemplate, activeTemplateId, t }) {
  const [draft, setDraft] = useState(() => createEmptyRule());
  const [editingId, setEditingId] = useState("");
  const rules = Array.isArray(template?.rules) ? template.rules : [];

  function commitDraft() {
    if (!template || !template.templateId) return;
    const trimmedName = String(draft.name ?? "").trim();
    if (!trimmedName) return;
    const nextRule = {
      id: editingId || crypto.randomUUID(),
      name: trimmedName,
      delimiter: draft.delimiter || "space",
      customDelimiter: draft.customDelimiter || "",
      action: draft.action || "last-token",
      tokenIndex: Number(draft.tokenIndex ?? 0) || 0,
      fallback: draft.fallback || "",
    };
    const nextRules = editingId
      ? rules.map((rule) => (rule.id === editingId ? nextRule : rule))
      : [...rules, nextRule];
    updateTemplate(template.templateId, { rules: nextRules });
    setDraft(createEmptyRule());
    setEditingId("");
  }

  function removeRule(ruleId) {
    if (!template) return;
    updateTemplate(template.templateId, { rules: rules.filter((rule) => rule.id !== ruleId) });
    if (editingId === ruleId) {
      setEditingId("");
      setDraft(createEmptyRule());
    }
  }

  return (
    <section className="page-grid two-column">
      <div className="section-card">
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{t("page.rules.title")}</h3>
            <p className="muted">{t("rules.help")}</p>
          </div>
        </div>
        <div className="rule-list">
          {rules.length === 0 ? <p className="muted">{t("rules.empty")}</p> : null}
          {rules.map((rule) => (
            <button
              key={rule.id}
              className={`rule-row ${editingId === rule.id ? "active" : ""}`}
              onClick={() => {
                setEditingId(rule.id);
                setDraft({
                  name: rule.name || "",
                  delimiter: rule.delimiter || "space",
                  customDelimiter: rule.customDelimiter || "",
                  action: rule.action || "last-token",
                  tokenIndex: rule.tokenIndex ?? 0,
                  fallback: rule.fallback || "",
                });
              }}
            >
              <span>{rule.name}</span>
              <small>{rule.action}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="section-card">
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{editingId ? t("rules.edit") : t("rules.add")}</h3>
          </div>
        </div>
        <div className="form-stack rule-editor">
          <label>
            {t("rules.name")}
            <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
          </label>
          <label>
            {t("rules.delimiter")}
            <select value={draft.delimiter} onChange={(event) => setDraft((current) => ({ ...current, delimiter: event.target.value }))}>
              <option value="space">{t("rules.delimiter.space")}</option>
              <option value="comma">{t("rules.delimiter.comma")}</option>
              <option value="dot">{t("rules.delimiter.dot")}</option>
              <option value="custom">{t("rules.delimiter.custom")}</option>
            </select>
          </label>
          {draft.delimiter === "custom" ? (
            <label>
              {t("rules.customDelimiter")}
              <input value={draft.customDelimiter} onChange={(event) => setDraft((current) => ({ ...current, customDelimiter: event.target.value }))} />
            </label>
          ) : null}
          <label>
            {t("rules.action")}
            <select value={draft.action} onChange={(event) => setDraft((current) => ({ ...current, action: event.target.value }))}>
              {ROW_RULE_ACTIONS.map((action) => (
                <option key={action.value} value={action.value}>{t(action.labelKey)}</option>
              ))}
            </select>
          </label>
          {draft.action === "index-token" ? (
            <label>
              {t("rules.tokenIndex")}
              <input type="number" min="0" value={draft.tokenIndex} onChange={(event) => setDraft((current) => ({ ...current, tokenIndex: Number(event.target.value) || 0 }))} />
            </label>
          ) : null}
          <label>
            {t("rules.fallback")}
            <input
              value={draft.fallback}
              placeholder={t("rules.fallbackPlaceholder")}
              onChange={(event) => setDraft((current) => ({ ...current, fallback: event.target.value }))}
            />
            <small className="muted">{t("rules.fallbackHelp")}</small>
          </label>
          <div className="field-editor-actions">
            <button className="primary" onClick={commitDraft}>{t("button.save")}</button>
            {editingId ? (
              <button className="danger" onClick={() => removeRule(editingId)}>{t("button.delete")}</button>
            ) : null}
            {editingId ? (
              <button onClick={() => {
                setEditingId("");
                setDraft(createEmptyRule());
              }}>{t("button.close")}</button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function createEmptyRule() {
  return {
    name: "",
    delimiter: "space",
    customDelimiter: "",
    action: "last-token",
    tokenIndex: 0,
    fallback: "",
  };
}

function TemplatePackagePage({ workMode, language, templates, templatePreviewUrls, activeTemplateId, setActiveTemplateId, updateTemplate, deleteTemplate, exportTemplateFile, importTemplateFile, flowStatus, t }) {
  return (
    <section className="page-grid single-column">
      <div className="section-card">
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{t("page.templatePackage.title")}</h3>
            <p className="muted">{t(workMode === "print" ? "templates.printSelectionHelp" : "templates.packageHelp")}</p>
            <p className="muted">{t("templates.packageStatus", { status: t(`templates.status.${flowStatus.template}`) })}</p>
          </div>
          <label className={`button ui-button ${workMode === "print" ? "" : "primary"}`}>
            <Upload size={16} /> {t("button.uploadTemplate")}
            <input type="file" accept=".printtpl,application/json" onChange={importTemplateFile} />
          </label>
        </div>
        <div className="template-list">
          {templates.length === 0 && <EmptyState title={t("source.noTemplates")} text={t("source.noTemplatesText")} />}
          {templates.map((template) => (
            <article key={template.templateId} className={`template-row ${template.templateId === activeTemplateId ? "active" : ""}`}>
              <button className="template-row-main" onClick={() => setActiveTemplateId(template.templateId)}>
                {templatePreviewUrls[template.templateId] ? <img className="template-row-thumb" src={templatePreviewUrls[template.templateId]} alt="" loading="lazy" decoding="async" /> : null}
                <span>{template.sourcePdf.fileName}</span>
                <span>
                  {t("source.page")} {template.sourcePdf.pageNumber ?? 1} · {template.cropArea ? t("source.cropSaved") : t("source.needsCrop")} · {template.variables.length} {t("source.variables")}
                </span>
                {template.savedAt ? <span>{t("templates.savedSetupAt", { time: formatLocalDateTime(template.savedAt, language) })}</span> : null}
              </button>
              <input
                className="template-name-input"
                value={template.templateName}
                onChange={(event) => updateTemplate(template.templateId, { templateName: event.target.value })}
              />
              <div className="template-row-actions">
                <button onClick={() => exportTemplateFile(template.templateId)}>
                  <ArrowDownToLine size={16} /> {t("button.saveTemplatePackage")}
                </button>
                <button
                  className="danger"
                  aria-label={t("button.deleteTemplate")}
                  title={t("button.deleteTemplate")}
                  onClick={() => deleteTemplate(template.templateId)}
                >
                  <Trash2 size={16} /> {t("button.deleteTemplate")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SetupPage({
  templates,
  activeTemplateId,
  setActiveTemplateId,
  updateTemplate,
  onPdfUpload,
  setupSourceKind,
  setSetupSourceKind,
  onCreateTemplateFromActivePdf,
  canCreateFromActivePdf,
  openDesignerForTemplate,
  removeCrop,
  deleteTemplate,
  setupDropActive,
  onSourceDragEnter,
  onSourceDragOver,
  onSourceDragLeave,
  onSourceDrop,
  t,
}) {
  const sourceAccept = setupSourceKind === "pdf" ? "application/pdf" : "image/jpeg,image/png,image/svg+xml,image/webp";
  const sourceHint = setupSourceKind === "pdf" ? t("source.designPdfHint") : t("source.designImageHint");
  const sourceDropHint = setupSourceKind === "pdf" ? t("source.dropHintSetupPdf") : t("source.dropHintSetupImage");
  return (
    <section className="setup-grid single-column">
      <div
        className={`section-card drop-zone ${setupDropActive ? "drop-zone-active" : ""}`}
        onDragEnter={onSourceDragEnter}
        onDragOver={onSourceDragOver}
        onDragLeave={onSourceDragLeave}
        onDrop={onSourceDrop}
      >
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{t("page.templates.title")}</h3>
            <p className="muted">{t("templates.savedLocalText")}</p>
          </div>
          <button className="uniform-action-button ui-button" disabled={!canCreateFromActivePdf} onClick={onCreateTemplateFromActivePdf}>
            <Plus size={16} /> {t("button.newCrop")}
          </button>
        </div>
        <div className="source-choice-row">
          <button className={setupSourceKind === "pdf" ? "active" : ""} onClick={() => setSetupSourceKind("pdf")}>{t("source.kindPdf")}</button>
          <button className={setupSourceKind === "image" ? "active" : ""} onClick={() => setSetupSourceKind("image")}>{t("source.kindImage")}</button>
        </div>
        <label className="source-upload-area" title={sourceHint}>
          <input type="file" accept={sourceAccept} onChange={onPdfUpload} />
          <strong>{t("button.addSource")}</strong>
          <span>{sourceHint}</span>
        </label>
        {setupDropActive && <p className="drop-zone-hint">{sourceDropHint}</p>}
        <div className="template-list">
          {templates.length === 0 && <EmptyState title={t("source.noTemplates")} text={t("source.noTemplatesText")} />}
          {templates.map((template) => (
            <article key={template.templateId} className={`template-row ${template.templateId === activeTemplateId ? "active" : ""}`}>
              <button className="template-row-main" onClick={() => setActiveTemplateId(template.templateId)}>
                <span>{template.sourcePdf.fileName}</span>
                <span>
                  {t("source.page")} {template.sourcePdf.pageNumber ?? 1} · {template.cropArea ? t("source.cropSaved") : t("source.needsCrop")} · {template.variables.length} {t("source.variables")}
                </span>
              </button>
              <input
                className="template-name-input"
                value={template.templateName}
                onChange={(event) => updateTemplate(template.templateId, { templateName: event.target.value })}
              />
              <div className="template-row-actions">
                <button
                  aria-label={template.cropArea ? t("source.editDesign") : t("source.designCrop")}
                  title={template.cropArea ? t("source.editDesign") : t("source.designCrop")}
                  onClick={() => openDesignerForTemplate(template.templateId, template.cropArea ? "fields" : "crop")}
                >
                  <MousePointer2 size={16} /> {template.cropArea ? t("source.editDesign") : t("source.designCrop")}
                </button>
                <button
                  aria-label={t("source.showCrop")}
                  title={t("source.showCrop")}
                  disabled={!template.cropArea}
                  onClick={() => openDesignerForTemplate(template.templateId, "fields")}
                >
                  <Eye size={16} /> {t("source.showCrop")}
                </button>
                <button
                  aria-label={t("source.removeCrop")}
                  className="danger"
                  title={t("source.removeCrop")}
                  disabled={!template.cropArea}
                  onClick={() => removeCrop(template.templateId)}
                >
                  <X size={16} /> {t("source.removeCrop")}
                </button>
                <button
                  aria-label={t("button.deleteTemplate")}
                  className="danger"
                  title={t("button.deleteTemplate")}
                  onClick={() => deleteTemplate(template.templateId)}
                >
                  <Trash2 size={16} /> {t("button.deleteTemplate")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function SidebarActions({ onPdfUpload, onCreateTemplateFromActivePdf, canCreateFromActivePdf, onCsvUpload, t = (key) => key }) {
  return (
    <div className="sidebar-actions">
      <div className="quick-actions">
        <label className="button primary icon-button" title={t("title.uploadSourceFile")}>
          <Upload size={16} />
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/svg+xml,image/webp" onChange={onPdfUpload} />
        </label>
        <button className="icon-button" title={t("title.createTemplateFromSource")} disabled={!canCreateFromActivePdf} onClick={onCreateTemplateFromActivePdf}>
          <Plus size={16} />
        </button>
        <label className="button icon-button" title={t("title.uploadCsvDataset")}>
          <Table size={16} />
          <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} />
        </label>
      </div>
    </div>
  );
}

function ContextSummary({ template, dataset, setView, t = (key) => key }) {
  return (
    <div className="context-summary">
      <button onClick={() => setView("template")} title={t("title.changeTemplateInPrintJob")}>
        <span>{t("common.template")}</span>
        <strong>{template?.templateName ?? t("common.none")}</strong>
      </button>
      <button onClick={() => setView("csv")} title={t("title.changeCsvInPrintJob")}>
        <span>{t("common.csv")}</span>
        <strong>{dataset?.name ?? t("common.none")}</strong>
      </button>
    </div>
  );
}

function LibraryPanel(props) {
  const {
    templates,
    activeTemplateId,
    setActiveTemplateId,
    csvDatasets,
    activeCsvId,
    setActiveCsvId,
    onPdfUpload,
    onCreateTemplateFromActivePdf,
    canCreateFromActivePdf,
    onCsvUpload,
    t = (key) => key,
  } = props;
  return (
    <div className="library-panel">
      <div className="quick-actions">
        <label className="button primary icon-button" title={t("title.uploadSourceFile")}>
          <Upload size={16} />
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/svg+xml,image/webp" onChange={onPdfUpload} />
        </label>
        <button className="icon-button" title={t("title.createTemplateFromSource")} disabled={!canCreateFromActivePdf} onClick={onCreateTemplateFromActivePdf}>
          <Plus size={16} />
        </button>
        <label className="button icon-button" title={t("title.uploadCsvDataset")}>
          <Table size={16} />
          <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} />
        </label>
      </div>
      <label className="library-select">
        <span>{t("library.activeTemplate")}</span>
        <select className="ui-select" value={activeTemplateId} onChange={(event) => setActiveTemplateId(event.target.value)}>
          {templates.length === 0 && <option value="">{t("library.noTemplates")}</option>}
          {templates.map((template) => (
            <option key={template.templateId} value={template.templateId}>
              {template.templateName} · {t("library.varsShort", { count: template.variables.length })}
            </option>
          ))}
        </select>
      </label>
      <label className="library-select">
        <span>{t("library.activeCsv")}</span>
        <select className="ui-select" value={activeCsvId} onChange={(event) => setActiveCsvId(event.target.value)}>
          {csvDatasets.length === 0 && <option value="">{t("library.noCsvDataset")}</option>}
          {csvDatasets.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name} · {t("csv.rows", { count: dataset.rows.length })}
            </option>
          ))}
        </select>
      </label>
      <div className="library-summary">
        <strong>{templates.find((template) => template.templateId === activeTemplateId)?.templateName ?? t("common.noTemplate")}</strong>
        <span>{t("library.summary", { templates: templates.length, csvs: csvDatasets.length })}</span>
      </div>
    </div>
  );
}

function HeaderSelectors({ templates, activeTemplateId, setActiveTemplateId, csvDatasets, activeCsvId, setActiveCsvId, t = (key) => key }) {
  return (
    <div className="header-selectors">
      <label>
        <span>{t("common.template")}</span>
        <select className="ui-select" value={activeTemplateId} onChange={(event) => setActiveTemplateId(event.target.value)}>
          {templates.length === 0 && <option value="">{t("common.noTemplate")}</option>}
          {templates.map((template) => (
            <option key={template.templateId} value={template.templateId}>
              {template.templateName}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t("common.csv")}</span>
        <select className="ui-select" value={activeCsvId} onChange={(event) => setActiveCsvId(event.target.value)}>
          {csvDatasets.length === 0 && <option value="">{t("common.noCsv")}</option>}
          {csvDatasets.map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function HomeModePage({ t, language, setLanguage, onDesign, onPrint }) {
  return (
    <section className="mode-home">
      <div className="mode-home-card">
        <div className="mode-home-head">
          <h2>{t("home.title")}</h2>
          <label className="language-select mode-home-language-select">
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              <option value="en">{t("language.en")}</option>
              <option value="ja">{t("language.ja")}</option>
            </select>
          </label>
        </div>
        <p className="muted">{t("home.description")}</p>
        <div className="mode-choice-grid">
          <button className="mode-choice" onClick={onDesign}>
            <strong>{t("home.designTitle")}</strong>
            <span>{t("home.designDescription")}</span>
          </button>
          <button className="mode-choice" onClick={onPrint}>
            <strong>{t("home.printTitle")}</strong>
            <span>{t("home.printDescription")}</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function FlowBar({ view, setView, flowStatus, steps, t }) {
  const columnCount = Math.max(steps.length, 1);
  return (
    <div className="flow-bar" style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => {
        const state = flowStatus[step.id] ?? "waiting";
        return (
          <button
            key={step.id}
            className={`${view === step.id ? "active" : ""} ${state}`}
            title={t("tooltip.openPage", { page: t(step.labelKey) })}
            onClick={() => setView(step.id)}
          >
            <span className="flow-index">{index + 1}</span>
            {t(step.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

function DesignerPage(props) {
  const {
    templates,
    activeTemplateId,
    setActiveTemplateId,
    template,
    designerMode,
    setDesignerMode,
    canvasRef,
    overlayRef,
    renderBox,
    cropRect,
    cropDebug,
    pdfZoom,
    setPdfZoom,
    fieldZoom,
    setFieldZoom,
    pageNumber,
    pageCount,
    setPageNumber,
    beginCropCreate,
    beginCropDrag,
    saveCrop,
    clearCrop,
    onPdfUpload,
    cropPreviewRef,
    selectedVariableId,
    selectedVariableIds,
    setSelectedVariableId,
    setSelection,
    selectedVariable,
    beginVariableDrag,
    addVariable,
    duplicateVariable,
    deleteVariable,
    updateVariable,
    mapping,
    updateVariableSource,
    updateVariableStyle,
    cropPreviewImageUrl,
    cropPreviewDisplaySize,
    dragGuides,
    snapEnabled,
    setSnapEnabled,
    canUndo,
    canRedo,
    undoChange,
    redoChange,
    alignSelected,
    designerDropActive,
    onSourceDragEnter,
    onSourceDragOver,
    onSourceDragLeave,
    onSourceDrop,
    printSizeCm,
    resizeCropRectToPrintSize,
    pageSize,
    t,
  } = props;
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const selectionAnchorRef = useRef("");
  const keyStateRef = useRef({ shift: false, ctrlOrMeta: false });
  const hasTemplate = Boolean(template);
  const showCropMode = !template || designerMode === "crop" || !template.cropArea;
  const cropMeasuredSizeCm = useMemo(() => {
    if (!cropRect || !renderBox.width || !renderBox.height || !pageSize) return null;
    const normalizedCrop = normalizeRect(cropRect, renderBox.width, renderBox.height);
    return {
      width: Number(pointsToCmNumber(normalizedCrop.widthRatio * pageSize.width).toFixed(2)),
      height: Number(pointsToCmNumber(normalizedCrop.heightRatio * pageSize.height).toFixed(2)),
    };
  }, [cropRect, renderBox.width, renderBox.height, pageSize]);
  const [cropSizeDraft, setCropSizeDraft] = useState(null);

  useEffect(() => {
    if (!showCropMode) return;
    setCropSizeDraft(printSizeCm ?? cropMeasuredSizeCm ?? null);
  }, [showCropMode, printSizeCm, cropMeasuredSizeCm, template?.templateId]);

  const addField = () => {
    setInspectorOpen(true);
    addVariable();
  };

  function updateCropSizeDraft(next) {
    setCropSizeDraft(next);
    resizeCropRectToPrintSize(next);
  }

  function applySelection(nextPrimaryId, nextIds) {
    const normalized = Array.from(new Set((nextIds || []).filter(Boolean)));
    const primary = nextPrimaryId || normalized[normalized.length - 1] || "";
    if (primary) selectionAnchorRef.current = primary;
    setSelection(primary, normalized);
  }

  function selectVariableRange(targetId, append = false) {
    if (!template?.variables?.length) {
      applySelection(targetId, [targetId]);
      return;
    }
    const orderedIds = template.variables.map((item) => item.id);
    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex === -1) {
      applySelection(targetId, [targetId]);
      return;
    }
    const anchorCandidate = orderedIds.includes(selectionAnchorRef.current)
      ? selectionAnchorRef.current
      : orderedIds.find((id) => selectedVariableIds.includes(id));
    const anchorId = anchorCandidate || targetId;
    const anchorIndex = orderedIds.indexOf(anchorId);
    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const rangeIds = orderedIds.slice(start, end + 1);
    const next = append ? Array.from(new Set([...selectedVariableIds, ...rangeIds])) : rangeIds;
    applySelection(targetId, next);
  }

  useLayoutEffect(() => {
    if (selectedVariableId) {
      selectionAnchorRef.current = selectedVariableId;
      return;
    }
    if (selectedVariableIds.length) {
      selectionAnchorRef.current = selectedVariableIds[selectedVariableIds.length - 1];
    }
  }, [selectedVariableId, selectedVariableIds]);

  useEffect(() => {
    function onKeyChange(event) {
      keyStateRef.current = {
        shift: Boolean(event.shiftKey),
        ctrlOrMeta: Boolean(event.ctrlKey || event.metaKey),
      };
    }
    function onWindowBlur() {
      keyStateRef.current = { shift: false, ctrlOrMeta: false };
    }
    window.addEventListener("keydown", onKeyChange);
    window.addEventListener("keyup", onKeyChange);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyChange);
      window.removeEventListener("keyup", onKeyChange);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, []);

  if (!hasTemplate) return <EmptyUpload onPdfUpload={onPdfUpload} t={t} />;

  return (
    <section className={showCropMode ? "crop-layout" : `editor-layout ${inspectorOpen ? "" : "panel-closed"}`}>
      <div
        className={`canvas-card drop-zone ${designerDropActive && showCropMode ? "drop-zone-active" : ""}`}
        onDragEnter={showCropMode ? onSourceDragEnter : undefined}
        onDragOver={showCropMode ? onSourceDragOver : undefined}
        onDragLeave={showCropMode ? onSourceDragLeave : undefined}
        onDrop={showCropMode ? onSourceDrop : undefined}
      >
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{t("page.designer.title")}</h3>
            <p className="muted">{t("designer.pageHelp")}</p>
          </div>
        </div>
        <div className={`local-toolbar ${showCropMode ? "compact-toolbar" : ""}`}>
          <label className="designer-template-select">
            <span>{t("common.template")}</span>
            <select className="ui-select" value={activeTemplateId} onChange={(event) => setActiveTemplateId(event.target.value)}>
              {templates.map((item) => (
                <option key={item.templateId} value={item.templateId}>{item.templateName}</option>
              ))}
            </select>
          </label>
          <div className="segmented">
            <button className={showCropMode ? "active" : ""} onClick={() => setDesignerMode("crop")}>{t("designer.crop")}</button>
            <button className={!showCropMode ? "active" : ""} disabled={!template.cropArea} onClick={() => setDesignerMode("fields")}>{t("designer.fields")}</button>
          </div>
          {showCropMode ? (
            <>
              <button disabled={pageNumber <= 1} onClick={() => setPageNumber((p) => p - 1)}><ChevronLeft size={16} /> {t("designer.previous")}</button>
              <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber((p) => p + 1)}>{t("designer.next")} <ChevronRight size={16} /></button>
              <span className="meta">{t("source.page")} {pageNumber} / {pageCount || "-"}</span>
              <div className="zoom-controls" aria-label={t("designer.pdfZoomAria")}>
                <button onClick={() => setPdfZoom((zoom) => Math.max(0.5, Number((zoom - 0.25).toFixed(2))))}>-</button>
                <span>{Math.round(pdfZoom * 100)}%</span>
                <button onClick={() => setPdfZoom((zoom) => Math.min(2.5, Number((zoom + 0.25).toFixed(2))))}>+</button>
              </div>
              <label className="designer-size-input">
                <span>{t("designer.printWidthCm")}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  disabled={!cropRect}
                  value={cropSizeDraft ? Number(cropSizeDraft.width || 0).toFixed(1) : ""}
                  onChange={(event) => {
                    const width = Math.max(0.1, Number(event.target.value) || 0.1);
                    updateCropSizeDraft({
                      width,
                      height: Math.max(0.1, Number(cropSizeDraft?.height ?? cropMeasuredSizeCm?.height) || 0.1),
                    });
                  }}
                />
              </label>
              <label className="designer-size-input">
                <span>{t("designer.printHeightCm")}</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  disabled={!cropRect}
                  value={cropSizeDraft ? Number(cropSizeDraft.height || 0).toFixed(1) : ""}
                  onChange={(event) => {
                    const height = Math.max(0.1, Number(event.target.value) || 0.1);
                    updateCropSizeDraft({
                      width: Math.max(0.1, Number(cropSizeDraft?.width ?? cropMeasuredSizeCm?.width) || 0.1),
                      height,
                    });
                  }}
                />
              </label>
              <button onClick={clearCrop}>{t("designer.redrawCrop")}</button>
              <button className="primary" disabled={!cropRect} onClick={() => saveCrop(cropSizeDraft ?? cropMeasuredSizeCm ?? null)}><Save size={16} /> {t("designer.saveCrop")}</button>
              <DebugInline cropDebug={cropDebug} renderBox={renderBox} t={t} />
            </>
          ) : (
            <>
              <button className="primary" onClick={addField}><Plus size={16} /> {t("designer.addField")}</button>
              <button onClick={undoChange} disabled={!canUndo}><ChevronLeft size={16} /> {t("button.undo")}</button>
              <button onClick={redoChange} disabled={!canRedo}><ChevronRight size={16} /> {t("button.redo")}</button>
              <div className="zoom-controls" aria-label={t("designer.fieldsZoomControls")}>
                <button onClick={() => setFieldZoom((zoom) => Math.max(0.5, Number((zoom - 0.1).toFixed(2))))}>-</button>
                <span>{Math.round(fieldZoom * 100)}%</span>
                <button onClick={() => setFieldZoom((zoom) => Math.min(3, Number((zoom + 0.1).toFixed(2))))}>+</button>
              </div>
              <span className="meta">{t("designer.savedFields", { count: template.variables.length })}</span>
              {!inspectorOpen && <button onClick={() => setInspectorOpen(true)}><ListChecks size={16} /> {t("designer.fieldsPanel")}</button>}
            </>
          )}
        </div>
        {showCropMode && designerDropActive && <p className="drop-zone-hint drop-zone-hint-designer">{t("source.dropHintDesigner")}</p>}
        {showCropMode ? (
          <div className="designer-work-scroll">
            <div className="pdf-frame" style={{ width: renderBox.width || "auto" }}>
              <canvas ref={canvasRef} />
              <div
                ref={overlayRef}
                className="overlay"
                style={{ width: renderBox.width, height: renderBox.height }}
                onPointerDown={beginCropCreate}
              >
                {cropRect && <CropBox rect={cropRect} onDrag={beginCropDrag} />}
              </div>
            </div>
          </div>
        ) : (
          <div className="designer-work-scroll">
            <TemplateCanvas
              template={template}
              cropPreviewRef={cropPreviewRef}
              selectedVariableId={selectedVariableId}
              selectedVariableIds={selectedVariableIds}
              setSelectedVariableId={setSelectedVariableId}
              setSelection={setSelection}
              beginVariableDrag={beginVariableDrag}
              cropImageUrl={cropPreviewImageUrl}
              cropPreviewDisplaySize={cropPreviewDisplaySize}
              dragGuides={dragGuides}
            />
          </div>
        )}
      </div>
      {!showCropMode && inspectorOpen && (
        <aside className="inspector">
          <div className="panel-head">
            <div>
              <h3>{t("designer.fields")}</h3>
              <p className="muted">{t("designer.fieldsCount", { count: template.variables.length })}</p>
            </div>
            <button className="icon-button" title={t("designer.closeFieldsPanel")} onClick={() => setInspectorOpen(false)}><X size={16} /></button>
          </div>
          <div className="inspector-tools">
            <div className="inspector-controls-card">
              <label className="snap-toggle">
                <input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} />
                <span>{t("designer.snapToGrid")}</span>
              </label>
              <div className="align-panel" role="toolbar" aria-label={t("designer.fieldAlignTools")}>
                <button className="align-action" title={t("button.alignLeft")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-left")}>{t("button.alignLeftShort")}</button>
                <button className="align-action" title={t("button.alignCenter")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-center")}>{t("button.alignCenterShort")}</button>
                <button className="align-action" title={t("button.alignRight")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-right")}>{t("button.alignRightShort")}</button>
                <button className="align-action" title={t("button.alignTop")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-top")}>{t("button.alignTopShort")}</button>
                <button className="align-action" title={t("button.alignMiddle")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-middle")}>{t("button.alignMiddleShort")}</button>
                <button className="align-action" title={t("button.alignBottom")} disabled={selectedVariableIds.length < 1} onClick={() => alignSelected("align-bottom")}>{t("button.alignBottomShort")}</button>
                <button className="align-action" title={t("button.distributeH")} disabled={selectedVariableIds.length < 3} onClick={() => alignSelected("distribute-h")}>{t("button.distributeHShort")}</button>
                <button className="align-action" title={t("button.distributeV")} disabled={selectedVariableIds.length < 3} onClick={() => alignSelected("distribute-v")}>{t("button.distributeVShort")}</button>
              </div>
            </div>
          </div>
          <div className="variable-list">
            {template.variables.length === 0 && <p className="muted">{t("designer.noFields")}</p>}
            {template.variables.map((variable) => {
              const isSelected = selectedVariableIds.includes(variable.id);
              const handleToggleSingle = () => {
                const next = isSelected
                  ? selectedVariableIds.filter((id) => id !== variable.id)
                  : [...selectedVariableIds, variable.id];
                applySelection(next[next.length - 1] ?? "", next);
              };
              const handleRowSelect = (event) => {
                const shiftHeld = Boolean(event.shiftKey || keyStateRef.current.shift);
                const additiveHeld = Boolean(event.ctrlKey || event.metaKey || keyStateRef.current.ctrlOrMeta);
                if (shiftHeld) {
                  selectVariableRange(variable.id, additiveHeld);
                  return;
                }
                if (additiveHeld) {
                  handleToggleSingle();
                  return;
                }
                if (isSelected && selectedVariableIds.length > 1) {
                  applySelection(variable.id, selectedVariableIds);
                  return;
                }
                applySelection(variable.id, [variable.id]);
              };
              return (
                <div
                  key={variable.id}
                  className={`variable-list-row ${isSelected ? "selected" : ""} ${variable.id === selectedVariableId ? "active" : ""}`}
                  onClick={(event) => {
                    const target = event.target;
                    if (!(target instanceof HTMLElement)) return;
                    if (target.closest(".variable-list-actions")) return;
                    if (target.closest(".variable-list-label")) return;
                    if (target.closest(".variable-select-toggle")) return;
                    handleRowSelect(event);
                  }}
                >
                <input
                  className="variable-select-toggle"
                  type="checkbox"
                  checked={isSelected}
                  onClick={(event) => {
                    event.stopPropagation();
                    const shiftHeld = Boolean(event.shiftKey || keyStateRef.current.shift);
                    const additiveHeld = Boolean(event.ctrlKey || event.metaKey || keyStateRef.current.ctrlOrMeta);
                    if (shiftHeld) {
                      selectVariableRange(variable.id, additiveHeld);
                      return;
                    }
                    handleToggleSingle();
                  }}
                  onChange={() => {}}
                  aria-label={t("designer.selectVariable", { name: variable.displayName })}
                />
                <button
                  className="variable-list-label"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    handleRowSelect(event);
                  }}
                >
                  <strong>{variable.displayName}</strong>
                  {variable.key && variable.key !== variable.displayName ? <span>{variable.key}</span> : null}
                </button>
                <div className="variable-list-actions">
                  <button
                    className="icon-button"
                    title={t("designer.duplicateField")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      duplicateVariable(variable.id);
                    }}
                  ><Copy size={14} /></button>
                  <button
                    className="icon-button danger"
                    title={t("designer.deleteField")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteVariable(variable.id);
                    }}
                  ><X size={14} /></button>
                </div>
              </div>
              );
            })}
          </div>
          <VariableEditor
            variable={selectedVariable}
            updateVariable={updateVariable}
            mappingSource={selectedVariable ? mapping?.[selectedVariable.id] ?? "" : ""}
            updateVariableSource={updateVariableSource}
            updateVariableStyle={updateVariableStyle}
            duplicateVariable={() => duplicateVariable(selectedVariableId)}
            deleteVariable={deleteVariable}
            rules={template?.rules ?? []}
            t={t}
          />
        </aside>
      )}
    </section>
  );
}

function CropBox({ rect, onDrag }) {
  return (
    <div className="crop-box" style={rectStyle(rect)} onPointerDown={(event) => onDrag(event, "move")}>
      {RESIZE_HANDLES.map((mode) => (
        <span key={mode} className={`handle handle-${mode}`} onPointerDown={(event) => onDrag(event, mode)} />
      ))}
    </div>
  );
}

function TemplateCanvas({
  template,
  cropPreviewRef,
  selectedVariableId,
  selectedVariableIds = [],
  setSelectedVariableId,
  setSelection,
  beginVariableDrag,
  previewValues = {},
  cropImageUrl = "",
  cropPreviewDisplaySize = null,
  dragGuides = { x: [], y: [] },
}) {
  const editable = Boolean(beginVariableDrag);
  const previewStyle = cropPreviewDisplaySize
    ? { width: `${cropPreviewDisplaySize.width}px`, height: `${cropPreviewDisplaySize.height}px` }
    : undefined;
  const cropSize = getCropPointSize(template);
  const previewFontScale = cropSize && cropPreviewDisplaySize?.width
    ? cropPreviewDisplaySize.width / cropSize.width
    : 0.72;
  if (!editable) {
    return (
      <div className="crop-preview" ref={cropPreviewRef} style={previewStyle}>
        <div className="crop-preview-stage">
          <PaperTemplateSlot
            template={template}
            cropImageUrl={cropImageUrl}
            previewValues={previewValues}
            style={{ width: "100%", height: "100%" }}
            fontScale={previewFontScale}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="crop-preview" ref={cropPreviewRef} style={previewStyle}>
      <div className="crop-preview-stage">
        <canvas className="crop-preview-canvas" />
        {cropImageUrl ? <img className="crop-preview-image" src={cropImageUrl} alt="" /> : null}
        <div
          className="variable-layer"
          onPointerDown={(event) => {
            if (!editable) return;
            if (event.target !== event.currentTarget) return;
            setSelection("", []);
          }}
        >
          {(dragGuides.x || []).map((xValue) => <span key={`gx-${xValue}`} className="guide-line guide-line-v" style={{ left: xValue }} />)}
          {(dragGuides.y || []).map((yValue) => <span key={`gy-${yValue}`} className="guide-line guide-line-h" style={{ top: yValue }} />)}
          {template.variables.map((variable) => (
            <div
              key={variable.id}
              className={`variable-box ${selectedVariableId === variable.id ? "selected" : ""} ${selectedVariableIds.includes(variable.id) ? "multi-selected" : ""}`}
              style={{
                left: `${variable.xRatio * 100}%`,
                top: `${variable.yRatio * 100}%`,
                width: `${variable.widthRatio * 100}%`,
                height: `${variable.heightRatio * 100}%`,
                color: variable.style.color,
                backgroundColor: resolveFieldBackgroundColor(variable.style.backgroundColor, "rgba(255, 255, 255, 0.42)"),
                fontSize: Math.max(5, variable.style.fontSize * previewFontScale),
                fontWeight: variable.style.fontWeight,
                justifyContent: justify(variable.style.textAlign),
                alignItems: align(variable.style.verticalAlign),
                textAlign: variable.style.textAlign,
              }}
              onPointerDown={(event) => {
                if (!editable) return;
                const additive = event.shiftKey || event.ctrlKey || event.metaKey;
                if (additive) {
                  event.preventDefault();
                  event.stopPropagation();
                  const exists = selectedVariableIds.includes(variable.id);
                  const next = exists
                    ? selectedVariableIds.filter((id) => id !== variable.id)
                    : [...selectedVariableIds, variable.id];
                  setSelection(next[next.length - 1] ?? "", next);
                  return;
                }
                if (!additive && !selectedVariableIds.includes(variable.id)) {
                  setSelection(variable.id, [variable.id]);
                }
                beginVariableDrag(event, variable.id, "move");
              }}
              onClick={(event) => {
                if (!editable) return;
                const additive = event.shiftKey || event.ctrlKey || event.metaKey;
                if (additive) return;
                setSelection(variable.id, [variable.id]);
                if (setSelectedVariableId) setSelectedVariableId(variable.id);
              }}
            >
              <span
                className="variable-text"
                style={{ transform: `rotate(${normalizeTextRotation(variable.style.textRotation)}deg)` }}
              >
                {previewValues[variable.id] ?? variable.displayName}
              </span>
              {editable && selectedVariableId === variable.id && selectedVariableIds.length <= 1 && RESIZE_HANDLES.map((mode) => (
                <span
                  key={mode}
                  className={`handle handle-${mode}`}
                  onPointerDown={(event) => beginVariableDrag(event, variable.id, mode)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function VariableEditor({ variable, mappingSource, updateVariableSource, updateVariable, updateVariableStyle, duplicateVariable, deleteVariable, rules = [], t }) {
  if (!variable) return <p className="muted">{t("designer.selectVariableToEdit")}</p>;
  const isBackgroundTransparent = !variable.style.backgroundColor || variable.style.backgroundColor === "transparent";
  const isRuleSelected = isRuleSource(mappingSource);
  const sourceValue = mappingSource && isMappingFunction(mappingSource) ? mappingSource : "__source_csv_header";
  const usingFunctionSource = sourceValue !== "__source_csv_header";
  const selectedRule = isRuleSelected ? rules.find((rule) => ruleSourceId(rule.id) === mappingSource) ?? null : null;
  return (
    <div className="field-editor">
      <div className="form-stack">
        <label>
          {t("field.valueSource")}
          <select
            className="ui-select"
            value={sourceValue}
            onChange={(event) => {
              const nextSource = event.target.value;
              if (nextSource === "__source_csv_header") {
                updateVariableSource(variable.key);
                return;
              }
              updateVariableSource(nextSource);
            }}
          >
            <option value="__source_csv_header">{t("field.valueSource.csvHeader")}</option>
            {MAPPING_FUNCTIONS.map((item) => (
              <option key={item.key} value={item.key}>{t(item.labelKey)}</option>
            ))}
          </select>
        </label>
        <label>
          {t("mapping.headerName")}
          <input
            value={variable.key}
            placeholder={t("mapping.headerPlaceholder")}
            disabled={usingFunctionSource}
            onChange={(event) => {
              const value = event.target.value;
              updateVariable({ key: value, displayName: value });
            }}
          />
        </label>
        {rules.length ? (
          <label>
            {t("rules.rule")}
            <select
              className="ui-select"
              value={selectedRule ? selectedRule.id : ""}
              onChange={(event) => {
                const nextRuleId = event.target.value;
                if (!nextRuleId) {
                  updateVariableSource(variable.key ?? "");
                  return;
                }
                updateVariableSource(ruleSourceId(nextRuleId));
              }}
            >
              <option value="">{t("rules.none")}</option>
              {rules.map((rule) => (
                <option key={rule.id} value={rule.id}>{rule.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        {usingFunctionSource ? <p className="muted">{t("field.valueSourceFunctionHint")}</p> : null}
        {selectedRule ? (
          <p className="muted">
            {t("rules.selectedPreview", { name: selectedRule.name || t("rules.rule") })}
          </p>
        ) : null}
        <p className="muted">{t("designer.selectVariableToEdit")}</p>
      </div>
      <div className="form-grid compact-form">
        <label>{t("field.fontSize")}<input type="number" min="4" value={variable.style.fontSize} onChange={(event) => updateVariableStyle({ fontSize: Number(event.target.value) })} /></label>
        <label>{t("field.weight")}<select value={variable.style.fontWeight} onChange={(event) => updateVariableStyle({ fontWeight: event.target.value })}><option value="normal">{t("field.weight.normal")}</option><option value="bold">{t("field.weight.bold")}</option></select></label>
        <label>{t("field.rotation")}<select value={normalizeTextRotation(variable.style.textRotation)} onChange={(event) => updateVariableStyle({ textRotation: Number(event.target.value) })}><option value="0">{t("field.rotation.0")}</option><option value="90">{t("field.rotation.90")}</option><option value="180">{t("field.rotation.180")}</option><option value="270">{t("field.rotation.270")}</option></select></label>
        <label>{t("field.textAlign")}<select value={variable.style.textAlign} onChange={(event) => updateVariableStyle({ textAlign: event.target.value })}><option value="left">{t("field.align.left")}</option><option value="center">{t("field.align.center")}</option><option value="right">{t("field.align.right")}</option></select></label>
        <label>{t("field.verticalAlign")}<select value={variable.style.verticalAlign} onChange={(event) => updateVariableStyle({ verticalAlign: event.target.value })}><option value="top">{t("field.vertical.top")}</option><option value="middle">{t("field.vertical.middle")}</option><option value="bottom">{t("field.vertical.bottom")}</option></select></label>
      </div>
      <div className="swatch-row">
        <label>{t("field.textColor")}<input type="color" value={variable.style.color} onChange={(event) => updateVariableStyle({ color: event.target.value })} /></label>
        <div className="bg-color-control">
          <span>{t("field.boxBackground")}</span>
          <div className="bg-color-row">
            <input
              type="color"
              value={normalizeColor(variable.style.backgroundColor)}
              disabled={isBackgroundTransparent}
              onChange={(event) => updateVariableStyle({ backgroundColor: event.target.value })}
            />
            <label className="bg-transparent-toggle">
              <input
                type="checkbox"
                checked={isBackgroundTransparent}
                onChange={(event) =>
                  updateVariableStyle({
                    backgroundColor: event.target.checked
                      ? "transparent"
                      : normalizeColor(variable.style.backgroundColor),
                  })
                }
              />
              <span>{t("field.noColor")}</span>
            </label>
          </div>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={variable.style.autoFit} onChange={(event) => updateVariableStyle({ autoFit: event.target.checked })} /> {t("field.autoFit")}</label>
      <div className="field-editor-actions">
        <button onClick={duplicateVariable} title={t("button.duplicate")} aria-label={t("button.duplicate")}>
          <Copy size={16} /> <span className="action-label">{t("button.duplicate")}</span>
        </button>
        <button className="danger" onClick={() => deleteVariable(variable.id)} title={t("button.delete")} aria-label={t("button.delete")}>
          <Trash2 size={16} /> <span className="action-label">{t("button.delete")}</span>
        </button>
      </div>
    </div>
  );
}

function CsvPage({
  datasets,
  activeCsvId,
  setActiveCsvId,
  previewCsvId,
  setPreviewCsvId,
  onCsvUpload,
  deleteCsvDataset,
  csvUploadEncoding,
  setCsvUploadEncoding,
  t,
}) {
  const active = datasets.find((dataset) => dataset.id === activeCsvId);
  const previewDataset = datasets.find((dataset) => dataset.id === previewCsvId);
  return (
    <section className={previewCsvId ? "page-grid" : "page-grid single-column"}>
      <div className="section-card">
        <div className="section-head section-head-global">
          <div className="section-title-stack">
            <h3>{t("csv.savedDatasets")}</h3>
            <p className="muted">{t("csv.savedDatasetsText")}</p>
          </div>
          <div className="csv-upload-tools">
            <label className="inline-control">
              <span>{t("csv.encoding")}</span>
              <select value={csvUploadEncoding} onChange={(event) => setCsvUploadEncoding(event.target.value)}>
                {CSV_ENCODINGS.map((encoding) => (
                  <option key={encoding.value} value={encoding.value}>{t(encoding.labelKey)}</option>
                ))}
              </select>
            </label>
            <label className="button primary ui-button">
              <Upload size={16} /> {t("button.uploadCsv")}
              <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} />
            </label>
          </div>
        </div>
        <div className="csv-list">
          {datasets.length === 0 && <EmptyState title={t("csv.noDatasets")} text={t("csv.noDatasetsText")} />}
          {datasets.map((dataset) => (
            <article key={dataset.id} className={`csv-row ${dataset.id === activeCsvId ? "active" : ""}`}>
              <button className="csv-row-main" onClick={() => setActiveCsvId(dataset.id)}>
                <strong>{dataset.name}</strong>
                <span>
                  {dataset.fileName} · {t("csv.datasetSummary", { rows: dataset.rows.length, columns: dataset.headers.length, encoding: encodingLabel(dataset.encoding, t) })}
                  {dataset.encodingDetected ? ` ${t("csv.autoDetected")}` : ""}
                </span>
              </button>
              <div className="csv-row-actions">
                <button className="preview-button" onClick={() => setPreviewCsvId(previewCsvId === dataset.id ? "" : dataset.id)}>
                  <Eye size={16} />
                  {previewCsvId === dataset.id ? t("button.close") : t("button.preview")}
                </button>
                <button className="danger" onClick={() => deleteCsvDataset(dataset.id)}>
                  <Trash2 size={16} /> {t("button.deleteCsv")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
      {previewCsvId ? (
        <div className="section-card">
          <div className="panel-head">
            <div>
              <h3>{t("preview.csv")}</h3>
              <p className="muted">{previewDataset?.name}</p>
            </div>
            <button className="icon-button" title={t("preview.closeCsv")} onClick={() => setPreviewCsvId("")}><X size={16} /></button>
          </div>
          <CsvPreview dataset={previewDataset} t={t} />
        </div>
      ) : null}
    </section>
  );
}
function CsvPreview({ dataset, t }) {
  if (!dataset) return <EmptyState title={t("csv.selectForPreview")} text={t("csv.previewDescription")} />;
  return (
    <div className="table-wrap">
      <h3>{dataset.name}</h3>
      <p className="muted">{dataset.fileName} · {encodingLabel(dataset.encoding, t)} · {t("csv.rows", { count: dataset.rows.length })}</p>
      <table>
        <thead><tr>{dataset.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>{dataset.rows.slice(0, 8).map((row, index) => <tr key={index}>{dataset.headers.map((header) => <td key={header}>{row[header]}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function LayoutPage({
  workMode,
  template,
  templates,
  activeTemplateId,
  setActiveTemplateId,
  csvDatasets,
  dataset,
  mapping,
  activeCsvId,
  setActiveCsvId,
  selectedRowIds,
  setSelectedRowIds,
  rowCopies,
  setRowCopies,
  cropPreviewRef,
  layout,
  setLayout,
  autoLayout,
  generatePdf,
  saveDesignTemplateSetup,
  exportUrl,
  isGeneratingPdf,
  previewOpen,
  setPreviewOpen,
  cropPreviewImageUrl,
  setView,
  pageSize,
  t,
}) {
  const resolvePresetKey = (rows, columns) => {
    if (rows === 1 && columns === 1) return "1up";
    if (rows === 2 && columns === 1) return "2up";
    if (rows === 2 && columns === 2) return "4up";
    if (rows === 4 && columns === 2) return "8up";
    return "";
  };
  const update = (key, value) => setLayout((current) => ({ ...current, [key]: value }));
  const isDesignMode = workMode === "design";
  const [splitPercent, setSplitPercent] = useState(32);
  const [activePresetKey, setActivePresetKey] = useState(() => resolvePresetKey(layout.rows, layout.columns));
  const splitGridRef = useRef(null);
  const selectedCount = dataset ? selectedRowIds.filter((id) => Number(id) < dataset.rows.length).length : 0;
  const totalRows = dataset?.rows.length ?? 0;
  const allRowsSelected = totalRows > 0 && selectedCount >= totalRows;
  const printableRows = useMemo(() => getPrintableRowEntries(dataset, selectedRowIds), [dataset, selectedRowIds]);
  const applyPreset = (preset) => setLayout((current) => ({ ...current, ...preset }));
  const updatePair = (xKey, yKey, value) => setLayout((current) => ({ ...current, [xKey]: value, [yKey]: value }));
  const cropSize = getCropPointSize(template, pageSize);
  const printedSize = cropSize ? getPrintedTemplateSize(layout, cropSize, template?.printSizeCm) : null;
  const printMetrics = getPrintMetrics(layout, cropSize, template?.printSizeCm ?? null);
  const manualAnchorBounds = getManualAnchorBounds(layout, printMetrics);
  const manualGapBounds = getManualGapBounds(layout, printMetrics);
  const manualBottomCm = pointsToCmNumber(printMetrics.bottomGap);
  const manualRightCm = pointsToCmNumber(printMetrics.rightGap);
  const hasDatasetRows = totalRows > 0;
  const showNoRecordsSelected = hasDatasetRows && selectedCount === 0;
  const missingMappedHeaders = useMemo(
    () => getMissingTemplateHeaders(template, dataset, mapping),
    [template, dataset, mapping],
  );
  const previewHeaderSummary = showNoRecordsSelected
    ? t("preview.noRecordsSelected")
    : hasDatasetRows
    ? t("preview.printSummaryInline", {
      paper: layout.paperSize,
      orientation: t(`print.orientation.${layout.orientation}`).toLowerCase(),
      columns: layout.columns,
      rows: layout.rows,
      selected: selectedCount,
      total: totalRows,
    })
    : t("preview.printSummaryLayoutOnly", {
      paper: layout.paperSize,
      orientation: t(`print.orientation.${layout.orientation}`).toLowerCase(),
      columns: layout.columns,
      rows: layout.rows,
    });
  const resolvedTemplateId = useMemo(() => {
    if (activeTemplateId && templates.some((item) => item.templateId === activeTemplateId)) return activeTemplateId;
    if (template?.templateId && templates.some((item) => item.templateId === template.templateId)) return template.templateId;
    return templates[0]?.templateId ?? "";
  }, [activeTemplateId, template?.templateId, templates]);

  useEffect(() => {
    if (!isDesignMode) return;
    if (!resolvedTemplateId) return;
    if (activeTemplateId === resolvedTemplateId) return;
    setActiveTemplateId(resolvedTemplateId);
  }, [isDesignMode, activeTemplateId, resolvedTemplateId, setActiveTemplateId]);

  useEffect(() => {
    if (layout.printMode === "manual") return;
    const nextPresetKey = resolvePresetKey(layout.rows, layout.columns);
    if (nextPresetKey) setActivePresetKey(nextPresetKey);
  }, [layout.printMode, layout.rows, layout.columns]);
  const startSplitDrag = (event) => {
    if (!splitGridRef.current || window.innerWidth <= 1080) return;
    event.preventDefault();
    const bounds = splitGridRef.current.getBoundingClientRect();
    const onMove = (moveEvent) => {
      const raw = ((moveEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(clampNumber(raw, 30, 84));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!isDesignMode) {
    return (
      <section className="page-grid single-column print-layout-single">
        <div className="section-card print-preview-job-card">
          <div className="section-head section-head-global print-preview-job-head">
            <div className="section-title-stack">
              <h3>{t("layout.chooseWhatToPrint")}</h3>
              <p className="muted">{t("layout.chooseWhatToPrintText")}</p>
            </div>
          </div>
          <div className="layout-compact-row print-preview-selectors" role="group" aria-label={t("layout.chooseWhatToPrint")}>
            <label className="layout-inline-control template-priority">
              <span>{t("common.template")}</span>
              <select className="ui-select" value={activeTemplateId} onChange={(event) => setActiveTemplateId(event.target.value)}>
                {templates.length === 0
                  ? <option value="">{t("common.noTemplate")}</option>
                  : <option value="" disabled>{t("common.selectTemplate")}</option>}
                {templates.map((item) => (
                  <option key={item.templateId} value={item.templateId}>{item.templateName}</option>
                ))}
              </select>
            </label>
            <label className="layout-inline-control compact-paper">
              <span>{t("common.csv")}</span>
              <select className="ui-select" value={activeCsvId} onChange={(event) => setActiveCsvId(event.target.value)}>
                {csvDatasets.length === 0
                  ? <option value="">{t("common.noCsv")}</option>
                  : <option value="" disabled>{t("common.selectCsv")}</option>}
                {csvDatasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.id}>{dataset.name}</option>
                ))}
              </select>
            </label>
          </div>
          {missingMappedHeaders.length > 0 ? (
            <p className="status status-alert-red">{t("print.missingHeaders", { headers: missingMappedHeaders.join(", ") })}</p>
          ) : null}
        </div>
        <div className="section-card preview-card print-preview-full">
          <div className="panel-head">
            <div>
              <h3>{t("preview.print")}</h3>
              <p className="muted">{previewHeaderSummary}</p>
            </div>
            <div className="print-layout-actions" role="group" aria-label={t("preview.print")}>
              <button onClick={() => setView("template")}><Database size={16} /> {t("button.changePrintJob")}</button>
              <button
                disabled={isGeneratingPdf}
                onClick={() => generatePdf({ openAfter: true }).catch((error) => window.alert(error.message))}
              >
                <Eye size={16} />
                {t("button.openPdfToPrint")}
              </button>
              <button
                className="primary"
                disabled={isGeneratingPdf}
                onClick={() => generatePdf({ downloadAfter: true }).catch((error) => window.alert(error.message))}
              >
                {isGeneratingPdf ? <span className="spinner" aria-hidden="true" /> : <ArrowDownToLine size={16} />}
                {isGeneratingPdf ? t("status.generatingPdf") : t("button.generatePdf")}
              </button>
            </div>
          </div>
          <PrintSheetPreview
            layout={layout}
            template={template}
            pageSize={pageSize}
            dataset={dataset}
            mapping={mapping}
            rows={printableRows}
            rowCopies={rowCopies}
            cropImageUrl={cropPreviewImageUrl}
            showNoRecordsSelected={showNoRecordsSelected}
            onManualLayoutChange={null}
            isReadOnly
            t={t}
          />
        </div>
      </section>
    );
  }

  return (
    <section
      ref={splitGridRef}
      className={previewOpen ? "page-grid print-page-grid layout-split-grid" : "page-grid single-column"}
      style={previewOpen ? { "--layout-left-width": `${splitPercent}%` } : undefined}
    >
      <div className="section-card layout-section-card">
        <div className="section-head section-head-global layout-section-head">
          <div className="section-title-stack">
            <h3>{isDesignMode ? t("layout.designPrintSetup") : t("layout.chooseWhatToPrint")}</h3>
            <p className="muted">{isDesignMode ? t("layout.designPrintSetupText") : t("layout.chooseWhatToPrintText")}</p>
          </div>
          <button
            className="preview-button layout-preview-button"
            onClick={() => setPreviewOpen(true)}
            aria-label={t("button.previewPrintSheet")}
            title={t("button.previewPrintSheet")}
          >
            <Eye size={16} /> <span className="preview-text">{t("button.previewPrintSheet")}</span>
          </button>
        </div>
        <div className={`print-job-summary ${isDesignMode ? "design-compact" : ""}`}>
          <div>
            {isDesignMode ? (
              <div className="layout-compact-row" role="group" aria-label={t("layout.designPrintSetup")}>
                <label className="layout-inline-control template-priority">
                  <span>{t("common.template")}</span>
                  <select className="ui-select" value={resolvedTemplateId} onChange={(event) => setActiveTemplateId(event.target.value)}>
                    {templates.length === 0
                      ? <option value="">{t("common.noTemplate")}</option>
                      : <option value="" disabled>{t("common.selectTemplate")}</option>}
                    {templates.map((item) => (
                      <option key={item.templateId} value={item.templateId}>{item.templateName}</option>
                    ))}
                  </select>
                </label>
                <label className="layout-inline-control compact-paper">
                  <span>{t("print.paper")}</span>
                  <select value={layout.paperSize} onChange={(event) => update("paperSize", event.target.value)}>
                    {["A4", "A3", "A5", "Letter", "Legal", "B5", "Custom"].map((paper) => <option key={paper} value={paper}>{paper}</option>)}
                  </select>
                </label>
                <div className="layout-inline-orientation" role="group" aria-label={t("print.orientation.portrait")}>
                  {["portrait", "landscape"].map((orientation) => (
                    <button key={orientation} className={layout.orientation === orientation ? "active" : ""} onClick={() => update("orientation", orientation)}>
                      {t(`print.orientation.${orientation}`)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <span>{t("print.jobSummary")}</span>
                <strong>{`${template?.templateName ?? t("common.noTemplate")} + ${dataset?.name ?? t("common.noCsv")}`}</strong>
              </>
            )}
          </div>
          {!isDesignMode && <button onClick={() => setView("template")}><Database size={16} /> {t("button.changePrintJob")}</button>}
        </div>
        {isDesignMode && <div className="layout-stack-separator" aria-hidden="true" />}
        {!isDesignMode && (
          <>
            <div className="section-head subtle-head">
              <div>
                <h3>{t("print.records")}</h3>
                <p className="muted">{t("print.recordsSelectedSummary", { selected: selectedCount, total: dataset?.rows.length ?? 0 })}</p>
              </div>
              <button
                onClick={() => {
                  if (!dataset) return;
                  if (allRowsSelected) {
                    setSelectedRowIds([]);
                    return;
                  }
                  setSelectedRowIds(dataset.rows.map((_, index) => String(index)));
                }}
                title={allRowsSelected ? t("button.unselectAll") : t("button.selectAll")}
              >
                <Rows3 size={16} /> {allRowsSelected ? t("button.unselectAll") : t("button.selectAll")}
              </button>
            </div>
            <CsvRowPicker dataset={dataset} selectedRowIds={selectedRowIds} setSelectedRowIds={setSelectedRowIds} rowCopies={rowCopies} setRowCopies={setRowCopies} t={t} />
          </>
        )}
        <div className="print-flow">
          <div className="choice-group compact-master">
            <div className={`flow-row flow-row-top ${isDesignMode ? "design-top" : "print-top"}`}>
              {!isDesignMode && (
                <div className="mini-group">
                  <h3>{t("print.paper")}</h3>
                  <div className="choice-row">
                    {["A4", "A3", "A5", "Letter", "Legal", "B5", "Custom"].map((paper) => <button key={paper} className={layout.paperSize === paper ? "active" : ""} onClick={() => update("paperSize", paper)}>{paper}</button>)}
                    {["portrait", "landscape"].map((orientation) => <button key={orientation} className={layout.orientation === orientation ? "active" : ""} onClick={() => update("orientation", orientation)}>{t(`print.orientation.${orientation}`)}</button>)}
                  </div>
                </div>
              )}
              <div className="mode-size-border-stack">
                <div className="mini-group mini-group-size">
                  <h3>{t("print.printSize")}</h3>
                  <div className="choice-row">
                    <button className={layout.sizeMode === "actual" ? "active" : ""} onClick={() => update("sizeMode", "actual")}>{t("print.actualSizeShort")}</button>
                    <button className={layout.sizeMode !== "actual" ? "active" : ""} onClick={() => update("sizeMode", "fit")}>{t("print.resizeToFitShort")}</button>
                  </div>
                  {cropSize && printedSize && (
                    <p className="muted compact-size-hint compact-size-inline">
                      {t("print.scaleSummary", {
                        sourceWidth: pointsToCm(cropSize.width),
                        sourceHeight: pointsToCm(cropSize.height),
                        printWidth: pointsToCm(printedSize.width),
                        printHeight: pointsToCm(printedSize.height),
                      })}
                    </p>
                  )}
                </div>
                <div className="layout-stack-separator in-stack" aria-hidden="true" />
                <div className="mini-group mini-group-border">
                  <h3>{t("print.border")}</h3>
                  <div className="border-inline-controls">
                    <div className="choice-row">
                      <button
                        className={!layout.printBorderEnabled ? "active" : ""}
                        onClick={() => update("printBorderEnabled", false)}
                      >
                        {t("print.border.off")}
                      </button>
                      <button
                        className={layout.printBorderEnabled && layout.printBorderStyle !== "dashed" ? "active" : ""}
                        onClick={() => {
                          update("printBorderEnabled", true);
                          update("printBorderStyle", "solid");
                        }}
                      >
                        {t("print.border.style.solid")}
                      </button>
                      <button
                        className={layout.printBorderEnabled && layout.printBorderStyle === "dashed" ? "active" : ""}
                        onClick={() => {
                          update("printBorderEnabled", true);
                          update("printBorderStyle", "dashed");
                        }}
                      >
                        {t("print.border.style.dashed")}
                      </button>
                    </div>
                    <label className="border-width-field">
                      <span>{t("print.border.width")}</span>
                      <input
                        type="number"
                        min="0.05"
                        max="5"
                        step="0.05"
                        disabled={!layout.printBorderEnabled}
                        value={Number(layout.printBorderWidth ?? 0.1).toFixed(2)}
                        onChange={(event) => update("printBorderWidth", clampNumber(Number(event.target.value) || 0.1, 0.05, 5))}
                      />
                      <strong>{t("unit.points")}</strong>
                    </label>
                  </div>
                </div>
              </div>
            </div>
            {layout.paperSize === "Custom" && <div className="layout-stack-separator" aria-hidden="true" />}
            {layout.paperSize === "Custom" && (
              <div className="mini-group compact-paper-custom">
                <h3>{t("print.paper")}</h3>
                <div className="human-controls two-col">
                  <MetricControl
                    label={`${t("print.customPaperWidth")} (cm)`}
                    value={pointsToCmNumber(layout.customPaperWidth)}
                    min={1}
                    step={0.1}
                    onChange={(value) => update("customPaperWidth", cmToPoints(value))}
                  />
                  <MetricControl
                    label={`${t("print.customPaperHeight")} (cm)`}
                    value={pointsToCmNumber(layout.customPaperHeight)}
                    min={1}
                    step={0.1}
                    onChange={(value) => update("customPaperHeight", cmToPoints(value))}
                  />
                </div>
              </div>
            )}
            <div className="mini-group mini-group-layout">
              <details className="advanced-layout" open>
                <summary><SlidersHorizontal size={16} /> {t("print.manualGrid")}</summary>
                <div className="layout-mode-toggle choice-row" role="group" aria-label={t("print.mode")}>
                  <button className={layout.printMode !== "manual" ? "active" : ""} onClick={() => update("printMode", "auto")}>{t("print.mode.autoShort")}</button>
                  <button className={layout.printMode === "manual" ? "active" : ""} onClick={() => update("printMode", "manual")}>{t("print.mode.manualShort")}</button>
                </div>
                {layout.printMode !== "manual" ? (
                  <>
                    <div className="mini-group mini-group-preset fine-tune-preset">
                      <h3>{t("print.layoutPreset")}</h3>
                      <div className="items-per-page-row choice-row">
                        <button
                          className={activePresetKey === "bestfit" ? "active" : ""}
                          onClick={async () => {
                            setActivePresetKey("bestfit");
                            await autoLayout();
                          }}
                        >
                          <Grid2X2 size={14} /> {t("button.bestFitShort")}
                        </button>
                        <button className={activePresetKey === "1up" ? "active" : ""} onClick={() => {
                          setActivePresetKey("1up");
                          applyPreset({ rows: 1, columns: 1 });
                        }}>1</button>
                        <button className={activePresetKey === "2up" ? "active" : ""} onClick={() => {
                          setActivePresetKey("2up");
                          applyPreset({ rows: 2, columns: 1 });
                        }}>2</button>
                        <button className={activePresetKey === "4up" ? "active" : ""} onClick={() => {
                          setActivePresetKey("4up");
                          applyPreset({ rows: 2, columns: 2 });
                        }}>4</button>
                        <button className={activePresetKey === "8up" ? "active" : ""} onClick={() => {
                          setActivePresetKey("8up");
                          applyPreset({ rows: 4, columns: 2 });
                        }}>8</button>
                      </div>
                    </div>
                    <div className="human-controls">
                      <DistanceControl label={`${t("print.edgeSpace")} (cm)`} value={layout.marginX} min={0} max={80} onChange={(value) => updatePair("marginX", "marginY", value)} />
                      <DistanceControl label={`${t("print.itemSpace")} (cm)`} value={layout.gapX} min={0} max={60} onChange={(value) => updatePair("gapX", "gapY", value)} />
                    </div>
                  </>
                ) : (
                  <div className="human-controls two-col">
                  <Stepper label={t("print.itemsAcross")} value={layout.columns} min={1} max={8} onChange={(value) => update("columns", value)} t={t} />
                  <Stepper label={t("print.itemsDown")} value={layout.rows} min={1} max={12} onChange={(value) => update("rows", value)} t={t} />
                  <NumberAdjustField
                    label={`${t("print.templateWidth")} (cm)`}
                    value={pointsToCmNumber(layout.manualTemplateWidth)}
                    min={0.1}
                    step={0.1}
                    onChange={(value) => update("manualTemplateWidth", cmToPoints(value))}
                    className="template-size-field"
                    t={t}
                  />
                  <NumberAdjustField
                    label={`${t("print.templateHeight")} (cm)`}
                    value={pointsToCmNumber(layout.manualTemplateHeight)}
                    min={0.1}
                    step={0.1}
                    onChange={(value) => update("manualTemplateHeight", cmToPoints(value))}
                    className="template-size-field"
                    t={t}
                  />
                  <ManualGapControl
                    gapXCm={pointsToCmNumber(printMetrics.gapX)}
                    gapYCm={pointsToCmNumber(layout.manualGapY)}
                    maxGapXCm={pointsToCmNumber(manualGapBounds.maxGapX)}
                    maxGapYCm={pointsToCmNumber(manualGapBounds.maxGapY)}
                    autoGapX={Boolean(layout.manualAutoGapX)}
                    onAutoGapXChange={(checked) => update("manualAutoGapX", checked)}
                    onGapXChange={(value) => {
                      update("manualAutoGapX", false);
                      update("manualGapX", cmToPoints(value));
                    }}
                    onGapYChange={(value) => update("manualGapY", cmToPoints(value))}
                    t={t}
                  />
                  <ManualPositionControl
                    leftCm={pointsToCmNumber(layout.manualLeft)}
                    topCm={pointsToCmNumber(layout.manualTop)}
                    autoBottomCm={manualBottomCm}
                    rightBelowCm={manualRightCm}
                    maxLeftCm={pointsToCmNumber(manualAnchorBounds.maxLeft)}
                    maxTopCm={pointsToCmNumber(manualAnchorBounds.maxTop)}
                    onLeftChange={(value) => update("manualLeft", cmToPoints(value))}
                    onTopChange={(value) => update("manualTop", cmToPoints(value))}
                    t={t}
                  />
                </div>
              )}
                {!printMetrics.valid && <p className="status">{t("status.layoutDoesNotFit", { paper: layout.paperSize })}</p>}
              </details>
            </div>
          </div>
          <div className="print-actions">
            {isDesignMode ? (
              <button className="primary" onClick={() => saveDesignTemplateSetup(layout)}>
                <Save size={16} /> {t("button.save")}
              </button>
            ) : (
              <button className="primary" disabled={isGeneratingPdf} onClick={() => generatePdf({ downloadAfter: true }).catch((error) => window.alert(error.message))}>
                {isGeneratingPdf ? <span className="spinner" aria-hidden="true" /> : <ArrowDownToLine size={16} />}
                {isGeneratingPdf ? t("status.generatingPdf") : t("button.generatePdf")}
              </button>
            )}
          </div>
        </div>
      </div>
      {previewOpen ? (
        <div
          className="layout-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.resizePanels")}
          aria-valuemin={30}
          aria-valuemax={84}
          aria-valuenow={Math.round(splitPercent)}
          onMouseDown={startSplitDrag}
        >
          <span className="layout-splitter-handle" aria-hidden="true" />
        </div>
      ) : null}
      {previewOpen ? (
      <div className="section-card preview-card">
        <div className="panel-head">
          <div>
            <h3>{t("preview.print")}</h3>
            <p className="muted">{previewHeaderSummary}</p>
          </div>
          <button className="icon-button" aria-label={t("preview.close")} title={t("preview.close")} onClick={() => setPreviewOpen(false)}><X size={16} /></button>
        </div>
        <PrintSheetPreview
          layout={layout}
          template={template}
          pageSize={pageSize}
          dataset={dataset}
          mapping={mapping}
          rows={printableRows}
          rowCopies={rowCopies}
          cropImageUrl={cropPreviewImageUrl}
          showNoRecordsSelected={showNoRecordsSelected}
          onManualLayoutChange={update}
          isReadOnly={false}
          t={t}
        />
        <div className="preview-modal-footer">
          {isDesignMode ? (
            <button className="primary" onClick={() => saveDesignTemplateSetup(layout)}>
              <Save size={16} /> {t("button.save")}
            </button>
          ) : (
            <button
              className="primary"
              disabled={isGeneratingPdf}
              onClick={() => generatePdf({ downloadAfter: true }).catch((error) => window.alert(error.message))}
            >
              {isGeneratingPdf ? <span className="spinner" aria-hidden="true" /> : <ArrowDownToLine size={16} />}
              {isGeneratingPdf ? t("status.generatingPdf") : t("button.generatePdf")}
            </button>
          )}
        </div>
      </div>
      ) : null}
    </section>
  );
}

function CsvRowPicker({ dataset, selectedRowIds, setSelectedRowIds, rowCopies, setRowCopies, t }) {
  if (!dataset) return <EmptyState title={t("print.noCsvSelected")} text={t("print.noCsvSelectedText")} />;
  const toggle = (rowId) => {
    setSelectedRowIds((current) =>
      current.includes(rowId) ? current.filter((id) => id !== rowId) : [...current, rowId],
    );
  };
  return (
    <div className="row-picker">
      <table>
        <thead>
          <tr>
            <th>{t("table.print")}</th>
            <th>{t("table.copies")}</th>
            {dataset.headers.slice(0, 4).map((header) => <th key={header}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {dataset.rows.map((row, index) => {
            const rowId = String(index);
            return (
              <tr key={rowId}>
                <td><input type="checkbox" checked={selectedRowIds.includes(rowId)} onChange={() => toggle(rowId)} /></td>
                <td>
                  <input
                    className="copies-input"
                    type="number"
                    min="1"
                    value={rowCopies[rowId] ?? 1}
                    onChange={(event) => setRowCopies((current) => ({ ...current, [rowId]: Math.max(1, Number(event.target.value) || 1) }))}
                  />
                </td>
                {dataset.headers.slice(0, 4).map((header) => <td key={header}>{row[header]}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange, t }) {
  const nextValue = (delta) => clampNumber(value + delta, min, max);
  const applyValue = (rawValue) => {
    const parsedValue = Number(rawValue);
    const fallback = Number.isFinite(parsedValue) ? parsedValue : min;
    onChange(Math.round(clampNumber(fallback, min, max)));
  };

  return (
    <label className="control-tile manual-position-field compact stepper-field">
      <span>{label}</span>
      <div className="number-adjust-wrap">
        <button
          type="button"
          className="number-adjust-btn"
          onClick={() => applyValue(nextValue(-1))}
          aria-label={t ? t("preview.decreaseValue") : "Decrease value"}
          title={t ? t("preview.decreaseValue") : "Decrease value"}
        >
          -
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          onChange={(event) => applyValue(event.target.value)}
        />
        <button
          type="button"
          className="number-adjust-btn"
          onClick={() => applyValue(nextValue(1))}
          aria-label={t ? t("preview.increaseValue") : "Increase value"}
          title={t ? t("preview.increaseValue") : "Increase value"}
        >
          +
        </button>
      </div>
    </label>
  );
}

function DistanceControl({ label, value, min, max, onChange }) {
  const minCm = pointsToCmNumber(min);
  const maxCm = pointsToCmNumber(max);

  return (
    <label className="control-tile distance-control">
      <span>{label}</span>
      <div className="distance-slider-row">
        <small>{minCm.toFixed(1)}</small>
        <input type="range" value={value} min={min} max={max} onChange={(event) => onChange(Number(event.target.value))} />
        <small>{maxCm.toFixed(1)}</small>
      </div>
    </label>
  );
}

function MetricControl({ label, value, min = 0, step = 0.1, onChange, readOnly = false, disabled = false }) {
  return (
    <label className="control-tile">
      <span>{label}</span>
      <div className="distance-input-wrap">
        <input
          type="number"
          min={min}
          step={step}
          value={Number(value).toFixed(1)}
          readOnly={readOnly}
          disabled={disabled}
          onChange={(event) => onChange(Math.max(min, Number(event.target.value) || min))}
        />
      </div>
    </label>
  );
}

function NumberAdjustField({
  label,
  value,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 0.1,
  onChange,
  disabled = false,
  compact = false,
  className = "",
  t,
}) {
  const safeMax = Number.isFinite(max) ? max : Number.POSITIVE_INFINITY;
  const applyValue = (rawValue) => {
    const next = clampNumber(Number(rawValue) || min, min, safeMax);
    onChange(next);
  };

  return (
    <label className={`manual-position-field ${compact ? "compact" : ""} ${className}`.trim()}>
      <span>{label}</span>
      <div className="number-adjust-wrap">
        <button
          type="button"
          className="number-adjust-btn"
          disabled={disabled}
          onClick={() => applyValue(value - step)}
          aria-label={t("preview.decreaseValue")}
          title={t("preview.decreaseValue")}
        >
          -
        </button>
        <div className="distance-input-wrap">
          <input
            type="number"
            min={min}
            max={Number.isFinite(safeMax) ? safeMax : undefined}
            step={step}
            value={value.toFixed(1)}
            disabled={disabled}
            onChange={(event) => applyValue(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="number-adjust-btn"
          disabled={disabled}
          onClick={() => applyValue(value + step)}
          aria-label={t("preview.increaseValue")}
          title={t("preview.increaseValue")}
        >
          +
        </button>
      </div>
    </label>
  );
}

function ManualPositionControl({
  leftCm,
  topCm,
  autoBottomCm,
  rightBelowCm,
  maxLeftCm,
  maxTopCm,
  onLeftChange,
  onTopChange,
  t,
}) {
  const safeMaxLeftCm = Math.max(0, maxLeftCm);
  const safeMaxTopCm = Math.max(0, maxTopCm);
  const [nudgeCm, setNudgeCm] = useState(0.1);
  const stepChoices = [0.1, 0.5, 1.0, 2.0];
  const applyNudge = (deltaX, deltaY) => {
    onLeftChange(clampNumber(leftCm + deltaX, 0, safeMaxLeftCm));
    onTopChange(clampNumber(topCm + deltaY, 0, safeMaxTopCm));
  };
  const handleKeyNudge = (event) => {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      applyNudge(0, -nudgeCm);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      applyNudge(0, nudgeCm);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      applyNudge(-nudgeCm, 0);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      applyNudge(nudgeCm, 0);
    }
  };

  return (
    <div className="control-tile manual-position-tile" tabIndex={0} onKeyDown={handleKeyNudge}>
      <div className="manual-position-body">
        <div className="manual-position-fields">
          <NumberAdjustField
            label={`${t("preview.leftX")} (cm)`}
            value={leftCm}
            min={0}
            max={safeMaxLeftCm}
            step={0.1}
            onChange={onLeftChange}
            t={t}
          />
          <NumberAdjustField
            label={`${t("preview.topY")} (cm)`}
            value={topCm}
            min={0}
            max={safeMaxTopCm}
            step={0.1}
            onChange={onTopChange}
            t={t}
          />
        </div>
        <div className="manual-position-nudge-wrap">
          <div className="manual-position-nudge" role="group" aria-label={t("preview.nudgePad")}>
            <button
              type="button"
              className="nudge-up"
              onClick={() => applyNudge(0, -nudgeCm)}
              aria-label={`${t("preview.nudgeUp")} (↑)`}
              title={`${t("preview.nudgeUp")} (↑)`}
            >
              ↑
            </button>
            <button
              type="button"
              className="nudge-left"
              onClick={() => applyNudge(-nudgeCm, 0)}
              aria-label={`${t("preview.nudgeLeft")} (←)`}
              title={`${t("preview.nudgeLeft")} (←)`}
            >
              ←
            </button>
            <label className="manual-position-step-select">
              <span>{t("preview.stepSize")}</span>
              <select value={nudgeCm} onChange={(event) => setNudgeCm(Number(event.target.value) || 0.1)}>
                {stepChoices.map((step) => (
                  <option key={step} value={step}>{step.toFixed(1)} cm</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="nudge-right"
              onClick={() => applyNudge(nudgeCm, 0)}
              aria-label={`${t("preview.nudgeRight")} (→)`}
              title={`${t("preview.nudgeRight")} (→)`}
            >
              →
            </button>
            <button
              type="button"
              className="nudge-down"
              onClick={() => applyNudge(0, nudgeCm)}
              aria-label={`${t("preview.nudgeDown")} (↓)`}
              title={`${t("preview.nudgeDown")} (↓)`}
            >
              ↓
            </button>
          </div>
        </div>
      </div>
      <div className="manual-metrics-panel">
        <div className="manual-space-remaining" aria-live="polite">
          <strong>{t("preview.spaceRemaining")}</strong>
          <span>{t("print.autoBottomY")} {autoBottomCm.toFixed(1)} cm</span>
          <span>{t("print.autoRightBelowX")} {rightBelowCm.toFixed(1)} cm</span>
          <button
            type="button"
            className="manual-space-reset"
            onClick={() => {
              onLeftChange(0);
              onTopChange(0);
            }}
          >
            {t("preview.resetPosition")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualGapControl({ gapXCm, gapYCm, maxGapXCm, maxGapYCm, autoGapX = false, onAutoGapXChange, onGapXChange, onGapYChange, t }) {
  const safeMaxGapXCm = Math.max(0, maxGapXCm);
  const safeMaxGapYCm = Math.max(0, maxGapYCm);

  return (
    <div className="control-tile manual-gap-panel manual-gap-panel-separate">
      <div className="manual-gap-head">
        <span>{t("print.gapX")} / {t("print.gapY")}</span>
        <label className="manual-gap-auto-toggle">
          <input type="checkbox" checked={autoGapX} onChange={(event) => onAutoGapXChange?.(event.target.checked)} />
          <em>{t("print.autoGapX")}</em>
        </label>
      </div>
      <div className="manual-gap-fields">
        <NumberAdjustField
          label={`${t("print.gapX")} (cm)`}
          value={gapXCm}
          min={0}
          max={safeMaxGapXCm}
          step={0.1}
          onChange={onGapXChange}
          disabled={autoGapX}
          compact
          t={t}
        />
        <NumberAdjustField
          label={`${t("print.gapY")} (cm)`}
          value={gapYCm}
          min={0}
          max={safeMaxGapYCm}
          step={0.1}
          onChange={onGapYChange}
          compact
          t={t}
        />
      </div>
    </div>
  );
}

function PrintSheetPreview({ layout, template, dataset, mapping, rows, rowCopies, cropImageUrl, pageSize, showNoRecordsSelected = false, onManualLayoutChange, isReadOnly = false, t }) {
  const [previewPage, setPreviewPage] = useState(1);
  const [previewZoom, setPreviewZoom] = useState(() => (window.innerWidth > 900 ? 1.2 : 1));
  const [previewZoomMode, setPreviewZoomMode] = useState("fit");
  const [showMeasurements, setShowMeasurements] = useState(false);
  const [measurementGuides, setMeasurementGuides] = useState({ x: [], y: [] });
  const [activeMeasurementGuide, setActiveMeasurementGuide] = useState(null);
  const [showManualHint, setShowManualHint] = useState(() => localStorage.getItem("print-preview-manual-hint-dismissed") !== "1");
  const measurementStageRef = useRef(null);
  const sheetPreviewRef = useRef(null);
  const selectedCount = rows.reduce((count, entry) => count + getRowCopyCount(rowCopies, entry.index), 0);
  const slots = Math.max(1, layout.rows * layout.columns);
  const pages = Math.max(1, Math.ceil(Math.max(selectedCount, 1) / slots));
  useEffect(() => {
    setPreviewPage((current) => Math.min(current, pages));
  }, [pages]);
  const paper = orientedPaper(layout);
  const isDesktopPreview = window.innerWidth > 900;
  const basePreviewWidth = isDesktopPreview
    ? layout.orientation === "landscape"
      ? 760
      : 580
    : layout.orientation === "landscape"
      ? 560
      : 420;
  const maxPreviewWidth = Math.max(220, window.innerWidth - (isDesktopPreview ? 140 : 52));
  const zoomedWidth = basePreviewWidth * previewZoom;
  const actualSizeWidth = paper.width * CSS_PX_PER_PT;
  const fitWidth = maxPreviewWidth;
  const previewWidth = previewZoomMode === "actual"
    ? actualSizeWidth
    : previewZoomMode === "fit"
      ? fitWidth
      : Math.min(zoomedWidth, maxPreviewWidth);
  const previewHeight = previewWidth * (paper.height / paper.width);
  const scale = previewWidth / paper.width;
  const cropSize = getCropPointSize(template, pageSize);
  const metrics = getPrintMetrics(layout, cropSize, template?.printSizeCm ?? null);
  const templateScale = metrics.variableScale;
  const rulerTicksX = useMemo(() => buildMeasurementTicks(paper.width, cmToPoints(1)), [paper.width]);
  const rulerTicksY = useMemo(() => buildMeasurementTicks(paper.height, cmToPoints(1)), [paper.height]);
  const gridStepPoints = cmToPoints(5);
  const gridLinesX = showMeasurements
    ? Array.from({ length: Math.floor(paper.width / gridStepPoints) + 1 }, (_item, index) => index * gridStepPoints)
      .filter((offset) => offset > 0 && offset < paper.width)
    : [];
  const gridLinesY = showMeasurements
    ? Array.from({ length: Math.floor(paper.height / gridStepPoints) + 1 }, (_item, index) => index * gridStepPoints)
      .filter((offset) => offset > 0 && offset < paper.height)
    : [];
  const tileStyle = cropSize ? {
    width: `${metrics.itemWidth * scale}px`,
    height: `${metrics.itemHeight * scale}px`,
  } : {};
  const allPreviewRows = expandRowEntries(rows, rowCopies);
  const overflowCount = Math.max(0, allPreviewRows.length - slots);
  // Fill visible slots with placeholder rows when CSV selection is empty so layout is still easy to inspect.
  const rowsForPreview = allPreviewRows.length
    ? allPreviewRows
    : Array.from({ length: Math.max(1, slots) }, (_, index) => ({ row: {}, index }));
  const previewRows = rowsForPreview.slice((previewPage - 1) * slots, previewPage * slots);
  const isManualMode = layout.printMode === "manual";
  const allowManualEditing = isManualMode && !isReadOnly && Boolean(onManualLayoutChange);
  const previewGapX = metrics.printMode === "manual" ? metrics.gapX : layout.gapX;
  const previewGapY = metrics.printMode === "manual" ? metrics.gapY : layout.gapY;
  const previewPaddingLeft = metrics.printMode === "manual" ? metrics.leftGap : layout.marginX;
  const previewPaddingRight = metrics.printMode === "manual" ? metrics.rightGap : layout.marginX;
  const previewPaddingTop = metrics.printMode === "manual" ? metrics.topGap : layout.marginY;
  const previewPaddingBottom = metrics.printMode === "manual" ? metrics.bottomGap : layout.marginY;
  const rulerOffsetLeft = showMeasurements ? PREVIEW_RULER_LEFT_PX : 0;
  const rulerOffsetTop = showMeasurements ? PREVIEW_RULER_TOP_PX : 0;
  const style = {
    width: previewWidth,
    height: previewHeight,
    padding: `${previewPaddingTop * scale}px ${previewPaddingRight * scale}px ${previewPaddingBottom * scale}px ${previewPaddingLeft * scale}px`,
    gap: `${previewGapY * scale}px ${previewGapX * scale}px`,
    gridTemplateColumns: isManualMode
      ? `repeat(${layout.columns}, ${metrics.itemWidth * scale}px)`
      : `repeat(${layout.columns}, minmax(0, 1fr))`,
    gridTemplateRows: isManualMode
      ? `repeat(${layout.rows}, ${metrics.itemHeight * scale}px)`
      : `repeat(${layout.rows}, minmax(0, 1fr))`,
    justifyContent: "start",
    alignContent: "start",
  };
  const manualOverlayStyle = allowManualEditing && cropSize ? {
    left: `${previewPaddingLeft * scale}px`,
    top: `${previewPaddingTop * scale}px`,
    width: `${metrics.itemWidth * scale}px`,
    height: `${metrics.itemHeight * scale}px`,
  } : null;
  const manualGapXHandleStyle = allowManualEditing && cropSize && layout.columns > 1 ? {
    left: `${previewPaddingLeft * scale + metrics.itemWidth * scale + (metrics.gapX * scale) / 2}px`,
    top: `${previewPaddingTop * scale + (metrics.itemHeight * scale) / 2}px`,
  } : null;
  const manualGapYHandleStyle = allowManualEditing && cropSize && layout.rows > 1 ? {
    left: `${previewPaddingLeft * scale + (metrics.itemWidth * scale) / 2}px`,
    top: `${previewPaddingTop * scale + metrics.itemHeight * scale + (metrics.gapY * scale) / 2}px`,
  } : null;

  const startManualOverlayDrag = (event) => {
    if (!allowManualEditing || !cropSize) return;
    event.preventDefault();
    event.stopPropagation();
    const startLeft = Number(layout.manualLeft) || 0;
    const startTop = Number(layout.manualTop) || 0;
    const manualBounds = getManualAnchorBounds(layout, metrics);
    const maxLeft = manualBounds.maxLeft;
    const maxTop = manualBounds.maxTop;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const onMove = (moveEvent) => {
      const deltaX = (moveEvent.clientX - startClientX) / scale;
      const deltaY = (moveEvent.clientY - startClientY) / scale;
      onManualLayoutChange("manualLeft", clampNumber(startLeft + deltaX, 0, maxLeft));
      onManualLayoutChange("manualTop", clampNumber(startTop + deltaY, 0, maxTop));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const updateMeasurementGuide = (axis, guideIndex, clientX, clientY) => {
    if (!measurementStageRef.current) return 0;
    const bounds = measurementStageRef.current.getBoundingClientRect();
    const nextValue = axis === "x"
      ? clampNumber((clientX - bounds.left - rulerOffsetLeft) / scale, 0, paper.width)
      : clampNumber((clientY - bounds.top - rulerOffsetTop) / scale, 0, paper.height);
    setMeasurementGuides((current) => ({
      ...current,
      [axis]: current[axis].map((value, index) => (index === guideIndex ? nextValue : value)),
    }));
    setActiveMeasurementGuide({ axis, index: guideIndex, value: nextValue });
    return nextValue;
  };

  const startMeasurementGuideDrag = (axis, event, guideIndex = null) => {
    if (!showMeasurements) return;
    event.preventDefault();
    event.stopPropagation();
    const nextIndex = guideIndex ?? measurementGuides[axis].length;
    if (guideIndex === null) {
      setMeasurementGuides((current) => ({
        ...current,
        [axis]: [...current[axis], 0],
      }));
    }
    updateMeasurementGuide(axis, nextIndex, event.clientX, event.clientY);
    const onMove = (moveEvent) => {
      updateMeasurementGuide(axis, nextIndex, moveEvent.clientX, moveEvent.clientY);
    };
    const onUp = () => {
      setActiveMeasurementGuide(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const placeManualAnchorFromClick = (event) => {
    if (!allowManualEditing || !cropSize || !sheetPreviewRef.current) return;
    if (event.target.closest(".preview-manual-overlay") || event.target.closest(".preview-gap-handle")) return;
    const bounds = sheetPreviewRef.current.getBoundingClientRect();
    const clickX = clampNumber((event.clientX - bounds.left) / scale, 0, paper.width);
    const clickY = clampNumber((event.clientY - bounds.top) / scale, 0, paper.height);
    const manualBounds = getManualAnchorBounds(layout, metrics);
    onManualLayoutChange("manualLeft", clampNumber(clickX, 0, manualBounds.maxLeft));
    onManualLayoutChange("manualTop", clampNumber(clickY, 0, manualBounds.maxTop));
  };

  const startManualGapDrag = (axis, event) => {
    if (!allowManualEditing || !cropSize) return;
    event.preventDefault();
    event.stopPropagation();
    const gapBounds = getManualGapBounds(layout, metrics);
    const startGap = axis === "x" ? metrics.gapX : metrics.gapY;
    const maxGap = axis === "x" ? gapBounds.maxGapX : gapBounds.maxGapY;
    const startClientX = event.clientX;
    const startClientY = event.clientY;
    const onMove = (moveEvent) => {
      const delta = axis === "x"
        ? (moveEvent.clientX - startClientX) / scale
        : (moveEvent.clientY - startClientY) / scale;
      const nextGap = clampNumber(startGap + delta, 0, maxGap);
      if (axis === "x") {
        onManualLayoutChange("manualAutoGapX", false);
        onManualLayoutChange("manualGapX", nextGap);
      }
      else onManualLayoutChange("manualGapY", nextGap);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const dismissManualHint = () => {
    setShowManualHint(false);
    localStorage.setItem("print-preview-manual-hint-dismissed", "1");
  };

  const zoomOut = () => {
    setPreviewZoomMode("custom");
    setPreviewZoom((value) => Math.max(0.7, Number((value - 0.1).toFixed(2))));
  };

  const zoomIn = () => {
    setPreviewZoomMode("custom");
    setPreviewZoom((value) => Math.min(1.9, Number((value + 0.1).toFixed(2))));
  };

  const clearMeasurementGuides = () => {
    setMeasurementGuides({ x: [], y: [] });
    setActiveMeasurementGuide(null);
  };

  const removeMeasurementGuide = (axis, guideIndex) => {
    setMeasurementGuides((current) => ({
      ...current,
      [axis]: current[axis].filter((_value, index) => index !== guideIndex),
    }));
    setActiveMeasurementGuide((current) => {
      if (!current || current.axis !== axis || current.index !== guideIndex) return current;
      return null;
    });
  };

  return (
    <div className="sheet-preview-wrap">
      <div className="preview-controls-row">
        <div className="preview-page-controls">
          <div className="preview-measurement-tools">
            <label className="preview-measurement-toggle">
              <input type="checkbox" checked={showMeasurements} onChange={(event) => setShowMeasurements(event.target.checked)} />
              <span>{t("preview.showMeasurements")}</span>
            </label>
            {showMeasurements && (measurementGuides.x.length || measurementGuides.y.length) ? (
              <button type="button" className="preview-clear-guides" onClick={clearMeasurementGuides}>
                {t("preview.clearGuides")}
              </button>
            ) : null}
          </div>
          {pages > 1 ? (
            <>
              <button disabled={previewPage <= 1} onClick={() => setPreviewPage((page) => Math.max(1, page - 1))}>
                <ChevronLeft size={16} /> {t("designer.previous")}
              </button>
              <span>{t("preview.pageOf", { page: previewPage, pages })}</span>
              <button disabled={previewPage >= pages} onClick={() => setPreviewPage((page) => Math.min(pages, page + 1))}>
                {t("designer.next")} <ChevronRight size={16} />
              </button>
            </>
          ) : null}
        </div>
        <div className="preview-zoom-controls" aria-label={t("preview.zoomControls")}>
          <button
            type="button"
            className={previewZoomMode === "fit" ? "active" : ""}
            onClick={() => setPreviewZoomMode("fit")}
          >
            {t("preview.zoomFit")}
          </button>
          <button
            type="button"
            className={previewZoomMode === "actual" ? "active" : ""}
            onClick={() => setPreviewZoomMode("actual")}
          >
            {t("print.actualSizeShort")}
          </button>
          <button type="button" onClick={zoomOut}>-</button>
          <span>{previewZoomMode === "custom" ? `${Math.round(previewZoom * 100)}%` : t(`preview.zoomMode.${previewZoomMode}`)}</span>
          <button type="button" onClick={zoomIn}>+</button>
        </div>
      </div>
      {showNoRecordsSelected ? <p className="preview-state-banner empty">{t("preview.noRecordsSelected")} {t("preview.noRecordsSelectedHelp")}</p> : null}
      {overflowCount > 0 && previewPage === 1 ? <p className="preview-state-banner overflow">{t("preview.overflowBanner", { count: overflowCount, page: 2 })}</p> : null}
      {allowManualEditing && showManualHint ? (
        <p className="preview-manual-click-hint">
          <span>{t("preview.manualPlacementHint")}</span>
          <button type="button" className="preview-manual-hint-dismiss" onClick={dismissManualHint} aria-label={t("preview.dismissHint")} title={t("preview.dismissHint")}>×</button>
        </p>
      ) : null}
      <div className="sheet-preview-scroll">
        <div ref={measurementStageRef} className={`sheet-preview-stage ${showMeasurements ? "with-measurements" : ""}`}>
          {showMeasurements ? (
            <>
              <div className="preview-ruler-corner" aria-hidden="true">cm</div>
              <div className="preview-ruler preview-ruler-top" aria-hidden="true" onMouseDown={(event) => startMeasurementGuideDrag("x", event)}>
                {rulerTicksX.map((tick) => (
                  <span
                    key={`ruler-top-${tick.index}`}
                    className={`preview-ruler-tick ${tick.isMajor ? "major" : "minor"}`}
                    style={{ left: `${tick.offset * scale}px` }}
                  >
                    {tick.label ? <em>{tick.label}</em> : null}
                  </span>
                ))}
              </div>
              <div className="preview-ruler preview-ruler-left" aria-hidden="true" onMouseDown={(event) => startMeasurementGuideDrag("y", event)}>
                {rulerTicksY.map((tick) => (
                  <span
                    key={`ruler-left-${tick.index}`}
                    className={`preview-ruler-tick ${tick.isMajor ? "major" : "minor"}`}
                    style={{ top: `${tick.offset * scale}px` }}
                  >
                    {tick.label ? <em>{tick.label}</em> : null}
                  </span>
                ))}
              </div>
              {measurementGuides.x.map((guide, index) => (
                <button
                  type="button"
                  key={`guide-x-${index}`}
                  className={`preview-drag-guide preview-drag-guide-v ${activeMeasurementGuide?.axis === "x" && activeMeasurementGuide?.index === index ? "active" : ""}`}
                  style={{ left: `${rulerOffsetLeft + guide * scale}px` }}
                  onMouseDown={(event) => startMeasurementGuideDrag("x", event, index)}
                  onDoubleClick={() => removeMeasurementGuide("x", index)}
                  title={`${pointsToCmNumber(guide).toFixed(1)} cm`}
                >
                  <span>{pointsToCmNumber(guide).toFixed(1)} cm</span>
                </button>
              ))}
              {measurementGuides.y.map((guide, index) => (
                <button
                  type="button"
                  key={`guide-y-${index}`}
                  className={`preview-drag-guide preview-drag-guide-h ${activeMeasurementGuide?.axis === "y" && activeMeasurementGuide?.index === index ? "active" : ""}`}
                  style={{ top: `${rulerOffsetTop + guide * scale}px` }}
                  onMouseDown={(event) => startMeasurementGuideDrag("y", event, index)}
                  onDoubleClick={() => removeMeasurementGuide("y", index)}
                  title={`${pointsToCmNumber(guide).toFixed(1)} cm`}
                >
                  <span>{pointsToCmNumber(guide).toFixed(1)} cm</span>
                </button>
              ))}
            </>
          ) : null}
          <div ref={sheetPreviewRef} className={`sheet-preview ${allowManualEditing ? "manual-clickable" : ""}`} style={style} onClick={placeManualAnchorFromClick}>
            {showMeasurements ? (
              <div className="preview-measurement-grid" aria-hidden="true">
                {gridLinesX.map((offset) => (
                  <span key={`grid-x-${offset}`} className="preview-grid-line preview-grid-line-v" style={{ left: `${offset * scale}px` }} />
                ))}
                {gridLinesY.map((offset) => (
                  <span key={`grid-y-${offset}`} className="preview-grid-line preview-grid-line-h" style={{ top: `${offset * scale}px` }} />
                ))}
              </div>
            ) : null}
            {Array.from({ length: Math.min(slots, 24) }).map((_, index) => {
              return (
                <div key={index} className={`paper-slot ${previewRows[index] ? "filled" : ""}`}>
                  {previewRows[index] && template?.cropArea && (
                    <PaperTemplateSlot
                      template={template}
                      cropImageUrl={cropImageUrl}
                      previewValues={previewValuesFromRow(template, dataset, mapping, previewRows[index].row)}
                      style={tileStyle}
                      fontScale={templateScale * scale}
                      showBorder={layout.printBorderEnabled}
                      borderStyle={layout.printBorderStyle}
                      borderWidth={layout.printBorderWidth}
                    />
                  )}
                </div>
              );
            })}
            {manualOverlayStyle && (
              <button type="button" className="preview-manual-overlay" style={manualOverlayStyle} onMouseDown={startManualOverlayDrag} title={t("preview.dragToMove")}>
                <span className="preview-manual-overlay-tag">{t("preview.firstItem")}</span>
                <span className="preview-manual-overlay-value">
                  {t("preview.leftX")} {pointsToCmNumber(layout.manualLeft).toFixed(1)} cm · {t("preview.topY")} {pointsToCmNumber(layout.manualTop).toFixed(1)} cm
                </span>
              </button>
            )}
            {manualGapXHandleStyle && (
              <button
                type="button"
                className="preview-gap-handle preview-gap-handle-x"
                style={manualGapXHandleStyle}
                onMouseDown={(event) => startManualGapDrag("x", event)}
              >
                <span>↔ {pointsToCmNumber(metrics.gapX).toFixed(1)} cm</span>
              </button>
            )}
            {manualGapYHandleStyle && (
              <button
                type="button"
                className="preview-gap-handle preview-gap-handle-y"
                style={manualGapYHandleStyle}
                onMouseDown={(event) => startManualGapDrag("y", event)}
              >
                <span>↕ {pointsToCmNumber(metrics.gapY).toFixed(1)} cm</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getManualAnchorBounds(layout, metrics) {
  const paper = orientedPaper(layout);
  const columns = Math.max(1, Number(layout.columns) || 1);
  const rows = Math.max(1, Number(layout.rows) || 1);
  const manualRight = Math.max(0, Number(layout.manualRight) || 0);
  const preserveRightGap = layout.manualAutoGapX && columns > 1;
  return {
    maxLeft: preserveRightGap
      ? Math.max(0, paper.width - manualRight - metrics.itemWidth * columns)
      : Math.max(0, paper.width - metrics.itemWidth * columns - Math.max(0, columns - 1) * metrics.gapX),
    maxTop: Math.max(0, paper.height - metrics.itemHeight * rows - Math.max(0, rows - 1) * metrics.gapY),
  };
}

function getManualGapBounds(layout, metrics) {
  const paper = orientedPaper(layout);
  const columns = Math.max(1, Number(layout.columns) || 1);
  const rows = Math.max(1, Number(layout.rows) || 1);
  const columnGaps = Math.max(0, columns - 1);
  const rowGaps = Math.max(0, rows - 1);
  const freeX = paper.width - metrics.leftGap - metrics.itemWidth * columns;
  const freeY = paper.height - metrics.topGap - metrics.itemHeight * rows;
  return {
    maxGapX: columnGaps > 0 ? Math.max(0, freeX / columnGaps) : 0,
    maxGapY: rowGaps > 0 ? Math.max(0, freeY / rowGaps) : 0,
  };
}

function buildMeasurementTicks(lengthPoints, stepPoints) {
  const safeLength = Math.max(0, Number(lengthPoints) || 0);
  const safeStep = Math.max(1, Number(stepPoints) || 1);
  const totalSteps = Math.floor(safeLength / safeStep);
  return Array.from({ length: totalSteps + 1 }, (_item, index) => ({
    index,
    offset: index * safeStep,
    isMajor: index % 5 === 0,
    label: index === 0 || index % 5 === 0 ? String(index) : "",
  }));
}

function PaperTemplateSlot({ template, cropImageUrl, previewValues, style, fontScale = 1, showBorder = false, borderStyle = "solid", borderWidth = 0.1 }) {
  const borderClass = showBorder
    ? borderStyle === "dashed"
      ? "with-border-dashed"
      : "with-border-solid"
    : "";
  const resolvedStyle = showBorder
    ? { ...style, "--print-border-width": `${Math.max(0.12, (Number(borderWidth) || 0.1) * 2.4)}px` }
    : style;
  return (
    <div className={`paper-template ${borderClass}`.trim()} style={resolvedStyle}>
      {cropImageUrl && <img src={cropImageUrl} alt="" />}
      <div className="variable-layer">
        {template.variables.map((variable) => (
          <div
            key={variable.id}
            className="paper-variable"
            style={{
              left: `${variable.xRatio * 100}%`,
              top: `${variable.yRatio * 100}%`,
              width: `${variable.widthRatio * 100}%`,
              height: `${variable.heightRatio * 100}%`,
              color: variable.style.color,
              backgroundColor: resolveFieldBackgroundColor(variable.style.backgroundColor, "transparent"),
              fontSize: Math.max(5, variable.style.fontSize * fontScale),
              fontWeight: variable.style.fontWeight,
              justifyContent: justify(variable.style.textAlign),
              alignItems: align(variable.style.verticalAlign),
              textAlign: variable.style.textAlign,
            }}
          >
            <span
              className="paper-variable-text"
              style={{ transform: `rotate(${normalizeTextRotation(variable.style.textRotation)}deg)` }}
            >
              {previewValues[variable.id] ?? variable.displayName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportPage({ template, dataset, generatePdf, cropPreviewRef, t = (key) => key }) {
  return (
    <section className="page-grid">
      <div className="section-card export-panel">
        <ArrowDownToLine size={36} />
        <h3>{t("export.generatePrintablePdf")}</h3>
        <p className="muted">
          {t("export.templateSummary", { name: template?.templateName ?? t("common.none") })}<br />
          {t("export.csvSummary", { name: dataset?.name ?? t("common.notAvailable") })}
        </p>
        <button className="primary" onClick={() => generatePdf({ downloadAfter: true })}>{t("button.generatePdfAction")}</button>
      </div>
      {template?.cropArea && <PreviewCard template={template} cropPreviewRef={cropPreviewRef} />}
    </section>
  );
}

function PreviewCard({
  template,
  cropPreviewRef,
  embedded = false,
  onClose,
  previewValues = {},
  cropImageUrl = "",
  cropPreviewDisplaySize = null,
  t = (key) => key,
}) {
  return (
    <aside className={embedded ? "preview-card embedded-preview" : "section-card preview-card"}>
      <div className="panel-head">
        <div>
          <h3>{t("preview.template")}</h3>
          <p className="muted">{template.templateName}</p>
        </div>
        {onClose && <button className="icon-button" title={t("preview.close")} onClick={onClose}><X size={16} /></button>}
      </div>
      <TemplateCanvas
        template={template}
        cropPreviewRef={cropPreviewRef}
        selectedVariableId=""
        setSelectedVariableId={() => {}}
        previewValues={previewValues}
        cropImageUrl={cropImageUrl}
        cropPreviewDisplaySize={cropPreviewDisplaySize}
      />
    </aside>
  );
}

function PreviewPlaceholder({ title, text, onPreview, t = (key) => key }) {
  return (
    <div className="section-card quiet-card">
      <Eye size={30} />
      <h3>{title}</h3>
      <p className="muted">{text}</p>
      <button onClick={onPreview}><Eye size={16} /> {t("button.preview")}</button>
    </div>
  );
}

function EmptyUpload({ onPdfUpload, t }) {
  return (
    <div className="empty-state large">
      <FileText size={42} />
      <h3>{t("empty.startWithPdf")}</h3>
      <p>{t("empty.startWithPdfText")}</p>
      <label className="button primary empty-upload-button">
        <Upload size={18} /> {t("button.uploadPdf")}
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/svg+xml,image/webp" onChange={onPdfUpload} />
      </label>
    </div>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function DebugPanel({ cropDebug, renderBox, t = (key) => key }) {
  return (
    <div className="debug">
      <h3>{t("debug.coordinateTitle")}</h3>
      <p>{t("debug.renderScale", { scale: renderBox.scale.toFixed(3) })}</p>
      {cropDebug ? (
        <>
          <code>{t("debug.screen", { value: fmtRect(cropDebug.screen) })}</code>
          <code>{t("debug.ratio", { value: fmtRatio(cropDebug.ratios) })}</code>
          <code>{t("debug.pdf", { value: fmtRect(cropDebug.pdf) })}</code>
        </>
      ) : <p className="muted">{t("debug.drawCropHint")}</p>}
    </div>
  );
}

function DebugInline({ cropDebug, renderBox, t = (key) => key }) {
  return (
    <span className="debug-inline">
      {t("debug.scaleShort", { scale: renderBox.scale.toFixed(3) })}
      {cropDebug && ` · ${fmtRatio(cropDebug.ratios)}`}
    </span>
  );
}

function autoMapping(variables, headers, existing = {}) {
  const next = { ...existing };
  variables.forEach((variable) => {
    if (!next[variable.id]) next[variable.id] = headers.find((header) => header === variable.key) ?? headers[0] ?? "";
  });
  return next;
}

function mappingKey(templateId, csvId) {
  return `${templateId}::${csvId}`;
}

function normalizeLayout(input) {
  if (!input) return { ...defaultLayout };
  const next = { ...defaultLayout, ...input };
  if (typeof input.marginX === "number" && typeof input.manualLeft !== "number") {
    next.manualLeft = input.marginX;
  }
  if (typeof input.marginX === "number" && typeof input.manualRight !== "number") {
    next.manualRight = input.marginX;
  }
  if (typeof input.marginY === "number" && typeof input.manualTop !== "number") {
    next.manualTop = input.marginY;
  }
  if (typeof input.gapX === "number" && typeof input.manualGapX !== "number") next.manualGapX = input.gapX;
  if (typeof input.gapY === "number" && typeof input.manualGapY !== "number") next.manualGapY = input.gapY;
  next.customPaperWidth = clampNumber(next.customPaperWidth, 120, 2400);
  next.customPaperHeight = clampNumber(next.customPaperHeight, 120, 2400);
  next.manualTemplateWidth = clampNumber(next.manualTemplateWidth, 8, 2000);
  next.manualTemplateHeight = clampNumber(next.manualTemplateHeight, 8, 2000);
  next.manualTop = clampNumber(next.manualTop, 0, 600);
  next.manualLeft = clampNumber(next.manualLeft, 0, 600);
  next.manualRight = clampNumber(next.manualRight, 0, 600);
  next.manualGapX = clampNumber(next.manualGapX, 0, 400);
  next.manualGapY = clampNumber(next.manualGapY, 0, 400);
  next.printBorderEnabled = Boolean(next.printBorderEnabled);
  if (next.printBorderStyle !== "dashed" && next.printBorderStyle !== "solid") {
    next.printBorderStyle = "solid";
  }
  next.printBorderWidth = clampNumber(next.printBorderWidth ?? 0.1, 0.05, 5);
  return next;
}

function remapTemplateMappingKeys(importedMappings, oldTemplateId, newTemplateId) {
  const entries = Object.entries(importedMappings || {});
  if (!entries.length) return {};
  const oldPrefix = oldTemplateId ? `${oldTemplateId}::` : "";
  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (key === oldTemplateId) return [newTemplateId, value];
      if (oldPrefix && key.startsWith(oldPrefix)) return [`${newTemplateId}::${key.slice(oldPrefix.length)}`, value];
      if (!oldTemplateId && key.includes("::")) return [key, value];
      return [newTemplateId, value];
    }),
  );
}

function sanitizeTemplateCsvHeaderMapping(mapping) {
  if (!mapping || typeof mapping !== "object") return {};
  return Object.fromEntries(
    Object.entries(mapping)
      .map(([key, value]) => [key, String(value ?? "").trim()])
      .filter(([_key, value]) => value),
  );
}

function extractLegacyTemplateMapping(legacyMappings, templateId = "", preferredCsvId = "") {
  if (!legacyMappings || typeof legacyMappings !== "object") return {};
  const direct = templateId && legacyMappings[templateId] && typeof legacyMappings[templateId] === "object"
    ? legacyMappings[templateId]
    : null;
  if (direct) return sanitizeTemplateCsvHeaderMapping(direct);
  const preferredKey = templateId && preferredCsvId ? mappingKey(templateId, preferredCsvId) : "";
  if (preferredKey && legacyMappings[preferredKey] && typeof legacyMappings[preferredKey] === "object") {
    return sanitizeTemplateCsvHeaderMapping(legacyMappings[preferredKey]);
  }
  const fallbackEntry = Object.entries(legacyMappings).find(([key, value]) => key.startsWith(`${templateId}::`) && value && typeof value === "object");
  return fallbackEntry ? sanitizeTemplateCsvHeaderMapping(fallbackEntry[1]) : {};
}

function migrateTemplatesWithLegacyMappings(templates, legacyMappings = {}, preferredCsvId = "") {
  return (templates ?? []).map((template) => {
    const directMapping = sanitizeTemplateCsvHeaderMapping(template?.csvHeaderMapping);
    const fallbackMapping = extractLegacyTemplateMapping(legacyMappings, template?.templateId ?? "", preferredCsvId);
    return {
      ...template,
      csvHeaderMapping: Object.keys(directMapping).length ? directMapping : fallbackMapping,
    };
  });
}

function resolveTemplateCsvHeaderMapping(template, dataset, activeCsvId, legacyMappings = {}) {
  if (!template) return {};
  const templateMapping = sanitizeTemplateCsvHeaderMapping(template.csvHeaderMapping);
  if (Object.keys(templateMapping).length) return templateMapping;
  const legacy = extractLegacyTemplateMapping(legacyMappings, template.templateId, activeCsvId);
  if (Object.keys(legacy).length) return legacy;

  const headers = new Set((dataset?.headers ?? []).map((header) => String(header).trim()));
  if (!headers.size) return {};
  return template.variables.reduce((acc, variable) => {
    const candidates = [variable.displayName, variable.key]
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
    const matchedHeader = candidates.find((name) => headers.has(name));
    if (matchedHeader) acc[variable.id] = matchedHeader;
    return acc;
  }, {});
}

function getMissingTemplateHeaders(template, dataset, mapping) {
  if (!template?.variables?.length || !dataset?.headers?.length) return [];
  const rules = Array.isArray(template.rules) ? template.rules : [];
  return template.variables
    .map((variable) => {
      const source = mapping?.[variable.id] ?? "";
      if (!source) return null;
      if (isMappingFunction(source)) return null;
      if (isRuleSource(source)) {
        const ruleId = String(source).replace(RULE_SOURCE_PREFIX, "");
        const rule = rules.find((item) => item.id === ruleId);
        if (!rule) return source;
        const checkedHeader = String(variable.key ?? rule.sourceHeader ?? "").trim();
        return checkedHeader && dataset.headers.includes(checkedHeader) ? null : checkedHeader;
      }
      return dataset.headers.includes(source) ? null : source;
    })
    .filter((header, index, items) => header && items.indexOf(header) === index);
}

function drawTemplateBorder(page, x, y, width, height, borderStyle = "solid", borderWidth = 0.1) {
  const borderColor = rgb(0.38, 0.47, 0.58);
  const resolvedBorderWidth = Math.max(0.05, Number(borderWidth) || 0.1);
  if (borderStyle === "dashed") {
    const dashedLine = { color: borderColor, thickness: resolvedBorderWidth, dashArray: [resolvedBorderWidth * 3.2, resolvedBorderWidth * 2.1] };
    page.drawLine({ start: { x, y }, end: { x: x + width, y }, ...dashedLine });
    page.drawLine({ start: { x, y: y + height }, end: { x: x + width, y: y + height }, ...dashedLine });
    page.drawLine({ start: { x, y }, end: { x, y: y + height }, ...dashedLine });
    page.drawLine({ start: { x: x + width, y }, end: { x: x + width, y: y + height }, ...dashedLine });
    return;
  }
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor,
    borderWidth: resolvedBorderWidth,
  });
}

function getFlowStatus(workMode, template, dataset, mapping, selectedRowIds) {
  const mappedCount = template?.variables.filter((variable) => mapping?.[variable.id]).length ?? 0;
  if (workMode === "design") {
    return {
      setup: template ? "done" : "waiting",
      template: template?.cropArea && template?.savedLayout ? "done" : template?.cropArea ? "warning" : template ? "warning" : "waiting",
      templates: template ? "done" : "waiting",
      designer: template?.cropArea && template.variables.length ? "done" : template?.cropArea ? "warning" : "waiting",
      csv: "waiting",
      mapping: template?.variables.length && mappedCount === template.variables.length ? "done" : mappedCount ? "warning" : template?.variables.length ? "warning" : "waiting",
      layout: template?.cropArea ? "done" : template ? "warning" : "waiting",
      export: "waiting",
    };
  }
  return {
    setup: template && dataset ? "done" : template || dataset ? "warning" : "waiting",
    template: template?.cropArea && template?.variables?.length && dataset && selectedRowIds.length ? "done" : template ? "warning" : "waiting",
    templates: template ? "done" : "waiting",
    designer: template?.cropArea && template.variables.length ? "done" : template?.cropArea ? "warning" : "waiting",
    csv: dataset ? "done" : "waiting",
    mapping: template?.variables.length && mappedCount === template.variables.length ? "done" : mappedCount ? "warning" : "waiting",
    layout: selectedRowIds.length ? "done" : "warning",
    export: template?.cropArea && dataset && selectedRowIds.length ? "ready" : "waiting",
  };
}

function safeFileName(name) {
  return String(name || "template")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function formatLocalDateTime(value, language = "en") {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const locale = language === "ja" ? "ja-JP" : undefined;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
    timeZoneName: "short",
  }).format(parsed);
}

function getPrintableRows(dataset, selectedRowIds) {
  if (!dataset?.rows?.length) return [];
  if (!selectedRowIds.length) return dataset.rows;
  return selectedRowIds
    .map((id) => dataset.rows[Number(id)])
    .filter(Boolean);
}

function sampleValue(dataset, header, rules = []) {
  if (isMappingFunction(header)) return resolveMappedValue(header, {}, rules);
  if (isRuleSource(header)) {
    const rule = rules.find((item) => ruleSourceId(item.id) === header) ?? null;
    return resolveMappedValue(header, {}, rules, rule?.sourceHeader ?? "");
  }
  const value = dataset?.rows?.find((row) => row[header] !== undefined && row[header] !== "")?.[header];
  return value ? `sample: ${value}` : "-";
}

function getPrintableRowEntries(dataset, selectedRowIds) {
  if (!dataset?.rows?.length) return [];
  const ids = selectedRowIds.length ? selectedRowIds : dataset.rows.map((_, index) => String(index));
  return ids
    .map((id) => ({ row: dataset.rows[Number(id)], index: String(id) }))
    .filter((entry) => entry.row);
}

function getRowCopyCount(rowCopies, rowId) {
  return Math.max(1, Number(rowCopies?.[rowId]) || 1);
}

function previewValuesFromRow(template, dataset, mapping, row) {
  if (!template) return {};
  const currentRow = row ?? {};
  return template.variables.reduce((values, variable) => {
    const source = mapping?.[variable.id];
    const value = resolveMappedValue(source, currentRow, template.rules ?? [], variable.key);
    if (source && value !== "") values[variable.id] = String(value);
    return values;
  }, {});
}

function isMappingFunction(source) {
  return typeof source === "string" && source.startsWith(MAPPING_FUNCTION_PREFIX);
}

function isRuleSource(source) {
  return typeof source === "string" && source.startsWith(RULE_SOURCE_PREFIX);
}

function ruleSourceId(ruleId) {
  return `${RULE_SOURCE_PREFIX}${String(ruleId ?? "")}`;
}

function formatTodayDate(format) {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  if (format === "yyyy/mm/dd") return `${yyyy}/${mm}/${dd}`;
  if (format === "yyyymmdd") return `${yyyy}${mm}${dd}`;
  return "";
}

function resolveMappedValue(source, row, rules = [], sourceHeader = "") {
  if (!source) return "";
  if (isRuleSource(source)) {
    const ruleId = String(source).replace(RULE_SOURCE_PREFIX, "");
    const rule = rules.find((item) => item.id === ruleId) ?? null;
    if (!rule) return "";
    const resolvedHeader = String(sourceHeader || rule.sourceHeader || "").trim();
    const rawValue = resolvedHeader ? (row?.[resolvedHeader] ?? "") : "";
    const text = rawValue === undefined || rawValue === null ? "" : String(rawValue);
    return applyRuleToValue(text, rule);
  }
  if (!isMappingFunction(source)) {
    const value = row?.[source];
    return value === undefined || value === null ? "" : String(value);
  }
  if (source === `${MAPPING_FUNCTION_PREFIX}today_yyyy_mm_dd`) return formatTodayDate("yyyy/mm/dd");
  if (source === `${MAPPING_FUNCTION_PREFIX}today_yyyymmdd`) return formatTodayDate("yyyymmdd");
  return "";
}

function applyRuleToValue(value, rule) {
  if (!rule) return value;
  const normalized = String(value ?? "").trim();
  const delimiter = rule.delimiter === "custom" ? (rule.customDelimiter ?? "") : rule.delimiter === "comma" ? "," : rule.delimiter === "dot" ? "." : " ";
  const parts = normalized ? normalized.split(delimiter).map((part) => part.trim()).filter(Boolean) : [];
  if (!parts.length) return rule.fallback || "";
  const tokenIndex = Math.max(0, Number(rule.tokenIndex ?? 0) || 0);
  if (rule.action === "first-token") return parts[0] || rule.fallback || "";
  if (rule.action === "last-token") return parts[parts.length - 1] || rule.fallback || "";
  if (rule.action === "index-token") return parts[Math.min(tokenIndex, parts.length - 1)] || rule.fallback || "";
  if (rule.action === "first-nonempty") {
    return parts.find(Boolean) || rule.fallback || "";
  }
  return parts[0] || rule.fallback || "";
}

function mappingSourceLabel(source, t, rules = []) {
  if (isRuleSource(source)) {
    const ruleId = String(source).replace(RULE_SOURCE_PREFIX, "");
    const found = rules.find((rule) => rule.id === ruleId);
    return found ? (found.name || found.sourceHeader) : source;
  }
  if (isMappingFunction(source)) {
    const found = MAPPING_FUNCTIONS.find((item) => item.key === source);
    return found ? t(found.labelKey) : source;
  }
  return source;
}

function getCropPointSize(template, fallbackPageSize = null) {
  const page = template?.sourcePdf?.pageSize ?? fallbackPageSize;
  if (!page || !template?.cropArea) return null;
  return {
    width: template.cropArea.widthRatio * page.width,
    height: template.cropArea.heightRatio * page.height,
  };
}

function getPrintedTemplateSize(layout, cropSize) {
  if (!cropSize) return null;
  const metrics = getPrintMetrics(layout, cropSize, null);
  if (!metrics.valid) return null;
  return { width: metrics.itemWidth, height: metrics.itemHeight };
}

function getPrintMetrics(layout, cropSize, templatePrintSizeCm = null) {
  const paper = orientedPaper(layout);
  const columns = Math.max(1, Number(layout.columns) || 1);
  const rows = Math.max(1, Number(layout.rows) || 1);
  const slotsPerPage = Math.max(1, columns * rows);
  const printMode = layout.printMode === "manual" ? "manual" : "auto";
  const errors = [];

  if (printMode === "manual") {
    const actualSize = templatePrintSizeCm
      ? { width: cmToPoints(templatePrintSizeCm.width), height: cmToPoints(templatePrintSizeCm.height) }
      : cropSize
        ? { width: cropSize.width, height: cropSize.height }
        : { width: layout.manualTemplateWidth, height: layout.manualTemplateHeight };
    const fitSize = { width: layout.manualTemplateWidth, height: layout.manualTemplateHeight };
    const sourceSize = layout.sizeMode === "actual" ? actualSize : fitSize;
    const itemWidth = Math.max(2, Number(sourceSize.width) || 2);
    const itemHeight = Math.max(2, Number(sourceSize.height) || 2);
    const leftGap = Math.max(0, Number(layout.manualLeft) || 0);
    const manualRight = Math.max(0, Number(layout.manualRight) || 0);
    const topGap = Math.max(0, Number(layout.manualTop) || 0);
    const gapY = Math.max(0, Number(layout.manualGapY) || 0);
    const columnGaps = Math.max(0, columns - 1);
    const availableGapWidth = paper.width - leftGap - manualRight - columns * itemWidth;
    const gapX = layout.manualAutoGapX && columnGaps > 0
      ? Math.max(0, availableGapWidth / columnGaps)
      : Math.max(0, Number(layout.manualGapX) || 0);
    const usedWidthNoRight = leftGap + columns * itemWidth + Math.max(0, columns - 1) * gapX;
    const rightGapRaw = paper.width - usedWidthNoRight;
    const rightGap = Math.max(0, rightGapRaw);
    const usedWidth = usedWidthNoRight + rightGap;
    const usedHeight = topGap + rows * itemHeight + Math.max(0, rows - 1) * gapY;
    const bottomGap = paper.height - usedHeight;
    if (layout.manualAutoGapX && columnGaps > 0 && availableGapWidth < -0.01) errors.push("Horizontal size exceeds paper.");
    if (rightGapRaw < -0.01) errors.push("Horizontal size exceeds paper.");
    if (usedWidth - paper.width > 0.01) errors.push("Horizontal size exceeds paper.");
    if (bottomGap < -0.01) errors.push("Vertical size exceeds paper.");
    const valid = errors.length === 0;
    const safeBottom = Math.max(0, bottomGap);
    return {
      valid,
      errors,
      printMode,
      paper,
      columns,
      rows,
      slotsPerPage,
      itemWidth,
      itemHeight,
      gapX,
      gapY,
      leftGap,
      rightGap,
      topGap,
      bottomGap: safeBottom,
      rightGapComputed: rightGap,
      variableScale: cropSize
        ? Math.min(itemWidth / Math.max(1, cropSize.width), itemHeight / Math.max(1, cropSize.height))
        : 1,
      slotPosition(slot) {
        const column = slot % columns;
        const rowIndex = Math.floor(slot / columns);
        const x = leftGap + column * (itemWidth + gapX);
        const y = paper.height - topGap - (rowIndex + 1) * itemHeight - rowIndex * gapY;
        return { x, y };
      },
    };
  }

  const cellWidth = (paper.width - layout.marginX * 2 - layout.gapX * Math.max(0, columns - 1)) / columns;
  const cellHeight = (paper.height - layout.marginY * 2 - layout.gapY * Math.max(0, rows - 1)) / rows;
  const baseCrop = cropSize ?? { width: cellWidth, height: cellHeight };
  const variableScale = layout.sizeMode === "actual" ? 1 : Math.min(cellWidth / baseCrop.width, cellHeight / baseCrop.height);
  const itemWidth = baseCrop.width * variableScale;
  const itemHeight = baseCrop.height * variableScale;
  return {
    valid: Number.isFinite(cellWidth) && Number.isFinite(cellHeight) && cellWidth > 0 && cellHeight > 0,
    errors,
    printMode,
    paper,
    columns,
    rows,
    slotsPerPage,
    itemWidth,
    itemHeight,
    gapX: layout.gapX,
    gapY: layout.gapY,
    leftGap: layout.marginX,
    rightGap: layout.marginX,
    topGap: layout.marginY,
    bottomGap: layout.marginY,
    rightGapComputed: layout.marginX,
    variableScale,
    slotPosition(slot) {
      const column = slot % columns;
      const rowIndex = Math.floor(slot / columns);
      const x = layout.marginX + column * (cellWidth + layout.gapX) + (cellWidth - itemWidth) / 2;
      const y = paper.height - layout.marginY - (rowIndex + 1) * cellHeight - rowIndex * layout.gapY + (cellHeight - itemHeight) / 2;
      return { x, y };
    },
  };
}

function pointsToCm(points) {
  return ((points / 72) * 2.54).toFixed(1);
}

function pointsToCmNumber(points) {
  return (Number(points || 0) / PT_PER_CM);
}

function cmToPoints(cm) {
  return Number(cm || 0) * PT_PER_CM;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function rectStyle(rect) {
  return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
}

function orientedPaper(layout) {
  const paper = layout.paperSize === "Custom"
    ? {
      width: Math.max(120, Number(layout.customPaperWidth) || 595.28),
      height: Math.max(120, Number(layout.customPaperHeight) || 841.89),
    }
    : PAPER_SIZES[layout.paperSize] || PAPER_SIZES.A4;
  if (layout.orientation === "landscape") return { width: paper.height, height: paper.width };
  return paper;
}

function sourceDataUrl(source) {
  const mimeType = source?.mimeType || "application/octet-stream";
  return `data:${mimeType};base64,${source?.dataBase64 || ""}`;
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image source."));
    image.src = url;
  });
}

function expandRowEntries(entries, rowCopies) {
  return entries.flatMap((entry) => Array.from({ length: getRowCopyCount(rowCopies, entry.index) }, () => entry));
}

async function loadPdfFonts(outputDoc) {
  const [regularBytes, boldBytes] = await Promise.all([
    fetch(PDF_FONTS.regular).then(assertFontResponse).then((response) => response.arrayBuffer()),
    fetch(PDF_FONTS.bold).then(assertFontResponse).then((response) => response.arrayBuffer()),
  ]);
  // Subsetting the bundled CJK fonts can trigger PDF encoding errors for glyphs that
  // exceed the subset encoder's expected bounds during print generation.
  const regularFont = await outputDoc.embedFont(regularBytes, { subset: false });
  const boldFont = await outputDoc.embedFont(boldBytes, { subset: false });
  return { regularFont, boldFont };
}

async function loadPdfJsDocumentWithFallback(arrayBuffer) {
  try {
    const loaded = await loadPdfJsDocumentTask(new Uint8Array(arrayBuffer)).promise;
    return { loaded, normalizedBytes: null };
  } catch (originalError) {
    const normalizedBytes = await tryNormalizePdfBytes(arrayBuffer);
    if (!normalizedBytes) throw originalError;
    const loaded = await loadPdfJsDocumentTask(new Uint8Array(normalizedBytes)).promise;
    return { loaded, normalizedBytes };
  }
}

function loadPdfJsDocumentTask(data) {
  return pdfjsLib.getDocument({
    data,
    disableWorker: true,
    enableXfa: false,
    isEvalSupported: false,
    useSystemFonts: true,
    wasmUrl: PDFJS_WASM_URL,
  });
}

async function renderPdfCropToPng(pdfDocument, pageNumber, cropArea) {
  const page = await pdfDocument.getPage(pageNumber ?? 1);
  const baseViewport = page.getViewport({ scale: 1 });
  const cropPixels = ratioRectToPixels(cropArea, baseViewport.width, baseViewport.height);
  const maxSide = Math.max(1, cropPixels.width, cropPixels.height);
  const scale = Math.max(1, Math.min(4, 2200 / maxSide));
  const viewport = page.getViewport({ scale });

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = Math.max(1, Math.round(viewport.width));
  sourceCanvas.height = Math.max(1, Math.round(viewport.height));
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: false });
  if (!sourceContext) throw new Error("Failed to create source canvas context");
  await page.render({
    canvasContext: sourceContext,
    viewport,
    annotationMode: pdfjsLib.AnnotationMode?.ENABLE_FORMS,
  }).promise;

  const sourceX = clampNumber(cropPixels.x * scale, 0, sourceCanvas.width - 1);
  const sourceY = clampNumber(cropPixels.y * scale, 0, sourceCanvas.height - 1);
  const sourceWidth = clampNumber(cropPixels.width * scale, 1, sourceCanvas.width - sourceX);
  const sourceHeight = clampNumber(cropPixels.height * scale, 1, sourceCanvas.height - sourceY);
  const targetWidth = Math.max(1, Math.round(sourceWidth));
  const targetHeight = Math.max(1, Math.round(sourceHeight));

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = targetWidth;
  cropCanvas.height = targetHeight;
  const cropContext = cropCanvas.getContext("2d", { willReadFrequently: false });
  if (!cropContext) throw new Error("Failed to create crop canvas context");
  cropContext.drawImage(
    sourceCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight,
  );

  return {
    dataUrl: cropCanvas.toDataURL("image/png"),
    width: Math.max(1, cropPixels.width),
    height: Math.max(1, cropPixels.height),
  };
}

function pdfCropBoxFromViewport(rect, viewport, pageWidth, pageHeight) {
  const vx = rect.xRatio * viewport.width;
  const vy = rect.yRatio * viewport.height;
  const vw = rect.widthRatio * viewport.width;
  const vh = rect.heightRatio * viewport.height;
  const corners = [
    viewportPointToPdf(vx, vy, viewport.transform),
    viewportPointToPdf(vx + vw, vy, viewport.transform),
    viewportPointToPdf(vx, vy + vh, viewport.transform),
    viewportPointToPdf(vx + vw, vy + vh, viewport.transform),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = clampNumber(Math.min(...xs), 0, pageWidth);
  const maxX = clampNumber(Math.max(...xs), 0, pageWidth);
  const minY = clampNumber(Math.min(...ys), 0, pageHeight);
  const maxY = clampNumber(Math.max(...ys), 0, pageHeight);
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { x: minX, y: minY, width, height };
}

function viewportPointToPdf(x, y, transform) {
  const [a, b, c, d, e, f] = transform;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) {
    return { x: 0, y: 0 };
  }
  const dx = x - e;
  const dy = y - f;
  return {
    x: (d * dx - c * dy) / det,
    y: (-b * dx + a * dy) / det,
  };
}

async function tryNormalizePdfBytes(arrayBuffer) {
  try {
    const doc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true });
    const bytes = await doc.save({ useObjectStreams: false });
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  } catch {
    return null;
  }
}

function assertFontResponse(response) {
  if (!response.ok) {
    throw new Error(runtimeT("status.fontLoadFailed", { status: response.status, url: response.url }));
  }
  return response;
}

async function decodeCsvFile(file, selectedEncoding) {
  const buffer = await file.arrayBuffer();
  if (selectedEncoding !== "auto") {
    return { text: decodeText(buffer, selectedEncoding), encoding: selectedEncoding, detected: false };
  }

  const utf8Text = decodeText(buffer, "utf-8");
  if (isCleanUtf8Csv(utf8Text)) {
    return { text: utf8Text, encoding: "utf-8", detected: true };
  }

  const candidates = ["utf-8", "shift_jis", "gb18030", "big5"];
  const decoded = candidates
    .map((encoding) => tryDecodeCsvCandidate(buffer, encoding))
    .filter(Boolean);
  if (!decoded.length) throw new Error(runtimeT("status.csvDecodeFailed"));
  decoded.sort((a, b) => b.score - a.score);
  return { text: decoded[0].text, encoding: decoded[0].encoding, detected: true };
}

function tryDecodeCsvCandidate(buffer, encoding) {
  try {
    const text = decodeText(buffer, encoding);
    return { text, encoding, score: scoreDecodedCsv(text) };
  } catch {
    return null;
  }
}

function decodeText(buffer, encoding) {
  const decoder = new TextDecoder(encoding, { fatal: false });
  return decoder.decode(buffer).replace(/^\uFEFF/, "");
}

function scoreDecodedCsv(text) {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  const kanaCount = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const commaCount = (text.match(/[,;\t]/g) || []).length;
  const lineCount = (text.match(/\r\n|\n|\r/g) || []).length;
  const mojibakeCount = (text.match(/[繧縺譁莨荳蜷鬟]/g) || []).length;
  return cjkCount * 2 + kanaCount * 4 + commaCount + lineCount - replacementCount * 30 - mojibakeCount * 12;
}

function isCleanUtf8Csv(text) {
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (replacementCount > 0) return false;
  const separators = (text.match(/[,;\t]/g) || []).length;
  const lines = (text.match(/\r\n|\n|\r/g) || []).length;
  const cjkCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
  return separators > 0 && lines > 0 && cjkCount > 0;
}

function encodingLabel(encoding = "utf-8", t = null) {
  const item = CSV_ENCODINGS.find((entry) => entry.value === encoding);
  if (item?.labelKey) return t ? t(item.labelKey) : runtimeT(item.labelKey);
  return encoding.toUpperCase();
}

function fitFontSize(text, size, width, height, autoFit, font) {
  if (!autoFit) return size;
  let next = size;
  while (
    next > 4
    && (font.widthOfTextAtSize(text, next) > width || next * 1.12 > height)
  ) {
    next -= 0.5;
  }
  return next;
}

function downloadBlobUrl(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function buildButtonTooltip(label, t) {
  const text = String(label || "").trim();
  if (!text) return t("common.buttonAction");
  const hasJapanese = /[\u3040-\u30ff\u3400-\u9fff]/.test(text);
  if (hasJapanese) return `クリックして${text}します。`;
  return `Click to ${text.toLowerCase()}.`;
}

function alignX(box, textWidth, alignValue) {
  if (alignValue === "right") return box.x + box.width - textWidth;
  if (alignValue === "center") return box.x + (box.width - textWidth) / 2;
  return box.x;
}

function alignY(box, size, alignValue) {
  if (alignValue === "top") return box.y + box.height - size;
  if (alignValue === "middle") return box.y + (box.height - size) / 2;
  return box.y;
}

function normalizeTextRotation(value) {
  const rotation = Number(value);
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

function alignBoxX(box, contentWidth, alignValue) {
  if (alignValue === "right") return box.x + box.width - contentWidth;
  if (alignValue === "center") return box.x + (box.width - contentWidth) / 2;
  return box.x;
}

function alignBoxY(box, contentHeight, alignValue) {
  if (alignValue === "top") return box.y + box.height - contentHeight;
  if (alignValue === "middle") return box.y + (box.height - contentHeight) / 2;
  return box.y;
}

function rotatedTextOrigin(box, textWidth, textHeight, textAlign, verticalAlign, rotation) {
  const normalized = normalizeTextRotation(rotation);
  if (normalized === 0) {
    return {
      x: alignX(box, textWidth, textAlign),
      y: alignY(box, textHeight, verticalAlign),
    };
  }
  const rotatedWidth = normalized === 90 || normalized === 270 ? textHeight : textWidth;
  const rotatedHeight = normalized === 90 || normalized === 270 ? textWidth : textHeight;
  const left = alignBoxX(box, rotatedWidth, textAlign);
  const bottom = alignBoxY(box, rotatedHeight, verticalAlign);
  if (normalized === 90) {
    return { x: left + textHeight, y: bottom };
  }
  if (normalized === 180) {
    return { x: left + textWidth, y: bottom + textHeight };
  }
  return { x: left, y: bottom + textWidth };
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function normalizeColor(value) {
  return value && value !== "transparent" ? value : "#ffffff";
}

function resolveFieldBackgroundColor(value, fallback = "transparent") {
  if (!value || value === "transparent") return fallback;
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, "");
  const isWhiteRgba = /^rgba\(255,255,255,(0|0?\.\d+|1(?:\.0+)?)\)$/.test(normalized);
  const isWhiteRgb = /^rgb\(255,255,255\)$/.test(normalized);
  if (
    normalized === "white"
    || normalized === "#fff"
    || normalized === "#ffffff"
    || normalized === "#ffffffff"
    || isWhiteRgb
    || isWhiteRgba
  ) {
    return "#ffffff";
  }
  return value;
}

function justify(value) {
  return { left: "flex-start", center: "center", right: "flex-end" }[value] ?? "center";
}

function align(value) {
  return { top: "flex-start", middle: "center", bottom: "flex-end" }[value] ?? "center";
}

function fmtRect(rect) {
  return `x:${rect.x.toFixed(1)} y:${rect.y.toFixed(1)} w:${rect.width.toFixed(1)} h:${rect.height.toFixed(1)}`;
}

function fmtRatio(rect) {
  return `x:${rect.xRatio.toFixed(4)} y:${rect.yRatio.toFixed(4)} w:${rect.widthRatio.toFixed(4)} h:${rect.heightRatio.toFixed(4)}`;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function dataUrlToArrayBuffer(dataUrl) {
  const base64Payload = String(dataUrl).split(",")[1] || "";
  return base64ToArrayBuffer(base64Payload);
}

createRoot(document.getElementById("root")).render(<App />);



