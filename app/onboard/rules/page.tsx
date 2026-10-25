"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  INTAKE_STAGE_STORAGE_KEY,
  toSlug,
  readSavedSessionsFromStorage,
  upsertSessionInArchive,
  deleteSessionFromArchive,
  purgeAllSessionsFromArchive,
  clearActiveStageAndRulesFromStorage,
  restoreSessionToActiveStage,
  exportAllSessionsJson,
  type IntakeStageData,
  type StagedMenuItem,
  type StagedModifierOption,
  type StagedRetailItem,
  type OnboardingSession,
} from "@/app/onboard/intake/page";

export const RULES_CONFIG_STORAGE_KEY = "barmaid_rules_config";

export type CupSizeLabel = "8oz" | "12oz" | "16oz" | "20oz" | "24oz" | "32oz";

export interface CupSizeRule {
  size: CupSizeLabel;
  enabled: boolean;
  defaultShots: number;
  defaultSyrupPumps: number;
}

export interface ModifierPricingRules {
  altMilkUpchargeDollars: number;
  extraShotDollars: number;
  syrupSauceAddOnDollars: number;
}

export interface BusinessRulesConfig {
  merchant_slug: string;
  sizeMatrix: CupSizeRule[];
  modifierPricing: ModifierPricingRules;
  preferredPosPreview: "square" | "clover";
  savedAt: string;
}

interface PreviewCatalogItem {
  id: string;
  name: string;
  category: string;
  basePrice: number;
  variations: Array<{ size: string; price: number }>;
  isRetail?: boolean;
}

interface GroupedModifiers {
  groupLabel: string;
  upchargePrice: number;
  options: string[];
}

const DEFAULT_SIZE_MATRIX: CupSizeRule[] = [
  { size: "8oz", enabled: true, defaultShots: 1, defaultSyrupPumps: 2 },
  { size: "12oz", enabled: true, defaultShots: 2, defaultSyrupPumps: 3 },
  { size: "16oz", enabled: true, defaultShots: 2, defaultSyrupPumps: 4 },
  { size: "20oz", enabled: true, defaultShots: 4, defaultSyrupPumps: 5 },
  { size: "24oz", enabled: true, defaultShots: 4, defaultSyrupPumps: 6 },
  { size: "32oz", enabled: true, defaultShots: 6, defaultSyrupPumps: 7 },
];

const DEFAULT_MODIFIER_PRICING: ModifierPricingRules = {
  altMilkUpchargeDollars: 0.75,
  extraShotDollars: 0.75,
  syrupSauceAddOnDollars: 0.5,
};

export default function OnboardingRulesStepPage() {
  const router = useRouter();
  const [stageData, setStageData] = useState<IntakeStageData | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);

  // Saved Client Sessions Archive ('barmaid_saved_sessions')
  const [savedSessions, setSavedSessions] = useState<OnboardingSession[]>([]);
  const [isSessionDrawerOpen, setIsSessionDrawerOpen] = useState<boolean>(false);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Business Rules state
  const [sizeMatrix, setSizeMatrix] = useState<CupSizeRule[]>(DEFAULT_SIZE_MATRIX);
  const [modifierPricing, setModifierPricing] = useState<ModifierPricingRules>(
    DEFAULT_MODIFIER_PRICING
  );

  // POS Simulator state
  const [posMode, setPosMode] = useState<"square" | "clover">("square");
  const [selectedCategory, setSelectedCategory] = useState<string>("All Items");
  const [activeDrinkModal, setActiveDrinkModal] = useState<PreviewCatalogItem | null>(
    null
  );
  const [selectedModalSize, setSelectedModalSize] = useState<CupSizeLabel>("16oz");
  const [selectedModalMods, setSelectedModalMods] = useState<string[]>([]);
  const [extraShotsCount, setExtraShotsCount] = useState<number>(0);

  // Hydrate staged intake data and any previously saved business rules on mount
  useEffect(() => {
    setSavedSessions(readSavedSessionsFromStorage());

    try {
      const rawStage =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      if (rawStage) {
        const parsedStage = JSON.parse(rawStage) as IntakeStageData;
        setStageData(parsedStage);
        if (
          parsedStage.storeProfile?.merchantSlug ||
          parsedStage.storeProfile?.dbaName ||
          parsedStage.storeProfile?.legalName
        ) {
          setSavedSessions(upsertSessionInArchive(parsedStage));
        }
      }

      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);
      if (rawRules) {
        const parsedRules = JSON.parse(rawRules) as Partial<BusinessRulesConfig>;
        if (Array.isArray(parsedRules.sizeMatrix) && parsedRules.sizeMatrix.length > 0) {
          setSizeMatrix(parsedRules.sizeMatrix);
        }
        if (parsedRules.modifierPricing) {
          setModifierPricing({
            altMilkUpchargeDollars:
              typeof parsedRules.modifierPricing.altMilkUpchargeDollars === "number"
                ? parsedRules.modifierPricing.altMilkUpchargeDollars
                : DEFAULT_MODIFIER_PRICING.altMilkUpchargeDollars,
            extraShotDollars:
              typeof parsedRules.modifierPricing.extraShotDollars === "number"
                ? parsedRules.modifierPricing.extraShotDollars
                : DEFAULT_MODIFIER_PRICING.extraShotDollars,
            syrupSauceAddOnDollars:
              typeof parsedRules.modifierPricing.syrupSauceAddOnDollars === "number"
                ? parsedRules.modifierPricing.syrupSauceAddOnDollars
                : DEFAULT_MODIFIER_PRICING.syrupSauceAddOnDollars,
          });
        }
        if (
          parsedRules.preferredPosPreview === "square" ||
          parsedRules.preferredPosPreview === "clover"
        ) {
          setPosMode(parsedRules.preferredPosPreview);
        }
      }
    } catch {
      // Ignore storage parse errors
    } finally {
      setLoaded(true);
    }
  }, []);

  // Resolved merchant identity & counts
  const storeProfile = stageData?.storeProfile;
  const resolvedSlug =
    storeProfile?.merchantSlug ||
    toSlug(storeProfile?.dbaName || storeProfile?.legalName || "") ||
    "unassigned";
  const resolvedDba =
    storeProfile?.dbaName || storeProfile?.legalName || "Unassigned Merchant";
  const resolvedLegal = storeProfile?.legalName || resolvedDba;
  const resolvedAddress = storeProfile?.streetAddress || "No Street Address Staged";
  const resolvedCityStateZip =
    [storeProfile?.city, storeProfile?.state, storeProfile?.zipCode]
      .filter(Boolean)
      .join(", ") || "—";

  const activeStagedDrinks: StagedMenuItem[] = useMemo(
    () => (stageData?.stagedItems || []).filter((d) => d.included),
    [stageData]
  );
  const activeStagedModifiers: StagedModifierOption[] = useMemo(
    () => (stageData?.modifiers || []).filter((m) => m.included),
    [stageData]
  );
  const activeStagedRetail: StagedRetailItem[] = useMemo(
    () => (stageData?.retailItems || []).filter((r) => r.included),
    [stageData]
  );

  const drinksCount =
    stageData?.stagedCounts?.drinksCount ?? activeStagedDrinks.length;
  const modifiersCount =
    stageData?.stagedCounts?.modifiersCount ?? activeStagedModifiers.length;
  const retailCount =
    stageData?.stagedCounts?.retailCount ?? activeStagedRetail.length;
  const suppliesCount =
    stageData?.stagedCounts?.suppliesCount ??
    stageData?.supplies?.filter((s) => !s.included).length ??
    0;

  // Build unified POS preview items from staged drinks + retail items (or fallback preview items)
  const previewItems: PreviewCatalogItem[] = useMemo(() => {
    const items: PreviewCatalogItem[] = [];

    activeStagedDrinks.forEach((d) => {
      const baseVar = d.variations[0];
      items.push({
        id: d.id,
        name: d.name,
        category: d.categoryName || "Hot Espresso",
        basePrice: baseVar?.price ?? 4.75,
        variations:
          d.variations.length > 0 ? d.variations : [{ size: "16oz", price: 4.75 }],
      });
    });

    activeStagedRetail.forEach((r) => {
      const priceDollars =
        typeof r.suggestedPriceCents === "number" && r.suggestedPriceCents > 0
          ? r.suggestedPriceCents / 100
          : typeof r.unitCostCents === "number" && r.unitCostCents > 0
          ? (r.unitCostCents * 2) / 100
          : 16.0;
      items.push({
        id: r.id,
        name: r.name,
        category: "Retail",
        basePrice: priceDollars,
        variations: [{ size: "Retail", price: priceDollars }],
        isRetail: true,
      });
    });

    return items;
  }, [activeStagedDrinks, activeStagedRetail]);

  // Categories list for Square top pill bar & Clover left sidebar
  const categoriesList: string[] = useMemo(() => {
    const unique = new Set<string>();
    previewItems.forEach((item) => unique.add(item.category));
    return ["All Items", ...Array.from(unique)];
  }, [previewItems]);

  const filteredPreviewItems = useMemo(() => {
    if (selectedCategory === "All Items") return previewItems;
    return previewItems.filter((item) => item.category === selectedCategory);
  }, [previewItems, selectedCategory]);

  // Build deduplicated Modifier Groups for the Modifier Pop-Out Sheet directly from staged modifiers
  const deduplicatedModifierGroups: GroupedModifiers[] = useMemo(() => {
    const dairySet = new Set<string>();
    const syrupSet = new Set<string>();
    const energySet = new Set<string>();
    const sauceSet = new Set<string>();

    if (activeStagedModifiers.length > 0) {
      activeStagedModifiers.forEach((mod) => {
        const cleanName = mod.name.trim();
        if (!cleanName) return;
        const g = mod.targetGroup.toLowerCase();

        if (g.includes("milk") || g.includes("dairy") || /oat|almond|coconut|soy|breve|cream/i.test(cleanName)) {
          dairySet.add(cleanName);
        } else if (g.includes("sauce") || /sauce|mocha|white choc|caramel drizzle/i.test(cleanName)) {
          sauceSet.add(cleanName);
        } else if (g.includes("energy") || g.includes("boost") || g.includes("powder") || /lotus|red bull|shot|boba|chai|matcha|frappe/i.test(cleanName)) {
          energySet.add(cleanName);
        } else {
          syrupSet.add(cleanName);
        }
      });
    }

    // Ensure every canonical group has realistic options if a particular category wasn't in the invoice
    if (dairySet.size === 0) {
      ["Oat Milk", "Almond Milk", "Coconut Milk", "Breve (Half & Half)", "Heavy Cream"].forEach(
        (m) => dairySet.add(m)
      );
    }
    if (syrupSet.size === 0) {
      [
        "Vanilla Syrup",
        "Hazelnut Syrup",
        "Lavender Syrup",
        "Salted Caramel Syrup",
        "Brown Sugar Cinnamon",
        "Sugar-Free Vanilla",
      ].forEach((m) => syrupSet.add(m));
    }
    if (energySet.size === 0) {
      [
        "Blue Lotus Plant Energy",
        "Pink Lotus Plant Energy",
        "Red Bull Original",
        "Spiced Chai Powder",
        "Matcha Green Tea Boost",
      ].forEach((m) => energySet.add(m));
    }
    if (sauceSet.size === 0) {
      [
        "Ghirardelli Caramel Sauce",
        "Dark Chocolate Mocha Sauce",
        "White Chocolate Sauce",
      ].forEach((m) => sauceSet.add(m));
    }

    return [
      {
        groupLabel: "Dairy Options",
        upchargePrice: modifierPricing.altMilkUpchargeDollars,
        options: Array.from(dairySet),
      },
      {
        groupLabel: "Syrups",
        upchargePrice: modifierPricing.syrupSauceAddOnDollars,
        options: Array.from(syrupSet),
      },
      {
        groupLabel: "Energy & Boosters",
        upchargePrice: modifierPricing.extraShotDollars,
        options: Array.from(energySet),
      },
      {
        groupLabel: "Sauces",
        upchargePrice: modifierPricing.syrupSauceAddOnDollars,
        options: Array.from(sauceSet),
      },
    ];
  }, [activeStagedModifiers, modifierPricing]);

  // Size Matrix update helpers
  const toggleSizeEnabled = (size: CupSizeLabel) => {
    setSizeMatrix((prev) =>
      prev.map((row) =>
        row.size === size ? { ...row, enabled: !row.enabled } : row
      )
    );
  };

  const updateSizeRuleNumber = (
    size: CupSizeLabel,
    field: "defaultShots" | "defaultSyrupPumps",
    nextVal: number
  ) => {
    const clamped = Math.max(0, Math.min(20, Math.round(nextVal)));
    setSizeMatrix((prev) =>
      prev.map((row) => (row.size === size ? { ...row, [field]: clamped } : row))
    );
  };

  // Open Drink Modifier Pop-Out Sheet
  const handleOpenDrinkModal = (item: PreviewCatalogItem) => {
    setActiveDrinkModal(item);
    const enabledSizes = sizeMatrix.filter((s) => s.enabled);
    const defaultSize =
      enabledSizes.find((s) => s.size === "16oz")?.size ||
      enabledSizes[0]?.size ||
      "16oz";
    setSelectedModalSize(defaultSize);
    setSelectedModalMods([]);
    setExtraShotsCount(0);
  };

  const toggleModalModifier = (optionName: string) => {
    setSelectedModalMods((prev) =>
      prev.includes(optionName)
        ? prev.filter((m) => m !== optionName)
        : [...prev, optionName]
    );
  };

  // Compute live price inside the Modifier Pop-Out Preview
  const activeModalComputation = useMemo(() => {
    if (!activeDrinkModal) return null;

    const matchedVar = activeDrinkModal.variations.find(
      (v) => v.size.toLowerCase() === selectedModalSize.toLowerCase()
    );
    const sizeIndex = DEFAULT_SIZE_MATRIX.findIndex(
      (s) => s.size === selectedModalSize
    );
    const fallbackPrice =
      activeDrinkModal.basePrice + Math.max(0, sizeIndex - 2) * 0.5;
    const baseSizePrice = matchedVar ? matchedVar.price : fallbackPrice;

    const sizeRule =
      sizeMatrix.find((s) => s.size === selectedModalSize) || DEFAULT_SIZE_MATRIX[2];

    let modifiersUpcharge = extraShotsCount * modifierPricing.extraShotDollars;
    selectedModalMods.forEach((modName) => {
      const group = deduplicatedModifierGroups.find((g) =>
        g.options.includes(modName)
      );
      if (group) {
        modifiersUpcharge += group.upchargePrice;
      }
    });

    return {
      baseSizePrice,
      sizeRule,
      modifiersUpcharge,
      totalPrice: baseSizePrice + modifiersUpcharge,
    };
  }, [
    activeDrinkModal,
    selectedModalSize,
    sizeMatrix,
    extraShotsCount,
    modifierPricing,
    selectedModalMods,
    deduplicatedModifierGroups,
  ]);

  // Save Rules & Continue to Step 3: POS Connect
  const handleSaveRulesAndContinue = () => {
    const configPayload: BusinessRulesConfig = {
      merchant_slug: resolvedSlug,
      sizeMatrix,
      modifierPricing,
      preferredPosPreview: posMode,
      savedAt: new Date().toISOString(),
    };

    try {
      const serialized = JSON.stringify(configPayload);
      localStorage.setItem(RULES_CONFIG_STORAGE_KEY, serialized);
      sessionStorage.setItem(RULES_CONFIG_STORAGE_KEY, serialized);
    } catch {
      // Ignore storage quota errors
    }

    if (
      stageData &&
      resolvedSlug &&
      resolvedSlug !== "unassigned"
    ) {
      const updatedArchive = upsertSessionInArchive(stageData, configPayload);
      setSavedSessions(updatedArchive);
    }

    router.push("/onboard/connect");
  };

  // Session Manager Action 1: Load Business
  const handleLoadSavedSession = (
    session: OnboardingSession,
    targetRoute?: "/onboard/intake" | "/onboard/rules"
  ) => {
    const restoredStage = restoreSessionToActiveStage(session);
    setStageData(restoredStage);

    if (session.rulesConfig) {
      if (
        Array.isArray(session.rulesConfig.sizeMatrix) &&
        session.rulesConfig.sizeMatrix.length > 0
      ) {
        setSizeMatrix(session.rulesConfig.sizeMatrix);
      }
      if (session.rulesConfig.modifierPricing) {
        setModifierPricing(session.rulesConfig.modifierPricing);
      }
      if (
        session.rulesConfig.preferredPosPreview === "square" ||
        session.rulesConfig.preferredPosPreview === "clover"
      ) {
        setPosMode(session.rulesConfig.preferredPosPreview);
      }
    } else {
      setSizeMatrix(DEFAULT_SIZE_MATRIX);
      setModifierPricing(DEFAULT_MODIFIER_PRICING);
    }

    setIsSessionDrawerOpen(false);
    setConfirmPurgeAll(false);
    setStatusBanner(
      `Loaded business "${
        session.storeProfile.dbaName ||
        session.storeProfile.legalName ||
        session.storeProfile.merchantSlug
      }" (${session.storeProfile.merchantSlug}).`
    );

    if (targetRoute === "/onboard/intake") {
      router.push("/onboard/intake");
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
    if (stageData && resolvedSlug && resolvedSlug !== "unassigned") {
      const configPayload: BusinessRulesConfig = {
        merchant_slug: resolvedSlug,
        sizeMatrix,
        modifierPricing,
        preferredPosPreview: posMode,
        savedAt: new Date().toISOString(),
      };
      upsertSessionInArchive(stageData, configPayload);
    }
    clearActiveStageAndRulesFromStorage();
    setStageData(null);
    setSizeMatrix(DEFAULT_SIZE_MATRIX);
    setModifierPricing(DEFAULT_MODIFIER_PRICING);
    setIsSessionDrawerOpen(false);
    setConfirmPurgeAll(false);
    router.push("/onboard/intake");
  };

  // Session Manager Action 5: Purge All Sessions
  const handlePurgeAllSessions = () => {
    purgeAllSessionsFromArchive();
    clearActiveStageAndRulesFromStorage();
    setSavedSessions([]);
    setStageData(null);
    setSizeMatrix(DEFAULT_SIZE_MATRIX);
    setModifierPricing(DEFAULT_MODIFIER_PRICING);
    setConfirmPurgeAll(false);
    setIsSessionDrawerOpen(false);
    setStatusBanner(
      "All saved client sessions and active working state have been permanently purged."
    );
  };

  const getSquareTileAccent = (category: string, isRetail?: boolean): string => {
    if (isRetail) {
      return "border-emerald-600/60 bg-emerald-950/50 hover:border-emerald-400 text-emerald-100";
    }
    if (/cold|iced|energy|lotus|red bull|frappe|boba|smoothie/i.test(category)) {
      return "border-cyan-600/60 bg-cyan-950/50 hover:border-cyan-400 text-cyan-100";
    }
    if (/food|pastry|bakery|snack/i.test(category)) {
      return "border-purple-600/60 bg-purple-950/50 hover:border-purple-400 text-purple-100";
    }
    return "border-amber-600/60 bg-amber-950/50 hover:border-amber-400 text-amber-100";
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-24">
      {/* Unified Top Command Navigation Bar */}
      <div className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-6 py-2.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left button: ← Dashboard */}
          <Link
            href="/dashboard"
            className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 text-amber-400 hover:text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
          >
            <span>← Dashboard</span>
          </Link>

          {/* Center badge: Active Client DBA & Slug */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-full px-4 py-1 flex items-center space-x-2 shadow-inner">
            <span
              className={`h-2 w-2 rounded-full ${
                resolvedSlug && resolvedSlug !== "unassigned"
                  ? "bg-amber-400"
                  : "bg-slate-600"
              }`}
            ></span>
            <span className="text-xs font-bold text-white">{resolvedDba}</span>
            <span className="text-xs font-mono text-amber-400">
              ({resolvedSlug})
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
                      s.storeProfile.merchantSlug === resolvedSlug ||
                      s.id === resolvedSlug
                  )
                    ? resolvedSlug
                    : ""
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "__new__") {
                    handleStartNewShop();
                    return;
                  }
                  const found = savedSessions.find(
                    (s) =>
                      s.storeProfile.merchantSlug === val || s.id === val
                  );
                  if (found) {
                    handleLoadSavedSession(found);
                  }
                }}
                className="bg-slate-900 text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer pr-1"
              >
                <option value="">
                  {resolvedSlug && resolvedSlug !== "unassigned"
                    ? `Active: ${resolvedDba}`
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

      {/* Onboarding Wizard Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <Link
              href="/"
              className="h-9 w-9 rounded-lg bg-amber-500 flex items-center justify-center font-black text-slate-950 text-xl shadow-md shadow-amber-500/20"
            >
              B
            </Link>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold tracking-tight text-lg text-white">
                  BarMaid Onboarding Wizard
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-amber-400 font-mono border border-slate-700">
                  8-Step Pipeline
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Guided Business Rules &amp; Live POS Layout Simulator
              </p>
            </div>
          </div>

          {/* Wizard Step Indicators */}
          <nav
            aria-label="Onboarding progress"
            className="flex items-center space-x-2 sm:space-x-3 text-xs font-semibold"
          >
            <Link
              href="/onboard/intake"
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60 transition"
            >
              <span className="h-5 w-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-[11px] font-bold">
                ✓
              </span>
              <span>Step 1: Document Intake</span>
            </Link>

            <span className="text-slate-600 font-mono">→</span>

            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20">
              <span className="h-5 w-5 rounded-full bg-slate-950 text-amber-400 flex items-center justify-center text-[11px] font-mono">
                2
              </span>
              <span>Step 2: Rules &amp; Sizing</span>
            </div>

            <span className="text-slate-600 font-mono">→</span>

            <button
              type="button"
              onClick={handleSaveRulesAndContinue}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition cursor-pointer"
            >
              <span className="h-5 w-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[11px] font-mono">
                3
              </span>
              <span>Step 3: POS Connect</span>
            </button>
          </nav>

          {/* Active Tenant Pill & Past Sessions / History Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="bg-slate-950 border border-slate-800 rounded-full px-3.5 py-1.5 flex items-center space-x-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  resolvedSlug && resolvedSlug !== "unassigned"
                    ? "bg-emerald-400"
                    : "bg-slate-600"
                }`}
              ></span>
              <span className="text-xs text-slate-400">merchant_slug:</span>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {resolvedSlug}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setSavedSessions(readSavedSessionsFromStorage());
                setConfirmPurgeAll(false);
                setIsSessionDrawerOpen(true);
              }}
              className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-amber-500/40 text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer"
            >
              <span>Past Sessions / History</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-950 text-amber-400 font-mono text-[11px]">
                {savedSessions.length}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
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

        {/* Page Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Step 2: Business Rules &amp; Sizing
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Configure cup size shot/syrup recipes, set universal modifier upcharges, and test your staged catalog inside a live Square or Clover register simulator.
            </p>
          </div>
        </div>

        {/* Section 1: Hydrated Merchant Identity & Staged Item Counts */}
        <section
          aria-label="Verified Merchant Identity and Staged Counts"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6"
        >
          {/* Verified Merchant Identity Card */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
                  Verified Merchant Identity
                </span>
                <h2 className="text-base font-bold text-white mt-0.5">
                  {resolvedDba}
                </h2>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-xs font-bold">
                {resolvedSlug}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-slate-500">
                  Legal Entity
                </span>
                <p className="font-semibold text-slate-200 mt-0.5 truncate">
                  {resolvedLegal}
                </p>
              </div>
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-slate-500">
                  Location
                </span>
                <p className="font-semibold text-slate-200 mt-0.5 truncate">
                  {resolvedAddress} &middot; {resolvedCityStateZip}
                </p>
              </div>
            </div>
          </div>

          {/* Staged Item Counts Summary */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-sm font-bold text-white">
                Hydrated Stage Summary (<code className="text-amber-400 font-mono">barmaid_intake_stage</code>)
              </h2>
              <span className="text-xs font-mono text-slate-400">
                {loaded ? "Synced from LocalStorage" : "Hydrating..."}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] font-mono uppercase text-cyan-400">
                  Drinks
                </span>
                <p className="text-xl font-extrabold text-white mt-0.5">
                  {drinksCount} Drinks
                </p>
                <span className="text-[11px] text-slate-400">Menu Boards</span>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] font-mono uppercase text-amber-400">
                  Modifiers
                </span>
                <p className="text-xl font-extrabold text-white mt-0.5">
                  {modifiersCount} Modifiers
                </p>
                <span className="text-[11px] text-slate-400">Deduplicated</span>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] font-mono uppercase text-emerald-400">
                  Retail
                </span>
                <p className="text-xl font-extrabold text-white mt-0.5">
                  {retailCount} Retail
                </p>
                <span className="text-[11px] text-slate-400">Whole Bean &amp; RTD</span>
              </div>

              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  Filtered Supplies
                </span>
                <p className="text-xl font-extrabold text-slate-300 mt-0.5">
                  {suppliesCount} Supplies
                </p>
                <span className="text-[11px] text-slate-500">Excluded Backroom</span>
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Interactive Business Rules & Defaults Form */}
        <section
          aria-label="Business Rules and Defaults Configuration"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6"
        >
          {/* Size & Recipe Matrix (7 cols) */}
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
              <div>
                <h2 className="text-base font-bold text-white">
                  Size &amp; Recipe Matrix
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure active cup sizes, default espresso shot pulls, and standard flavor syrup pumps per size.
                </p>
              </div>
              <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-full">
                Drive-Thru Baseline
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/90 text-slate-400 font-mono uppercase text-[11px] border-b border-slate-800">
                    <th className="py-2.5 px-3">Active</th>
                    <th className="py-2.5 px-3">Cup Size</th>
                    <th className="py-2.5 px-3">Default Espresso Shots</th>
                    <th className="py-2.5 px-3">Default Syrup Pumps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {sizeMatrix.map((row) => (
                    <tr
                      key={row.size}
                      className={`transition ${
                        row.enabled ? "bg-slate-900/50" : "bg-slate-950/50 opacity-50"
                      }`}
                    >
                      <td className="py-3 px-3">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={() => toggleSizeEnabled(row.size)}
                          aria-label={`Enable ${row.size}`}
                          className="h-4 w-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-3">
                        <span className="px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 font-mono font-bold text-amber-400">
                          {row.size}
                        </span>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultShots",
                                row.defaultShots - 1
                              )
                            }
                            className="h-7 w-7 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono font-bold cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={12}
                            value={row.defaultShots}
                            onChange={(e) =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultShots",
                                Number(e.target.value || 0)
                              )
                            }
                            aria-label={`${row.size} default espresso shots`}
                            className="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-center font-mono text-white text-base sm:text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultShots",
                                row.defaultShots + 1
                              )
                            }
                            className="h-7 w-7 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono font-bold cursor-pointer"
                          >
                            +
                          </button>
                          <span className="text-[11px] text-slate-400 font-mono">
                            shots
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultSyrupPumps",
                                row.defaultSyrupPumps - 1
                              )
                            }
                            className="h-7 w-7 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono font-bold cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={16}
                            value={row.defaultSyrupPumps}
                            onChange={(e) =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultSyrupPumps",
                                Number(e.target.value || 0)
                              )
                            }
                            aria-label={`${row.size} default syrup pumps`}
                            className="w-14 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-center font-mono text-cyan-300 text-base sm:text-xs"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateSizeRuleNumber(
                                row.size,
                                "defaultSyrupPumps",
                                row.defaultSyrupPumps + 1
                              )
                            }
                            className="h-7 w-7 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono font-bold cursor-pointer"
                          >
                            +
                          </button>
                          <span className="text-[11px] text-slate-400 font-mono">
                            pumps
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Modifier Pricing Rules (5 cols) */}
          <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-5 shadow-lg">
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-4">
                <h2 className="text-base font-bold text-white">
                  Modifier Pricing Rules
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Set standard upcharge thresholds applied across your deduplicated modifier groups.
                </p>
              </div>

              {/* Rule 1: Dairy / Alt Milk Upcharge */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="rule-alt-milk"
                    className="text-xs font-bold text-white"
                  >
                    Dairy / Alt Milk Upcharge
                  </label>
                  <span className="text-xs font-mono text-amber-400 font-bold">
                    +${modifierPricing.altMilkUpchargeDollars.toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Applies to Oat, Almond, Coconut, Soy, and Breve substitutions.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <span className="text-xs font-mono text-slate-400">$</span>
                  <input
                    id="rule-alt-milk"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={modifierPricing.altMilkUpchargeDollars}
                    onChange={(e) =>
                      setModifierPricing((prev) => ({
                        ...prev,
                        altMilkUpchargeDollars: Math.max(
                          0,
                          Number(e.target.value || 0)
                        ),
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-base sm:text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Rule 2: Extra Shot Price */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="rule-extra-shot"
                    className="text-xs font-bold text-white"
                  >
                    Extra Shot Price
                  </label>
                  <span className="text-xs font-mono text-amber-400 font-bold">
                    +${modifierPricing.extraShotDollars.toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Per additional espresso shot or plant energy booster above recipe baseline.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <span className="text-xs font-mono text-slate-400">$</span>
                  <input
                    id="rule-extra-shot"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={modifierPricing.extraShotDollars}
                    onChange={(e) =>
                      setModifierPricing((prev) => ({
                        ...prev,
                        extraShotDollars: Math.max(0, Number(e.target.value || 0)),
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-base sm:text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {/* Rule 3: Flavor Syrup / Sauce Add-On */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="rule-syrup-addon"
                    className="text-xs font-bold text-white"
                  >
                    Flavor Syrup / Sauce Add-On
                  </label>
                  <span className="text-xs font-mono text-amber-400 font-bold">
                    +${modifierPricing.syrupSauceAddOnDollars.toFixed(2)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Applies to Torani syrups, Ghirardelli sauces, and flavor add-ons.
                </p>
                <div className="flex items-center space-x-2 pt-1">
                  <span className="text-xs font-mono text-slate-400">$</span>
                  <input
                    id="rule-syrup-addon"
                    type="number"
                    step="0.05"
                    min="0"
                    max="5"
                    value={modifierPricing.syrupSauceAddOnDollars}
                    onChange={(e) =>
                      setModifierPricing((prev) => ({
                        ...prev,
                        syrupSauceAddOnDollars: Math.max(
                          0,
                          Number(e.target.value || 0)
                        ),
                      }))
                    }
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-base sm:text-xs font-mono text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200">
              Tip: Click any drink tile in the POS Simulator below to test these pricing and shot rules live.
            </div>
          </div>
        </section>

        {/* Section 3: Live Register Layout Preview (Square vs Clover Toggle) */}
        <section
          aria-label="Live Register Layout Preview"
          className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6"
        >
          {/* Simulator Header & Toggle Switch */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <h2 className="text-lg font-bold text-white">
                  Live Register Layout Preview
                </h2>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Interactive hardware layout simulation. Tap any drink tile to inspect the deduplicated modifier pop-out sheet.
              </p>
            </div>

            {/* [Square Register] | [Clover POS] Toggle */}
            <div
              role="group"
              aria-label="POS Layout Mode Toggle"
              className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800"
            >
              <button
                type="button"
                onClick={() => setPosMode("square")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                  posMode === "square"
                    ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Square Register
              </button>
              <button
                type="button"
                onClick={() => setPosMode("clover")}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
                  posMode === "clover"
                    ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/20"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                Clover POS
              </button>
            </div>
          </div>

          {/* MODE A: SQUARE REGISTER (Top Category Pill Bar + 5x5 Tile Grid) */}
          {posMode === "square" && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl p-5 space-y-5">
              {/* Square Top Status & Category Pill Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  {categoriesList.map((cat) => {
                    const isSelected = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition cursor-pointer ${
                          isSelected
                            ? "bg-amber-500 text-slate-950 font-bold"
                            : "bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-600"
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Square Point of Sale &middot; 5×5 High-Velocity Grid
                </span>
              </div>

              {/* Square 5x5 Tile Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                {Array.from(
                  { length: Math.max(25, filteredPreviewItems.length) },
                  (_, idx) => {
                    const item = filteredPreviewItems[idx];
                    if (!item) {
                      return (
                        <div
                          key={`empty_sq_${idx}`}
                          className="h-24 rounded-xl border border-dashed border-slate-800/60 bg-slate-900/20 flex items-center justify-center text-[11px] font-mono text-slate-600"
                        >
                          [Empty Slot]
                        </div>
                      );
                    }
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleOpenDrinkModal(item)}
                        className={`h-24 p-3 rounded-xl border text-left flex flex-col justify-between transition shadow-sm cursor-pointer ${getSquareTileAccent(
                          item.category,
                          item.isRetail
                        )}`}
                      >
                        <div>
                          <span className="text-[10px] font-mono uppercase opacity-75 block truncate">
                            {item.category}
                          </span>
                          <p className="text-xs font-bold leading-snug line-clamp-2 mt-0.5">
                            {item.name}
                          </p>
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-xs font-mono font-extrabold">
                            ${item.basePrice.toFixed(2)}
                          </span>
                          <span className="text-[10px] font-mono opacity-75">
                            Mods →
                          </span>
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            </div>
          )}

          {/* MODE B: CLOVER POS (Left Category Sidebar + Right Panel Item Grid) */}
          {posMode === "clover" && (
            <div className="bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden grid grid-cols-1 md:grid-cols-12 min-h-[420px]">
              {/* Clover Left Sidebar */}
              <div className="md:col-span-3 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-900/60 p-4 space-y-2">
                <div className="pb-2 mb-2 border-b border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] font-mono uppercase text-emerald-400 font-bold">
                    Clover Categories
                  </span>
                  <span className="text-[10px] font-mono text-slate-500">
                    {categoriesList.length} Groups
                  </span>
                </div>

                {categoriesList.map((cat) => {
                  const isSelected = selectedCategory === cat;
                  const count =
                    cat === "All Items"
                      ? previewItems.length
                      : previewItems.filter((i) => i.category === cat).length;

                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-between transition cursor-pointer ${
                        isSelected
                          ? "bg-emerald-500 text-slate-950 font-bold shadow-md shadow-emerald-500/20"
                          : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800/80"
                      }`}
                    >
                      <span className="truncate pr-2">{cat}</span>
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                          isSelected
                            ? "bg-slate-950 text-emerald-400"
                            : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Clover Right Item Selection Panel */}
              <div className="md:col-span-9 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <span className="text-xs font-bold text-white">
                    {selectedCategory} ({filteredPreviewItems.length} Items)
                  </span>
                  <span className="text-[11px] font-mono text-emerald-400">
                    Clover Station Duo Register View
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {Array.from(
                    { length: Math.max(16, filteredPreviewItems.length) },
                    (_, idx) => {
                      const item = filteredPreviewItems[idx];
                      if (!item) {
                        return (
                          <div
                            key={`empty_clv_${idx}`}
                            className="h-24 rounded-xl border border-dashed border-slate-800/60 bg-slate-900/20 flex items-center justify-center text-[11px] font-mono text-slate-600"
                          >
                            [Empty Slot]
                          </div>
                        );
                      }
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleOpenDrinkModal(item)}
                          className="h-24 p-3.5 rounded-xl bg-slate-900 hover:bg-slate-800/90 border-l-4 border-l-emerald-500 border border-slate-800 hover:border-emerald-500/50 text-left flex flex-col justify-between transition cursor-pointer"
                        >
                          <div>
                            <p className="text-xs font-bold text-white line-clamp-2">
                              {item.name}
                            </p>
                            <span className="text-[10px] font-mono text-slate-400">
                              {item.category}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-emerald-400">
                              ${item.basePrice.toFixed(2)}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              Customize
                            </span>
                          </div>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Modifier Pop-Out Sheet Modal */}
      {activeDrinkModal && activeModalComputation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Customize ${activeDrinkModal.name}`}
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActiveDrinkModal(null)}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/30">
                    {posMode === "square" ? "Square Register" : "Clover POS"} Modifier Sheet
                  </span>
                  <span className="text-xs font-mono text-slate-400">
                    {activeDrinkModal.category}
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-white mt-1">
                  {activeDrinkModal.name}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setActiveDrinkModal(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 cursor-pointer"
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Cup Size & Recipe Bar */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase text-slate-400">
                    1. Select Cup Size &amp; Auto-Applied Recipe
                  </span>
                  <span className="text-xs font-mono text-amber-400">
                    Recipe: {activeModalComputation.sizeRule.defaultShots} Shots &middot;{" "}
                    {activeModalComputation.sizeRule.defaultSyrupPumps} Syrup Pumps
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {sizeMatrix
                    .filter((s) => s.enabled)
                    .map((s) => {
                      const isSelected = selectedModalSize === s.size;
                      return (
                        <button
                          key={s.size}
                          type="button"
                          onClick={() => setSelectedModalSize(s.size)}
                          className={`p-2.5 rounded-xl border text-center transition cursor-pointer ${
                            isSelected
                              ? "bg-amber-500 text-slate-950 border-amber-400 font-bold"
                              : "bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-600"
                          }`}
                        >
                          <div className="text-xs font-mono font-bold">{s.size}</div>
                          <div className="text-[10px] font-mono opacity-80 mt-0.5">
                            {s.defaultShots}sh / {s.defaultSyrupPumps}p
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Extra Espresso Shots Counter */}
              <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-bold text-white">
                    Extra Espresso Shots (+${modifierPricing.extraShotDollars.toFixed(2)}/ea)
                  </span>
                  <p className="text-[11px] text-slate-400">
                    Base {selectedModalSize} includes{" "}
                    {activeModalComputation.sizeRule.defaultShots} standard shots.
                  </p>
                </div>
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() =>
                      setExtraShotsCount((c) => Math.max(0, c - 1))
                    }
                    className="h-8 w-8 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono font-bold cursor-pointer"
                  >
                    -
                  </button>
                  <span className="text-sm font-mono font-bold text-amber-400 w-6 text-center">
                    +{extraShotsCount}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExtraShotsCount((c) => c + 1)}
                    className="h-8 w-8 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono font-bold cursor-pointer"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Deduplicated Modifier Groups (Dairy Options, Syrups, Energy & Boosters, Sauces) */}
              <div className="space-y-5">
                {deduplicatedModifierGroups.map((group) => (
                  <div key={group.groupLabel} className="space-y-2.5">
                    <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
                      <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                        {group.groupLabel}
                      </span>
                      <span className="text-xs font-mono text-amber-400">
                        +${group.upchargePrice.toFixed(2)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {group.options.map((optName) => {
                        const isPicked = selectedModalMods.includes(optName);
                        return (
                          <button
                            key={optName}
                            type="button"
                            onClick={() => toggleModalModifier(optName)}
                            className={`px-3 py-2 rounded-xl border text-left text-xs flex items-center justify-between transition cursor-pointer ${
                              isPicked
                                ? "bg-amber-500/20 border-amber-400 text-amber-200 font-bold"
                                : "bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700"
                            }`}
                          >
                            <span className="truncate pr-2">{optName}</span>
                            <span className="text-[10px] font-mono text-amber-400 shrink-0">
                              {isPicked
                                ? "✓"
                                : `+$${group.upchargePrice.toFixed(2)}`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer Ticket Summary */}
            <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="text-xs font-mono text-slate-400">
                <span>
                  Base ({selectedModalSize}):{" "}
                  <strong className="text-white">
                    ${activeModalComputation.baseSizePrice.toFixed(2)}
                  </strong>
                </span>
                <span className="mx-2">+</span>
                <span>
                  Modifiers:{" "}
                  <strong className="text-amber-400">
                    ${activeModalComputation.modifiersUpcharge.toFixed(2)}
                  </strong>
                </span>
              </div>

              <div className="flex items-center space-x-3">
                <span className="text-sm font-mono font-extrabold text-emerald-400">
                  Ticket Total: ${activeModalComputation.totalPrice.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveDrinkModal(null)}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Session Manager Modal / Drawer */}
      {isSessionDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="rules-session-archive-drawer-title"
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
                  id="rules-session-archive-drawer-title"
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
                    resolvedSlug &&
                    resolvedSlug !== "unassigned" &&
                    resolvedSlug === session.storeProfile.merchantSlug;

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
                            handleLoadSavedSession(session, "/onboard/rules")
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                        >
                          Load Business (Step 2)
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleLoadSavedSession(session, "/onboard/intake")
                          }
                          className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                        >
                          ← Load in Step 1 (Intake)
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

      {/* Sticky Footer Progression */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-6 py-3.5 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/onboard/intake"
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition flex items-center space-x-2"
          >
            <span>← Back to Step 1: Document Intake</span>
          </Link>

          <div className="hidden md:flex items-center space-x-3 text-xs font-mono text-slate-400">
            <span>
              Tenant: <strong className="text-amber-400">{resolvedSlug}</strong>
            </span>
            <span>&middot;</span>
            <span>
              Active Sizes:{" "}
              <strong className="text-white">
                {sizeMatrix.filter((s) => s.enabled).length}
              </strong>
            </span>
            <span>&middot;</span>
            <span>
              Layout:{" "}
              <strong className="text-emerald-400 uppercase">{posMode}</strong>
            </span>
          </div>

          <button
            type="button"
            onClick={handleSaveRulesAndContinue}
            className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
          >
            <span>Save Rules &amp; Continue to Step 3: POS Connect →</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
