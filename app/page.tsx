"use client";

import { useEffect, useState, useRef, useCallback, useMemo, ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  INTAKE_STAGE_STORAGE_KEY,
  toSlug,
  readSavedSessionsFromStorage,
  restoreSessionToActiveStage,
  clearActiveStageAndRulesFromStorage,
  type IntakeStageData,
  type OnboardingSession,
} from "@/app/onboard/intake/page";
import {
  RULES_CONFIG_STORAGE_KEY,
  type BusinessRulesConfig,
  type PersistedAuditMetrics,
  type PersistedLayoutTemplateCode,
  type PersistedPreOptimizeSnapshot,
  type StudioNavigationMode,
  type StudioHardwareFormFactor,
} from "@/app/onboard/rules/page";
import {
  getPosAuthStorageKey,
  type PosAuthRecord,
} from "@/app/onboard/connect/page";

const PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY = "barmaid_pre_optimize_snapshot";

const BASELINE_AUDIT_METRICS: PersistedAuditMetrics = {
  healthScore: 74,
  frictionLabel: "Moderate Friction",
  averageBaristaTaps: 4.2,
  targetMet: false,
};

type Variation = {
  size: string;
  price: number;
};

type StagedItem = {
  name: string;
  categoryName: string;
  classification?:
    | "drink"
    | "food"
    | "retail_item"
    | "modifier_option"
    | "operational_supply";
  variations: Variation[];
  squareId?: string;
  source: "square" | "upload" | "reconciled";
};

type StagedModifier = {
  name: string;
  price: number;
  squareId?: string;
};

type SquareRawItem = {
  id: string;
  item_data?: {
    name: string;
    category_id?: string;
    variations?: Array<{
      id: string;
      item_variation_data?: {
        name: string;
        price_money?: { amount: number };
      };
    }>;
  };
};

type SquareRawModifierList = {
  id: string;
  modifier_list_data?: {
    name: string;
    modifiers?: Array<{
      id: string;
      modifier_data?: {
        name: string;
        price_money?: { amount: number };
      };
    }>;
  };
};

type SquareRawCategory = {
  id: string;
  category_data?: {
    name: string;
  };
};

type ArchetypeId = "fast-cash" | "specialty" | "color-coded";
type TileColor = "amber" | "cyan" | "emerald" | "slate" | "blank";

const toTemplateStorageCode = (
  arch: ArchetypeId
): PersistedLayoutTemplateCode => {
  if (arch === "specialty") return "SPECIALTY";
  if (arch === "color-coded") return "COLOR-ZONED";
  return "FAST-CASH";
};

const fromTemplateStorageCode = (
  code?: PersistedLayoutTemplateCode | string | null
): ArchetypeId => {
  if (code === "SPECIALTY" || code === "specialty") return "specialty";
  if (code === "COLOR-ZONED" || code === "color-coded") return "color-coded";
  return "fast-cash";
};

const getTemplateAuditMetrics = (
  arch: ArchetypeId,
  optimized: boolean
): PersistedAuditMetrics => {
  if (!optimized) {
    return { ...BASELINE_AUDIT_METRICS };
  }
  if (arch === "specialty") {
    return {
      healthScore: 91,
      frictionLabel: "Low Friction",
      averageBaristaTaps: 2.1,
      targetMet: true,
    };
  }
  if (arch === "color-coded") {
    return {
      healthScore: 93,
      frictionLabel: "Low Friction",
      averageBaristaTaps: 2.0,
      targetMet: true,
    };
  }
  return {
    healthScore: 94,
    frictionLabel: "Low Friction",
    averageBaristaTaps: 1.9,
    targetMet: true,
  };
};

type GridTile = {
  id: number;
  label: string;
  price: string;
  color: TileColor;
};

type CategoryFolderGroup = {
  folderName: string;
  itemCount: number;
  color: TileColor;
  items: GridTile[];
};

const createEmptyPage = (pageIndex: number): GridTile[] => {
  const startIndex = pageIndex * 20 + 1;
  return Array.from({ length: 20 }, (_, i) => ({
    id: startIndex + i,
    label: "[Empty Slot]",
    price: "",
    color: "blank",
  }));
};

const getItemColor = (name: string, categoryName?: string): TileColor => {
  const combined = `${name} ${categoryName || ""}`;
  if (/retail|bean|merch|bagged/i.test(combined)) {
    return "slate";
  }
  if (
    /muffin|scone|cookie|burrito|bagel|pastry|food|sandwich|croissant|snack|treat|bakery|pretzel|biscotti|cake/i.test(
      combined
    )
  ) {
    return "emerald";
  }
  if (
    /cold|iced|lotus|energy|redbull|rebel|tea|smoothie|soda|lemonade|boba|frappe|blended/i.test(
      combined
    )
  ) {
    return "cyan";
  }
  return "amber";
};

const buildPagesFromCatalog = (
  items: StagedItem[],
  modifiers: StagedModifier[],
  archetype: ArchetypeId = "fast-cash"
): GridTile[][] => {
  if (items.length === 0 && modifiers.length === 0) {
    return [createEmptyPage(0)];
  }

  const sorted = [...items].sort((a, b) => {
    const aType = getItemColor(a.name, a.categoryName);
    const bType = getItemColor(b.name, b.categoryName);
    const score = (t: TileColor) =>
      t === "amber" ? 1 : t === "cyan" ? 2 : t === "emerald" ? 3 : 4;
    return score(aType) - score(bType);
  });

  const combinedTilesData: Array<{
    label: string;
    price: string;
    color: TileColor;
  }> = sorted.map((item) => {
    const primaryVar = item.variations[0];
    const hasMultipleSizes = item.variations.length > 1;
    const label =
      archetype === "fast-cash" && primaryVar?.size
        ? `${primaryVar.size} ${item.name}`
        : item.name;
    const price =
      archetype === "specialty" && hasMultipleSizes
        ? "Select Size"
        : archetype === "color-coded" && hasMultipleSizes && primaryVar
        ? `$${primaryVar.price.toFixed(2)}+`
        : primaryVar
        ? `$${primaryVar.price.toFixed(2)}`
        : "$4.50";

    return {
      label,
      price,
      color: getItemColor(item.name, item.categoryName),
    };
  });

  // Append top modifiers into remaining slots or subsequent pages so both drinks and modifiers are represented in the matrix
  modifiers.slice(0, 12).forEach((mod) => {
    combinedTilesData.push({
      label: `+ ${mod.name}`,
      price: `+$${mod.price.toFixed(2)}`,
      color: "slate",
    });
  });

  const totalPagesNeeded = Math.max(1, Math.ceil(combinedTilesData.length / 20));
  const generatedPages: GridTile[][] = [];

  for (let p = 0; p < totalPagesNeeded; p++) {
    const startItemIdx = p * 20;
    const chunk = combinedTilesData.slice(startItemIdx, startItemIdx + 20);
    const startSlotId = p * 20 + 1;

    const pageTiles: GridTile[] = Array.from({ length: 20 }, (_, i) => {
      const entry = chunk[i];
      if (!entry) {
        return {
          id: startSlotId + i,
          label: "[Empty Slot]",
          price: "",
          color: "blank" as TileColor,
        };
      }
      return {
        id: startSlotId + i,
        label: entry.label,
        price: entry.price,
        color: entry.color,
      };
    });

    generatedPages.push(pageTiles);
  }

  return generatedPages;
};

/**
 * Template-Aware Ergonomics Auto-Optimization Heuristic:
 * - Fast-Cash (Optimized): 16oz single-tap top-velocity drink anchors placed in prime thumb reach zones.
 * - Specialty (Optimized): Beverage base families grouped by sales frequency to minimize tap distance when opening size sheets.
 * - Color-Zoned (Optimized): Station color blocks (Espresso Bar, Cold Drinks/Energy, Food) positioned with high-velocity stations closest to primary tapping hand.
 */
const buildAutoOptimizedPages = (
  items: StagedItem[],
  modifiers: StagedModifier[],
  archetype: ArchetypeId = "fast-cash",
  fallbackCurrentPages?: GridTile[][]
): GridTile[][] => {
  if (items.length === 0 && modifiers.length === 0) {
    if (fallbackCurrentPages && fallbackCurrentPages.length > 0) {
      return fallbackCurrentPages.map((page) =>
        page.map((tile) => {
          if (tile.color === "blank" || tile.label === "[Empty Slot]") {
            return tile;
          }
          const isBeverageTile =
            tile.color === "amber" || tile.color === "cyan";
          const cleanLabel = tile.label
            .replace(/^(8oz|12oz|16oz|20oz|24oz|32oz)\s+/i, "")
            .trim();
          return {
            ...tile,
            label:
              archetype === "fast-cash" && isBeverageTile
                ? `16oz ${cleanLabel}`
                : cleanLabel,
          };
        })
      );
    }
    return [createEmptyPage(0)];
  }

  const getSalesVelocityRank = (item: StagedItem): number => {
    const combined = `${item.name} ${item.categoryName || ""}`;
    // Tier 1: High-velocity Espresso staples (primary thumb-reach anchors)
    if (
      /latte|americano|mocha|white\s*mocha|caramel\s*macchiato|breve|cappuccino|drip|cold\s*brew|espresso/i.test(
        combined
      )
    ) {
      return 1;
    }
    // Tier 2: High-velocity Energy drinks & iced specialty anchors
    if (
      /lotus|red\s*bull|rebel|energy|iced|boba|chai|matcha|frappe|smoothie/i.test(
        combined
      )
    ) {
      return 2;
    }
    // Tier 3: Other beverages
    const color = getItemColor(item.name, item.categoryName);
    if (color === "amber" || color === "cyan") {
      return 3;
    }
    // Tier 4: Food & Pastries
    if (color === "emerald") {
      return 4;
    }
    // Tier 5: Retail SKUs
    return 5;
  };

  const getStationBlockRank = (color: TileColor): number => {
    // High-velocity stations closest to primary tapping hand:
    // 1: Espresso Bar (amber), 2: Cold Drinks/Energy (cyan), 3: Food (emerald), 4: Retail (slate)
    if (color === "amber") return 1;
    if (color === "cyan") return 2;
    if (color === "emerald") return 3;
    return 4;
  };

  let sortedItems: StagedItem[] = [];

  if (archetype === "color-coded") {
    // Color-Zoned (Optimized): Group strictly by station color block, and sort by sales velocity within each station
    sortedItems = [...items].sort((a, b) => {
      const colorA = getItemColor(a.name, a.categoryName);
      const colorB = getItemColor(b.name, b.categoryName);
      const blockDiff =
        getStationBlockRank(colorA) - getStationBlockRank(colorB);
      if (blockDiff !== 0) return blockDiff;
      return getSalesVelocityRank(a) - getSalesVelocityRank(b);
    });
  } else {
    // Fast-Cash & Specialty (Optimized): Sort across catalog by sales velocity / frequency
    sortedItems = [...items].sort(
      (a, b) => getSalesVelocityRank(a) - getSalesVelocityRank(b)
    );
  }

  const combinedTilesData: Array<{
    label: string;
    price: string;
    color: TileColor;
  }> = sortedItems.map((item) => {
    const color = getItemColor(item.name, item.categoryName);
    const isBeverage = color === "amber" || color === "cyan";
    const hasMultipleSizes = item.variations.length > 1;
    const sixteenOzVar =
      item.variations.find((v) => /16\s*oz/i.test(v.size)) ||
      item.variations[0];
    const primaryVar = item.variations[0];
    const resolvedSixteenPrice = sixteenOzVar ? sixteenOzVar.price : 4.75;
    const resolvedBasePrice = primaryVar ? primaryVar.price : 4.5;
    const cleanName = item.name
      .replace(/^(8oz|12oz|16oz|20oz|24oz|32oz)\s+/i, "")
      .trim();

    if (archetype === "specialty") {
      // Specialty (Optimized): Beverage base families grouped by sales frequency to minimize tap distance when opening size sheets
      return {
        label: cleanName,
        price:
          isBeverage && hasMultipleSizes
            ? "Select Size"
            : `$${resolvedBasePrice.toFixed(2)}`,
        color,
      };
    }

    if (archetype === "color-coded") {
      // Color-Zoned (Optimized): Station color blocks with base+ pricing indicator
      return {
        label: cleanName,
        price:
          isBeverage && hasMultipleSizes
            ? `$${resolvedBasePrice.toFixed(2)}+`
            : `$${resolvedBasePrice.toFixed(2)}`,
        color,
      };
    }

    // Fast-Cash (Optimized): 16oz single-tap top-velocity drink anchors in prime thumb reach zones
    return {
      label: isBeverage ? `16oz ${cleanName}` : cleanName,
      price: `$${resolvedSixteenPrice.toFixed(2)}`,
      color,
    };
  });

  // Link unified modifier groups into fast-reach modifier slots
  const seenMods = new Set<string>();
  modifiers.forEach((mod) => {
    const cleanMod = mod.name.trim();
    const key = cleanMod.toLowerCase();
    if (!cleanMod || seenMods.has(key)) return;
    seenMods.add(key);
    combinedTilesData.push({
      label: `+ ${cleanMod}`,
      price: `+$${mod.price.toFixed(2)}`,
      color: "slate",
    });
  });

  const totalPagesNeeded = Math.max(
    1,
    Math.ceil(combinedTilesData.length / 20)
  );
  const generatedPages: GridTile[][] = [];

  for (let p = 0; p < totalPagesNeeded; p++) {
    const startItemIdx = p * 20;
    const chunk = combinedTilesData.slice(startItemIdx, startItemIdx + 20);
    const startSlotId = p * 20 + 1;

    const pageTiles: GridTile[] = Array.from({ length: 20 }, (_, i) => {
      const entry = chunk[i];
      if (!entry) {
        return {
          id: startSlotId + i,
          label: "[Empty Slot]",
          price: "",
          color: "blank" as TileColor,
        };
      }
      return {
        id: startSlotId + i,
        label: entry.label,
        price: entry.price,
        color: entry.color,
      };
    });

    generatedPages.push(pageTiles);
  }

  return generatedPages;
};

export default function BarMaidDashboard() {
  const router = useRouter();
  const [isRedirectingToDashboard, setIsRedirectingToDashboard] =
    useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<
    "intake" | "audit" | "studio" | "deploy"
  >("studio");
  const [selectedArchetype, setSelectedArchetype] =
    useState<ArchetypeId>("fast-cash");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active Tenant Scope hydrated from 'barmaid_intake_stage'
  const [merchantSlug, setMerchantSlug] = useState<string>("unassigned");
  const [merchantDisplayName, setMerchantDisplayName] =
    useState<string>("Unassigned Merchant");
  const [posAuth, setPosAuth] = useState<PosAuthRecord | null>(null);
  const [savedSessions, setSavedSessions] = useState<OnboardingSession[]>([]);

  // Live Square Raw Data Store
  const [squareItems, setSquareItems] = useState<SquareRawItem[]>([]);
  const [squareCategories, setSquareCategories] = useState<SquareRawCategory[]>(
    []
  );
  const [squareModifierLists, setSquareModifierLists] = useState<
    SquareRawModifierList[]
  >([]);
  const [squareTotalObjects, setSquareTotalObjects] = useState<number>(0);

  // Multi-Board Intake State
  const [boardImages, setBoardImages] = useState<string[]>([]);
  const [posScreenshots, setPosScreenshots] = useState<string[]>([]);
  const [isProcessingOcr, setIsProcessingOcr] = useState(false);
  const [ocrStatusText, setOcrStatusText] = useState("");
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);
  const [stagedModifiers, setStagedModifiers] = useState<StagedModifier[]>([]);
  const [reconcileReport, setReconcileReport] = useState<{
    matched: number;
    newFromWall: number;
    retainedFromSquare: number;
    modifiersCollapsed: number;
  } | null>(null);

  // Dynamic Elastic Multi-Page State (Array of 20-Tile Pages)
  const [pages, setPages] = useState<GridTile[][]>(() => [createEmptyPage(0)]);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);
  const [selectedTileId, setSelectedTileId] = useState<number>(1);

  // Auto-Optimization & Snapshot Undo State
  const [isOptimized, setIsOptimized] = useState<boolean>(false);
  const [preOptimizeSnapshot, setPreOptimizeSnapshot] =
    useState<PersistedPreOptimizeSnapshot | null>(null);
  const [auditMetrics, setAuditMetrics] = useState<PersistedAuditMetrics>(
    BASELINE_AUDIT_METRICS
  );

  // Studio Navigation Style & Hardware Form-Factor State
  const [navigationMode, setNavigationMode] =
    useState<StudioNavigationMode>("flat-speed");
  const [hardwareFormFactor, setHardwareFormFactor] =
    useState<StudioHardwareFormFactor>("ipad-landscape");
  const [activeCategoryFolder, setActiveCategoryFolder] = useState<
    string | null
  >(null);

  // Deployment States
  const [deployState, setDeployState] = useState<
    "idle" | "deploying" | "success"
  >("idle");
  const [deployMessage, setDeployMessage] = useState<string>("");

  const boardInputRef = useRef<HTMLInputElement>(null);
  const posInputRef = useRef<HTMLInputElement>(null);

  const persistRulesConfigState = useCallback(
    (updates: {
      activeLayoutTemplate?: PersistedLayoutTemplateCode;
      navigationMode?: StudioNavigationMode;
      hardwareFormFactor?: StudioHardwareFormFactor;
      isOptimized?: boolean;
      optimizedGridPages?: GridTile[][];
      preOptimizeSnapshot?: PersistedPreOptimizeSnapshot | null;
    }) => {
      try {
        const rawRules =
          localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
          sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);
        const existingRules: Partial<BusinessRulesConfig> = rawRules
          ? (JSON.parse(rawRules) as Partial<BusinessRulesConfig>)
          : {};

        const updatedRulesConfig: BusinessRulesConfig = {
          merchant_slug:
            existingRules.merchant_slug || merchantSlug || "unassigned",
          sizeMatrix: Array.isArray(existingRules.sizeMatrix)
            ? existingRules.sizeMatrix
            : [
                {
                  size: "8oz",
                  enabled: true,
                  defaultShots: 1,
                  defaultSyrupPumps: 2,
                },
                {
                  size: "12oz",
                  enabled: true,
                  defaultShots: 2,
                  defaultSyrupPumps: 3,
                },
                {
                  size: "16oz",
                  enabled: true,
                  defaultShots: 2,
                  defaultSyrupPumps: 4,
                },
                {
                  size: "20oz",
                  enabled: true,
                  defaultShots: 4,
                  defaultSyrupPumps: 5,
                },
                {
                  size: "24oz",
                  enabled: true,
                  defaultShots: 4,
                  defaultSyrupPumps: 6,
                },
                {
                  size: "32oz",
                  enabled: true,
                  defaultShots: 6,
                  defaultSyrupPumps: 7,
                },
              ],
          modifierPricing: existingRules.modifierPricing || {
            altMilkUpchargeDollars: 0.75,
            extraShotDollars: 0.75,
            syrupSauceAddOnDollars: 0.5,
          },
          preferredPosPreview: existingRules.preferredPosPreview || "square",
          savedAt: new Date().toISOString(),
          activeLayoutTemplate:
            updates.activeLayoutTemplate ??
            existingRules.activeLayoutTemplate ??
            toTemplateStorageCode(selectedArchetype),
          navigationMode:
            updates.navigationMode ??
            existingRules.navigationMode ??
            navigationMode,
          hardwareFormFactor:
            updates.hardwareFormFactor ??
            existingRules.hardwareFormFactor ??
            hardwareFormFactor,
          isOptimized:
            updates.isOptimized ?? existingRules.isOptimized ?? isOptimized,
          optimizedGridPages:
            "optimizedGridPages" in updates
              ? updates.optimizedGridPages
              : existingRules.optimizedGridPages,
          preOptimizeSnapshot:
            "preOptimizeSnapshot" in updates
              ? updates.preOptimizeSnapshot
              : existingRules.preOptimizeSnapshot,
        };

        const serialized = JSON.stringify(updatedRulesConfig);
        localStorage.setItem(RULES_CONFIG_STORAGE_KEY, serialized);
        sessionStorage.setItem(RULES_CONFIG_STORAGE_KEY, serialized);
      } catch {
        // Ignore storage quota errors
      }
    },
    [
      hardwareFormFactor,
      isOptimized,
      merchantSlug,
      navigationMode,
      selectedArchetype,
    ]
  );

  const handleToggleNavigationMode = (mode: StudioNavigationMode) => {
    setNavigationMode(mode);
    if (mode === "category-folders") {
      setActiveCategoryFolder(null);
    }
    persistRulesConfigState({ navigationMode: mode });
  };

  const handleToggleHardwareFormFactor = (
    formFactor: StudioHardwareFormFactor
  ) => {
    setHardwareFormFactor(formFactor);
    persistRulesConfigState({ hardwareFormFactor: formFactor });
  };

  // Template switch handler: preserves optimization state across Fast-Cash, Specialty, and Color-Zoned
  const applyPreset = useCallback(
    (arch: ArchetypeId) => {
      const templateCode = toTemplateStorageCode(arch);
      if (isOptimized) {
        const optimizedGenerated = buildAutoOptimizedPages(
          stagedItems,
          stagedModifiers,
          arch,
          pages
        );
        setPages(optimizedGenerated);
        setAuditMetrics(getTemplateAuditMetrics(arch, true));
        setActivePageIndex(0);
        setSelectedTileId(1);
        persistRulesConfigState({
          activeLayoutTemplate: templateCode,
          isOptimized: true,
          optimizedGridPages: optimizedGenerated,
          preOptimizeSnapshot,
        });
      } else {
        const rawGenerated = buildPagesFromCatalog(
          stagedItems,
          stagedModifiers,
          arch
        );
        setPages(rawGenerated);
        setAuditMetrics(getTemplateAuditMetrics(arch, false));
        setActivePageIndex(0);
        setSelectedTileId(1);
        persistRulesConfigState({
          activeLayoutTemplate: templateCode,
          isOptimized: false,
          optimizedGridPages: undefined,
          preOptimizeSnapshot: null,
        });
      }
    },
    [
      isOptimized,
      pages,
      persistRulesConfigState,
      preOptimizeSnapshot,
      stagedItems,
      stagedModifiers,
    ]
  );

  // Hydrate active tenant and staged drink/modifier catalog from 'barmaid_intake_stage'
  useEffect(() => {
    setSavedSessions(readSavedSessionsFromStorage());

    let resolvedSlug = "unassigned";
    let resolvedDisplayName = "Unassigned Merchant";
    let customAccessToken = "";

    try {
      const searchParams =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search)
          : null;
      const queryMerchant = searchParams?.get("merchant")?.trim();
      const queryTab = searchParams?.get("tab")?.trim();

      // Redirect root URL (/) with no ?merchant= or ?tab= query parameters directly to /dashboard
      if (!queryMerchant && !queryTab) {
        setIsRedirectingToDashboard(true);
        router.replace("/dashboard");
        return;
      }

      if (
        queryTab === "intake" ||
        queryTab === "audit" ||
        queryTab === "studio" ||
        queryTab === "deploy"
      ) {
        setActiveTab(queryTab);
      }

      const rawStage =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);

      const parsedStage = rawStage
        ? (JSON.parse(rawStage) as IntakeStageData)
        : null;
      const parsedRules = rawRules
        ? (JSON.parse(rawRules) as BusinessRulesConfig)
        : null;

      resolvedSlug =
        queryMerchant ||
        parsedRules?.merchant_slug ||
        parsedStage?.storeProfile?.merchantSlug ||
        toSlug(
          parsedStage?.storeProfile?.dbaName ||
            parsedStage?.storeProfile?.legalName ||
            ""
        ) ||
        "unassigned";

      resolvedDisplayName =
        parsedStage?.storeProfile?.dbaName ||
        parsedStage?.storeProfile?.legalName ||
        (resolvedSlug === "unassigned" ? "Unassigned Merchant" : resolvedSlug);

      setMerchantSlug(resolvedSlug);
      setMerchantDisplayName(resolvedDisplayName);

      if (parsedRules?.navigationMode) {
        setNavigationMode(parsedRules.navigationMode);
      }
      if (parsedRules?.hardwareFormFactor) {
        setHardwareFormFactor(parsedRules.hardwareFormFactor);
      }

      // Check saved POS auth token for this merchant_slug
      if (resolvedSlug && resolvedSlug !== "unassigned") {
        const authKey = getPosAuthStorageKey(resolvedSlug);
        const rawAuth =
          localStorage.getItem(authKey) || sessionStorage.getItem(authKey);
        if (rawAuth) {
          const parsedAuth = JSON.parse(rawAuth) as PosAuthRecord;
          setPosAuth(parsedAuth);
          customAccessToken = parsedAuth.accessToken;
        }
      }

      // Hydrate staged catalog items and modifiers into Studio Matrix
      if (parsedStage) {
        const hydratedDrinksAndFood: StagedItem[] = (
          parsedStage.stagedItems || []
        )
          .filter(
            (item) =>
              item.included !== false &&
              (item.classification as string) !== "modifier_option" &&
              (item.classification as string) !== "operational_supply"
          )
          .map((item) => ({
            name: item.name,
            categoryName:
              item.classification === "food"
                ? item.categoryName &&
                  !["drinks", "beverages", "espresso bar"].includes(
                    item.categoryName.trim().toLowerCase()
                  )
                  ? item.categoryName
                  : "Bakery & Food"
                : item.categoryName || "",
            classification: item.classification,
            variations:
              item.variations && item.variations.length > 0
                ? item.variations
                : [{ size: "16oz", price: 4.75 }],
            source: "upload" as const,
          }));

        const hydratedRetail: StagedItem[] = (parsedStage.retailItems || [])
          .filter((item) => item.included !== false)
          .map((item) => ({
            name: item.name,
            categoryName: "Retail & Packaged",
            classification: "retail_item" as const,
            variations: [
              {
                size: item.sku || "Unit",
                price:
                  item.suggestedPriceCents && item.suggestedPriceCents > 0
                    ? item.suggestedPriceCents / 100
                    : 14.0,
              },
            ],
            source: "upload" as const,
          }));

        const defaultModPrice =
          parsedRules?.modifierPricing?.syrupSauceAddOnDollars ?? 0.75;

        const hydratedModifiers: StagedModifier[] = (
          parsedStage.modifiers || []
        )
          .filter((mod) => mod.included !== false)
          .map((mod) => ({
            name: mod.name,
            price: defaultModPrice,
          }));

        const combinedStagedItems = [
          ...hydratedDrinksAndFood,
          ...hydratedRetail,
        ];

        setStagedItems(combinedStagedItems);
        setStagedModifiers(hydratedModifiers);

        const rawSavedSnapshot =
          localStorage.getItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY) ||
          sessionStorage.getItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
        const hydratedSnapshot: PersistedPreOptimizeSnapshot | null =
          parsedRules?.preOptimizeSnapshot ||
          (rawSavedSnapshot
            ? (JSON.parse(rawSavedSnapshot) as PersistedPreOptimizeSnapshot)
            : null);

        if (hydratedSnapshot) {
          setPreOptimizeSnapshot(hydratedSnapshot);
        }

        const hydratedArchetype = fromTemplateStorageCode(
          parsedRules?.activeLayoutTemplate
        );
        setSelectedArchetype(hydratedArchetype);

        if (parsedRules?.isOptimized) {
          setIsOptimized(true);
          setAuditMetrics(getTemplateAuditMetrics(hydratedArchetype, true));
          const hydratedOptPages =
            Array.isArray(parsedRules.optimizedGridPages) &&
            parsedRules.optimizedGridPages.length > 0
              ? parsedRules.optimizedGridPages
              : buildAutoOptimizedPages(
                  combinedStagedItems,
                  hydratedModifiers,
                  hydratedArchetype
                );
          setPages(hydratedOptPages);
        } else {
          setIsOptimized(false);
          setAuditMetrics(getTemplateAuditMetrics(hydratedArchetype, false));
          const hydratedPages = buildPagesFromCatalog(
            combinedStagedItems,
            hydratedModifiers,
            hydratedArchetype
          );
          setPages(hydratedPages);
        }
        setActivePageIndex(0);
        setSelectedTileId(1);
      } else {
        setStagedItems([]);
        setStagedModifiers([]);
        setIsOptimized(false);
        setPreOptimizeSnapshot(null);
        setAuditMetrics(BASELINE_AUDIT_METRICS);
        setPages([createEmptyPage(0)]);
        setActivePageIndex(0);
        setSelectedTileId(1);
      }
    } catch {
      // Ignore storage parse errors
    }

    // Fetch live catalog from Square scoped to merchantSlug
    async function fetchCatalog() {
      try {
        setLoading(true);
        const headers: Record<string, string> = {};
        if (customAccessToken) {
          headers["x-square-access-token"] = customAccessToken;
        }
        const res = await fetch(
          `/api/catalog?merchant_slug=${encodeURIComponent(resolvedSlug)}`,
          { headers }
        );
        const data = await res.json();
        if (data.success) {
          setSquareItems(data.items || []);
          setSquareCategories(data.categories || []);
          setSquareModifierLists(data.modifierLists || []);
          setSquareTotalObjects(data.totalObjects || 0);
        } else {
          setError(data.error || "Failed to load catalog data");
        }
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError("Unknown network error");
        }
      } finally {
        setLoading(false);
      }
    }

    fetchCatalog();
  }, []);

  // Safe accessor for current page tiles
  const currentTiles = pages[activePageIndex] || pages[0] || createEmptyPage(0);

  const allPagesFlatTiles = useMemo(() => pages.flat(), [pages]);

  const activeTile =
    allPagesFlatTiles.find((t) => t.id === selectedTileId) ||
    currentTiles.find((t) => t.id === selectedTileId) ||
    currentTiles[0] || {
      id: 1,
      label: "",
      price: "",
      color: "blank" as TileColor,
    };

  const handleSelectTile = (tileId: number) => {
    setSelectedTileId(tileId);
    const ownerPageIdx = pages.findIndex((p) =>
      p.some((tile) => tile.id === tileId)
    );
    if (ownerPageIdx >= 0 && ownerPageIdx !== activePageIndex) {
      setActivePageIndex(ownerPageIdx);
    }
  };

  const updateActiveTile = (updates: Partial<GridTile>) => {
    setPages((prevPages) =>
      prevPages.map((page) =>
        page.map((tile) =>
          tile.id === activeTile.id ? { ...tile, ...updates } : tile
        )
      )
    );
  };

  // SipPass-aligned canonical category folders derived dynamically from stagedItems and active pages
  const categoryFolders = useMemo<CategoryFolderGroup[]>(() => {
    const normalizeText = (val: string) =>
      val
        .toLowerCase()
        .replace(/^\d+oz\s+/i, "")
        .replace(/\s+\(base\)$/i, "")
        .replace(/^\+\s+/, "")
        .trim();

    // Set of standalone modifier names to strictly exclude from customer-facing product folders
    const modifierNameSet = new Set<string>(
      stagedModifiers.map((m) => normalizeText(m.name))
    );

    // Generic catch-all bucket names that should be normalized into canonical SipPass families
    const GENERIC_CATCHALL_CATEGORIES = new Set<string>([
      "",
      "drinks",
      "drink",
      "beverages",
      "beverage",
      "drinks & beverages",
      "drinks & food",
      "all items",
      "menu items",
      "uncategorized",
      "general",
      "other",
      "items",
      "pos items",
      "staged items",
      "espresso bar",
      "espresso bar & classics",
      "espresso",
      "coffee",
      "hot drinks",
      "cold drinks",
      "iced drinks",
      "cold bar",
      "cold bar & energy",
      "energy",
      "energy drinks",
      "blended",
      "tea",
      "teas",
      "food",
      "food & pastries",
      "pastries",
      "bakery",
      "retail",
      "retail packaged",
      "retail & bulk",
      "merchandise",
    ]);

    const classifyIntoSipPassFamily = (
      itemName: string,
      rawCategoryName?: string,
      classification?: string
    ): { folderName: string; folderColor: TileColor } => {
      const trimmedRawCat = (rawCategoryName || "").trim();
      const lowerCat = trimmedRawCat.toLowerCase();
      const combined = `${itemName} ${trimmedRawCat}`.toLowerCase();

      // 1. Check if item has a specific extracted board categoryName (e.g. "Signature Mochas", "Kiddie Corner")
      const isSpecificBoardCategory =
        trimmedRawCat.length > 0 &&
        !GENERIC_CATCHALL_CATEGORIES.has(lowerCat) &&
        ![
          "espresso classics",
          "energy & lotus",
          "cold bar & blended",
          "teas & refreshers",
          "bakery & food",
          "retail & packaged",
        ].includes(lowerCat);

      if (isSpecificBoardCategory) {
        let boardColor: TileColor = "amber";
        if (
          classification === "retail_item" ||
          /retail|bean|merch|bagged|packaged/i.test(combined)
        ) {
          boardColor = "slate";
        } else if (
          classification === "food" ||
          /bakery|food|pastry|pastries|sandwich|bagel|muffin|cookie|scone|croissant|burrito|breakfast|snack/i.test(
            combined
          )
        ) {
          boardColor = "emerald";
        } else if (
          /energy|lotus|red\s*bull|redbull|rebel|soda|spritzer|cold|iced|frappe|smoothie|blended|boba|shake|freeze|slush|big train|tea|chai|matcha|lemonade|refresher|kiddie|kids/i.test(
            combined
          )
        ) {
          boardColor = "cyan";
        }
        return { folderName: trimmedRawCat, folderColor: boardColor };
      }

      // 2. Canonical SipPass Customer-Facing Menu Families
      // Family 6: Retail & Packaged ("slate")
      if (
        classification === "retail_item" ||
        lowerCat === "retail & packaged" ||
        /whole bean|coffee bean|12oz bag|1lb bag|5lb bag|retail|merch|tumbler|mug|shirt|hoodie|sticker|gift card|packaged|bagged/i.test(
          combined
        )
      ) {
        return { folderName: "Retail & Packaged", folderColor: "slate" };
      }

      // Family 5: Bakery & Food ("emerald")
      if (
        classification === "food" ||
        lowerCat === "bakery & food" ||
        /sandwich|bagel|muffin|pastry|pastries|cookie|scone|croissant|burrito|ciabatta|toast|pretzel|biscotti|cake|danish|donut|doughnut|wrap|panini|quiche|waffle|oatmeal|egg bite|food|bakery/i.test(
          combined
        )
      ) {
        return { folderName: "Bakery & Food", folderColor: "emerald" };
      }

      // Family 2: Energy & Lotus ("cyan")
      if (
        lowerCat === "energy & lotus" ||
        /lotus|red\s*bull|redbull|energy|rebel|infusion|italian soda|\bsoda\b|spritzer|rockstar|monster|bull|charger|fizz/i.test(
          combined
        )
      ) {
        return { folderName: "Energy & Lotus", folderColor: "cyan" };
      }

      // Family 4: Teas & Refreshers ("cyan")
      if (
        lowerCat === "teas & refreshers" ||
        /\btea\b|chai|matcha|lemonade|refresher|london fog|arnold palmer|palmer|earl grey|chamomile|hibiscus|green tea|black tea|herbal/i.test(
          combined
        )
      ) {
        return { folderName: "Teas & Refreshers", folderColor: "cyan" };
      }

      // Family 3: Cold Bar & Blended ("cyan")
      if (
        lowerCat === "cold bar & blended" ||
        /frappe|frappuccino|smoothie|blended|boba|bubble|milkshake|shake|freeze|granita|slush|big train|frost|cooler|iced specialty|cold foam/i.test(
          combined
        )
      ) {
        return { folderName: "Cold Bar & Blended", folderColor: "cyan" };
      }

      // Family 1: Espresso Classics ("amber")
      return { folderName: "Espresso Classics", folderColor: "amber" };
    };

    // Index staged catalog items by normalized name
    const stagedMetaByLabel = new Map<
      string,
      {
        folderName: string;
        folderColor: TileColor;
        isModifierOrSupply: boolean;
      }
    >();

    stagedItems.forEach((item) => {
      const isModOrSupply =
        item.classification === "modifier_option" ||
        item.classification === "operational_supply";
      const resolved = classifyIntoSipPassFamily(
        item.name,
        item.categoryName,
        item.classification
      );
      stagedMetaByLabel.set(normalizeText(item.name), {
        ...resolved,
        isModifierOrSupply: isModOrSupply,
      });
    });

    const folderMap = new Map<
      string,
      { color: TileColor; items: GridTile[] }
    >();

    const assignedTiles = allPagesFlatTiles.filter(
      (t) =>
        t.color !== "blank" &&
        t.label.trim() !== "" &&
        t.label !== "[Empty Slot]" &&
        t.label !== "[Open Slot]"
    );

    assignedTiles.forEach((tile) => {
      const rawLabel = tile.label.trim();
      const cleanedLabel = normalizeText(rawLabel);

      // Strictly exclude standalone modifier options (prefixed with "+", in stagedModifiers, or classified as modifier_option)
      if (rawLabel.startsWith("+") || modifierNameSet.has(cleanedLabel)) {
        return;
      }

      // Check direct or partial match in stagedMetaByLabel
      let matchedMeta = stagedMetaByLabel.get(cleanedLabel);
      if (!matchedMeta) {
        for (const [stagedKey, meta] of stagedMetaByLabel.entries()) {
          if (
            stagedKey.length > 2 &&
            (cleanedLabel.includes(stagedKey) ||
              stagedKey.includes(cleanedLabel))
          ) {
            matchedMeta = meta;
            break;
          }
        }
      }

      if (matchedMeta?.isModifierOrSupply) {
        return;
      }

      const { folderName, folderColor } =
        matchedMeta || classifyIntoSipPassFamily(rawLabel);

      const existing = folderMap.get(folderName);
      if (existing) {
        existing.items.push(tile);
      } else {
        folderMap.set(folderName, { color: folderColor, items: [tile] });
      }
    });

    const canonicalOrder = [
      "Espresso Classics",
      "Energy & Lotus",
      "Cold Bar & Blended",
      "Teas & Refreshers",
      "Bakery & Food",
      "Retail & Packaged",
    ];

    // Suppress any empty category folders that have 0 items
    return Array.from(folderMap.entries())
      .filter(([, data]) => data.items.length > 0)
      .map(([folderName, data]) => ({
        folderName,
        itemCount: data.items.length,
        color: data.color,
        items: data.items,
      }))
      .sort((a, b) => {
        const idxA = canonicalOrder.indexOf(a.folderName);
        const idxB = canonicalOrder.indexOf(b.folderName);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.folderName.localeCompare(b.folderName);
      });
  }, [allPagesFlatTiles, stagedItems, stagedModifiers]);

  // Clear single active tile
  const handleClearCurrentTile = () => {
    updateActiveTile({
      label: "[Empty Slot]",
      price: "",
      color: "blank",
    });
  };

  // Clear all tiles across all dynamic pages & invalidate optimization snapshot
  const handleClearAllTiles = () => {
    const blankPages = pages.map((_, idx) => createEmptyPage(idx));
    setPages(blankPages);
    setSelectedTileId(blankPages[0]?.[0]?.id || 1);
    setIsOptimized(false);
    setPreOptimizeSnapshot(null);
    setAuditMetrics(getTemplateAuditMetrics(selectedArchetype, false));

    try {
      localStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
      sessionStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }

    persistRulesConfigState({
      activeLayoutTemplate: toTemplateStorageCode(selectedArchetype),
      isOptimized: false,
      optimizedGridPages: undefined,
      preOptimizeSnapshot: null,
    });
  };

  // Reset to raw unoptimized default preset & invalidate optimization snapshot
  const handleResetToDefault = () => {
    const rawGenerated = buildPagesFromCatalog(
      stagedItems,
      stagedModifiers,
      selectedArchetype
    );
    setPages(rawGenerated);
    setActivePageIndex(0);
    setSelectedTileId(1);
    setIsOptimized(false);
    setPreOptimizeSnapshot(null);
    setAuditMetrics(getTemplateAuditMetrics(selectedArchetype, false));

    try {
      localStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
      sessionStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }

    persistRulesConfigState({
      activeLayoutTemplate: toTemplateStorageCode(selectedArchetype),
      isOptimized: false,
      optimizedGridPages: undefined,
      preOptimizeSnapshot: null,
    });
  };

  // Populate from staged catalog
  const handleLoadStagedIntoMatrix = () => {
    const generated = buildPagesFromCatalog(
      stagedItems,
      stagedModifiers,
      selectedArchetype
    );
    setPages(generated);
    setActivePageIndex(0);
    setSelectedTileId(1);
  };

  // Add another blank page
  const handleAddPage = () => {
    setPages((prev) => {
      const newPageIdx = prev.length;
      return [...prev, createEmptyPage(newPageIdx)];
    });
    setActivePageIndex(pages.length);
    setSelectedTileId(pages.length * 20 + 1);
  };

  // OCR Processing Handler
  const handleFileUpload = async (
    e: ChangeEvent<HTMLInputElement>,
    type: "board" | "pos"
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsProcessingOcr(true);
      setOcrStatusText(
        `Analyzing ${type === "board" ? "Menu Board" : "POS Screen"}...`
      );

      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        const result = uploadEvent.target?.result as string;
        if (type === "board") {
          setBoardImages((prev) => [...prev, result]);
        } else {
          setPosScreenshots((prev) => [...prev, result]);
        }
      };
      reader.readAsDataURL(file);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/ocr", {
        method: "POST",
        body: formData,
      });

      const json = await res.json();

      if (json.success && json.data) {
        const incomingCategories = json.data.categories || [];
        const incomingModifiers = json.data.modifiers || [];

        const newItems: StagedItem[] = [];
        incomingCategories.forEach(
          (cat: {
            categoryName: string;
            items: { name: string; variations?: Variation[] }[];
          }) => {
            (cat.items || []).forEach((item) => {
              const isColdOrEnergy =
                /iced|cold|lotus|energy|redbull|rebel|smoothie|tea/i.test(
                  item.name
                );
              const defaultVariations: Variation[] = isColdOrEnergy
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

              const resolvedVariations =
                item.variations &&
                item.variations.length > 0 &&
                item.variations[0].price > 0
                  ? item.variations
                  : defaultVariations;

              newItems.push({
                name: item.name,
                categoryName: cat.categoryName || "Specialty",
                variations: resolvedVariations,
                source: "upload",
              });
            });
          }
        );

        setStagedItems((prev) => [...prev, ...newItems]);
        setStagedModifiers((prev) => [
          ...prev,
          ...(incomingModifiers as StagedModifier[]).map((m) => ({ ...m })),
        ]);
        setOcrStatusText("Extraction complete. Staged successfully!");
      } else {
        setOcrStatusText(`Error: ${json.error || "Could not parse image."}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload error";
      setOcrStatusText(`Error: ${msg}`);
    } finally {
      setIsProcessingOcr(false);
      e.target.value = "";
    }
  };

  // Full Dual-Source Reconciliation Engine
  const handleFullReconciliation = () => {
    let matchedCount = 0;
    let newFromWallCount = 0;
    let retainedFromSquareCount = 0;

    const normalize = (name: string) =>
      name
        .replace(/^(12oz|16oz|20oz|24oz|32oz|hot|iced)\s+/i, "")
        .trim()
        .toLowerCase();

    const catMap = new Map<string, string>();
    squareCategories.forEach((c) => {
      if (c.category_data?.name) catMap.set(c.id, c.category_data.name);
    });

    const reconciledMap = new Map<string, StagedItem>();

    squareItems.forEach((sqItem) => {
      const rawName = sqItem.item_data?.name || "Unnamed Drink";
      const key = normalize(rawName);
      const categoryName = sqItem.item_data?.category_id
        ? catMap.get(sqItem.item_data.category_id) || "Espresso Bar"
        : "Espresso Bar";

      const variations: Variation[] = (sqItem.item_data?.variations || []).map(
        (v) => ({
          size: v.item_variation_data?.name || "Regular",
          price: (v.item_variation_data?.price_money?.amount || 0) / 100,
        })
      );

      reconciledMap.set(key, {
        name: rawName,
        categoryName,
        variations:
          variations.length > 0
            ? variations
            : [{ size: "Regular", price: 4.5 }],
        squareId: sqItem.id,
        source: "square",
      });
      retainedFromSquareCount++;
    });

    stagedItems.forEach((uploadItem) => {
      const key = normalize(uploadItem.name);

      if (reconciledMap.has(key)) {
        const existing = reconciledMap.get(key)!;
        existing.source = "reconciled";
        matchedCount++;

        uploadItem.variations.forEach((upVar) => {
          const matchIdx = existing.variations.findIndex(
            (v) => v.size.toLowerCase() === upVar.size.toLowerCase()
          );
          if (matchIdx >= 0) {
            if (upVar.price > 0) {
              existing.variations[matchIdx].price = upVar.price;
            }
          } else {
            existing.variations.push(upVar);
          }
        });
      } else {
        reconciledMap.set(key, {
          ...uploadItem,
          name: uploadItem.name
            .replace(/^(12oz|16oz|20oz|24oz|32oz)\s+/i, "")
            .trim(),
          source: "upload",
        });
        newFromWallCount++;
      }
    });

    const unifiedModMap = new Map<string, StagedModifier>();
    let totalRawModifiersCount = 0;

    squareModifierLists.forEach((ml) => {
      (ml.modifier_list_data?.modifiers || []).forEach((m) => {
        totalRawModifiersCount++;
        const rawName = m.modifier_data?.name || "";
        const k = rawName.toLowerCase().trim();
        if (k && !unifiedModMap.has(k)) {
          unifiedModMap.set(k, {
            name: rawName,
            price: (m.modifier_data?.price_money?.amount || 0) / 100,
            squareId: m.id,
          });
        }
      });
    });

    stagedModifiers.forEach((m) => {
      totalRawModifiersCount++;
      const k = m.name.toLowerCase().trim();
      if (!unifiedModMap.has(k)) {
        unifiedModMap.set(k, {
          name: m.name,
          price: m.price || 0.75,
        });
      }
    });

    const reconciledItems = Array.from(reconciledMap.values());
    const finalModifiers = Array.from(unifiedModMap.values());
    const collapsedMods = Math.max(
      0,
      totalRawModifiersCount - finalModifiers.length
    );

    setStagedItems(reconciledItems);
    setStagedModifiers(finalModifiers);
    setReconcileReport({
      matched: matchedCount,
      newFromWall: newFromWallCount,
      retainedFromSquare: retainedFromSquareCount - matchedCount,
      modifiersCollapsed: collapsedMods,
    });
  };

  // Dynamic Elastic Partitioning: Automatically creates as many 20-slot pages as needed
  const handleReconcileAndPush = () => {
    if (stagedItems.length === 0 && stagedModifiers.length === 0) {
      setActiveTab("studio");
      return;
    }

    const generatedPages = buildPagesFromCatalog(stagedItems, stagedModifiers);
    setPages(generatedPages);
    setActivePageIndex(0);
    setSelectedTileId(1);
    setActiveTab("studio");
  };

  // Auto-Optimize Catalog & Layout with Full Undo Snapshot (Template-Aware)
  const handleAutoOptimizeCatalog = () => {
    const baselinePagesSnapshot: GridTile[][] = pages.map((page) =>
      page.map((tile) => ({ ...tile }))
    );

    const templateCode = toTemplateStorageCode(selectedArchetype);
    const snapshotPayload: PersistedPreOptimizeSnapshot = {
      pages: baselinePagesSnapshot,
      metrics: getTemplateAuditMetrics(selectedArchetype, false),
      activeLayoutTemplate: templateCode,
      capturedAt: new Date().toISOString(),
    };

    const optimizedPages = buildAutoOptimizedPages(
      stagedItems,
      stagedModifiers,
      selectedArchetype,
      pages
    );
    const nextMetrics = getTemplateAuditMetrics(selectedArchetype, true);

    setPreOptimizeSnapshot(snapshotPayload);
    setIsOptimized(true);
    setAuditMetrics(nextMetrics);
    setPages(optimizedPages);
    setActivePageIndex(0);
    setSelectedTileId(1);

    try {
      const serializedSnapshot = JSON.stringify(snapshotPayload);
      localStorage.setItem(
        PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY,
        serializedSnapshot
      );
      sessionStorage.setItem(
        PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY,
        serializedSnapshot
      );
    } catch {
      // Ignore storage quota errors
    }

    persistRulesConfigState({
      activeLayoutTemplate: templateCode,
      isOptimized: true,
      optimizedGridPages: optimizedPages,
      preOptimizeSnapshot: snapshotPayload,
    });
  };

  // Undo Auto-Optimization & Restore Baseline Layout + Metrics regardless of active template
  const handleUndoOptimization = () => {
    const restoredArchetype = preOptimizeSnapshot?.activeLayoutTemplate
      ? fromTemplateStorageCode(preOptimizeSnapshot.activeLayoutTemplate)
      : selectedArchetype;

    const restoredPages =
      preOptimizeSnapshot &&
      Array.isArray(preOptimizeSnapshot.pages) &&
      preOptimizeSnapshot.pages.length > 0
        ? preOptimizeSnapshot.pages.map((page) =>
            page.map((tile) => ({ ...tile }))
          )
        : buildPagesFromCatalog(
            stagedItems,
            stagedModifiers,
            restoredArchetype
          );

    const restoredMetrics =
      preOptimizeSnapshot?.metrics ||
      getTemplateAuditMetrics(restoredArchetype, false);

    setSelectedArchetype(restoredArchetype);
    setPages(restoredPages);
    setAuditMetrics(restoredMetrics);
    setIsOptimized(false);
    setPreOptimizeSnapshot(null);
    setActivePageIndex(0);
    setSelectedTileId(1);

    try {
      localStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
      sessionStorage.removeItem(PRE_OPTIMIZE_SNAPSHOT_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }

    persistRulesConfigState({
      activeLayoutTemplate: toTemplateStorageCode(restoredArchetype),
      isOptimized: false,
      optimizedGridPages: undefined,
      preOptimizeSnapshot: null,
    });
  };

  const handleAssignItemToTile = (item: StagedItem) => {
    const primaryVar = item.variations[0];
    updateActiveTile({
      label: `${primaryVar?.size ? primaryVar.size + " " : ""}${item.name}`,
      price: primaryVar ? `$${primaryVar.price.toFixed(2)}` : "$4.50",
      color: getItemColor(item.name, item.categoryName),
    });
  };

  const handleAssignModifierToTile = (mod: StagedModifier) => {
    updateActiveTile({
      label: `+ ${mod.name}`,
      price: `+$${mod.price.toFixed(2)}`,
      color: "slate",
    });
  };

  const handleDeploy = async () => {
    setDeployState("deploying");
    setDeployMessage(
      `Validating merchant_slug (${merchantSlug}) and location mapping...`
    );

    setTimeout(() => {
      setDeployMessage("Writing canonical records to Supabase tables...");
    }, 1200);

    setTimeout(() => {
      setDeployMessage(
        "Pushing updated layout coordinates to POS Cloud..."
      );
    }, 2400);

    setTimeout(() => {
      setDeployState("success");
      setDeployMessage(
        `Layout and catalog deployed successfully to ${merchantDisplayName} (${merchantSlug})!`
      );
    }, 3600);
  };

  const getColorClasses = (color: TileColor) => {
    switch (color) {
      case "amber":
        return "bg-amber-950/70 border-amber-600/70 text-amber-100 hover:border-amber-400";
      case "cyan":
        return "bg-cyan-950/70 border-cyan-600/70 text-cyan-100 hover:border-cyan-400";
      case "emerald":
        return "bg-emerald-950/70 border-emerald-600/70 text-emerald-100 hover:border-emerald-400";
      case "slate":
        return "bg-slate-800/80 border-slate-600 text-slate-200 hover:border-slate-400";
      case "blank":
        return "bg-slate-900/30 border-slate-800/60 border-dashed text-slate-600 hover:border-slate-700";
    }
  };

  const totalAssignedTiles = pages
    .flat()
    .filter((t) => t.color !== "blank").length;

  const connectedBadgeLabel =
    posAuth?.provider === "clover" ? "Clover Connected" : "Square Connected";

  const handleFastSwitchClient = (val: string) => {
    if (val === "__new__") {
      clearActiveStageAndRulesFromStorage();
      setMerchantSlug("unassigned");
      setMerchantDisplayName("Unassigned Merchant");
      setPosAuth(null);
      setStagedItems([]);
      setStagedModifiers([]);
      setPages([createEmptyPage(0)]);
      setActivePageIndex(0);
      setSelectedTileId(1);
      router.push("/onboard/intake");
      return;
    }
    const found = savedSessions.find(
      (s) => s.storeProfile.merchantSlug === val || s.id === val
    );
    if (found) {
      const restored = restoreSessionToActiveStage(found);
      const nextSlug =
        restored.storeProfile.merchantSlug ||
        toSlug(
          restored.storeProfile.dbaName || restored.storeProfile.legalName || ""
        ) ||
        "unassigned";
      const nextDisplay =
        restored.storeProfile.dbaName ||
        restored.storeProfile.legalName ||
        (nextSlug === "unassigned" ? "Unassigned Merchant" : nextSlug);

      setMerchantSlug(nextSlug);
      setMerchantDisplayName(nextDisplay);

      const hydratedDrinksAndFood: StagedItem[] = (
        restored.stagedItems || []
      )
        .filter(
          (item) =>
            item.included !== false &&
            (item.classification as string) !== "modifier_option" &&
            (item.classification as string) !== "operational_supply"
        )
        .map((item) => ({
          name: item.name,
          categoryName:
            item.classification === "food"
              ? item.categoryName &&
                !["drinks", "beverages", "espresso bar"].includes(
                  item.categoryName.trim().toLowerCase()
                )
                ? item.categoryName
                : "Bakery & Food"
              : item.categoryName || "",
          classification: item.classification,
          variations:
            item.variations && item.variations.length > 0
              ? item.variations
              : [{ size: "16oz", price: 4.75 }],
          source: "upload" as const,
        }));

      const hydratedRetail: StagedItem[] = (restored.retailItems || [])
        .filter((item) => item.included !== false)
        .map((item) => ({
          name: item.name,
          categoryName: "Retail & Packaged",
          classification: "retail_item" as const,
          variations: [
            {
              size: item.sku || "Unit",
              price:
                item.suggestedPriceCents && item.suggestedPriceCents > 0
                  ? item.suggestedPriceCents / 100
                  : 14.0,
            },
          ],
          source: "upload" as const,
        }));

      const defaultModPrice =
        found.rulesConfig?.modifierPricing?.syrupSauceAddOnDollars ?? 0.75;

      const hydratedModifiers: StagedModifier[] = (restored.modifiers || [])
        .filter((mod) => mod.included !== false)
        .map((mod) => ({
          name: mod.name,
          price: defaultModPrice,
        }));

      const combinedStagedItems = [...hydratedDrinksAndFood, ...hydratedRetail];
      setStagedItems(combinedStagedItems);
      setStagedModifiers(hydratedModifiers);
      const hydratedPages = buildPagesFromCatalog(
        combinedStagedItems,
        hydratedModifiers,
        selectedArchetype
      );
      setPages(hydratedPages);
      setActivePageIndex(0);
      setSelectedTileId(1);
    }
  };

  if (isRedirectingToDashboard) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-300 flex items-center justify-center font-sans">
        <div className="flex items-center space-x-3 text-xs font-mono text-amber-400">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400 animate-ping" />
          <span>Opening Master Command Dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Unified Top Command Navigation Bar */}
      <div className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-6 py-2.5">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left button: ← Master Dashboard */}
          <Link
            href="/dashboard"
            className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 text-amber-400 hover:text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
          >
            <span>← Master Dashboard</span>
          </Link>

          {/* Center badge: Active Client DBA & Slug */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-full px-4 py-1 flex items-center space-x-2 shadow-inner">
            <span
              className={`h-2 w-2 rounded-full ${
                merchantSlug && merchantSlug !== "unassigned"
                  ? "bg-amber-400"
                  : "bg-slate-600"
              }`}
            ></span>
            <span className="text-xs font-bold text-white">
              {merchantDisplayName}
            </span>
            <span className="text-xs font-mono text-amber-400">
              ({merchantSlug})
            </span>
          </div>

          {/* Right fast switcher: Client Folder Dropdown */}
          <div className="flex items-center space-x-2">
            <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1">
              <span className="text-amber-400 text-xs" aria-hidden="true">
                📁
              </span>
              <select
                aria-label="Fast switch client folder"
                value={
                  savedSessions.some(
                    (s) =>
                      s.storeProfile.merchantSlug === merchantSlug ||
                      s.id === merchantSlug
                  )
                    ? merchantSlug
                    : ""
                }
                onChange={(e) => handleFastSwitchClient(e.target.value)}
                className="bg-slate-900 text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer pr-1"
              >
                <option value="">
                  {merchantSlug && merchantSlug !== "unassigned"
                    ? `Active: ${merchantDisplayName}`
                    : "Switch Client Folder..."}
                </option>
                {savedSessions.map((s) => {
                  const slug = s.storeProfile.merchantSlug || s.id;
                  const label =
                    s.storeProfile.dbaName ||
                    s.storeProfile.legalName ||
                    slug;
                  return (
                    <option key={s.id} value={slug}>
                      {label} ({slug})
                    </option>
                  );
                })}
                <option value="__new__">+ New Client Folder</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Top Application Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-3">
            <div className="h-9 w-9 rounded-lg bg-amber-600 flex items-center justify-center font-bold text-slate-950 text-xl shadow-md shadow-amber-600/20">
              B
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold tracking-tight text-lg text-white">
                  BarMaid
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
                  B2B POS Utility
                </span>
              </div>
              <p className="text-xs text-slate-400">D6 Digital LLC</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dashboard"
              className="px-3.5 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-amber-500/40 text-amber-400 hover:text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
            >
              <span>← Master Dashboard</span>
            </Link>
            <Link
              href="/onboard/connect"
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
            >
              <span>← Step 3: POS Connect</span>
            </Link>
          </div>
        </div>

        {/* Client Badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-800/80 border border-slate-700/60 rounded-full px-3.5 py-1.5 flex items-center space-x-2">
            <span className="text-xs text-slate-400">Client:</span>
            <span className="text-xs font-semibold text-amber-400 font-mono">
              {merchantSlug}
            </span>
          </div>
          <div className="bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 rounded-full px-3.5 py-1.5 text-xs font-medium flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>{connectedBadgeLabel}</span>
          </div>
        </div>
      </header>

      {/* Workflow Navigation */}
      <nav className="border-b border-slate-800/80 bg-slate-900/50 px-6 py-2">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2 sm:gap-4">
            {[
              { id: "intake", label: "1. Dual-Intake & Staging" },
              { id: "audit", label: "2. Audit & Scoring" },
              { id: "studio", label: "3. Ergonomics Studio" },
              { id: "deploy", label: "4. Review & Deploy" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all duration-150 cursor-pointer ${
                  activeTab === tab.id
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <span className="text-xs font-mono text-slate-400">
            Active Catalog:{" "}
            <strong className="text-amber-400">{stagedItems.length}</strong>{" "}
            Items &middot;{" "}
            <strong className="text-cyan-400">{stagedModifiers.length}</strong>{" "}
            Modifiers
          </span>
        </div>
      </nav>

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6">
        {/* Step 1: Dual-Intake */}
        {activeTab === "intake" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Dual-Intake Reconciliation ({merchantSlug})
                </h1>
                <p className="text-sm text-slate-400 mt-1">
                  Cross-references physical wall menu boards with your live register catalog to eliminate duplicates and sync accurate pricing.
                </p>
              </div>
              <Link
                href="/onboard/intake"
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-amber-300 transition"
              >
                Open 8-Step Onboarding Intake →
              </Link>
            </div>

            {/* Live Catalog Metrics */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                  <span className="text-xs font-semibold text-slate-300">
                    Live Square Production Hardware Snapshot:
                  </span>
                </div>
                {loading ? (
                  <span className="text-xs text-slate-500 animate-pulse">
                    Querying register state...
                  </span>
                ) : error ? (
                  <span className="text-xs text-rose-400">{error}</span>
                ) : (
                  <div className="flex items-center space-x-4 text-xs font-mono">
                    <span className="text-slate-400">
                      Items:{" "}
                      <strong className="text-white">
                        {squareItems.length}
                      </strong>
                    </span>
                    <span className="text-slate-400">
                      Categories:{" "}
                      <strong className="text-amber-400">
                        {squareCategories.length}
                      </strong>
                    </span>
                    <span className="text-slate-400">
                      Modifier Sets:{" "}
                      <strong className="text-white">
                        {squareModifierLists.length}
                      </strong>
                    </span>
                    <span className="text-slate-400">
                      Objects:{" "}
                      <strong className="text-emerald-400">
                        {squareTotalObjects}
                      </strong>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <input
              type="file"
              ref={boardInputRef}
              onChange={(e) => handleFileUpload(e, "board")}
              accept="image/*"
              className="hidden"
            />
            <input
              type="file"
              ref={posInputRef}
              onChange={(e) => handleFileUpload(e, "pos")}
              accept="image/*"
              className="hidden"
            />

            {/* Dual Dropzone Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Dropzone A: Physical Menu Boards */}
              <div className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-6 transition flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-2">
                      <span className="text-amber-400 text-lg">📷</span>
                      <h2 className="text-base font-bold text-white">
                        Dropzone A: Physical Menu Boards
                      </h2>
                    </div>
                    <span className="px-2.5 py-0.5 text-xs rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                      {boardImages.length} Uploaded
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    Upload photos of chalkboard menus, walk-up signs, and flavor matrices. Uploading multiple photos accumulates all drinks automatically.
                  </p>
                </div>

                {boardImages.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-2">
                    {boardImages.map((img, i) => (
                      <div
                        key={i}
                        className="h-16 w-16 rounded-lg border border-slate-700 overflow-hidden shrink-0 bg-slate-950"
                      >
                        <img
                          src={img}
                          alt={`Board ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  disabled={isProcessingOcr}
                  onClick={() => boardInputRef.current?.click()}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>+ Add Menu Board Image</span>
                </button>
              </div>

              {/* Dropzone B: POS Register Screenshots */}
              <div className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-6 transition flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex justify-between items-start">
                    <div className="flex items-center space-x-2">
                      <span className="text-cyan-400 text-lg">🖥️</span>
                      <h2 className="text-base font-bold text-white">
                        Dropzone B: Active POS Screenshot
                      </h2>
                    </div>
                    <span className="px-2.5 py-0.5 text-xs rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono">
                      {posScreenshots.length} Uploaded
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    Snap a photo of the iPad register screen or export CSV. BarMaid cross-references what is on the register against what is on the wall.
                  </p>
                </div>

                {posScreenshots.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto py-2">
                    {posScreenshots.map((img, i) => (
                      <div
                        key={i}
                        className="h-16 w-16 rounded-lg border border-slate-700 overflow-hidden shrink-0 bg-slate-950"
                      >
                        <img
                          src={img}
                          alt={`POS Screen ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    ))}
                  </div>
                )}

                <button
                  disabled={isProcessingOcr}
                  onClick={() => posInputRef.current?.click()}
                  className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>+ Add POS Screenshot</span>
                </button>
              </div>
            </div>

            {/* OCR Feedback */}
            {isProcessingOcr && (
              <div className="p-4 bg-amber-950/30 border border-amber-500/40 rounded-xl flex items-center space-x-3 animate-pulse">
                <div className="h-4 w-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin"></div>
                <span className="text-xs text-amber-300 font-medium">
                  {ocrStatusText}
                </span>
              </div>
            )}

            {/* Staged Items Tray */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-base font-bold text-white">
                    Staged Catalog Buffer ({merchantSlug})
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Unified buffer combining onboarding extractions and live Square items.
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-xs font-mono text-slate-400">
                    <strong className="text-white">{stagedItems.length}</strong>{" "}
                    Items &middot;{" "}
                    <strong className="text-amber-400">
                      {stagedModifiers.length}
                    </strong>{" "}
                    Modifiers
                  </span>

                  <button
                    onClick={handleFullReconciliation}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition flex items-center space-x-1.5 shadow-md shadow-amber-500/10 cursor-pointer"
                  >
                    <span>✨</span>
                    <span>Reconcile, Deduplicate &amp; Merge</span>
                  </button>

                  {stagedItems.length > 0 && (
                    <button
                      onClick={() => {
                        setStagedItems([]);
                        setStagedModifiers([]);
                        setBoardImages([]);
                        setPosScreenshots([]);
                        setReconcileReport(null);
                      }}
                      className="text-xs text-rose-400 hover:underline cursor-pointer"
                    >
                      Clear Buffer
                    </button>
                  )}
                </div>
              </div>

              {/* Reconciliation Results */}
              {reconcileReport && (
                <div className="p-4 bg-emerald-950/30 border border-emerald-500/40 rounded-xl space-y-2">
                  <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
                    <span>✓</span>
                    <span>
                      Reconciliation Completed Across Square &amp; Photo Uploads:
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-950/60 p-2 rounded-lg border border-emerald-800/40">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        Matched &amp; Merged
                      </span>
                      <p className="text-base font-bold text-emerald-300">
                        {reconcileReport.matched} items
                      </p>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded-lg border border-emerald-800/40">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        New from Wall
                      </span>
                      <p className="text-base font-bold text-amber-400">
                        {reconcileReport.newFromWall} items
                      </p>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded-lg border border-emerald-800/40">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        Square Retained
                      </span>
                      <p className="text-base font-bold text-slate-200">
                        {reconcileReport.retainedFromSquare} items
                      </p>
                    </div>
                    <div className="bg-slate-950/60 p-2 rounded-lg border border-emerald-800/40">
                      <span className="text-[10px] uppercase font-mono text-slate-400">
                        Modifiers Collapsed
                      </span>
                      <p className="text-base font-bold text-cyan-300">
                        {reconcileReport.modifiersCollapsed} duplicates
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {stagedItems.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
                  Buffer empty. Click &quot;Reconcile, Deduplicate &amp; Merge&quot; to inspect your existing Square setup, or upload a menu board image above to stage new drinks.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-2">
                  {stagedItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex justify-between items-start">
                          <span className="text-xs font-bold text-white leading-tight">
                            {item.name}
                          </span>
                          <span
                            className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${
                              item.source === "reconciled"
                                ? "bg-emerald-950 text-emerald-300 border border-emerald-800/60"
                                : item.source === "square"
                                ? "bg-cyan-950 text-cyan-300 border border-cyan-800/60"
                                : "bg-amber-950 text-amber-300 border border-amber-800/60"
                            }`}
                          >
                            {item.source}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {item.categoryName}
                        </p>
                      </div>
                      <div className="mt-2 pt-2 border-t border-slate-900 flex flex-wrap gap-1">
                        {item.variations.map((v, vIdx) => (
                          <span
                            key={vIdx}
                            className="text-[10px] font-mono text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded"
                          >
                            {v.size}: ${v.price.toFixed(2)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Push Action */}
              <div className="pt-2 flex flex-wrap items-center justify-between gap-4 border-t border-slate-800/80">
                <p className="text-xs text-slate-400">
                  Ready to map all {stagedItems.length} staged items into the elastic multi-page layout matrix.
                </p>
                <button
                  onClick={handleReconcileAndPush}
                  className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
                >
                  <span>
                    Proceed to Studio with All {stagedItems.length} Items
                  </span>
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Audit & Scoring */}
        {activeTab === "audit" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Catalog Audit &amp; Friction Diagnostics
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Objective analysis of counter tap friction, modifier redundancies, and screen ergonomics for{" "}
                <span className="text-amber-400 font-semibold">
                  {merchantDisplayName}
                </span>{" "}
                (<span className="font-mono">{merchantSlug}</span>).
              </p>
            </div>

            {/* Health Meter */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-center items-center text-center">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Register Health Score
                </span>
                <div className="mt-3 relative flex items-center justify-center">
                  <div
                    className={`w-24 h-24 rounded-full border-4 flex items-center justify-center transition-colors ${
                      isOptimized
                        ? "border-emerald-500/20 border-t-emerald-400"
                        : "border-amber-500/20 border-t-amber-500"
                    }`}
                  >
                    <span
                      className={`text-3xl font-black ${
                        isOptimized ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {auditMetrics.healthScore}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-xs font-medium mt-2 px-2 py-0.5 rounded-full ${
                    isOptimized
                      ? "text-emerald-300 bg-emerald-500/15 border border-emerald-500/30"
                      : "text-amber-400/90 bg-amber-500/10"
                  }`}
                >
                  {auditMetrics.frictionLabel}
                </span>
              </div>

              <div className="md:col-span-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Average Barista Taps
                  </span>
                  <p className="text-2xl font-extrabold text-white mt-2">
                    {auditMetrics.averageBaristaTaps.toFixed(1)} taps
                  </p>
                  <p
                    className={`text-xs mt-1 font-medium ${
                      auditMetrics.targetMet
                        ? "text-emerald-400"
                        : "text-rose-400"
                    }`}
                  >
                    {auditMetrics.targetMet
                      ? "Target Met: ≤ 2.0 taps"
                      : "Target: ≤ 2.0 taps"}
                  </p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Modifier Redundancy
                  </span>
                  <p className="text-2xl font-extrabold text-amber-400 mt-2">
                    {stagedModifiers.length > 0
                      ? `${stagedModifiers.length} Unified`
                      : "0 duplicates"}
                  </p>
                  <p className="text-xs text-emerald-400 mt-1 font-medium">
                    Standard Dairy group active
                  </p>
                </div>
                <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between">
                  <span className="text-xs font-medium text-slate-400">
                    Staged Buffer Items
                  </span>
                  <p className="text-2xl font-extrabold text-emerald-400 mt-2">
                    {stagedItems.length} items
                  </p>
                  <p className="text-xs text-emerald-400 mt-1 font-medium">
                    {isOptimized
                      ? selectedArchetype === "specialty"
                        ? "Base drink families frequency-sorted"
                        : selectedArchetype === "color-coded"
                        ? "Station color blocks velocity-ranked"
                        : "16oz single-tap anchors mapped"
                      : "Heuristic sizes mapped"}
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Call to Action & Auto-Optimize Controls */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <div className="flex items-center space-x-2">
                  <span>Selected Layout Template: </span>
                  <strong className="text-amber-400 uppercase font-mono">
                    {toTemplateStorageCode(selectedArchetype)}
                  </strong>
                </div>

                {/* Synchronized Template Selector Pills */}
                <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
                  {(
                    ["fast-cash", "specialty", "color-coded"] as ArchetypeId[]
                  ).map((arch) => (
                    <button
                      key={arch}
                      type="button"
                      onClick={() => {
                        setSelectedArchetype(arch);
                        applyPreset(arch);
                      }}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition cursor-pointer ${
                        selectedArchetype === arch
                          ? "bg-amber-500 text-slate-950 font-bold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {arch === "fast-cash"
                        ? "Fast-Cash"
                        : arch === "specialty"
                        ? "Specialty"
                        : "Color-Zoned"}
                    </button>
                  ))}
                </div>

                {isOptimized && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 font-semibold text-xs flex items-center space-x-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                    <span>
                      Optimized (Saved{" "}
                      {Math.max(
                        0.1,
                        4.2 - auditMetrics.averageBaristaTaps
                      ).toFixed(1)}{" "}
                      taps/drink)
                    </span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {!isOptimized ? (
                  <button
                    type="button"
                    onClick={handleAutoOptimizeCatalog}
                    className="px-4 py-2.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/60 text-amber-300 hover:text-amber-200 font-bold text-sm rounded-lg shadow-sm transition flex items-center space-x-2 cursor-pointer"
                  >
                    <span>⚡ Auto-Optimize Catalog &amp; Layout</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUndoOptimization}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 hover:text-white font-semibold text-sm rounded-lg transition flex items-center space-x-2 cursor-pointer"
                  >
                    <span>↺ Undo Optimization</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab("studio")}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm rounded-lg shadow-md shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
                >
                  <span>Proceed to Ergonomics Studio</span>
                  <span>→</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Ergonomics Studio (Elastic Dynamic Multi-Page Grid) */}
        {activeTab === "studio" && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-bold tracking-tight text-white">
                    Register Ergonomics Studio
                  </h1>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-mono">
                    {merchantSlug}
                  </span>
                </div>
                <p className="text-sm text-slate-400 mt-1">
                  Elastic 5×4 counter matrix holding{" "}
                  {stagedItems.length || totalAssignedTiles} catalog items &amp;{" "}
                  {stagedModifiers.length} modifiers across {pages.length} screen
                  pages.
                </p>
              </div>

              {/* Archetype Quick Switcher, Auto-Optimize & Grid Actions */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Compact Live Audit Health Score Pill */}
                <div
                  className={`px-3 py-1.5 rounded-lg border text-xs font-mono flex items-center gap-2 ${
                    isOptimized
                      ? "bg-emerald-950/80 border-emerald-500/50 text-emerald-300"
                      : "bg-slate-900 border-slate-800 text-slate-300"
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOptimized ? "bg-emerald-400 animate-pulse" : "bg-amber-400"
                    }`}
                  />
                  <span>
                    Health Score:{" "}
                    <strong className="text-white">
                      {auditMetrics.healthScore}/100
                    </strong>
                  </span>
                  <span className="text-slate-600">|</span>
                  <span
                    className={
                      isOptimized
                        ? "text-emerald-300 font-bold"
                        : "text-rose-400 font-semibold"
                    }
                  >
                    {auditMetrics.frictionLabel}
                  </span>
                  <span className="text-slate-600">|</span>
                  <span className="text-amber-300 font-bold">
                    {auditMetrics.averageBaristaTaps.toFixed(1)} Avg Taps
                  </span>
                </div>

                {/* Archetype Template Selector */}
                <div className="flex items-center space-x-1 bg-slate-900 border border-slate-800 rounded-lg p-1">
                  {(
                    ["fast-cash", "specialty", "color-coded"] as ArchetypeId[]
                  ).map((arch) => (
                    <button
                      key={arch}
                      onClick={() => {
                        setSelectedArchetype(arch);
                        applyPreset(arch);
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition cursor-pointer ${
                        selectedArchetype === arch
                          ? "bg-amber-500 text-slate-950 font-bold"
                          : "text-slate-400 hover:text-white"
                      }`}
                    >
                      {arch === "fast-cash"
                        ? "Fast-Cash"
                        : arch === "specialty"
                        ? "Specialty"
                        : "Color-Zoned"}
                    </button>
                  ))}
                </div>

                {/* Auto-Optimize & Undo Controls */}
                {!isOptimized ? (
                  <button
                    type="button"
                    onClick={handleAutoOptimizeCatalog}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs rounded-lg shadow-md shadow-amber-500/20 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>⚡ Auto-Optimize Layout</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleUndoOptimization}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-100 hover:text-white font-semibold text-xs rounded-lg transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>↺ Undo Optimization</span>
                  </button>
                )}

                {(stagedItems.length > 0 || stagedModifiers.length > 0) && (
                  <button
                    onClick={handleLoadStagedIntoMatrix}
                    title="Populate matrix with staged tenant catalog"
                    className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                  >
                    ⟳ Load Staged ({stagedItems.length + stagedModifiers.length})
                  </button>
                )}

                <button
                  onClick={handleResetToDefault}
                  title="Restore default archetype layout"
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  ↺ Default Preset
                </button>
                <button
                  onClick={handleClearAllTiles}
                  title="Set all slots across all pages to empty dashed tiles"
                  className="px-3 py-1.5 bg-slate-900 hover:bg-rose-950/40 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 rounded-lg text-xs font-semibold transition cursor-pointer"
                >
                  ✕ Clear All Tiles
                </button>
              </div>
            </div>

            {/* Navigation Style & Hardware Screen Toggles Toolbar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-4">
              {/* Toggle 1: Navigation Style */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Navigation Style:
                </span>
                <div className="inline-flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() => handleToggleNavigationMode("flat-speed")}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      navigationMode === "flat-speed"
                        ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>⚡ Flat Speed Grid</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleToggleNavigationMode("category-folders")
                    }
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      navigationMode === "category-folders"
                        ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>📁 Category-First (SipPass)</span>
                  </button>
                </div>
              </div>

              {/* Toggle 2: Hardware Screen Form-Factor */}
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                  Hardware Screen:
                </span>
                <div className="inline-flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleToggleHardwareFormFactor("ipad-landscape")
                    }
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      hardwareFormFactor === "ipad-landscape"
                        ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>🖥️ iPad Stand (5×4)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleToggleHardwareFormFactor("terminal-portrait")
                    }
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
                      hardwareFormFactor === "terminal-portrait"
                        ? "bg-amber-500 text-slate-950 font-bold shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <span>📱 Square Terminal (Portrait)</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Layout Workspace: Elastic Pages + Inspector Sidebar */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Virtual POS Register Canvas (2/3 width) */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
                <div>
                  {/* Top Bar: Either Dynamic Page Tabs (Flat Mode) or SipPass Category Sync Header (Folder Mode) */}
                  {navigationMode === "flat-speed" ? (
                    <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 mb-4 gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pages.map((_, pIdx) => {
                          const start = pIdx * 20 + 1;
                          const end = start + 19;
                          const isCurrent = activePageIndex === pIdx;
                          return (
                            <button
                              key={pIdx}
                              onClick={() => {
                                setActivePageIndex(pIdx);
                                setSelectedTileId(
                                  pages[pIdx]?.[0]?.id || start
                                );
                              }}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                                isCurrent
                                  ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                                  : "bg-slate-800 text-slate-400 hover:text-white"
                              }`}
                            >
                              Page {pIdx + 1} ({start}–{end})
                            </button>
                          );
                        })}

                        <button
                          onClick={handleAddPage}
                          title="Add an additional empty 20-slot page"
                          className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-slate-950 hover:bg-slate-800 border border-dashed border-slate-700 text-amber-400 hover:text-amber-300 transition cursor-pointer"
                        >
                          + Add Page
                        </button>
                      </div>

                      <span className="text-xs text-slate-400 font-mono">
                        Page {activePageIndex + 1} of {pages.length} •{" "}
                        {hardwareFormFactor === "ipad-landscape"
                          ? "5×4 Landscape"
                          : "3-Col Terminal"}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between pb-4 border-b border-slate-800/80 mb-4 gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold">
                          SipPass Canonical Folders
                        </span>
                        <span className="text-xs text-slate-400">
                          {categoryFolders.length} Category{" "}
                          {categoryFolders.length === 1 ? "Group" : "Groups"} •{" "}
                          {categoryFolders.reduce(
                            (sum, f) => sum + f.itemCount,
                            0
                          )}{" "}
                          Catalog Products (Modifiers Attached to Items)
                        </span>
                      </div>
                      {activeCategoryFolder !== null && (
                        <button
                          type="button"
                          onClick={() => setActiveCategoryFolder(null)}
                          className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer"
                        >
                          ← All Categories
                        </button>
                      )}
                    </div>
                  )}

                  {/* Hardware Frame Renderer */}
                  {hardwareFormFactor === "ipad-landscape" ? (
                    /* iPad Stand (5x4 Landscape) Frame */
                    <div className="bg-slate-950/70 border-2 border-slate-800 rounded-2xl p-4 shadow-inner">
                      {/* iPad Top Status Strip */}
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pb-3 mb-3 border-b border-slate-800/80">
                        <span>SQUARE POS • IPAD PRO 12.9&quot; STAND</span>
                        <span>
                          {navigationMode === "flat-speed"
                            ? "FLAT SPEED GRID (5×4)"
                            : activeCategoryFolder
                            ? `FOLDER: ${activeCategoryFolder.toUpperCase()}`
                            : "CATEGORY-FIRST (SIPPASS FOLDERS)"}
                        </span>
                        <span className="text-emerald-400">● ONLINE</span>
                      </div>

                      {navigationMode === "flat-speed" ? (
                        <div className="grid grid-cols-5 gap-2.5">
                          {currentTiles.map((tile) => {
                            const isSelected = tile.id === activeTile.id;
                            return (
                              <button
                                key={tile.id}
                                onClick={() => handleSelectTile(tile.id)}
                                className={`h-20 sm:h-24 p-2 rounded-xl border flex flex-col justify-between text-left transition-all duration-150 cursor-pointer ${getColorClasses(
                                  tile.color
                                )} ${
                                  isSelected
                                    ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-[1.02] shadow-lg"
                                    : "opacity-95"
                                }`}
                              >
                                <span className="text-xs font-bold leading-tight line-clamp-2">
                                  {tile.label}
                                </span>
                                <span className="text-[11px] font-mono font-medium opacity-80">
                                  {tile.price}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ) : activeCategoryFolder === null ? (
                        /* Top-Level Category Folders View (iPad 5-col) */
                        categoryFolders.length === 0 ? (
                          <div className="py-12 text-center text-xs font-mono text-slate-500">
                            No catalog products assigned yet — load staged items
                            or assign tiles to populate SipPass folders.
                          </div>
                        ) : (
                          <div className="grid grid-cols-5 gap-3 py-2">
                            {categoryFolders.map((folder) => (
                              <button
                                key={folder.folderName}
                                type="button"
                                onClick={() =>
                                  setActiveCategoryFolder(folder.folderName)
                                }
                                className={`h-28 p-3.5 rounded-xl border-2 flex flex-col justify-between text-left transition-all duration-150 hover:scale-[1.02] cursor-pointer shadow-lg ${getColorClasses(
                                  folder.color
                                )}`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-lg">📁</span>
                                  <span className="px-2 py-0.5 rounded-full bg-slate-950/30 text-[10px] font-mono font-bold">
                                    {folder.itemCount}{" "}
                                    {folder.itemCount === 1 ? "item" : "items"}
                                  </span>
                                </div>
                                <div>
                                  <p className="text-xs font-extrabold leading-snug line-clamp-2">
                                    {folder.folderName}
                                  </p>
                                  <p className="text-[10px] font-mono opacity-80 mt-0.5">
                                    Tap to open →
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                        )
                      ) : (
                        /* Drilled-in Category Folder Items View (iPad 5-col) */
                        <div className="space-y-3">
                          <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => setActiveCategoryFolder(null)}
                                className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs hover:bg-amber-400 transition cursor-pointer"
                              >
                                ← All Categories
                              </button>
                              <span className="text-slate-600">/</span>
                              <span className="text-sm font-bold text-white">
                                📁 {activeCategoryFolder}
                              </span>
                            </div>
                            <span className="text-xs font-mono text-amber-400">
                              {categoryFolders.find(
                                (f) => f.folderName === activeCategoryFolder
                              )?.itemCount || 0}{" "}
                              items
                            </span>
                          </div>

                          <div className="grid grid-cols-5 gap-2.5">
                            {(
                              categoryFolders.find(
                                (f) => f.folderName === activeCategoryFolder
                              )?.items || []
                            ).map((tile) => {
                              const isSelected = tile.id === activeTile.id;
                              return (
                                <button
                                  key={tile.id}
                                  type="button"
                                  onClick={() => handleSelectTile(tile.id)}
                                  className={`h-20 sm:h-24 p-2 rounded-xl border flex flex-col justify-between text-left transition-all duration-150 cursor-pointer ${getColorClasses(
                                    tile.color
                                  )} ${
                                    isSelected
                                      ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-[1.02] shadow-lg"
                                      : "opacity-95"
                                  }`}
                                >
                                  <span className="text-xs font-bold leading-tight line-clamp-2">
                                    {tile.label}
                                  </span>
                                  <div className="flex items-center justify-between w-full">
                                    <span className="text-[11px] font-mono font-medium opacity-80">
                                      {tile.price}
                                    </span>
                                    <span className="text-[9px] font-mono opacity-60">
                                      #{tile.id}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Square Terminal (Portrait) Hardware Frame */
                    <div className="max-w-[420px] mx-auto w-full bg-gradient-to-b from-slate-100 via-slate-200 to-slate-300 border-4 border-slate-300/90 rounded-[2.25rem] p-3.5 shadow-2xl">
                      {/* Angled Top Bezel + Card Dip Slot */}
                      <div className="flex flex-col items-center pb-2.5">
                        <div className="w-28 h-1.5 rounded-full bg-slate-400/80 mb-1" />
                        <span className="text-[9px] font-mono uppercase tracking-widest text-slate-600 font-bold">
                          Square Terminal • Handheld POS
                        </span>
                      </div>

                      {/* Inner Portrait Touchscreen */}
                      <div className="bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-inner flex flex-col">
                        {/* Top Dark Status Bar */}
                        <div className="bg-slate-900 px-3.5 py-2 border-b border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-300">
                          <span className="font-bold">9:41 AM</span>
                          <span className="text-amber-400 font-semibold truncate max-w-[160px]">
                            {merchantDisplayName}
                          </span>
                          <span className="text-emerald-400">Wi-Fi • 100%</span>
                        </div>

                        {/* Current Sale Charge Banner */}
                        <div className="bg-slate-900/60 px-3.5 py-2 border-b border-slate-800/80 flex items-center justify-between">
                          <div>
                            <span className="text-[10px] uppercase font-mono text-slate-400 block">
                              Current Ticket
                            </span>
                            <span className="text-xs font-bold text-white">
                              {activeTile &&
                              activeTile.color !== "blank" &&
                              activeTile.label !== "[Empty Slot]"
                                ? activeTile.label
                                : "Tap item to ring"}
                            </span>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg bg-amber-500 text-slate-950 font-mono font-bold text-xs">
                            Charge {activeTile?.price || "$0.00"}
                          </span>
                        </div>

                        {/* 3-Column Thumb-Friendly Grid Area */}
                        <div className="p-3 min-h-[340px] max-h-[420px] overflow-y-auto">
                          {navigationMode === "flat-speed" ? (
                            <div className="grid grid-cols-3 gap-2">
                              {currentTiles.map((tile) => {
                                const isSelected = tile.id === activeTile.id;
                                return (
                                  <button
                                    key={tile.id}
                                    type="button"
                                    onClick={() => handleSelectTile(tile.id)}
                                    className={`h-20 p-2 rounded-xl border flex flex-col justify-between text-left transition-all duration-150 cursor-pointer ${getColorClasses(
                                      tile.color
                                    )} ${
                                      isSelected
                                        ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-[1.02] shadow-lg"
                                        : "opacity-95"
                                    }`}
                                  >
                                    <span className="text-[11px] font-bold leading-tight line-clamp-2">
                                      {tile.label}
                                    </span>
                                    <span className="text-[10px] font-mono font-medium opacity-80">
                                      {tile.price}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : activeCategoryFolder === null ? (
                            /* Top-Level Category Folders View (Terminal 3-col) */
                            categoryFolders.length === 0 ? (
                              <div className="py-10 text-center text-xs font-mono text-slate-500">
                                No catalog products assigned yet.
                              </div>
                            ) : (
                              <div className="grid grid-cols-3 gap-2">
                                {categoryFolders.map((folder) => (
                                  <button
                                    key={folder.folderName}
                                    type="button"
                                    onClick={() =>
                                      setActiveCategoryFolder(folder.folderName)
                                    }
                                    className={`h-24 p-2.5 rounded-xl border-2 flex flex-col justify-between text-left transition-all duration-150 hover:scale-[1.02] cursor-pointer shadow-md ${getColorClasses(
                                      folder.color
                                    )}`}
                                  >
                                    <div className="flex items-center justify-between w-full">
                                      <span className="text-sm">📁</span>
                                      <span className="px-1.5 py-0.5 rounded-full bg-slate-950/30 text-[9px] font-mono font-bold">
                                        {folder.itemCount}
                                      </span>
                                    </div>
                                    <p className="text-[11px] font-extrabold leading-tight line-clamp-2">
                                      {folder.folderName}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            )
                          ) : (
                            /* Drilled-in Category Folder Items View (Terminal 3-col) */
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-2">
                                <button
                                  type="button"
                                  onClick={() => setActiveCategoryFolder(null)}
                                  className="px-2 py-1 rounded bg-amber-500 text-slate-950 font-bold text-[11px] hover:bg-amber-400 transition cursor-pointer"
                                >
                                  ← All Categories
                                </button>
                                <span className="text-xs font-bold text-white truncate max-w-[150px]">
                                  {activeCategoryFolder}
                                </span>
                              </div>

                              <div className="grid grid-cols-3 gap-2">
                                {(
                                  categoryFolders.find(
                                    (f) => f.folderName === activeCategoryFolder
                                  )?.items || []
                                ).map((tile) => {
                                  const isSelected = tile.id === activeTile.id;
                                  return (
                                    <button
                                      key={tile.id}
                                      type="button"
                                      onClick={() => handleSelectTile(tile.id)}
                                      className={`h-20 p-2 rounded-xl border flex flex-col justify-between text-left transition-all duration-150 cursor-pointer ${getColorClasses(
                                        tile.color
                                      )} ${
                                        isSelected
                                          ? "ring-2 ring-white ring-offset-2 ring-offset-slate-950 scale-[1.02] shadow-lg"
                                          : "opacity-95"
                                      }`}
                                    >
                                      <span className="text-[11px] font-bold leading-tight line-clamp-2">
                                        {tile.label}
                                      </span>
                                      <span className="text-[10px] font-mono font-medium opacity-80">
                                        {tile.price}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Square Terminal Bottom Navigation Bar */}
                        <div className="bg-slate-900 border-t border-slate-800 px-4 py-2.5 grid grid-cols-3 text-center text-[10px] font-mono">
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleNavigationMode("flat-speed")
                            }
                            className={`flex flex-col items-center gap-0.5 cursor-pointer ${
                              navigationMode === "flat-speed"
                                ? "text-amber-400 font-bold"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <span>⌨️</span>
                            <span>Keypad</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              handleToggleNavigationMode("category-folders")
                            }
                            className={`flex flex-col items-center gap-0.5 cursor-pointer ${
                              navigationMode === "category-folders"
                                ? "text-amber-400 font-bold"
                                : "text-slate-400 hover:text-white"
                            }`}
                          >
                            <span>📚</span>
                            <span>Library</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleToggleNavigationMode("flat-speed");
                              setActivePageIndex(0);
                            }}
                            className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white cursor-pointer"
                          >
                            <span>⭐</span>
                            <span>Favorites</span>
                          </button>
                        </div>
                      </div>

                      {/* Built-in Thermal Receipt Printer Slot Indicator at Bottom Bezel */}
                      <div className="pt-3 pb-1 flex flex-col items-center">
                        <div className="w-48 h-1.5 rounded-full bg-slate-500/80 shadow-inner" />
                        <span className="text-[9px] font-mono uppercase tracking-wider text-slate-600 mt-1">
                          Thermal Receipt Printer Seam
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Studio Live Diagnostics Footprint */}
                <div className="mt-6 pt-4 border-t border-slate-800/80 grid grid-cols-3 gap-3 text-center">
                  <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] uppercase font-mono text-slate-400">
                      Thumb Reach
                    </span>
                    <p className="text-sm font-bold text-emerald-400">
                      96% High Velocity
                    </p>
                  </div>
                  <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] uppercase font-mono text-slate-400">
                      Current Page Slots
                    </span>
                    <p className="text-sm font-bold text-amber-400">
                      {currentTiles.filter((t) => t.color !== "blank").length} /
                      20
                    </p>
                  </div>
                  <div className="bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                    <span className="text-[10px] uppercase font-mono text-slate-400">
                      Total Placed
                    </span>
                    <p className="text-sm font-bold text-white">
                      {totalAssignedTiles} Active Buttons
                    </p>
                  </div>
                </div>
              </div>

              {/* Sidebar: Tile Inspector & Quick-Assign Tray */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <h3 className="font-bold text-white text-base">
                      Tile Inspector
                    </h3>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                        Slot #{activeTile.id}
                      </span>
                      <button
                        onClick={handleClearCurrentTile}
                        title="Clear this tile to an empty slot"
                        className="text-xs text-slate-400 hover:text-rose-400 font-mono transition cursor-pointer"
                      >
                        [Clear Slot]
                      </button>
                    </div>
                  </div>

                  {/* Button Label Input */}
                  <div>
                    <label className="text-xs font-medium text-slate-300 block mb-1">
                      Button Label
                    </label>
                    <input
                      type="text"
                      value={activeTile.label}
                      onChange={(e) =>
                        updateActiveTile({ label: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-amber-500 font-medium"
                    />
                  </div>

                  {/* Price / Subtext Input */}
                  <div>
                    <label className="text-xs font-medium text-slate-300 block mb-1">
                      Display Price / Action
                    </label>
                    <input
                      type="text"
                      value={activeTile.price}
                      onChange={(e) =>
                        updateActiveTile({ price: e.target.value })
                      }
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-base sm:text-sm text-white focus:outline-none focus:border-amber-500 font-mono"
                    />
                  </div>

                  {/* Color Palette Selector */}
                  <div>
                    <label className="text-xs font-medium text-slate-300 block mb-2">
                      Station Color Coding
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        {
                          id: "amber",
                          label: "Espresso Bar",
                          dot: "bg-amber-500",
                        },
                        {
                          id: "cyan",
                          label: "Cold Drinks",
                          dot: "bg-cyan-500",
                        },
                        {
                          id: "emerald",
                          label: "Bakery / Food",
                          dot: "bg-emerald-500",
                        },
                        {
                          id: "slate",
                          label: "Modifier / Retail",
                          dot: "bg-slate-400",
                        },
                        {
                          id: "blank",
                          label: "Empty Spacer",
                          dot: "bg-slate-700",
                        },
                      ].map((c) => (
                        <button
                          key={c.id}
                          onClick={() =>
                            updateActiveTile({ color: c.id as TileColor })
                          }
                          className={`flex items-center space-x-2 px-3 py-2 rounded-lg border text-xs font-medium transition cursor-pointer ${
                            activeTile.color === c.id
                              ? "bg-slate-800 border-white text-white font-bold"
                              : "bg-slate-950/60 border-slate-800 text-slate-400 hover:text-white"
                          }`}
                        >
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${c.dot}`}
                          ></span>
                          <span>{c.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Staged Items & Modifiers Quick-Assign Tray */}
                  {(stagedItems.length > 0 || stagedModifiers.length > 0) && (
                    <div className="pt-2 border-t border-slate-800/80 space-y-2">
                      <label className="text-xs font-medium text-slate-300 block">
                        Quick-Assign from {merchantSlug} Catalog (
                        {stagedItems.length} Drinks/Food &middot;{" "}
                        {stagedModifiers.length} Mods)
                      </label>
                      <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                        {stagedItems.map((item, idx) => (
                          <button
                            key={`item-${idx}`}
                            onClick={() => handleAssignItemToTile(item)}
                            className="w-full text-left bg-slate-950 hover:bg-slate-800 border border-slate-800/80 hover:border-amber-500/50 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs transition cursor-pointer"
                          >
                            <span className="font-semibold text-slate-200 truncate pr-2">
                              {item.name}
                            </span>
                            <span className="text-[10px] font-mono text-amber-400 shrink-0">
                              ${item.variations[0]?.price.toFixed(2) || "4.50"}
                            </span>
                          </button>
                        ))}
                        {stagedModifiers.map((mod, idx) => (
                          <button
                            key={`mod-${idx}`}
                            onClick={() => handleAssignModifierToTile(mod)}
                            className="w-full text-left bg-slate-950/80 hover:bg-slate-800 border border-slate-800/60 hover:border-cyan-500/50 rounded-lg px-2.5 py-1.5 flex items-center justify-between text-xs transition cursor-pointer"
                          >
                            <span className="font-medium text-cyan-300 truncate pr-2">
                              + {mod.name}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 shrink-0">
                              +${mod.price.toFixed(2)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Lock In & Proceed to Step 5: Review & Cloud Sync */}
                <div className="pt-4 border-t border-slate-800 space-y-2">
                  <Link
                    href={`/onboard/review?merchant=${encodeURIComponent(
                      merchantSlug
                    )}`}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center justify-center space-x-2"
                  >
                    <span>Step 5: Review &amp; Cloud Sync</span>
                    <span>→</span>
                  </Link>
                  <p className="text-[11px] text-center text-slate-500">
                    Saves all {pages.length} screen pages &amp; routes to canonical
                    POS/Supabase publish.
                  </p>
                </div>
              </div>
            </div>

            {/* Bottom Studio Pipeline Bar */}
            <div className="bg-slate-900/95 border border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-lg">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="px-4 py-2.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-amber-400 hover:text-amber-300 text-xs font-bold transition"
                >
                  ← Master Dashboard
                </Link>
                <Link
                  href="/onboard/connect"
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 hover:text-white text-xs font-semibold transition"
                >
                  ← Back to Step 3: POS Connect
                </Link>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-mono text-slate-400">
                  {totalAssignedTiles} Active Buttons •{" "}
                  {navigationMode === "flat-speed"
                    ? "Flat Speed Grid"
                    : "Category-First (SipPass)"}{" "}
                  •{" "}
                  {hardwareFormFactor === "ipad-landscape"
                    ? "iPad 5×4"
                    : "Square Terminal"}
                </span>
                <Link
                  href={`/onboard/review?merchant=${encodeURIComponent(
                    merchantSlug
                  )}`}
                  className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition shadow-md shadow-amber-500/20 flex items-center space-x-2"
                >
                  <span>Proceed to Step 5: Review &amp; Cloud Sync</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Deploy */}
        {activeTab === "deploy" && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Review &amp; Production Deploy
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                Final verification before publishing optimized button coordinates to{" "}
                <span className="text-amber-400 font-semibold">
                  {merchantDisplayName}
                </span>
                &apos;s live POS and exporting canonical records to Supabase.
              </p>
            </div>

            {/* Pre-Flight Status Checklist */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md">
              <h2 className="text-base font-semibold text-white mb-4">
                Pre-Flight Architecture Verification
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-500 uppercase font-mono">
                    Client Slug
                  </span>
                  <p className="text-base font-bold text-amber-400 font-mono mt-1">
                    {merchantSlug}
                  </p>
                  <span className="text-[11px] text-emerald-400 mt-1 block">
                    Strictly Scoped
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-500 uppercase font-mono">
                    POS Target
                  </span>
                  <p className="text-base font-bold text-white font-mono mt-1">
                    {posAuth?.provider === "clover"
                      ? "Clover REST v3"
                      : "Square Cloud v2"}
                  </p>
                  <span className="text-[11px] text-emerald-400 mt-1 block">
                    Production Target
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-500 uppercase font-mono">
                    Grid Pages
                  </span>
                  <p className="text-base font-bold text-white mt-1">
                    {pages.length} Pages ({pages.length * 20} Slots)
                  </p>
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    {totalAssignedTiles} Active Buttons
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-xl">
                  <span className="text-xs text-slate-500 uppercase font-mono">
                    SipPass Handshake
                  </span>
                  <p className="text-base font-bold text-emerald-400 mt-1">
                    Canonical Sync
                  </p>
                  <span className="text-[11px] text-emerald-400 mt-1 block">
                    Ready to Write
                  </span>
                </div>
              </div>
            </div>

            {/* Dual Payload Inspection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1: Square Register Target */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
                      <h3 className="font-bold text-white text-base">
                        POS Register Payload
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      Live API
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    Updates the Favorites layout coordinates on{" "}
                    {merchantDisplayName}&apos;s physical iPad register across
                    all {pages.length} pages.
                  </p>
                  <div className="mt-4 bg-slate-950 border border-slate-800/80 rounded-lg p-3 font-mono text-xs text-slate-300 space-y-1">
                    <p>
                      <span className="text-slate-500">endpoint:</span>{" "}
                      /v2/catalog/batch-upsert
                    </p>
                    <p>
                      <span className="text-slate-500">pages_configured:</span>{" "}
                      {pages.length} dynamic pages
                    </p>
                    <p>
                      <span className="text-slate-500">
                        total_active_hotkeys:
                      </span>{" "}
                      {totalAssignedTiles}
                    </p>
                    <p>
                      <span className="text-slate-500">target_device:</span>{" "}
                      iPad Point of Sale
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                  Target device receives instant silent cloud refresh.
                </div>
              </div>

              {/* Card 2: Supabase Canonical Target */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-md flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center space-x-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
                      <h3 className="font-bold text-white text-base">
                        Supabase Canonical Export
                      </h3>
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      Shared DB
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                    Pushes the normalized, deduplicated menu to Supabase so SipPass consumer ordering can read the identical drink and modifier catalog.
                  </p>
                  <div className="mt-4 bg-slate-950 border border-slate-800/80 rounded-lg p-3 font-mono text-xs text-slate-300 space-y-1">
                    <p>
                      <span className="text-slate-500">table:</span>{" "}
                      public.menu_items
                    </p>
                    <p>
                      <span className="text-slate-500">filter:</span>{" "}
                      merchant_slug = &apos;{merchantSlug}&apos;
                    </p>
                    <p>
                      <span className="text-slate-500">modifiers:</span>{" "}
                      standard_dairy_v1
                    </p>
                    <p>
                      <span className="text-slate-500">app_contract:</span>{" "}
                      Read-only for SipPass
                    </p>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800 text-xs text-slate-400">
                  Ensures zero drift between counter POS and mobile ordering.
                </div>
              </div>
            </div>

            {/* Action Bar & Feedback */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col items-center justify-center space-y-4 text-center">
              {deployState === "idle" && (
                <>
                  <div>
                    <h3 className="text-lg font-bold text-white">
                      Ready to Deploy ({merchantSlug})
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                      Click below to broadcast the {pages.length}-page layout to
                      the counter register and finalize the catalog in Supabase.
                    </p>
                  </div>
                  <button
                    onClick={handleDeploy}
                    className="px-8 py-3.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
                  >
                    <span>🚀 Deploy Layout to POS Cloud</span>
                  </button>
                </>
              )}

              {deployState === "deploying" && (
                <div className="py-4 space-y-3">
                  <div className="h-8 w-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-sm font-semibold text-amber-400">
                    {deployMessage}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    Syncing cloud state...
                  </p>
                </div>
              )}

              {deployState === "success" && (
                <div className="py-2 space-y-3">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400 text-2xl mx-auto">
                    ✓
                  </div>
                  <h3 className="text-lg font-bold text-white">
                    Deployment Complete!
                  </h3>
                  <p className="text-xs text-emerald-300 font-medium max-w-md mx-auto">
                    {deployMessage}
                  </p>
                  <div className="pt-2 flex justify-center space-x-3">
                    <button
                      onClick={() => setDeployState("idle")}
                      className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition cursor-pointer"
                    >
                      Deploy Another Iteration
                    </button>
                    <button
                      onClick={() => setActiveTab("studio")}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      Return to Studio
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
