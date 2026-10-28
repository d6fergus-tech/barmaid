"use client";

import React, {
  useState,
  useRef,
  useMemo,
  useEffect,
  useCallback,
  ChangeEvent,
  DragEvent,
  MouseEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PipelineHeader, {
  type PipelineStepNumber,
} from "@/app/components/PipelineHeader";
import type {
  InvoiceOcrResponse,
  InvoiceRetailItem,
  InvoiceModifierOption,
  InvoiceOperationalSupply,
} from "@/app/api/ocr/invoice/route";

export const INTAKE_STAGE_STORAGE_KEY = "barmaid_intake_stage";

type DropzoneKey = "license" | "menu" | "invoice";

export type ItemClassification =
  | "food"
  | "drink"
  | "modifier_option"
  | "retail_item"
  | "operational_supply";

export const CLASSIFICATION_OPTIONS: ReadonlyArray<{
  value: ItemClassification;
  label: string;
}> = [
  { value: "food", label: "Food & Pastries" },
  { value: "drink", label: "Drinks & Beverages" },
  { value: "modifier_option", label: "Modifier Option" },
  { value: "retail_item", label: "Retail Packaged" },
  { value: "operational_supply", label: "Operational Supply" },
];

interface UploadedAsset {
  id: string;
  zone: DropzoneKey;
  fileName: string;
  fileSize: number;
  mimeType: string;
  previewUrl: string;
  status: "processing" | "ready" | "error";
  errorMessage?: string;
}

export type AddressSelectionMode = "physical" | "mailing";

export interface StoreProfileData {
  legalName: string;
  dbaName: string;
  merchantSlug: string;
  physicalAddress?: string;
  mailingAddress?: string;
  address?: string;
  selectedAddressType?: AddressSelectionMode;
  streetAddress: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface StagedCountsData {
  drinksCount: number;
  modifiersCount: number;
  retailCount: number;
  suppliesCount: number;
}

export interface UploadedFileNamesData {
  license: string[];
  menus: string[];
  invoices: string[];
}

export interface MenuVariation {
  size: string;
  price: number;
}

export interface StagedMenuItem {
  id: string;
  name: string;
  categoryName: string;
  variations: MenuVariation[];
  included: boolean;
  classification: "drink" | "food";
  sourceFileName: string;
}

export interface StagedRetailItem extends Omit<InvoiceRetailItem, "classification"> {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "retail_item";
  sourceFileName: string;
}

export interface StagedModifierOption extends Omit<InvoiceModifierOption, "classification"> {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "modifier_option";
  sourceFileName: string;
}

export interface StagedSupplyItem extends Omit<InvoiceOperationalSupply, "classification"> {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "operational_supply";
  sourceFileName: string;
}

export interface IntakeStageData {
  storeProfile: StoreProfileData;
  stagedCounts: StagedCountsData;
  stagedItems: StagedMenuItem[];
  modifiers?: StagedModifierOption[];
  retailItems?: StagedRetailItem[];
  supplies?: StagedSupplyItem[];
  uploadedFileNames: UploadedFileNamesData;
  licenseDetected?: boolean;
  stagedAt?: string;
}

export const SAVED_SESSIONS_STORAGE_KEY = "barmaid_saved_sessions";
export const RULES_CONFIG_STORAGE_KEY_REF = "barmaid_rules_config";

export interface OnboardingSessionCatalogEntry {
  id: string;
  name: string;
  classification: ItemClassification;
  categoryName?: string;
  variations?: MenuVariation[];
  targetGroup?: string;
  unitCostCents?: number;
  suggestedPriceCents?: number;
  sku?: string;
  packSize?: string;
  vendorName?: string;
  included: boolean;
  sourceFileName: string;
}

export interface OnboardingSessionRulesSnapshot {
  merchant_slug: string;
  sizeMatrix: Array<{
    size: "8oz" | "12oz" | "16oz" | "20oz" | "24oz" | "32oz";
    enabled: boolean;
    defaultShots: number;
    defaultSyrupPumps: number;
  }>;
  modifierPricing: {
    altMilkUpchargeDollars: number;
    extraShotDollars: number;
    syrupSauceAddOnDollars: number;
  };
  preferredPosPreview: "square" | "clover";
  savedAt: string;
}

export interface OnboardingSession {
  id: string;
  createdAt: string;
  storeProfile: StoreProfileData;
  counts: {
    drinks: number;
    modifiers: number;
    retail: number;
    supplies: number;
  };
  catalog: OnboardingSessionCatalogEntry[];
  stageData?: IntakeStageData;
  rulesConfig?: OnboardingSessionRulesSnapshot;
}

interface MenuOcrApiResponse {
  success?: boolean;
  error?: string;
  data?: {
    detectedStoreName?: string | null;
    categories?: Array<{
      categoryName?: string;
      items?: Array<{
        name?: string;
        description?: string;
        variations?: Array<{
          size?: string;
          price?: number;
        }>;
      }>;
    }>;
    modifiers?: Array<{
      name?: string;
      price?: number;
    }>;
  };
}

interface LicenseOcrApiResponse {
  success?: boolean;
  error?: string;
  data?: {
    legalEntityName?: string;
    legalName?: string;
    tradeName?: string;
    dbaName?: string;
    hasExplicitTradeName?: boolean;
    physicalAddress?: string | null;
    mailingAddress?: string | null;
    address?: string | null;
    streetAddress?: string;
    city?: string;
    state?: string;
    zip?: string;
    zipCode?: string;
    suggestedSlug?: string;
    merchantSlug?: string;
  };
}

const MODIFIER_GROUPS = [
  "Flavor Syrups",
  "Sauces",
  "Milk Options",
  "Powders & Frappe Bases",
  "Energy & Boosters",
  "Sweeteners & Toppings",
] as const;

const EMPTY_STORE_PROFILE: StoreProfileData = {
  legalName: "",
  dbaName: "",
  merchantSlug: "",
  physicalAddress: "",
  mailingAddress: "",
  address: "",
  selectedAddressType: "physical",
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
};

function parseCityStateZipFromAddress(rawAddress: string): {
  city?: string;
  state?: string;
  zip?: string;
} {
  if (!rawAddress) return {};
  // Match "... , City, ST 98901" or "... City, WA 98901-1234"
  const match = rawAddress.match(
    /,\s*([A-Za-z .'-]+?)\s*,\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/i
  );
  if (match) {
    return {
      city: match[1].trim(),
      state: match[2].toUpperCase(),
      zip: match[3].trim(),
    };
  }
  return {};
}

export function toSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(12oz|16oz|20oz|24oz|32oz|hot|iced)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatCents(cents?: number): string {
  if (typeof cents !== "number" || Number.isNaN(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatFileCountBadge(count: number): string {
  return `${count} ${count === 1 ? "File" : "Files"}`;
}

function inferFoodOrDrink(name: string, categoryName: string): "food" | "drink" {
  const combined = `${name} ${categoryName}`;
  if (
    /muffin|scone|cookie|treat|crispy|bagel|croissant|burrito|sandwich|pastry|food|bakery|snack|cake|brownie|toast|biscotti|waffle/i.test(
      combined
    )
  ) {
    return "food";
  }
  return "drink";
}

function getClassificationSelectClasses(classification: ItemClassification): string {
  switch (classification) {
    case "food":
      return "bg-slate-950 border-purple-700/70 text-purple-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
    case "drink":
      return "bg-slate-950 border-cyan-700/70 text-cyan-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
    case "modifier_option":
      return "bg-slate-950 border-amber-700/70 text-amber-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
    case "retail_item":
      return "bg-slate-950 border-emerald-700/70 text-emerald-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
    case "operational_supply":
      return "bg-slate-950 border-slate-700 text-slate-300 focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
  }
}

export function buildCatalogFromStage(
  stage: IntakeStageData
): OnboardingSessionCatalogEntry[] {
  const entries: OnboardingSessionCatalogEntry[] = [];

  (stage.stagedItems || []).forEach((item) => {
    entries.push({
      id: item.id,
      name: item.name,
      classification: item.classification || "drink",
      categoryName: item.categoryName,
      variations: item.variations,
      included: item.included,
      sourceFileName: item.sourceFileName,
    });
  });

  (stage.modifiers || []).forEach((mod) => {
    entries.push({
      id: mod.id,
      name: mod.name,
      classification: "modifier_option",
      targetGroup: mod.targetGroup,
      unitCostCents: mod.unitCostCents,
      vendorName: mod.vendorName,
      included: mod.included,
      sourceFileName: mod.sourceFileName,
    });
  });

  (stage.retailItems || []).forEach((ret) => {
    entries.push({
      id: ret.id,
      name: ret.name,
      classification: "retail_item",
      unitCostCents: ret.unitCostCents,
      suggestedPriceCents: ret.suggestedPriceCents,
      sku: ret.sku,
      vendorName: ret.vendorName,
      included: ret.included,
      sourceFileName: ret.sourceFileName,
    });
  });

  (stage.supplies || []).forEach((sup) => {
    entries.push({
      id: sup.id,
      name: sup.name,
      classification: "operational_supply",
      packSize: sup.packSize,
      vendorName: sup.vendorName,
      included: sup.included,
      sourceFileName: sup.sourceFileName,
    });
  });

  return entries;
}

export function readSavedSessionsFromStorage(): OnboardingSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem(SAVED_SESSIONS_STORAGE_KEY) ||
      sessionStorage.getItem(SAVED_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as OnboardingSession[]) : [];
  } catch {
    return [];
  }
}

export function writeSavedSessionsToStorage(
  sessions: OnboardingSession[]
): void {
  if (typeof window === "undefined") return;
  try {
    const serialized = JSON.stringify(sessions);
    localStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, serialized);
    sessionStorage.setItem(SAVED_SESSIONS_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota errors
  }
}

export function upsertSessionInArchive(
  stage: IntakeStageData,
  rulesOverride?: OnboardingSessionRulesSnapshot
): OnboardingSession[] {
  if (typeof window === "undefined") return [];

  const resolvedSlug =
    stage.storeProfile.merchantSlug ||
    toSlug(stage.storeProfile.dbaName || stage.storeProfile.legalName);

  const hasAnyItems =
    (stage.stagedItems?.length || 0) +
      (stage.modifiers?.length || 0) +
      (stage.retailItems?.length || 0) +
      (stage.supplies?.length || 0) >
    0;

  // Do not archive blank/unassigned sessions with no merchant identity and no items
  if (
    (!resolvedSlug || resolvedSlug === "unassigned") &&
    !stage.storeProfile.dbaName &&
    !stage.storeProfile.legalName &&
    !hasAnyItems
  ) {
    return readSavedSessionsFromStorage();
  }

  const uniqueSlug =
    resolvedSlug && resolvedSlug !== "unassigned"
      ? resolvedSlug
      : `draft-${Date.now()}`;

  const existingSessions = readSavedSessionsFromStorage();
  const existingMatch = existingSessions.find(
    (s) =>
      s.storeProfile.merchantSlug === uniqueSlug || s.id === uniqueSlug
  );

  let resolvedRules = rulesOverride ?? existingMatch?.rulesConfig;
  if (!resolvedRules) {
    try {
      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY_REF) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY_REF);
      if (rawRules) {
        const parsedRules = JSON.parse(
          rawRules
        ) as OnboardingSessionRulesSnapshot;
        if (
          !parsedRules.merchant_slug ||
          parsedRules.merchant_slug === uniqueSlug
        ) {
          resolvedRules = parsedRules;
        }
      }
    } catch {
      // Ignore parse errors
    }
  }

  const resolvedPrimaryAddress =
    stage.storeProfile.address ||
    stage.storeProfile.streetAddress ||
    stage.storeProfile.physicalAddress ||
    stage.storeProfile.mailingAddress ||
    "";

  const normalizedProfile: StoreProfileData = {
    legalName: stage.storeProfile.legalName || "",
    dbaName: stage.storeProfile.dbaName || "",
    merchantSlug: uniqueSlug,
    physicalAddress: stage.storeProfile.physicalAddress || "",
    mailingAddress: stage.storeProfile.mailingAddress || "",
    address: resolvedPrimaryAddress,
    selectedAddressType: stage.storeProfile.selectedAddressType || "physical",
    streetAddress: resolvedPrimaryAddress,
    city: stage.storeProfile.city || "",
    state: stage.storeProfile.state || "",
    zipCode: stage.storeProfile.zipCode || "",
  };

  const normalizedStage: IntakeStageData = {
    ...stage,
    storeProfile: normalizedProfile,
  };

  const sessionRecord: OnboardingSession = {
    id: uniqueSlug,
    createdAt: new Date().toISOString(),
    storeProfile: normalizedProfile,
    counts: {
      drinks: stage.stagedCounts.drinksCount,
      modifiers: stage.stagedCounts.modifiersCount,
      retail: stage.stagedCounts.retailCount,
      supplies: stage.stagedCounts.suppliesCount,
    },
    catalog: buildCatalogFromStage(normalizedStage),
    stageData: normalizedStage,
    rulesConfig: resolvedRules,
  };

  const filtered = existingSessions.filter(
    (s) =>
      s.storeProfile.merchantSlug !== uniqueSlug && s.id !== uniqueSlug
  );
  const nextSessions = [sessionRecord, ...filtered];
  writeSavedSessionsToStorage(nextSessions);
  return nextSessions;
}

export function deleteSessionFromArchive(
  slugOrId: string
): OnboardingSession[] {
  const existing = readSavedSessionsFromStorage();
  const next = existing.filter(
    (s) => s.id !== slugOrId && s.storeProfile.merchantSlug !== slugOrId
  );
  writeSavedSessionsToStorage(next);
  return next;
}

export function purgeAllSessionsFromArchive(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(SAVED_SESSIONS_STORAGE_KEY);
    sessionStorage.removeItem(SAVED_SESSIONS_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function clearActiveStageAndRulesFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(INTAKE_STAGE_STORAGE_KEY);
    sessionStorage.removeItem(INTAKE_STAGE_STORAGE_KEY);
    localStorage.removeItem(RULES_CONFIG_STORAGE_KEY_REF);
    sessionStorage.removeItem(RULES_CONFIG_STORAGE_KEY_REF);

    const localKeysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (
        k &&
        k !== SAVED_SESSIONS_STORAGE_KEY &&
        (k.startsWith("barmaid_pos_auth_") ||
          k.startsWith("barmaid_studio_") ||
          k === INTAKE_STAGE_STORAGE_KEY ||
          k === RULES_CONFIG_STORAGE_KEY_REF)
      ) {
        localKeysToRemove.push(k);
      }
    }
    localKeysToRemove.forEach((k) => localStorage.removeItem(k));

    const sessionKeysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (
        k &&
        k !== SAVED_SESSIONS_STORAGE_KEY &&
        (k.startsWith("barmaid_pos_auth_") ||
          k.startsWith("barmaid_studio_") ||
          k === INTAKE_STAGE_STORAGE_KEY ||
          k === RULES_CONFIG_STORAGE_KEY_REF)
      ) {
        sessionKeysToRemove.push(k);
      }
    }
    sessionKeysToRemove.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    // Ignore storage errors
  }
}

export function restoreSessionToActiveStage(
  session: OnboardingSession
): IntakeStageData {
  let stageToRestore: IntakeStageData;

  if (session.stageData) {
    stageToRestore = {
      ...session.stageData,
      storeProfile: { ...session.storeProfile },
    };
  } else {
    const drinks: StagedMenuItem[] = [];
    const modifiers: StagedModifierOption[] = [];
    const retail: StagedRetailItem[] = [];
    const supplies: StagedSupplyItem[] = [];

    (session.catalog || []).forEach((entry) => {
      if (entry.classification === "drink" || entry.classification === "food") {
        drinks.push({
          id: entry.id,
          name: entry.name,
          categoryName:
            entry.categoryName ||
            (entry.classification === "food"
              ? "Food & Pastries"
              : "Drinks & Beverages"),
          variations:
            entry.variations && entry.variations.length > 0
              ? entry.variations
              : [{ size: "16oz", price: 4.75 }],
          included: entry.included,
          classification: entry.classification,
          sourceFileName: entry.sourceFileName || "session-archive",
        });
      } else if (entry.classification === "modifier_option") {
        modifiers.push({
          id: entry.id,
          name: entry.name,
          targetGroup: entry.targetGroup || "Flavor Syrups",
          unitCostCents: entry.unitCostCents,
          vendorName: entry.vendorName || "Archived Vendor",
          included: entry.included,
          classification: "modifier_option",
          sourceFileName: entry.sourceFileName || "session-archive",
        });
      } else if (entry.classification === "retail_item") {
        retail.push({
          id: entry.id,
          name: entry.name,
          unitCostCents: entry.unitCostCents,
          suggestedPriceCents: entry.suggestedPriceCents,
          sku: entry.sku,
          vendorName: entry.vendorName || "Archived Vendor",
          included: entry.included,
          classification: "retail_item",
          sourceFileName: entry.sourceFileName || "session-archive",
        });
      } else if (entry.classification === "operational_supply") {
        supplies.push({
          id: entry.id,
          name: entry.name,
          packSize: entry.packSize,
          vendorName: entry.vendorName || "Archived Vendor",
          included: entry.included,
          classification: "operational_supply",
          sourceFileName: entry.sourceFileName || "session-archive",
        });
      }
    });

    stageToRestore = {
      storeProfile: { ...session.storeProfile },
      stagedCounts: {
        drinksCount: session.counts.drinks,
        modifiersCount: session.counts.modifiers,
        retailCount: session.counts.retail,
        suppliesCount: session.counts.supplies,
      },
      stagedItems: drinks,
      modifiers,
      retailItems: retail,
      supplies,
      uploadedFileNames: {
        license: [],
        menus: [],
        invoices: [],
      },
      licenseDetected: Boolean(
        session.storeProfile.legalName || session.storeProfile.dbaName
      ),
      stagedAt: session.createdAt,
    };
  }

  try {
    const serializedStage = JSON.stringify(stageToRestore);
    localStorage.setItem(INTAKE_STAGE_STORAGE_KEY, serializedStage);
    sessionStorage.setItem(INTAKE_STAGE_STORAGE_KEY, serializedStage);

    if (session.rulesConfig) {
      const serializedRules = JSON.stringify(session.rulesConfig);
      localStorage.setItem(RULES_CONFIG_STORAGE_KEY_REF, serializedRules);
      sessionStorage.setItem(RULES_CONFIG_STORAGE_KEY_REF, serializedRules);
    } else {
      localStorage.removeItem(RULES_CONFIG_STORAGE_KEY_REF);
      sessionStorage.removeItem(RULES_CONFIG_STORAGE_KEY_REF);
    }
  } catch {
    // Ignore storage quota errors
  }

  return stageToRestore;
}

export function exportAllSessionsJson(sessions: OnboardingSession[]): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify(sessions, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "barmaid_sessions_backup.json";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSingleSessionJson(session: OnboardingSession): void {
  if (typeof window === "undefined") return;
  const slug = session.storeProfile.merchantSlug || session.id || "client";
  const payload = JSON.stringify(session, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `barmaid_${slug}_folder.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MultiSourceIntakeStagingPage() {
  const router = useRouter();

  // Multi-file upload state per dropzone (empty starting slate before hydration)
  const [licenseFiles, setLicenseFiles] = useState<UploadedAsset[]>([]);
  const [menuFiles, setMenuFiles] = useState<UploadedAsset[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<UploadedAsset[]>([]);

  // Uncontrolled DOM refs for Detected Store Info inputs:
  // Zero React state updates on keystroke -> zero viewport jumping or focus loss on iPad Safari
  const legalNameRef = useRef<HTMLInputElement>(null);
  const dbaNameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const physicalAddressRef = useRef<HTMLInputElement>(null);
  const mailingAddressRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const slugManuallyEditedRef = useRef<boolean>(false);
  const storeProfileRef = useRef<StoreProfileData>({ ...EMPTY_STORE_PROFILE });
  const isHydratedRef = useRef<boolean>(false);
  const isResettingRef = useRef<boolean>(false);

  const [activeSlugBadge, setActiveSlugBadge] = useState<string>("");
  const [activeDbaBadge, setActiveDbaBadge] = useState<string>("");
  const [selectedAddressMode, setSelectedAddressMode] =
    useState<AddressSelectionMode>("physical");
  const [detectedPhysicalBadge, setDetectedPhysicalBadge] =
    useState<string>("");
  const [detectedMailingBadge, setDetectedMailingBadge] =
    useState<string>("");
  const [licenseDetected, setLicenseDetected] = useState<boolean>(false);

  // Saved Client Sessions Archive ('barmaid_saved_sessions')
  const [savedSessions, setSavedSessions] = useState<OnboardingSession[]>([]);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState<boolean>(false);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState<boolean>(false);

  // Staged extracted data (empty starting slate before hydration)
  const [stagedMenuItems, setStagedMenuItems] = useState<StagedMenuItem[]>([]);
  const [stagedRetailItems, setStagedRetailItems] = useState<StagedRetailItem[]>([]);
  const [stagedModifiers, setStagedModifiers] = useState<StagedModifierOption[]>([]);
  const [stagedSupplies, setStagedSupplies] = useState<StagedSupplyItem[]>([]);

  // UI states
  const [activeReviewTab, setActiveReviewTab] = useState<
    "all" | "drinks" | "modifiers" | "retail" | "supplies"
  >("all");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Hidden native file input refs
  const licenseInputRef = useRef<HTMLInputElement>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  // Read current values from uncontrolled DOM inputs into storeProfileRef
  const readStoreProfileFromDom = useCallback((): StoreProfileData => {
    const legalName =
      legalNameRef.current?.value.trim() ?? storeProfileRef.current.legalName;
    const dbaName =
      dbaNameRef.current?.value.trim() ?? storeProfileRef.current.dbaName;
    const rawSlug =
      slugRef.current?.value.trim() ?? storeProfileRef.current.merchantSlug;
    const merchantSlug = toSlug(rawSlug || dbaName || legalName);
    const physicalAddress =
      physicalAddressRef.current?.value.trim() ??
      storeProfileRef.current.physicalAddress ??
      "";
    const mailingAddress =
      mailingAddressRef.current?.value.trim() ??
      storeProfileRef.current.mailingAddress ??
      "";
    const activeAddressVal =
      addressRef.current?.value.trim() ??
      storeProfileRef.current.address ??
      storeProfileRef.current.streetAddress ??
      "";
    const selectedType: AddressSelectionMode =
      storeProfileRef.current.selectedAddressType || "physical";
    const resolvedPrimaryAddress =
      activeAddressVal ||
      (selectedType === "mailing"
        ? mailingAddress || physicalAddress
        : physicalAddress || mailingAddress);

    const city = cityRef.current?.value.trim() ?? storeProfileRef.current.city;
    const state = stateRef.current?.value.trim() ?? storeProfileRef.current.state;
    const zipCode = zipRef.current?.value.trim() ?? storeProfileRef.current.zipCode;

    const snapshot: StoreProfileData = {
      legalName,
      dbaName,
      merchantSlug,
      physicalAddress,
      mailingAddress,
      address: resolvedPrimaryAddress,
      selectedAddressType: selectedType,
      streetAddress: resolvedPrimaryAddress,
      city,
      state,
      zipCode,
    };
    storeProfileRef.current = snapshot;
    return snapshot;
  }, []);

  // Write values into uncontrolled DOM inputs
  const writeStoreProfileToInputs = useCallback((profile: StoreProfileData) => {
    const mode: AddressSelectionMode = profile.selectedAddressType || "physical";
    const primaryAddr =
      profile.address ||
      profile.streetAddress ||
      (mode === "mailing"
        ? profile.mailingAddress || profile.physicalAddress || ""
        : profile.physicalAddress || profile.mailingAddress || "");

    const normalized: StoreProfileData = {
      ...profile,
      physicalAddress: profile.physicalAddress || "",
      mailingAddress: profile.mailingAddress || "",
      address: primaryAddr,
      selectedAddressType: mode,
      streetAddress: primaryAddr,
    };

    storeProfileRef.current = normalized;
    if (legalNameRef.current)
      legalNameRef.current.value = normalized.legalName || "";
    if (dbaNameRef.current)
      dbaNameRef.current.value = normalized.dbaName || "";
    if (slugRef.current)
      slugRef.current.value = normalized.merchantSlug || "";
    if (physicalAddressRef.current)
      physicalAddressRef.current.value = normalized.physicalAddress || "";
    if (mailingAddressRef.current)
      mailingAddressRef.current.value = normalized.mailingAddress || "";
    if (addressRef.current)
      addressRef.current.value = normalized.address || "";
    if (cityRef.current) cityRef.current.value = normalized.city || "";
    if (stateRef.current) stateRef.current.value = normalized.state || "";
    if (zipRef.current) zipRef.current.value = normalized.zipCode || "";

    setActiveSlugBadge(normalized.merchantSlug || "");
    setActiveDbaBadge(normalized.dbaName || normalized.legalName || "");
    setSelectedAddressMode(mode);
    setDetectedPhysicalBadge(normalized.physicalAddress || "");
    setDetectedMailingBadge(normalized.mailingAddress || "");
  }, []);

  // Build and persist canonical IntakeStageData to localStorage + auto-archive session
  const persistStageToStorage = useCallback(
    (overrides?: {
      profile?: StoreProfileData;
      drinks?: StagedMenuItem[];
      modifiers?: StagedModifierOption[];
      retail?: StagedRetailItem[];
      supplies?: StagedSupplyItem[];
      licFiles?: UploadedAsset[];
      menFiles?: UploadedAsset[];
      invFiles?: UploadedAsset[];
      licDetected?: boolean;
      archiveSession?: boolean;
    }) => {
      if (typeof window === "undefined") return;
      if (isResettingRef.current) return;

      const profile = overrides?.profile ?? readStoreProfileFromDom();
      const drinks = overrides?.drinks ?? stagedMenuItems;
      const modifiers = overrides?.modifiers ?? stagedModifiers;
      const retail = overrides?.retail ?? stagedRetailItems;
      const supplies = overrides?.supplies ?? stagedSupplies;
      const licFiles = overrides?.licFiles ?? licenseFiles;
      const menFiles = overrides?.menFiles ?? menuFiles;
      const invFiles = overrides?.invFiles ?? invoiceFiles;
      const licDetected = overrides?.licDetected ?? licenseDetected;

      const isCompletelyBlank =
        !profile.legalName &&
        !profile.dbaName &&
        !profile.merchantSlug &&
        !profile.physicalAddress &&
        !profile.mailingAddress &&
        !profile.address &&
        !profile.streetAddress &&
        !profile.city &&
        !profile.state &&
        !profile.zipCode &&
        drinks.length === 0 &&
        modifiers.length === 0 &&
        retail.length === 0 &&
        supplies.length === 0 &&
        licFiles.length === 0 &&
        menFiles.length === 0 &&
        invFiles.length === 0;

      if (isCompletelyBlank) {
        clearActiveStageAndRulesFromStorage();
        return;
      }

      const activeDrinksCount = drinks.filter((d) => d.included).length;
      const activeModifiersCount = modifiers.filter((m) => m.included).length;
      const activeRetailCount = retail.filter((r) => r.included).length;
      const excludedSuppliesCount = supplies.filter((s) => !s.included).length;

      const stagePayload: IntakeStageData = {
        storeProfile: profile,
        stagedCounts: {
          drinksCount: activeDrinksCount,
          modifiersCount: activeModifiersCount,
          retailCount: activeRetailCount,
          suppliesCount: excludedSuppliesCount,
        },
        stagedItems: drinks,
        modifiers,
        retailItems: retail,
        supplies,
        uploadedFileNames: {
          license: licFiles.map((f) => f.fileName),
          menus: menFiles.map((f) => f.fileName),
          invoices: invFiles.map((f) => f.fileName),
        },
        licenseDetected: licDetected,
        stagedAt: new Date().toISOString(),
      };

      try {
        const serialized = JSON.stringify(stagePayload);
        localStorage.setItem(INTAKE_STAGE_STORAGE_KEY, serialized);
        sessionStorage.setItem(INTAKE_STAGE_STORAGE_KEY, serialized);
      } catch {
        // Ignore storage quota errors
      }

      if (
        overrides?.archiveSession !== false &&
        Boolean(profile.merchantSlug || profile.dbaName || profile.legalName)
      ) {
        const updatedArchive = upsertSessionInArchive(stagePayload);
        setSavedSessions(updatedArchive);
      }
    },
    [
      readStoreProfileFromDom,
      stagedMenuItems,
      stagedModifiers,
      stagedRetailItems,
      stagedSupplies,
      licenseFiles,
      menuFiles,
      invoiceFiles,
      licenseDetected,
    ]
  );

  // Hydrate from localStorage on mount
  useEffect(() => {
    setSavedSessions(readSavedSessionsFromStorage());

    try {
      const raw =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<IntakeStageData>;

        if (parsed.storeProfile) {
          const mode: AddressSelectionMode =
            parsed.storeProfile.selectedAddressType || "physical";
          const hydratedPrimaryAddr =
            parsed.storeProfile.address ||
            parsed.storeProfile.streetAddress ||
            (mode === "mailing"
              ? parsed.storeProfile.mailingAddress ||
                parsed.storeProfile.physicalAddress ||
                ""
              : parsed.storeProfile.physicalAddress ||
                parsed.storeProfile.mailingAddress ||
                "");

          const hydratedProfile: StoreProfileData = {
            legalName: parsed.storeProfile.legalName || "",
            dbaName: parsed.storeProfile.dbaName || "",
            merchantSlug:
              parsed.storeProfile.merchantSlug ||
              toSlug(
                parsed.storeProfile.dbaName || parsed.storeProfile.legalName || ""
              ),
            physicalAddress: parsed.storeProfile.physicalAddress || "",
            mailingAddress: parsed.storeProfile.mailingAddress || "",
            address: hydratedPrimaryAddr,
            selectedAddressType: mode,
            streetAddress: hydratedPrimaryAddr,
            city: parsed.storeProfile.city || "",
            state: parsed.storeProfile.state || "",
            zipCode: parsed.storeProfile.zipCode || "",
          };
          writeStoreProfileToInputs(hydratedProfile);
          if (hydratedProfile.merchantSlug) {
            slugManuallyEditedRef.current = true;
          }
        }

        if (typeof parsed.licenseDetected === "boolean") {
          setLicenseDetected(parsed.licenseDetected);
        }

        if (Array.isArray(parsed.stagedItems)) {
          setStagedMenuItems(
            parsed.stagedItems.map((item) => ({
              ...item,
              classification:
                item.classification === "food" || item.classification === "drink"
                  ? item.classification
                  : inferFoodOrDrink(item.name, item.categoryName || ""),
            }))
          );
        }
        if (Array.isArray(parsed.modifiers)) {
          setStagedModifiers(parsed.modifiers);
        }
        if (Array.isArray(parsed.retailItems)) {
          setStagedRetailItems(parsed.retailItems);
        }
        if (Array.isArray(parsed.supplies)) {
          setStagedSupplies(parsed.supplies);
        }

        if (parsed.uploadedFileNames) {
          const licNames = Array.isArray(parsed.uploadedFileNames.license)
            ? parsed.uploadedFileNames.license
            : [];
          const menuNames = Array.isArray(parsed.uploadedFileNames.menus)
            ? parsed.uploadedFileNames.menus
            : [];
          const invNames = Array.isArray(parsed.uploadedFileNames.invoices)
            ? parsed.uploadedFileNames.invoices
            : [];

          if (licNames.length > 0) {
            setLicenseFiles(
              licNames.map((name, idx) => ({
                id: `lic_hydrated_${idx}_${name}`,
                zone: "license",
                fileName: name,
                fileSize: 0,
                mimeType: name.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : "image/jpeg",
                previewUrl: "",
                status: "ready",
              }))
            );
          }

          if (menuNames.length > 0) {
            setMenuFiles(
              menuNames.map((name, idx) => ({
                id: `menu_hydrated_${idx}_${name}`,
                zone: "menu",
                fileName: name,
                fileSize: 0,
                mimeType: "image/jpeg",
                previewUrl: "",
                status: "ready",
              }))
            );
          }

          if (invNames.length > 0) {
            setInvoiceFiles(
              invNames.map((name, idx) => ({
                id: `inv_hydrated_${idx}_${name}`,
                zone: "invoice",
                fileName: name,
                fileSize: 0,
                mimeType: name.toLowerCase().endsWith(".pdf")
                  ? "application/pdf"
                  : "image/jpeg",
                previewUrl: "",
                status: "ready",
              }))
            );
          }
        }
      }
    } catch {
      // Ignore corrupt storage entries
    } finally {
      isHydratedRef.current = true;
    }
  }, [writeStoreProfileToInputs]);

  // Automatically sync staged arrays & file badges to localStorage whenever they change after hydration
  useEffect(() => {
    if (!isHydratedRef.current) return;
    persistStageToStorage();
  }, [
    stagedMenuItems,
    stagedModifiers,
    stagedRetailItems,
    stagedSupplies,
    licenseFiles,
    menuFiles,
    invoiceFiles,
    licenseDetected,
    persistStageToStorage,
  ]);

  // Sync storeProfile to localStorage on every input change WITHOUT triggering any React state re-render
  const handleStoreInputChange = (field: keyof StoreProfileData) => {
    if (field === "merchantSlug") {
      slugManuallyEditedRef.current = Boolean(slugRef.current?.value.trim());
    }

    const legalVal = legalNameRef.current?.value.trim() || "";
    const dbaVal = dbaNameRef.current?.value.trim() || "";

    if (
      (field === "dbaName" || field === "legalName") &&
      !slugManuallyEditedRef.current &&
      slugRef.current
    ) {
      slugRef.current.value = toSlug(dbaVal || legalVal);
    }

    // Keep primary stand address synchronized with the active selected address type when editing physicalAddress or mailingAddress
    const activeType: AddressSelectionMode =
      storeProfileRef.current.selectedAddressType || "physical";
    if (
      field === "physicalAddress" &&
      activeType === "physical" &&
      addressRef.current &&
      physicalAddressRef.current
    ) {
      addressRef.current.value = physicalAddressRef.current.value;
    } else if (
      field === "mailingAddress" &&
      activeType === "mailing" &&
      addressRef.current &&
      mailingAddressRef.current
    ) {
      addressRef.current.value = mailingAddressRef.current.value;
    } else if (
      (field === "streetAddress" || field === "address") &&
      addressRef.current
    ) {
      if (activeType === "physical" && physicalAddressRef.current && !physicalAddressRef.current.value.trim()) {
        physicalAddressRef.current.value = addressRef.current.value;
      }
    }

    const currentProfile = readStoreProfileFromDom();
    persistStageToStorage({ profile: currentProfile });
  };

  const handleStoreInputBlur = () => {
    if (slugRef.current) {
      const rawSlug = slugRef.current.value.trim();
      const dbaVal = dbaNameRef.current?.value.trim() || "";
      const legalVal = legalNameRef.current?.value.trim() || "";
      slugRef.current.value = toSlug(rawSlug || dbaVal || legalVal);
    }
    const updated = readStoreProfileFromDom();
    setActiveSlugBadge(updated.merchantSlug);
    setActiveDbaBadge(updated.dbaName || updated.legalName || "");
    setDetectedPhysicalBadge(updated.physicalAddress || "");
    setDetectedMailingBadge(updated.mailingAddress || "");
    persistStageToStorage({ profile: updated });
  };

  // Interactive chooser toggle between Physical / Ship-To (Default) and Mailing / Bill-To
  const handleSelectAddressMode = (mode: AddressSelectionMode) => {
    storeProfileRef.current.selectedAddressType = mode;
    setSelectedAddressMode(mode);

    const physVal =
      physicalAddressRef.current?.value.trim() ||
      storeProfileRef.current.physicalAddress ||
      "";
    const mailVal =
      mailingAddressRef.current?.value.trim() ||
      storeProfileRef.current.mailingAddress ||
      "";
    const chosenAddr =
      mode === "mailing" ? mailVal || physVal : physVal || mailVal;

    if (addressRef.current && chosenAddr) {
      addressRef.current.value = chosenAddr;
    }

    const parsedParts = parseCityStateZipFromAddress(chosenAddr);
    if (parsedParts.city && cityRef.current) {
      cityRef.current.value = parsedParts.city;
    }
    if (parsedParts.state && stateRef.current) {
      stateRef.current.value = parsedParts.state;
    }
    if (parsedParts.zip && zipRef.current) {
      zipRef.current.value = parsedParts.zip;
    }

    const updated = readStoreProfileFromDom();
    updated.selectedAddressType = mode;
    if (chosenAddr) {
      updated.address = chosenAddr;
      updated.streetAddress = chosenAddr;
    }
    storeProfileRef.current = updated;
    setDetectedPhysicalBadge(updated.physicalAddress || "");
    setDetectedMailingBadge(updated.mailingAddress || "");
    persistStageToStorage({ profile: updated });

    setStatusBanner(
      mode === "physical"
        ? `Switched stand primary address to Physical / Ship-To: "${chosenAddr || "—"}".`
        : `Switched stand primary address to Mailing / Bill-To: "${chosenAddr || "—"}".`
    );
  };

  /**
   * Unified Classification Override Handler:
   * Immediately updates the item's classification, moves it to the target bucket
   * (stagedMenuItems for 'food' | 'drink', stagedModifiers for 'modifier_option',
   * stagedRetailItems for 'retail_item', stagedSupplies for 'operational_supply'),
   * recalculates tab/footer counts, and persists to localStorage ('barmaid_intake_stage').
   */
  const handleReclassifyItem = (
    currentTable: "drinks" | "modifiers" | "retail" | "supplies",
    itemId: string,
    nextClassification: ItemClassification
  ) => {
    let nextDrinks = [...stagedMenuItems];
    let nextModifiers = [...stagedModifiers];
    let nextRetail = [...stagedRetailItems];
    let nextSupplies = [...stagedSupplies];

    // Extract source item metadata before moving/updating
    let itemName = "";
    let sourceFileName = "manual-override";
    let basePriceDollars = 4.5;
    let unitCostCents: number | undefined;
    let suggestedPriceCents: number | undefined;
    let sku: string | undefined;
    let vendorName = "Staged Override";
    let currentCategoryName = "";
    let currentVariations: MenuVariation[] = [];
    let currentIncluded = true;

    if (currentTable === "drinks") {
      const found = nextDrinks.find((d) => d.id === itemId);
      if (!found) return;
      if (nextClassification === "drink" || nextClassification === "food") {
        // Stay in stagedMenuItems, update classification & categoryName if switched
        nextDrinks = nextDrinks.map((d) =>
          d.id === itemId
            ? {
                ...d,
                classification: nextClassification,
                categoryName:
                  nextClassification === "food" &&
                  !/food|pastry|bakery|snack/i.test(d.categoryName)
                    ? "Food & Pastries"
                    : nextClassification === "drink" &&
                      d.categoryName === "Food & Pastries"
                    ? "Drinks & Beverages"
                    : d.categoryName,
              }
            : d
        );
        setStagedMenuItems(nextDrinks);
        persistStageToStorage({ drinks: nextDrinks });
        return;
      }
      itemName = found.name;
      sourceFileName = found.sourceFileName;
      basePriceDollars = found.variations[0]?.price ?? 4.5;
      unitCostCents = Math.round(basePriceDollars * 100);
      suggestedPriceCents = Math.round(basePriceDollars * 100);
      currentCategoryName = found.categoryName;
      currentVariations = found.variations;
      currentIncluded = found.included;
      nextDrinks = nextDrinks.filter((d) => d.id !== itemId);
    } else if (currentTable === "modifiers") {
      const found = nextModifiers.find((m) => m.id === itemId);
      if (!found || nextClassification === "modifier_option") return;
      itemName = found.name;
      sourceFileName = found.sourceFileName;
      unitCostCents = found.unitCostCents;
      basePriceDollars =
        typeof found.unitCostCents === "number" && found.unitCostCents > 0
          ? Number((found.unitCostCents / 100).toFixed(2))
          : 0.75;
      vendorName = found.vendorName;
      currentIncluded = found.included;
      nextModifiers = nextModifiers.filter((m) => m.id !== itemId);
    } else if (currentTable === "retail") {
      const found = nextRetail.find((r) => r.id === itemId);
      if (!found || nextClassification === "retail_item") return;
      itemName = found.name;
      sourceFileName = found.sourceFileName;
      unitCostCents = found.unitCostCents;
      suggestedPriceCents = found.suggestedPriceCents;
      sku = found.sku;
      vendorName = found.vendorName;
      currentIncluded = found.included;
      basePriceDollars =
        typeof found.suggestedPriceCents === "number" && found.suggestedPriceCents > 0
          ? Number((found.suggestedPriceCents / 100).toFixed(2))
          : typeof found.unitCostCents === "number" && found.unitCostCents > 0
          ? Number(((found.unitCostCents * 2) / 100).toFixed(2))
          : 4.25;
      nextRetail = nextRetail.filter((r) => r.id !== itemId);
    } else if (currentTable === "supplies") {
      const found = nextSupplies.find((s) => s.id === itemId);
      if (!found || nextClassification === "operational_supply") return;
      itemName = found.name;
      sourceFileName = found.sourceFileName;
      vendorName = found.vendorName;
      currentIncluded = true; // Enabling on POS when moved out of operational supplies
      basePriceDollars = 4.0;
      nextSupplies = nextSupplies.filter((s) => s.id !== itemId);
    }

    // Insert into the newly selected classification target array
    if (nextClassification === "food" || nextClassification === "drink") {
      const resolvedCategory =
        nextClassification === "food"
          ? "Food & Pastries"
          : currentCategoryName || "Drinks & Beverages";
      const resolvedVariations: MenuVariation[] =
        currentVariations.length > 0
          ? currentVariations
          : [
              {
                size: nextClassification === "food" ? "Regular" : "16oz",
                price: basePriceDollars,
              },
            ];
      nextDrinks.push({
        id: itemId,
        name: itemName,
        categoryName: resolvedCategory,
        variations: resolvedVariations,
        included: currentIncluded,
        classification: nextClassification,
        sourceFileName,
      });
    } else if (nextClassification === "modifier_option") {
      const inferredGroup = /oat|almond|coconut|soy|breve|milk|cream/i.test(itemName)
        ? "Milk Options"
        : /sauce|mocha|caramel|white choc/i.test(itemName)
        ? "Sauces"
        : /lotus|red bull|shot|espresso|boba/i.test(itemName)
        ? "Energy & Boosters"
        : "Flavor Syrups";

      nextModifiers.push({
        id: itemId,
        name: itemName,
        targetGroup: inferredGroup,
        unitCostCents,
        vendorName,
        included: currentIncluded,
        classification: "modifier_option",
        sourceFileName,
      });
    } else if (nextClassification === "retail_item") {
      nextRetail.push({
        id: itemId,
        name: itemName,
        unitCostCents,
        suggestedPriceCents:
          suggestedPriceCents ?? Math.round(basePriceDollars * 100),
        sku,
        vendorName,
        included: currentIncluded,
        classification: "retail_item",
        sourceFileName,
      });
    } else if (nextClassification === "operational_supply") {
      nextSupplies.push({
        id: itemId,
        name: itemName,
        vendorName,
        included: false,
        classification: "operational_supply",
        sourceFileName,
      });
    }

    setStagedMenuItems(nextDrinks);
    setStagedModifiers(nextModifiers);
    setStagedRetailItems(nextRetail);
    setStagedSupplies(nextSupplies);

    persistStageToStorage({
      drinks: nextDrinks,
      modifiers: nextModifiers,
      retail: nextRetail,
      supplies: nextSupplies,
    });

    const labelMatch =
      CLASSIFICATION_OPTIONS.find((o) => o.value === nextClassification)?.label ||
      nextClassification;
    setStatusBanner(`Reclassified "${itemName}" as ${labelMatch}.`);
  };

  // Active processing flags per zone for card-level spinner feedback
  const isLicenseAnalyzing = useMemo(
    () => licenseFiles.some((f) => f.status === "processing"),
    [licenseFiles]
  );
  const isMenuAnalyzing = useMemo(
    () => menuFiles.some((f) => f.status === "processing"),
    [menuFiles]
  );
  const isInvoiceAnalyzing = useMemo(
    () => invoiceFiles.some((f) => f.status === "processing"),
    [invoiceFiles]
  );

  // True Full Merchant Reset handler
  const handleResetIntake = () => {
    isResettingRef.current = true;

    licenseFiles.forEach((f) => {
      if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
    });
    menuFiles.forEach((f) => {
      if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
    });
    invoiceFiles.forEach((f) => {
      if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
    });

    slugManuallyEditedRef.current = false;
    writeStoreProfileToInputs({ ...EMPTY_STORE_PROFILE });
    setActiveSlugBadge("");
    setActiveDbaBadge("");
    setLicenseDetected(false);

    setLicenseFiles([]);
    setMenuFiles([]);
    setInvoiceFiles([]);

    setStagedMenuItems([]);
    setStagedRetailItems([]);
    setStagedModifiers([]);
    setStagedSupplies([]);

    if (licenseInputRef.current) licenseInputRef.current.value = "";
    if (menuInputRef.current) menuInputRef.current.value = "";
    if (invoiceInputRef.current) invoiceInputRef.current.value = "";

    clearActiveStageAndRulesFromStorage();

    setTimeout(() => {
      isResettingRef.current = false;
    }, 0);

    setStatusBanner("Intake reset to a clean blank slate (merchant_slug: unassigned).");
  };

  // Session Manager Action 1: Load Business
  const handleLoadSavedSession = (
    session: OnboardingSession,
    targetRoute?: "/onboard/intake" | "/onboard/rules"
  ) => {
    const restoredStage = restoreSessionToActiveStage(session);

    writeStoreProfileToInputs(restoredStage.storeProfile);
    slugManuallyEditedRef.current = Boolean(restoredStage.storeProfile.merchantSlug);
    setLicenseDetected(Boolean(restoredStage.licenseDetected));

    setStagedMenuItems(restoredStage.stagedItems || []);
    setStagedModifiers(restoredStage.modifiers || []);
    setStagedRetailItems(restoredStage.retailItems || []);
    setStagedSupplies(restoredStage.supplies || []);

    const licNames = restoredStage.uploadedFileNames?.license || [];
    const menuNames = restoredStage.uploadedFileNames?.menus || [];
    const invNames = restoredStage.uploadedFileNames?.invoices || [];

    setLicenseFiles(
      licNames.map((name, idx) => ({
        id: `lic_restored_${idx}_${name}`,
        zone: "license",
        fileName: name,
        fileSize: 0,
        mimeType: name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg",
        previewUrl: "",
        status: "ready",
      }))
    );
    setMenuFiles(
      menuNames.map((name, idx) => ({
        id: `menu_restored_${idx}_${name}`,
        zone: "menu",
        fileName: name,
        fileSize: 0,
        mimeType: "image/jpeg",
        previewUrl: "",
        status: "ready",
      }))
    );
    setInvoiceFiles(
      invNames.map((name, idx) => ({
        id: `inv_restored_${idx}_${name}`,
        zone: "invoice",
        fileName: name,
        fileSize: 0,
        mimeType: name.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "image/jpeg",
        previewUrl: "",
        status: "ready",
      }))
    );

    setIsSessionDrawerOpen(false);
    setConfirmPurgeAll(false);
    setStatusBanner(
      `Loaded business "${
        session.storeProfile.dbaName ||
        session.storeProfile.legalName ||
        session.storeProfile.merchantSlug
      }" (${session.storeProfile.merchantSlug}).`
    );

    if (targetRoute === "/onboard/rules") {
      router.push("/onboard/rules");
    }
  };

  // Session Manager Action 2: Export All Records (.json)
  const handleExportAllSessions = () => {
    const currentSessions = readSavedSessionsFromStorage();
    exportAllSessionsJson(currentSessions);
    setStatusBanner(
      `Exported ${currentSessions.length} client session(s) to barmaid_sessions_backup.json.`
    );
  };

  // Session Manager Action 3: Delete Record
  const handleDeleteSavedSession = (slugOrId: string) => {
    const nextSessions = deleteSessionFromArchive(slugOrId);
    setSavedSessions(nextSessions);
  };

  // Session Manager Action 4: + Start New Shop
  const handleStartNewShop = () => {
    const currentProfile = readStoreProfileFromDom();
    if (
      currentProfile.merchantSlug ||
      currentProfile.dbaName ||
      currentProfile.legalName
    ) {
      persistStageToStorage({ profile: currentProfile, archiveSession: true });
    }
    handleResetIntake();
    setIsSessionDrawerOpen(false);
    setConfirmPurgeAll(false);
    setStatusBanner(
      "Previous progress archived. Ready to onboard a brand new shop."
    );
  };

  // Session Manager Action 5: Purge All Sessions
  const handlePurgeAllSessions = () => {
    purgeAllSessionsFromArchive();
    setSavedSessions([]);
    setConfirmPurgeAll(false);
    handleResetIntake();
    setIsSessionDrawerOpen(false);
    setStatusBanner(
      "All saved client sessions and active working state have been permanently purged."
    );
  };

  // Core processor for Dropzone 1: Business License
  const processLicenseFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const queuedAssets: Array<{ file: File; asset: UploadedAsset }> = files.map(
      (file) => {
        const assetId = `lic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let previewUrl = "";
        try {
          previewUrl = URL.createObjectURL(file);
        } catch {
          previewUrl = "";
        }
        return {
          file,
          asset: {
            id: assetId,
            zone: "license",
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "image/jpeg",
            previewUrl,
            status: "processing",
          },
        };
      }
    );

    setLicenseFiles((prev) => [...prev, ...queuedAssets.map((q) => q.asset)]);

    for (const { file, asset } of queuedAssets) {
      setStatusBanner(`Extracting Business Identity from "${file.name}"...`);

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("documentType", "license");

        const res = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        });
        const json = (await res.json()) as LicenseOcrApiResponse;

        if (!res.ok || !json.data) {
          throw new Error(json.error || "License OCR failed");
        }

        const extracted = json.data;
        const current = readStoreProfileFromDom();

        const extractedLegal = (
          extracted.legalEntityName ||
          extracted.legalName ||
          ""
        ).trim();
        const extractedTrade = (
          extracted.tradeName ||
          extracted.dbaName ||
          ""
        ).trim();

        // Populate storeProfile.legalName with the official entity from the license
        const reconciledLegal = extractedLegal || current.legalName;

        // Reconcile DBA / Trade Name:
        // If storeProfile.dbaName was already populated from a menu board, retain it
        // unless the license explicitly defines a conflicting trade name.
        const currentDba = current.dbaName.trim();
        const hasExistingDba =
          Boolean(currentDba) && currentDba.toLowerCase() !== "unassigned";

        const isDistinctTradeNameFromLegal =
          Boolean(extractedTrade) &&
          extractedTrade.toLowerCase() !== "unassigned" &&
          normalizeKey(extractedTrade) !== normalizeKey(extractedLegal);
        const hasExplicitLicenseTradeName =
          Boolean(extractedTrade) &&
          extractedTrade.toLowerCase() !== "unassigned" &&
          (extracted.hasExplicitTradeName === true ||
            isDistinctTradeNameFromLegal);

        let reconciledDba = currentDba;
        if (hasExistingDba) {
          if (
            hasExplicitLicenseTradeName &&
            normalizeKey(extractedTrade) !== normalizeKey(currentDba)
          ) {
            reconciledDba = extractedTrade;
          }
        } else if (hasExplicitLicenseTradeName) {
          reconciledDba = extractedTrade;
        } else if (
          extractedTrade &&
          extractedTrade.toLowerCase() !== "unassigned"
        ) {
          reconciledDba = extractedTrade;
        }

        const currentSlug = current.merchantSlug.trim();
        const preferredSlugSource = reconciledDba || reconciledLegal;
        const resolvedSlug =
          (slugManuallyEditedRef.current &&
          currentSlug &&
          currentSlug.toLowerCase() !== "unassigned"
            ? currentSlug
            : toSlug(preferredSlugSource)) ||
          extracted.merchantSlug?.trim() ||
          extracted.suggestedSlug?.trim() ||
          currentSlug;

        const extractedPhysical =
          (typeof extracted.physicalAddress === "string"
            ? extracted.physicalAddress.trim()
            : "") || "";
        const extractedMailing =
          (typeof extracted.mailingAddress === "string"
            ? extracted.mailingAddress.trim()
            : "") || "";
        const extractedSingleAddr =
          (typeof extracted.streetAddress === "string"
            ? extracted.streetAddress.trim()
            : "") ||
          (typeof extracted.address === "string"
            ? extracted.address.trim()
            : "") ||
          "";

        const nextPhysicalAddress =
          extractedPhysical ||
          current.physicalAddress ||
          extractedSingleAddr ||
          "";
        const nextMailingAddress =
          extractedMailing || current.mailingAddress || "";
        const chosenMode: AddressSelectionMode =
          current.selectedAddressType || "physical";
        const nextPrimaryAddress =
          chosenMode === "mailing" && nextMailingAddress
            ? nextMailingAddress
            : nextPhysicalAddress ||
              extractedSingleAddr ||
              current.address ||
              current.streetAddress ||
              nextMailingAddress ||
              "";

        const nextProfile: StoreProfileData = {
          legalName: reconciledLegal,
          dbaName: reconciledDba,
          merchantSlug: resolvedSlug,
          physicalAddress: nextPhysicalAddress,
          mailingAddress: nextMailingAddress,
          address: nextPrimaryAddress,
          selectedAddressType: chosenMode,
          streetAddress: nextPrimaryAddress,
          city: extracted.city?.trim() || current.city,
          state: extracted.state?.trim() || current.state,
          zipCode:
            extracted.zipCode?.trim() ||
            extracted.zip?.trim() ||
            current.zipCode,
        };

        writeStoreProfileToInputs(nextProfile);
        setLicenseDetected(true);
        persistStageToStorage({ profile: nextProfile, licDetected: true });

        setLicenseFiles((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(
          `Business identity reconciled from "${file.name}" (Legal: ${
            reconciledLegal || "—"
          }, DBA: ${reconciledDba || "—"}).`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse license";
        setLicenseFiles((prev) =>
          prev.map((a) =>
            a.id === asset.id ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`License staged ("${file.name}"). OCR note: ${msg}`);
      }
    }
  };

  // Core processor for Dropzone 2: Menu & Signage
  const processMenuFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const queuedAssets: Array<{ file: File; asset: UploadedAsset }> = files.map(
      (file) => {
        const assetId = `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let previewUrl = "";
        try {
          previewUrl = URL.createObjectURL(file);
        } catch {
          previewUrl = "";
        }
        return {
          file,
          asset: {
            id: assetId,
            zone: "menu",
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "image/jpeg",
            previewUrl,
            status: "processing",
          },
        };
      }
    );

    setMenuFiles((prev) => [...prev, ...queuedAssets.map((q) => q.asset)]);

    for (const { file, asset } of queuedAssets) {
      setStatusBanner(`Parsing menu board "${file.name}" via Gemini Vision...`);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        });
        const json = (await res.json()) as MenuOcrApiResponse;

        if (!res.ok || !json.data) {
          throw new Error(json.error || "Menu OCR failed");
        }

        // Signboard & Menu Header Merchant Detection:
        // If storeProfile.dbaName is empty or 'unassigned', automatically populate dbaName with detectedStoreName
        // and auto-derive merchantSlug (leaving legalName blank until confirmed).
        const detectedStoreName =
          typeof json.data.detectedStoreName === "string"
            ? json.data.detectedStoreName.trim()
            : "";
        const currentProfile = readStoreProfileFromDom();
        let nextProfile = currentProfile;

        if (
          detectedStoreName &&
          detectedStoreName.toLowerCase() !== "unassigned"
        ) {
          const currentDba = currentProfile.dbaName.trim();
          if (!currentDba || currentDba.toLowerCase() === "unassigned") {
            const derivedSlug = toSlug(detectedStoreName);
            const currentSlug = currentProfile.merchantSlug.trim();
            const shouldAutoSetSlug =
              !slugManuallyEditedRef.current ||
              !currentSlug ||
              currentSlug.toLowerCase() === "unassigned";

            nextProfile = {
              ...currentProfile,
              dbaName: detectedStoreName,
              merchantSlug: shouldAutoSetSlug ? derivedSlug : currentSlug,
              legalName: currentProfile.legalName,
            };
            writeStoreProfileToInputs(nextProfile);
          }
        }

        const categories = json.data.categories || [];
        const boardModifiers = json.data.modifiers || [];

        const extractedDrinks: StagedMenuItem[] = [];
        categories.forEach((cat) => {
          const categoryName = cat.categoryName?.trim() || "Espresso & Classics";
          (cat.items || []).forEach((item) => {
            if (!item.name) return;
            const rawName = item.name.trim();
            const isColdOrEnergy =
              /iced|cold|lotus|energy|redbull|rebel|smoothie|tea|boba|frappe/i.test(
                rawName
              );
            const fallbackVars: MenuVariation[] = isColdOrEnergy
              ? [
                  { size: "16oz", price: 4.75 },
                  { size: "24oz", price: 5.75 },
                  { size: "32oz", price: 6.75 },
                ]
              : [
                  { size: "12oz", price: 4.25 },
                  { size: "16oz", price: 4.95 },
                  { size: "20oz", price: 5.45 },
                ];

            const validVars: MenuVariation[] = (item.variations || [])
              .filter(
                (v): v is { size: string; price: number } =>
                  Boolean(v?.size) && typeof v?.price === "number" && v.price > 0
              )
              .map((v) => {
                const trimmedSize = v.size.trim();
                const ozMatch = trimmedSize.match(/(\d+)\s*(?:fl\.?\s*)?oz/i);
                return {
                  size: ozMatch ? `${ozMatch[1]}oz` : trimmedSize,
                  price: v.price,
                };
              });

            extractedDrinks.push({
              id: `drink_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: rawName,
              categoryName,
              variations: validVars.length > 0 ? validVars : fallbackVars,
              included: true,
              classification: inferFoodOrDrink(rawName, categoryName),
              sourceFileName: file.name,
            });
          });
        });

        setStagedMenuItems((prev) => {
          const map = new Map<string, StagedMenuItem>();
          prev.forEach((existing) => {
            map.set(normalizeKey(existing.name), existing);
          });
          extractedDrinks.forEach((incoming) => {
            const key = normalizeKey(incoming.name);
            const match = map.get(key);
            if (match) {
              const mergedVars = [...match.variations];
              incoming.variations.forEach((incVar) => {
                const existsIdx = mergedVars.findIndex(
                  (v) => v.size.toLowerCase() === incVar.size.toLowerCase()
                );
                if (existsIdx === -1) {
                  mergedVars.push(incVar);
                }
              });
              map.set(key, { ...match, variations: mergedVars });
            } else {
              map.set(key, incoming);
            }
          });
          return Array.from(map.values());
        });

        if (boardModifiers.length > 0) {
          setStagedModifiers((prev) => {
            const modMap = new Map<string, StagedModifierOption>();
            prev.forEach((m) => modMap.set(normalizeKey(m.name), m));
            boardModifiers.forEach((bm) => {
              if (!bm.name) return;
              const cleanName = bm.name.trim();
              const k = normalizeKey(cleanName);
              if (!modMap.has(k)) {
                const targetGroup = /oat|almond|coconut|soy|breve|milk|cream/i.test(
                  cleanName
                )
                  ? "Milk Options"
                  : /sauce|mocha|caramel|white choc/i.test(cleanName)
                  ? "Sauces"
                  : /lotus|red bull|shot|espresso|boba/i.test(cleanName)
                  ? "Energy & Boosters"
                  : "Flavor Syrups";

                modMap.set(k, {
                  id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: cleanName,
                  targetGroup,
                  unitCostCents:
                    typeof bm.price === "number" ? Math.round(bm.price * 100) : undefined,
                  vendorName: "Menu Board",
                  included: true,
                  classification: "modifier_option",
                  sourceFileName: file.name,
                });
              }
            });
            return Array.from(modMap.values());
          });
        }

        // Immediately sync reconciled storeProfile (DBA & merchant_slug) to localStorage
        persistStageToStorage({ profile: nextProfile });

        setMenuFiles((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(
          detectedStoreName
            ? `Appended ${extractedDrinks.length} menu items from "${file.name}" (Detected Storefront: ${detectedStoreName} → ${nextProfile.merchantSlug}).`
            : `Appended ${extractedDrinks.length} menu items from "${file.name}" into staging.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse menu board";
        setMenuFiles((prev) =>
          prev.map((a) =>
            a.id === asset.id ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`Menu file staged ("${file.name}"). OCR note: ${msg}`);
      }
    }
  };

  // Core processor for Dropzone 3: Vendor Invoices
  const processInvoiceFiles = async (files: File[]) => {
    if (files.length === 0) return;

    const queuedAssets: Array<{ file: File; asset: UploadedAsset }> = files.map(
      (file) => {
        const assetId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        let previewUrl = "";
        try {
          previewUrl = URL.createObjectURL(file);
        } catch {
          previewUrl = "";
        }
        return {
          file,
          asset: {
            id: assetId,
            zone: "invoice",
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type || "image/jpeg",
            previewUrl,
            status: "processing",
          },
        };
      }
    );

    setInvoiceFiles((prev) => [...prev, ...queuedAssets.map((q) => q.asset)]);

    for (const { file, asset } of queuedAssets) {
      setStatusBanner(`Classifying vendor invoice "${file.name}" via /api/ocr/invoice...`);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch("/api/ocr/invoice", {
          method: "POST",
          body: formData,
        });

        const data = (await res.json()) as InvoiceOcrResponse & { error?: string };

        if (!res.ok || data.error) {
          throw new Error(data.error || "Invoice OCR failed");
        }

        const vendorName = data.vendorName || "Distributor Invoice";

        // Reconcile Physical / Ship-To and Mailing / Bill-To addresses from the invoice
        const invPhysical =
          typeof data.physicalAddress === "string"
            ? data.physicalAddress.trim()
            : "";
        const invMailing =
          typeof data.mailingAddress === "string"
            ? data.mailingAddress.trim()
            : "";
        const invFallbackAddr =
          typeof data.address === "string" ? data.address.trim() : "";

        const currentProfile = readStoreProfileFromDom();
        let nextProfile = currentProfile;

        if (invPhysical || invMailing || invFallbackAddr) {
          const reconciledPhysical =
            invPhysical ||
            currentProfile.physicalAddress ||
            (!invMailing ? invFallbackAddr : "") ||
            "";
          const reconciledMailing =
            invMailing || currentProfile.mailingAddress || "";
          const chosenMode: AddressSelectionMode =
            currentProfile.selectedAddressType || "physical";

          const resolvedPrimaryAddr =
            chosenMode === "mailing" && reconciledMailing
              ? reconciledMailing
              : reconciledPhysical ||
                invFallbackAddr ||
                currentProfile.address ||
                currentProfile.streetAddress ||
                reconciledMailing ||
                "";

          const parsedParts = parseCityStateZipFromAddress(resolvedPrimaryAddr);

          nextProfile = {
            ...currentProfile,
            physicalAddress: reconciledPhysical,
            mailingAddress: reconciledMailing,
            address: resolvedPrimaryAddr,
            selectedAddressType: chosenMode,
            streetAddress: resolvedPrimaryAddr,
            city: currentProfile.city || parsedParts.city || "",
            state: currentProfile.state || parsedParts.state || "",
            zipCode: currentProfile.zipCode || parsedParts.zip || "",
          };

          writeStoreProfileToInputs(nextProfile);
          persistStageToStorage({ profile: nextProfile });
        }

        if (Array.isArray(data.retailItems) && data.retailItems.length > 0) {
          setStagedRetailItems((prev) => {
            const map = new Map<string, StagedRetailItem>();
            prev.forEach((r) => map.set(normalizeKey(r.name), r));
            data.retailItems.forEach((item) => {
              const key = normalizeKey(item.name);
              if (!map.has(key)) {
                map.set(key, {
                  id: `ret_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: item.name,
                  unitCostCents: item.unitCostCents,
                  suggestedPriceCents: item.suggestedPriceCents,
                  sku: item.sku,
                  vendorName,
                  included: true,
                  classification: "retail_item",
                  sourceFileName: file.name,
                });
              }
            });
            return Array.from(map.values());
          });
        }

        if (Array.isArray(data.modifierOptions) && data.modifierOptions.length > 0) {
          setStagedModifiers((prev) => {
            const map = new Map<string, StagedModifierOption>();
            prev.forEach((m) => map.set(normalizeKey(m.name), m));
            data.modifierOptions.forEach((mod) => {
              const key = normalizeKey(mod.name);
              if (!map.has(key)) {
                map.set(key, {
                  id: `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: mod.name,
                  targetGroup: mod.targetGroup || "Flavor Syrups",
                  unitCostCents: mod.unitCostCents,
                  vendorName,
                  included: true,
                  classification: "modifier_option",
                  sourceFileName: file.name,
                });
              }
            });
            return Array.from(map.values());
          });
        }

        if (Array.isArray(data.supplies) && data.supplies.length > 0) {
          setStagedSupplies((prev) => {
            const map = new Map<string, StagedSupplyItem>();
            prev.forEach((s) => map.set(normalizeKey(s.name), s));
            data.supplies.forEach((sup) => {
              const key = normalizeKey(sup.name);
              if (!map.has(key)) {
                map.set(key, {
                  id: `sup_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  name: sup.name,
                  packSize: sup.packSize,
                  vendorName,
                  included: false,
                  classification: "operational_supply",
                  sourceFileName: file.name,
                });
              }
            });
            return Array.from(map.values());
          });
        }

        setInvoiceFiles((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(
          `Ingested ${vendorName} invoice: ${data.retailItems?.length || 0} retail SKUs, ${
            data.modifierOptions?.length || 0
          } modifiers, ${data.supplies?.length || 0} operational supplies isolated.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse invoice";
        setInvoiceFiles((prev) =>
          prev.map((a) =>
            a.id === asset.id ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`Invoice file staged ("${file.name}"). OCR note: ${msg}`);
      }
    }
  };

  // Native input onChange handlers
  const handleLicenseUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) {
      void processLicenseFiles(selected);
    }
    e.target.value = "";
  };

  const handleMenuUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) {
      void processMenuFiles(selected);
    }
    e.target.value = "";
  };

  const handleInvoiceUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) {
      void processInvoiceFiles(selected);
    }
    e.target.value = "";
  };

  // Drag-and-drop handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropZone = (zone: DropzoneKey, e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length === 0) return;

    if (zone === "license") {
      void processLicenseFiles(files);
    } else if (zone === "menu") {
      void processMenuFiles(files);
    } else if (zone === "invoice") {
      void processInvoiceFiles(files);
    }
  };

  // Card click trigger
  const handleCardClick = (zone: DropzoneKey, e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, label, a, input, select")) {
      return;
    }
    if (zone === "license") {
      licenseInputRef.current?.click();
    } else if (zone === "menu") {
      menuInputRef.current?.click();
    } else if (zone === "invoice") {
      invoiceInputRef.current?.click();
    }
  };

  // Remove uploaded file card from a dropzone & revoke blob URL
  const handleRemoveAsset = (zone: DropzoneKey, assetId: string, fileName: string) => {
    if (zone === "license") {
      setLicenseFiles((prev) => {
        prev
          .filter((f) => f.id === assetId)
          .forEach((f) => {
            if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
          });
        return prev.filter((f) => f.id !== assetId);
      });
    } else if (zone === "menu") {
      setMenuFiles((prev) => {
        prev
          .filter((f) => f.id === assetId)
          .forEach((f) => {
            if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
          });
        return prev.filter((f) => f.id !== assetId);
      });
      setStagedMenuItems((prev) => prev.filter((i) => i.sourceFileName !== fileName));
    } else if (zone === "invoice") {
      setInvoiceFiles((prev) => {
        prev
          .filter((f) => f.id === assetId)
          .forEach((f) => {
            if (f.previewUrl.startsWith("blob:")) URL.revokeObjectURL(f.previewUrl);
          });
        return prev.filter((f) => f.id !== assetId);
      });
      setStagedRetailItems((prev) => prev.filter((i) => i.sourceFileName !== fileName));
      setStagedModifiers((prev) => prev.filter((i) => i.sourceFileName !== fileName));
      setStagedSupplies((prev) => prev.filter((i) => i.sourceFileName !== fileName));
    }
  };

  // Toggle inclusion and group reassignment handlers
  const toggleMenuItemIncluded = (id: string) => {
    setStagedMenuItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, included: !item.included } : item))
    );
  };

  const toggleRetailItemIncluded = (id: string) => {
    setStagedRetailItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, included: !item.included } : item))
    );
  };

  const toggleModifierIncluded = (id: string) => {
    setStagedModifiers((prev) =>
      prev.map((mod) => (mod.id === id ? { ...mod, included: !mod.included } : mod))
    );
  };

  const updateModifierTargetGroup = (id: string, newGroup: string) => {
    setStagedModifiers((prev) =>
      prev.map((mod) => (mod.id === id ? { ...mod, targetGroup: newGroup } : mod))
    );
  };

  const toggleSupplyIncluded = (id: string) => {
    setStagedSupplies((prev) =>
      prev.map((sup) => (sup.id === id ? { ...sup, included: !sup.included } : sup))
    );
  };

  // Dynamic summary counts
  const summaryCounts = useMemo(() => {
    const activeDrinks = stagedMenuItems.filter((i) => i.included).length;
    const activeModifiers = stagedModifiers.filter((m) => m.included).length;
    const activeRetail = stagedRetailItems.filter((r) => r.included).length;
    const excludedSupplies = stagedSupplies.filter((s) => !s.included).length;
    return {
      activeDrinks,
      activeModifiers,
      activeRetail,
      excludedSupplies,
      totalActivePosObjects: activeDrinks + activeModifiers + activeRetail,
    };
  }, [stagedMenuItems, stagedModifiers, stagedRetailItems, stagedSupplies]);

  // Step 1 -> Step 2 Handoff Handler
  const handleContinueToBusinessRules = () => {
    const currentProfile = readStoreProfileFromDom();
    const resolvedSlug =
      currentProfile.merchantSlug ||
      toSlug(currentProfile.dbaName || currentProfile.legalName) ||
      "unassigned";

    const finalProfile: StoreProfileData = {
      ...currentProfile,
      merchantSlug: resolvedSlug,
    };

    persistStageToStorage({ profile: finalProfile });
    router.push(`/onboard/rules?merchant=${encodeURIComponent(resolvedSlug)}`);
  };

  const handlePipelineNavigateStep = (
    targetStep: PipelineStepNumber,
    defaultHref: string
  ) => {
    if (targetStep === 1) return;
    const currentProfile = readStoreProfileFromDom();
    const resolvedSlug =
      currentProfile.merchantSlug ||
      toSlug(currentProfile.dbaName || currentProfile.legalName) ||
      "unassigned";
    const finalProfile: StoreProfileData = {
      ...currentProfile,
      merchantSlug: resolvedSlug,
    };
    persistStageToStorage({ profile: finalProfile });
    router.push(defaultHref);
  };

  const renderAssetThumbnail = (asset: UploadedAsset) => {
    const isPdf =
      asset.mimeType === "application/pdf" ||
      asset.fileName.toLowerCase().endsWith(".pdf");

    if (isPdf || !asset.previewUrl) {
      return (
        <div className="h-11 w-11 rounded-lg border border-slate-700 shrink-0 bg-slate-900 flex items-center justify-center text-[10px] font-mono font-bold text-amber-400">
          {isPdf ? "PDF" : "IMG"}
        </div>
      );
    }

    return (
      <img
        src={asset.previewUrl}
        alt={asset.fileName}
        className="h-11 w-11 rounded-lg object-cover border border-slate-700 shrink-0 bg-slate-900"
      />
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-24">
      <PipelineHeader
        activeStep={1}
        merchantSlug={activeSlugBadge || "unassigned"}
        merchantDba={
          activeDbaBadge ||
          (activeSlugBadge && activeSlugBadge !== "unassigned"
            ? activeSlugBadge
            : "Unassigned Client")
        }
        savedSessions={savedSessions}
        onSwitchClient={(val) => {
          if (val === "__new__") {
            handleStartNewShop();
            return;
          }
          const found = savedSessions.find(
            (s) => s.storeProfile.merchantSlug === val || s.id === val
          );
          if (found) {
            handleLoadSavedSession(found);
          }
        }}
        onNavigateStep={handlePipelineNavigateStep}
        subtitle="Step 1: Multi-Source Document Intake & POS Staging Engine"
        rightSlot={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSavedSessions(readSavedSessionsFromStorage());
                setConfirmPurgeAll(false);
                setIsSessionDrawerOpen(true);
              }}
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 border border-amber-500/40 text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
            >
              <span>Past Sessions / History</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-950 text-amber-400 font-mono text-[11px]">
                {savedSessions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={handleResetIntake}
              className="px-3 py-1 rounded-xl bg-slate-950 hover:bg-rose-950/50 border border-slate-700 hover:border-rose-500/50 text-slate-300 hover:text-rose-300 text-xs font-semibold transition cursor-pointer"
            >
              Reset Intake
            </button>
          </div>
        }
      />

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Step 1: Multi-Source Document Intake &amp; Catalog Staging
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Ingest physical business licenses, walk-up menu boards, and vendor packing slips (Dillanos, Torani, Big Train) to isolate retail SKUs, modifiers, and operational supplies.
          </p>
        </div>

        {/* Live Status Banner */}
        {statusBanner && (
          <div className="p-3.5 rounded-xl bg-slate-900/90 border border-amber-500/40 flex items-center justify-between gap-4">
            <div className="flex items-center space-x-2.5 text-xs text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
              <span>{statusBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs text-slate-400 hover:text-white font-mono cursor-pointer"
            >
              [Dismiss]
            </button>
          </div>
        )}

        {/* Hidden Native File Inputs */}
        <input
          id="license-upload-input"
          ref={licenseInputRef}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={handleLicenseUpload}
          className="hidden"
        />
        <input
          id="menu-upload-input"
          ref={menuInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleMenuUpload}
          className="hidden"
        />
        <input
          id="invoice-upload-input"
          ref={invoiceInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          onChange={handleInvoiceUpload}
          className="hidden"
        />

        {/* Section 1: Three Distinct Intake Dropzones */}
        <section
          aria-label="Document Upload Dropzones"
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          {/* Dropzone 1: Business Identity */}
          <div
            onClick={(e) => handleCardClick("license", e)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropZone("license", e)}
            className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg cursor-pointer"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  Dropzone 1 &middot; Identity
                </span>
                <span className="text-xs font-mono text-amber-300 bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-full">
                  {formatFileCountBadge(licenseFiles.length)}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Business Identity &amp; Permit
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload state business license or health permit (Image or PDF). Automatically extracts Legal Name, DBA/Trade Name, Address, City, State, Zip, and Suggested Slug.
              </p>
            </div>

            {isLicenseAnalyzing && (
              <div className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-300">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span>
                <span>Analyzing business license via Gemini Vision...</span>
              </div>
            )}

            {licenseFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {licenseFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      {renderAssetThumbnail(asset)}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <div className="flex items-center space-x-1.5 text-[11px] font-mono text-slate-400">
                          {asset.status === "processing" && (
                            <span className="h-2.5 w-2.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0"></span>
                          )}
                          <span>
                            {asset.status === "processing"
                              ? "Extracting identity..."
                              : asset.status === "error"
                              ? "Staged (Manual Review)"
                              : "Identity Parsed"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAsset("license", asset.id, asset.fileName);
                      }}
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <label
                htmlFor="license-upload-input"
                className="block border border-dashed border-slate-800 hover:border-amber-500/40 rounded-xl p-5 text-center text-xs text-slate-500 cursor-pointer transition"
              >
                Click or tap to snap a photo or select a business license / permit file.
              </label>
            )}

            <label
              htmlFor="license-upload-input"
              onClick={(e) => e.stopPropagation()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer select-none"
            >
              {isLicenseAnalyzing ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></span>
                  <span>Analyzing Permit...</span>
                </>
              ) : (
                <span>+ Upload Business License / Permit</span>
              )}
            </label>
          </div>

          {/* Dropzone 2: Menu & Signage */}
          <div
            onClick={(e) => handleCardClick("menu", e)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropZone("menu", e)}
            className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg cursor-pointer"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  Dropzone 2 &middot; Menu &amp; Signage
                </span>
                <span className="text-xs font-mono text-cyan-300 bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-full">
                  {formatFileCountBadge(menuFiles.length)}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Chalkboards, Drive-Thru &amp; Flyers
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload 1 or more images of walk-up boards, drive-thru panels, or seasonal flyers. Appends items to menu staging without overwriting previous uploads.
              </p>
            </div>

            {isMenuAnalyzing && (
              <div className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-xs text-cyan-300">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0"></span>
                <span>Analyzing menu board signage via Gemini Vision...</span>
              </div>
            )}

            {menuFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {menuFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      {renderAssetThumbnail(asset)}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <div className="flex items-center space-x-1.5 text-[11px] font-mono text-cyan-400">
                          {asset.status === "processing" && (
                            <span className="h-2.5 w-2.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin shrink-0"></span>
                          )}
                          <span>
                            {asset.status === "processing"
                              ? "Scanning board..."
                              : asset.status === "error"
                              ? "Staged (Manual Review)"
                              : "Appended to Menu"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAsset("menu", asset.id, asset.fileName);
                      }}
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <label
                htmlFor="menu-upload-input"
                className="block border border-dashed border-slate-800 hover:border-cyan-500/40 rounded-xl p-5 text-center text-xs text-slate-500 cursor-pointer transition"
              >
                Click or drop multiple menu board photos to accumulate categories, base sizes, and prices.
              </label>
            )}

            <label
              htmlFor="menu-upload-input"
              onClick={(e) => e.stopPropagation()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer select-none"
            >
              {isMenuAnalyzing ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin"></span>
                  <span>Analyzing Menu Board(s)...</span>
                </>
              ) : (
                <span>+ Upload Menu Board / Flyer Image(s)</span>
              )}
            </label>
          </div>

          {/* Dropzone 3: Vendor Invoices */}
          <div
            onClick={(e) => handleCardClick("invoice", e)}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDropZone("invoice", e)}
            className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg cursor-pointer"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  Dropzone 3 &middot; Vendor Invoices
                </span>
                <span className="text-xs font-mono text-emerald-300 bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-full">
                  {formatFileCountBadge(invoiceFiles.length)}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Distributor Delivery Invoices
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload distributor packing slips (Dillanos, Torani, Big Train). Classifies retail bags/RTDs, syrups/sauces/milks, and filters out operational supplies.
              </p>
            </div>

            {isInvoiceAnalyzing && (
              <div className="flex items-center space-x-2.5 px-3 py-2 rounded-xl bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-300">
                <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin shrink-0"></span>
                <span>Classifying invoice SKUs via Gemini Vision...</span>
              </div>
            )}

            {invoiceFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {invoiceFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      {renderAssetThumbnail(asset)}
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <div className="flex items-center space-x-1.5 text-[11px] font-mono text-emerald-400">
                          {asset.status === "processing" && (
                            <span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin shrink-0"></span>
                          )}
                          <span>
                            {asset.status === "processing"
                              ? "Classifying SKUs..."
                              : asset.status === "error"
                              ? "Staged (Manual Review)"
                              : "Classified & Staged"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveAsset("invoice", asset.id, asset.fileName);
                      }}
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0 cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <label
                htmlFor="invoice-upload-input"
                className="block border border-dashed border-slate-800 hover:border-emerald-500/40 rounded-xl p-5 text-center text-xs text-slate-500 cursor-pointer transition"
              >
                Click or drop Dillanos, Torani, or Big Train invoices to auto-populate modifiers &amp; retail items.
              </label>
            )}

            <label
              htmlFor="invoice-upload-input"
              onClick={(e) => e.stopPropagation()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer select-none"
            >
              {isInvoiceAnalyzing ? (
                <>
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></span>
                  <span>Analyzing Invoice(s)...</span>
                </>
              ) : (
                <span>+ Upload Vendor Invoice / Packing Slip(s)</span>
              )}
            </label>
          </div>
        </section>

        {/* Section 2: Uncontrolled Store Info with Live LocalStorage Sync */}
        <section
          aria-label="Detected Store Identity"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white">
                  Detected Store Info (Business License Profile)
                </h2>
                <span
                  className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded-full ${
                    licenseDetected
                      ? "bg-emerald-950 text-emerald-300 border border-emerald-700/60"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {licenseDetected ? "OCR Verified" : "Awaiting Intake"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Multi-tenant catalog isolation is strictly scoped to the{" "}
                <code className="text-amber-400 font-mono">merchant_slug</code> below.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label
                htmlFor="store-legal-name"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                Legal Entity Name
              </label>
              <input
                id="store-legal-name"
                ref={legalNameRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="Official license / LLC registration"
                onChange={() => handleStoreInputChange("legalName")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
              <span className="block text-[10px] text-slate-500 mt-1">
                Official license / LLC registration
              </span>
            </div>

            <div>
              <label
                htmlFor="store-dba-name"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                DBA / Trade Name
              </label>
              <input
                id="store-dba-name"
                ref={dbaNameRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="Storefront / menu board identity"
                onChange={() => handleStoreInputChange("dbaName")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
              <span className="block text-[10px] text-slate-500 mt-1">
                Storefront / menu board identity
              </span>
            </div>

            <div>
              <label
                htmlFor="store-slug"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                Suggested Slug (merchant_slug)
              </label>
              <input
                id="store-slug"
                ref={slugRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="merchant-slug"
                onChange={() => handleStoreInputChange("merchantSlug")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-2 text-base sm:text-xs font-mono text-amber-400 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
              <span className="block text-[10px] text-slate-500 mt-1">
                Kebab-case tenant key derived from DBA
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="store-address"
                  className="block text-[11px] font-mono uppercase text-slate-400"
                >
                  Active Stand Address
                </label>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {selectedAddressMode === "mailing"
                    ? "Mailing / Bill-To"
                    : "Physical / Ship-To"}
                </span>
              </div>
              <input
                id="store-address"
                ref={addressRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="Primary stand street address"
                onChange={() => handleStoreInputChange("streetAddress")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
              <span className="block text-[10px] text-slate-500 mt-1">
                Primary address synced to Dashboard dossier
              </span>
            </div>

            <div>
              <label
                htmlFor="store-city"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                City
              </label>
              <input
                id="store-city"
                ref={cityRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="City"
                onChange={() => handleStoreInputChange("city")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="store-state"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                State
              </label>
              <input
                id="store-state"
                ref={stateRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="State"
                onChange={() => handleStoreInputChange("state")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label
                htmlFor="store-zip"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                ZIP Code
              </label>
              <input
                id="store-zip"
                ref={zipRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="ZIP"
                onChange={() => handleStoreInputChange("zipCode")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500 font-mono"
              />
            </div>
          </div>

          {/* Physical (Ship-To) vs. Mailing (Bill-To) Address Reconciliation & Interactive Chooser */}
          <div className="pt-4 border-t border-slate-800/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-bold text-white">
                    Physical (Ship-To) vs. Mailing (Bill-To) Address Selection
                  </span>
                  {Boolean(detectedPhysicalBadge && detectedMailingBadge) && (
                    <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/40">
                      Dual Invoice Addresses Detected
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Choose which parsed address should serve as the stand&apos;s primary address, or edit either field manually below.
                </p>
              </div>

              {/* Interactive Address Chooser Badge */}
              <div
                role="group"
                aria-label="Choose active stand address"
                className="inline-flex flex-wrap items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl p-1"
              >
                <button
                  type="button"
                  onClick={() => handleSelectAddressMode("physical")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                    selectedAddressMode === "physical"
                      ? "bg-amber-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  [ Use Physical / Ship-To (Default) ]
                </button>
                <span className="text-slate-700 font-mono text-xs">|</span>
                <button
                  type="button"
                  onClick={() => handleSelectAddressMode("mailing")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition cursor-pointer ${
                    selectedAddressMode === "mailing"
                      ? "bg-amber-500 text-slate-950 shadow-sm"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  [ Use Mailing / Bill-To ]
                </button>
              </div>
            </div>

            {/* Dual Parsed Address Comparison & Manual Edit Fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div
                className={`rounded-xl border p-3.5 transition ${
                  selectedAddressMode === "physical"
                    ? "bg-amber-950/15 border-amber-500/50"
                    : "bg-slate-950/60 border-slate-800"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="store-physical-address"
                    className="text-[11px] font-mono uppercase font-bold text-amber-300"
                  >
                    Physical / Ship-To Address (Stand Location)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSelectAddressMode("physical")}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded transition cursor-pointer ${
                      selectedAddressMode === "physical"
                        ? "bg-amber-500 text-slate-950 font-bold"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    {selectedAddressMode === "physical"
                      ? "✓ Active Stand Address"
                      : "Select Physical"}
                  </button>
                </div>
                <input
                  id="store-physical-address"
                  ref={physicalAddressRef}
                  type="text"
                  defaultValue=""
                  autoComplete="off"
                  placeholder="Ship-To / delivery stand address (e.g., 1402 W Yakima Ave)"
                  onChange={() => handleStoreInputChange("physicalAddress")}
                  onBlur={handleStoreInputBlur}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                />
                {detectedPhysicalBadge && (
                  <p className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">
                    Parsed Ship-To: <span className="text-slate-200">{detectedPhysicalBadge}</span>
                  </p>
                )}
              </div>

              <div
                className={`rounded-xl border p-3.5 transition ${
                  selectedAddressMode === "mailing"
                    ? "bg-amber-950/15 border-amber-500/50"
                    : "bg-slate-950/60 border-slate-800"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <label
                    htmlFor="store-mailing-address"
                    className="text-[11px] font-mono uppercase font-bold text-cyan-300"
                  >
                    Mailing / Bill-To Address (Corporate / PO Box)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleSelectAddressMode("mailing")}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded transition cursor-pointer ${
                      selectedAddressMode === "mailing"
                        ? "bg-amber-500 text-slate-950 font-bold"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    {selectedAddressMode === "mailing"
                      ? "✓ Active Stand Address"
                      : "Select Mailing"}
                  </button>
                </div>
                <input
                  id="store-mailing-address"
                  ref={mailingAddressRef}
                  type="text"
                  defaultValue=""
                  autoComplete="off"
                  placeholder="Bill-To / corporate / PO Box address"
                  onChange={() => handleStoreInputChange("mailingAddress")}
                  onBlur={handleStoreInputBlur}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                />
                {detectedMailingBadge && (
                  <p className="text-[11px] text-slate-400 mt-1.5 font-mono truncate">
                    Parsed Bill-To: <span className="text-slate-200">{detectedMailingBadge}</span>
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Section 3: Interactive Staging Review Table */}
        <section
          aria-label="Interactive Staging Review Table"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md space-y-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white">
                Interactive Staging Review Table
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Aggregated, deduplicated preview across Menu Boards and Vendor Invoices. Override item classifications or modifier groups with live category count recalculation.
              </p>
            </div>

            {/* Dynamic Filter Tabs */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              {[
                {
                  id: "all" as const,
                  label: `All Staged (${
                    stagedMenuItems.length +
                    stagedModifiers.length +
                    stagedRetailItems.length +
                    stagedSupplies.length
                  })`,
                },
                {
                  id: "drinks" as const,
                  label: `Drinks & Food (${stagedMenuItems.length})`,
                },
                {
                  id: "modifiers" as const,
                  label: `Modifiers (${stagedModifiers.length})`,
                },
                {
                  id: "retail" as const,
                  label: `Retail SKUs (${stagedRetailItems.length})`,
                },
                {
                  id: "supplies" as const,
                  label: `Operational Supplies (${stagedSupplies.length})`,
                },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveReviewTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                    activeReviewTab === tab.id
                      ? "bg-amber-500 text-slate-950 font-bold"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Empty State */}
          {stagedMenuItems.length === 0 &&
            stagedModifiers.length === 0 &&
            stagedRetailItems.length === 0 &&
            stagedSupplies.length === 0 && (
              <div className="py-12 text-center border border-dashed border-slate-800 rounded-xl space-y-3">
                <p className="text-sm font-semibold text-slate-300">
                  No menu items or invoice SKUs staged yet
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Upload photos of menu boards or vendor invoices in the dropzones above to populate the staging table.
                </p>
              </div>
            )}

          {/* Sub-Table A: Drinks & Food */}
          {(activeReviewTab === "all" || activeReviewTab === "drinks") &&
            stagedMenuItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-400">
                    Drinks &amp; Food (Menu &amp; Reclassified Items)
                  </h3>
                  <span className="text-xs font-mono text-slate-400">
                    {summaryCounts.activeDrinks} / {stagedMenuItems.length} Included
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                        <th className="py-2.5 px-3 w-12">POS</th>
                        <th className="py-2.5 px-3">Item Name</th>
                        <th className="py-2.5 px-3">Classification</th>
                        <th className="py-2.5 px-3">Category</th>
                        <th className="py-2.5 px-3">Sizes &amp; Board Pricing</th>
                        <th className="py-2.5 px-3">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {stagedMenuItems.map((drink) => (
                        <tr
                          key={drink.id}
                          className={`transition ${
                            drink.included
                              ? "bg-slate-900/40 hover:bg-slate-800/40"
                              : "bg-slate-950/40 opacity-50"
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={drink.included}
                              onChange={() => toggleMenuItemIncluded(drink.id)}
                              aria-label={`Include ${drink.name}`}
                              className="h-4 w-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {drink.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={drink.classification || "drink"}
                              onChange={(e) =>
                                handleReclassifyItem(
                                  "drinks",
                                  drink.id,
                                  e.target.value as ItemClassification
                                )
                              }
                              aria-label={`Classification for ${drink.name}`}
                              className={`rounded-lg border px-2.5 py-1 text-base sm:text-xs font-mono font-medium transition cursor-pointer focus:outline-none ${getClassificationSelectClasses(
                                drink.classification || "drink"
                              )}`}
                            >
                              {CLASSIFICATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded bg-cyan-950/70 border border-cyan-800/50 text-cyan-300 font-mono text-[11px]">
                              {drink.categoryName}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex flex-wrap gap-1.5">
                              {drink.variations.map((v, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-amber-300"
                                >
                                  {v.size}: ${v.price.toFixed(2)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {drink.sourceFileName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {/* Sub-Table B: Ingested Modifiers */}
          {(activeReviewTab === "all" || activeReviewTab === "modifiers") &&
            stagedModifiers.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-amber-400">
                    Ingested Modifier Options (Syrups, Sauces, Milks &amp; Powders)
                  </h3>
                  <span className="text-xs font-mono text-slate-400">
                    {summaryCounts.activeModifiers} / {stagedModifiers.length} Included
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                        <th className="py-2.5 px-3 w-12">POS</th>
                        <th className="py-2.5 px-3">Modifier Option</th>
                        <th className="py-2.5 px-3">Classification</th>
                        <th className="py-2.5 px-3">Target Modifier Group</th>
                        <th className="py-2.5 px-3">Unit Cost</th>
                        <th className="py-2.5 px-3">Vendor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {stagedModifiers.map((mod) => (
                        <tr
                          key={mod.id}
                          className={`transition ${
                            mod.included
                              ? "bg-slate-900/40 hover:bg-slate-800/40"
                              : "bg-slate-950/40 opacity-50"
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={mod.included}
                              onChange={() => toggleModifierIncluded(mod.id)}
                              aria-label={`Include ${mod.name}`}
                              className="h-4 w-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {mod.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={mod.classification}
                              onChange={(e) =>
                                handleReclassifyItem(
                                  "modifiers",
                                  mod.id,
                                  e.target.value as ItemClassification
                                )
                              }
                              aria-label={`Classification for ${mod.name}`}
                              className={`rounded-lg border px-2.5 py-1 text-base sm:text-xs font-mono font-medium transition cursor-pointer focus:outline-none ${getClassificationSelectClasses(
                                mod.classification
                              )}`}
                            >
                              {CLASSIFICATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={mod.targetGroup}
                              onChange={(e) =>
                                updateModifierTargetGroup(mod.id, e.target.value)
                              }
                              aria-label={`Modifier group for ${mod.name}`}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-base sm:text-xs text-amber-300 font-medium focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 cursor-pointer"
                            >
                              {MODIFIER_GROUPS.map((groupName) => (
                                <option key={groupName} value={groupName}>
                                  {groupName}
                                </option>
                              ))}
                              {!MODIFIER_GROUPS.includes(
                                mod.targetGroup as (typeof MODIFIER_GROUPS)[number]
                              ) && (
                                <option value={mod.targetGroup}>
                                  {mod.targetGroup}
                                </option>
                              )}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">
                            {formatCents(mod.unitCostCents)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {mod.vendorName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {/* Sub-Table C: Retail Products */}
          {(activeReviewTab === "all" || activeReviewTab === "retail") &&
            stagedRetailItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-emerald-400">
                    Ingested Retail Products (Whole Bean Bags, RTDs &amp; Packaged Goods)
                  </h3>
                  <span className="text-xs font-mono text-slate-400">
                    {summaryCounts.activeRetail} / {stagedRetailItems.length} Included
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                        <th className="py-2.5 px-3 w-12">POS</th>
                        <th className="py-2.5 px-3">Retail Item Name</th>
                        <th className="py-2.5 px-3">Classification</th>
                        <th className="py-2.5 px-3">SKU</th>
                        <th className="py-2.5 px-3">Unit Cost</th>
                        <th className="py-2.5 px-3">Suggested Retail</th>
                        <th className="py-2.5 px-3">Vendor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {stagedRetailItems.map((item) => (
                        <tr
                          key={item.id}
                          className={`transition ${
                            item.included
                              ? "bg-slate-900/40 hover:bg-slate-800/40"
                              : "bg-slate-950/40 opacity-50"
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={item.included}
                              onChange={() => toggleRetailItemIncluded(item.id)}
                              aria-label={`Include ${item.name}`}
                              className="h-4 w-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {item.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={item.classification}
                              onChange={(e) =>
                                handleReclassifyItem(
                                  "retail",
                                  item.id,
                                  e.target.value as ItemClassification
                                )
                              }
                              aria-label={`Classification for ${item.name}`}
                              className={`rounded-lg border px-2.5 py-1 text-base sm:text-xs font-mono font-medium transition cursor-pointer focus:outline-none ${getClassificationSelectClasses(
                                item.classification
                              )}`}
                            >
                              {CLASSIFICATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {item.sku || "—"}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">
                            {formatCents(item.unitCostCents)}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-emerald-400">
                            {formatCents(item.suggestedPriceCents)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                            {item.vendorName}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          {/* Sub-Table D: Operational Supplies */}
          {(activeReviewTab === "all" || activeReviewTab === "supplies") &&
            stagedSupplies.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Operational Supplies (Non-Menu Backroom Disposables — Excluded by Default)
                  </h3>
                  <span className="text-xs font-mono text-slate-500">
                    {summaryCounts.excludedSupplies} Excluded from POS Screen
                  </span>
                </div>

                <div className="overflow-x-auto border border-slate-800 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                        <th className="py-2.5 px-3 w-12">POS</th>
                        <th className="py-2.5 px-3">Supply Description</th>
                        <th className="py-2.5 px-3">Classification</th>
                        <th className="py-2.5 px-3">Pack Size</th>
                        <th className="py-2.5 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {stagedSupplies.map((sup) => (
                        <tr
                          key={sup.id}
                          className={`transition ${
                            sup.included
                              ? "bg-slate-900/40"
                              : "bg-slate-950/60 text-slate-400"
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <input
                              type="checkbox"
                              checked={sup.included}
                              onChange={() => toggleSupplyIncluded(sup.id)}
                              aria-label={`Include ${sup.name}`}
                              className="h-4 w-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-300">
                            {sup.name}
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={sup.classification}
                              onChange={(e) =>
                                handleReclassifyItem(
                                  "supplies",
                                  sup.id,
                                  e.target.value as ItemClassification
                                )
                              }
                              aria-label={`Classification for ${sup.name}`}
                              className={`rounded-lg border px-2.5 py-1 text-base sm:text-xs font-mono font-medium transition cursor-pointer focus:outline-none ${getClassificationSelectClasses(
                                sup.classification
                              )}`}
                            >
                              {CLASSIFICATION_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-400">
                            {sup.packSize || "—"}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px]">
                            {sup.included ? (
                              <span className="text-amber-400">Included on POS</span>
                            ) : (
                              <span className="text-slate-500">
                                Excluded (Non-Menu Supply)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </section>
      </main>

      {/* Session Manager Modal / Drawer */}
      {isSessionDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-archive-drawer-title"
          onClick={() => {
            setIsSessionDrawerOpen(false);
            setConfirmPurgeAll(false);
          }}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full flex flex-col justify-between shadow-2xl overflow-hidden"
          >
            {/* Drawer Header */}
            <div className="p-6 border-b border-slate-800 bg-slate-950/90 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    barmaid_saved_sessions
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {savedSessions.length} Stored
                  </span>
                </div>
                <h2
                  id="session-archive-drawer-title"
                  className="text-lg font-extrabold text-white mt-1"
                >
                  Past Sessions &amp; Client Onboarding Archive
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsSessionDrawerOpen(false);
                  setConfirmPurgeAll(false);
                }}
                aria-label="Close session drawer"
                className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold transition cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Top Action Bar inside Drawer: + Start New Shop & Export All Records (.json) */}
            <div className="px-6 py-3.5 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={handleStartNewShop}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition cursor-pointer shadow-md shadow-amber-500/10"
              >
                + Start New Shop
              </button>

              <button
                type="button"
                disabled={savedSessions.length === 0}
                onClick={handleExportAllSessions}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 border border-slate-700 text-emerald-300 text-xs font-bold transition cursor-pointer"
              >
                Export All Records (.json)
              </button>
            </div>

            {/* Saved Business Cards List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {savedSessions.length === 0 ? (
                <div className="py-16 text-center border border-dashed border-slate-800 rounded-2xl p-6 space-y-2">
                  <p className="text-sm font-bold text-slate-300">
                    No Saved Client Sessions
                  </p>
                  <p className="text-xs text-slate-500 max-w-xs mx-auto leading-relaxed">
                    As you enter merchant details or upload documents, BarMaid automatically archives each shop here by its unique{" "}
                    <code className="font-mono text-amber-400">merchantSlug</code>.
                  </p>
                </div>
              ) : (
                savedSessions.map((session) => {
                  const displayName =
                    session.storeProfile.dbaName ||
                    session.storeProfile.legalName ||
                    session.storeProfile.merchantSlug;
                  const formattedDate = (() => {
                    try {
                      return new Date(session.createdAt).toLocaleString();
                    } catch {
                      return session.createdAt;
                    }
                  })();
                  const isCurrentActive =
                    activeSlugBadge &&
                    activeSlugBadge === session.storeProfile.merchantSlug;

                  return (
                    <div
                      key={session.id}
                      className={`rounded-2xl border p-4 space-y-3.5 transition ${
                        isCurrentActive
                          ? "bg-slate-950/90 border-amber-500/60 shadow-lg shadow-amber-500/5"
                          : "bg-slate-950/60 border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-sm font-extrabold text-white">
                              {displayName}
                            </h3>
                            <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-amber-400 font-mono text-[11px]">
                              {session.storeProfile.merchantSlug}
                            </span>
                            {isCurrentActive && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                                Active
                              </span>
                            )}
                          </div>
                          {session.storeProfile.legalName &&
                            session.storeProfile.legalName !== displayName && (
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                Legal: {session.storeProfile.legalName}
                              </p>
                            )}
                          <p className="text-[11px] font-mono text-slate-500 mt-1">
                            Saved: {formattedDate}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteSavedSession(
                              session.storeProfile.merchantSlug || session.id
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 text-[11px] font-semibold transition cursor-pointer"
                        >
                          Delete Record
                        </button>
                      </div>

                      {/* Counts Row */}
                      <div className="grid grid-cols-4 gap-2 text-center text-xs">
                        <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2">
                          <span className="text-[10px] font-mono text-cyan-400 block">
                            Drinks/Food
                          </span>
                          <span className="font-bold text-white">
                            {session.counts.drinks}
                          </span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2">
                          <span className="text-[10px] font-mono text-amber-400 block">
                            Modifiers
                          </span>
                          <span className="font-bold text-white">
                            {session.counts.modifiers}
                          </span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2">
                          <span className="text-[10px] font-mono text-emerald-400 block">
                            Retail
                          </span>
                          <span className="font-bold text-white">
                            {session.counts.retail}
                          </span>
                        </div>
                        <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2">
                          <span className="text-[10px] font-mono text-slate-400 block">
                            Supplies
                          </span>
                          <span className="font-bold text-slate-300">
                            {session.counts.supplies}
                          </span>
                        </div>
                      </div>

                      {/* Load Actions */}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() =>
                            handleLoadSavedSession(session, "/onboard/intake")
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                        >
                          Load Business (Step 1)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleLoadSavedSession(session, "/onboard/rules")
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                        >
                          Load &amp; Open Step 2 →
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Drawer Footer: Master Purge All Sessions */}
            <div className="p-5 border-t border-slate-800 bg-slate-950/90">
              {!confirmPurgeAll ? (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-slate-400">
                    Master Archive Controls
                  </span>
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeAll(true)}
                    className="px-4 py-2 rounded-xl bg-rose-950/70 hover:bg-rose-900/80 border border-rose-500/50 text-rose-200 text-xs font-bold transition cursor-pointer"
                  >
                    Purge All Sessions
                  </button>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-500/70 space-y-3">
                  <p className="text-xs font-bold text-rose-200 leading-relaxed">
                    Are you sure? This permanently deletes all{" "}
                    {savedSessions.length} saved business session(s) from{" "}
                    <code className="font-mono">barmaid_saved_sessions</code>{" "}
                    and resets the current onboarding workspace.
                  </p>
                  <div className="flex items-center justify-end gap-2.5">
                    <button
                      type="button"
                      onClick={() => setConfirmPurgeAll(false)}
                      className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handlePurgeAllSessions}
                      className="px-4 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-extrabold transition cursor-pointer"
                    >
                      Confirm Purge All
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Sticky Footer Action Bar */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-6 py-3.5 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs font-mono text-slate-400">
            <span>
              Tenant:{" "}
              <strong className="text-amber-400">
                {activeSlugBadge || "unassigned"}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Drinks &amp; Food:{" "}
              <strong className="text-white">{summaryCounts.activeDrinks}</strong>
            </span>
            <span>&middot;</span>
            <span>
              Modifiers:{" "}
              <strong className="text-amber-400">
                {summaryCounts.activeModifiers}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Retail SKUs:{" "}
              <strong className="text-emerald-400">
                {summaryCounts.activeRetail}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Filtered Supplies:{" "}
              <strong className="text-slate-400">
                {summaryCounts.excludedSupplies}
              </strong>
            </span>
          </div>

          <button
            type="button"
            onClick={handleContinueToBusinessRules}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
          >
            <span>Continue to Step 2: Business Rules →</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
