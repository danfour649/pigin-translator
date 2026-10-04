export type Correction = {
  english: string;
  naija: string;
  yoruba: string;
  note: string;
};

export type CatalogItem = {
  id: string;
  english: string;
  naija: string;
  yoruba: string;
  modelId: string;
  modelLabel: string;
  savedAt: string;
  correction: Correction | null;
};

export const CATALOG_STORAGE_KEY = "pigin.catalog";

const CATALOG_EVENT = "pigin-catalog-change";
const EMPTY_CATALOG: CatalogItem[] = [];

let cachedRaw: string | null | undefined;
let cachedItems: CatalogItem[] = EMPTY_CATALOG;

export function emptyCorrection(): Correction {
  return { english: "", naija: "", yoruba: "", note: "" };
}

export function parseCatalog(raw: string | null): CatalogItem[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const valid = asCatalogItem(item);
      return valid ? [valid] : [];
    });
  } catch {
    return [];
  }
}

export function getCatalogSnapshot(): CatalogItem[] {
  if (typeof window === "undefined") return EMPTY_CATALOG;
  const raw = window.localStorage.getItem(CATALOG_STORAGE_KEY);
  if (raw === cachedRaw) return cachedItems;
  cachedRaw = raw;
  cachedItems = parseCatalog(raw);
  return cachedItems;
}

export function getServerCatalogSnapshot(): CatalogItem[] {
  return EMPTY_CATALOG;
}

export function subscribeCatalog(onStoreChange: () => void) {
  const notify = () => onStoreChange();
  window.addEventListener("storage", notify);
  window.addEventListener(CATALOG_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(CATALOG_EVENT, notify);
  };
}

export function addCatalogItem(item: CatalogItem) {
  writeCatalog([item, ...getCatalogSnapshot()]);
}

export function updateCatalogCorrection(id: string, correction: Correction) {
  writeCatalog(
    getCatalogSnapshot().map((item) =>
      item.id === id ? { ...item, correction } : item,
    ),
  );
}

export function removeCatalogItem(id: string) {
  writeCatalog(getCatalogSnapshot().filter((item) => item.id !== id));
}

function writeCatalog(items: CatalogItem[]) {
  const raw = JSON.stringify(items);
  window.localStorage.setItem(CATALOG_STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedItems = items;
  window.dispatchEvent(new Event(CATALOG_EVENT));
}

function asCatalogItem(value: unknown): CatalogItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CatalogItem>;
  if (
    typeof record.id !== "string" ||
    typeof record.english !== "string" ||
    typeof record.naija !== "string" ||
    typeof record.yoruba !== "string" ||
    typeof record.modelId !== "string" ||
    typeof record.modelLabel !== "string" ||
    typeof record.savedAt !== "string"
  ) {
    return null;
  }

  return {
    id: record.id,
    english: record.english,
    naija: record.naija,
    yoruba: record.yoruba,
    modelId: record.modelId,
    modelLabel: record.modelLabel,
    savedAt: record.savedAt,
    correction: asCorrection(record.correction),
  };
}

function asCorrection(value: unknown): Correction | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Correction>;
  return {
    english: typeof record.english === "string" ? record.english : "",
    naija: typeof record.naija === "string" ? record.naija : "",
    yoruba: typeof record.yoruba === "string" ? record.yoruba : "",
    note: typeof record.note === "string" ? record.note : "",
  };
}
