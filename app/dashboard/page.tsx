"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
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
  exportSingleSessionJson,
  type IntakeStageData,
  type OnboardingSession,
} from "@/app/onboard/intake/page";
import {
  RULES_CONFIG_STORAGE_KEY,
  type BusinessRulesConfig,
} from "@/app/onboard/rules/page";
import {
  getPosAuthStorageKey,
  type PosAuthRecord,
} from "@/app/onboard/connect/page";

export default function BarMaidMasterDashboardPage() {
  const router = useRouter();

  const [savedSessions, setSavedSessions] = useState<OnboardingSession[]>([]);
  const [stageData, setStageData] = useState<IntakeStageData | null>(null);
  const [rulesConfig, setRulesConfig] = useState<BusinessRulesConfig | null>(
    null
  );
  const [posMap, setPosMap] = useState<Record<string, PosAuthRecord>>({});
  const [loaded, setLoaded] = useState<boolean>(false);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState<boolean>(false);

  const loadPosMapForSlugs = useCallback(
    (slugs: string[]): Record<string, PosAuthRecord> => {
      if (typeof window === "undefined") return {};
      const nextMap: Record<string, PosAuthRecord> = {};
      slugs.forEach((slug) => {
        if (!slug || slug === "unassigned") return;
        const authKey = getPosAuthStorageKey(slug);
        const rawAuth =
          localStorage.getItem(authKey) || sessionStorage.getItem(authKey);
        if (rawAuth) {
          try {
            nextMap[slug] = JSON.parse(rawAuth) as PosAuthRecord;
          } catch {
            // Ignore malformed auth entry
          }
        }
      });
      return nextMap;
    },
    []
  );

  const hydrateDashboardState = useCallback(() => {
    try {
      let currentSessions = readSavedSessionsFromStorage();

      const rawStage =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      let parsedStage: IntakeStageData | null = null;
      if (rawStage) {
        parsedStage = JSON.parse(rawStage) as IntakeStageData;
        setStageData(parsedStage);

        if (
          parsedStage.storeProfile?.merchantSlug ||
          parsedStage.storeProfile?.dbaName ||
          parsedStage.storeProfile?.legalName
        ) {
          currentSessions = upsertSessionInArchive(parsedStage);
        }
      } else {
        setStageData(null);
      }

      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);
      if (rawRules) {
        setRulesConfig(JSON.parse(rawRules) as BusinessRulesConfig);
      } else {
        setRulesConfig(null);
      }

      setSavedSessions(currentSessions);

      const activeSlug =
        parsedStage?.storeProfile?.merchantSlug ||
        toSlug(
          parsedStage?.storeProfile?.dbaName ||
            parsedStage?.storeProfile?.legalName ||
            ""
        ) ||
        "unassigned";

      const allSlugs = Array.from(
        new Set([
          activeSlug,
          ...currentSessions.map(
            (s) => s.storeProfile.merchantSlug || s.id || ""
          ),
        ])
      );
      setPosMap(loadPosMapForSlugs(allSlugs));
    } catch {
      // Ignore storage read errors
    } finally {
      setLoaded(true);
    }
  }, [loadPosMapForSlugs]);

  useEffect(() => {
    hydrateDashboardState();
  }, [hydrateDashboardState]);

  // Active Store Identity & Counts
  const activeSlug =
    stageData?.storeProfile?.merchantSlug ||
    rulesConfig?.merchant_slug ||
    toSlug(
      stageData?.storeProfile?.dbaName ||
        stageData?.storeProfile?.legalName ||
        ""
    ) ||
    "unassigned";

  const activeDba =
    stageData?.storeProfile?.dbaName ||
    stageData?.storeProfile?.legalName ||
    (activeSlug !== "unassigned" ? activeSlug : "Unassigned Stand");

  const activeLegal =
    stageData?.storeProfile?.legalName || "Pending License Verification";

  const activeAddressLine = useMemo(() => {
    if (!stageData?.storeProfile) return "No physical address staged yet";
    const { streetAddress, city, state, zipCode } = stageData.storeProfile;
    const parts = [streetAddress, city, state, zipCode].filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : "No physical address staged yet";
  }, [stageData]);

  const drinksCount =
    stageData?.stagedCounts?.drinksCount ??
    (stageData?.stagedItems?.filter((d) => d.included !== false).length ?? 0);
  const modifiersCount =
    stageData?.stagedCounts?.modifiersCount ??
    (stageData?.modifiers?.filter((m) => m.included !== false).length ?? 0);
  const retailCount =
    stageData?.stagedCounts?.retailCount ??
    (stageData?.retailItems?.filter((r) => r.included !== false).length ?? 0);
  const suppliesCount =
    stageData?.stagedCounts?.suppliesCount ??
    (stageData?.supplies?.filter((s) => !s.included).length ?? 0);
  const totalActivePosObjects = drinksCount + modifiersCount + retailCount;

  const enabledSizesCount =
    rulesConfig?.sizeMatrix?.filter((s) => s.enabled).length ??
    (activeSlug !== "unassigned" && totalActivePosObjects > 0 ? 6 : 0);

  const activePosAuth =
    activeSlug !== "unassigned" ? posMap[activeSlug] || null : null;

  const uploadedDocsCount =
    (stageData?.uploadedFileNames?.license?.length || 0) +
    (stageData?.uploadedFileNames?.menus?.length || 0) +
    (stageData?.uploadedFileNames?.invoices?.length || 0);

  // Separate background folders from the front active folder
  const backgroundSessions = useMemo(
    () =>
      savedSessions.filter((s) => {
        const slug = s.storeProfile.merchantSlug || s.id;
        return slug !== activeSlug;
      }),
    [savedSessions, activeSlug]
  );

  const activeSessionRecord = useMemo(
    () =>
      savedSessions.find((s) => {
        const slug = s.storeProfile.merchantSlug || s.id;
        return slug === activeSlug;
      }) || null,
    [savedSessions, activeSlug]
  );

  // Swap a saved client folder to front active
  const handleSelectClientFolder = (session: OnboardingSession) => {
    const restoredStage = restoreSessionToActiveStage(session);
    setStageData(restoredStage);

    if (session.rulesConfig) {
      setRulesConfig(session.rulesConfig);
    } else {
      setRulesConfig(null);
    }

    const slug =
      restoredStage.storeProfile.merchantSlug ||
      session.storeProfile.merchantSlug ||
      session.id;

    setPosMap((prev) => ({
      ...prev,
      ...loadPosMapForSlugs([slug]),
    }));

    setStatusBanner(
      `Switched active client folder to "${
        restoredStage.storeProfile.dbaName ||
        restoredStage.storeProfile.legalName ||
        slug
      }" (${slug}).`
    );
  };

  // + New Client Folder Tab action: wipes active working state clean (unassigned, 0 counts) and links to /onboard/intake
  const handleCreateNewClientFolder = () => {
    if (
      stageData &&
      activeSlug &&
      activeSlug !== "unassigned" &&
      (stageData.storeProfile.dbaName ||
        stageData.storeProfile.legalName ||
        totalActivePosObjects > 0)
    ) {
      const updated = upsertSessionInArchive(stageData);
      setSavedSessions(updated);
    }

    clearActiveStageAndRulesFromStorage();
    setStageData(null);
    setRulesConfig(null);
    router.push("/onboard/intake");
  };

  // Delete an individual client folder
  const handleDeleteClientFolder = (slugOrId: string, displayName: string) => {
    const updated = deleteSessionFromArchive(slugOrId);
    setSavedSessions(updated);

    if (slugOrId === activeSlug) {
      clearActiveStageAndRulesFromStorage();
      setStageData(null);
      setRulesConfig(null);
      setStatusBanner(
        `Deleted active client folder "${displayName}" (${slugOrId}) and reset workspace to unassigned.`
      );
    } else {
      setStatusBanner(`Deleted client folder "${displayName}" (${slugOrId}).`);
    }
  };

  // Export an individual client folder JSON
  const handleExportSingleFolder = (session: OnboardingSession) => {
    exportSingleSessionJson(session);
    const label =
      session.storeProfile.dbaName ||
      session.storeProfile.legalName ||
      session.storeProfile.merchantSlug;
    setStatusBanner(`Exported JSON backup for "${label}".`);
  };

  // Export active folder even if not yet in savedSessions
  const handleExportActiveFolder = () => {
    if (activeSessionRecord) {
      handleExportSingleFolder(activeSessionRecord);
      return;
    }
    if (!stageData) return;
    const updated = upsertSessionInArchive(stageData);
    setSavedSessions(updated);
    const created = updated[0];
    if (created) {
      handleExportSingleFolder(created);
    }
  };

  const handlePurgeAllFolders = () => {
    purgeAllSessionsFromArchive();
    clearActiveStageAndRulesFromStorage();
    setSavedSessions([]);
    setStageData(null);
    setRulesConfig(null);
    setConfirmPurgeAll(false);
    setStatusBanner("All client folders and active staging state purged.");
  };

  const hubCards = [
    {
      stepNumber: "01",
      title: "Document & Menu Intake",
      href: "/onboard/intake",
      badgeText:
        totalActivePosObjects > 0
          ? `${totalActivePosObjects} Staged Objects`
          : "Ready for Upload",
      badgeClass:
        totalActivePosObjects > 0
          ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/40"
          : "bg-slate-800 text-slate-300 border-slate-700",
      description:
        "Multi-source OCR for business licenses, walk-up menu boards, and vendor packing slips (Dillanos, Torani, Big Train).",
      metrics: [
        { label: "Drinks & Food", value: `${drinksCount}` },
        { label: "Modifiers", value: `${modifiersCount}` },
        { label: "Retail SKUs", value: `${retailCount}` },
        { label: "Supplies Filtered", value: `${suppliesCount}` },
      ],
      ctaLabel: "Open Document Intake →",
    },
    {
      stepNumber: "02",
      title: "Business Rules & Recipe Matrix",
      href: "/onboard/rules",
      badgeText:
        enabledSizesCount > 0
          ? `${enabledSizesCount} Cup Sizes Active`
          : "0 Sizes Configured",
      badgeClass:
        enabledSizesCount > 0
          ? "bg-amber-500/15 text-amber-300 border-amber-500/40"
          : "bg-slate-800 text-slate-400 border-slate-700",
      description:
        "Configure cup size defaults (8oz–32oz), espresso shot/syrup recipes, modifier upcharges, and test on the live Square/Clover simulator.",
      metrics: [
        { label: "Enabled Sizes", value: `${enabledSizesCount} Cups` },
        {
          label: "Alt Milk Upcharge",
          value: rulesConfig
            ? `+$${rulesConfig.modifierPricing.altMilkUpchargeDollars.toFixed(2)}`
            : "+$0.75",
        },
        {
          label: "Extra Shot",
          value: rulesConfig
            ? `+$${rulesConfig.modifierPricing.extraShotDollars.toFixed(2)}`
            : "+$0.75",
        },
        {
          label: "POS Simulator",
          value:
            rulesConfig?.preferredPosPreview === "clover"
              ? "Clover POS"
              : "Square POS",
        },
      ],
      ctaLabel: "Configure Business Rules →",
    },
    {
      stepNumber: "03",
      title: "Cloud POS Handshake",
      href: "/onboard/connect",
      badgeText: activePosAuth
        ? `${
            activePosAuth.provider === "clover" ? "Clover" : "Square"
          } Connected`
        : "Awaiting Handshake",
      badgeClass: activePosAuth
        ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/50"
        : "bg-amber-950/60 text-amber-300 border-amber-500/40",
      description:
        "Authorize Square Point of Sale or Clover REST v3 via Direct Bearer Token or Cloud OAuth to snapshot and reconcile live hardware catalogs.",
      metrics: [
        {
          label: "POS Provider",
          value: activePosAuth
            ? activePosAuth.provider.toUpperCase()
            : "Unlinked",
        },
        {
          label: "Cloud Objects",
          value: `${activePosAuth?.catalogSnapshot?.totalObjects ?? 0}`,
        },
        {
          label: "Live Items",
          value: `${activePosAuth?.catalogSnapshot?.itemsCount ?? 0}`,
        },
        {
          label: "Modifier Lists",
          value: `${activePosAuth?.catalogSnapshot?.modifierListsCount ?? 0}`,
        },
      ],
      ctaLabel: "Manage POS Connection →",
    },
    {
      stepNumber: "04",
      title: "5x4 Register Layout Studio",
      href: "/",
      badgeText:
        drinksCount + retailCount > 0
          ? `${drinksCount + retailCount} Grid Items`
          : "Empty Matrix",
      badgeClass:
        drinksCount + retailCount > 0
          ? "bg-cyan-950/80 text-cyan-300 border-cyan-500/40"
          : "bg-slate-800 text-slate-400 border-slate-700",
      description:
        "Arrange high-velocity drive-thru hotkeys across elastic 5×4 register pages with color-coded station zoning and modifier trays.",
      metrics: [
        {
          label: "Matrix Pages",
          value: `${Math.max(
            1,
            Math.ceil((drinksCount + retailCount + Math.min(12, modifiersCount)) / 20)
          )} Page(s)`,
        },
        { label: "Drink/Food Tiles", value: `${drinksCount}` },
        { label: "Retail Tiles", value: `${retailCount}` },
        { label: "Quick Modifiers", value: `${Math.min(12, modifiersCount)}` },
      ],
      ctaLabel: "Launch 5x4 Layout Studio →",
    },
    {
      stepNumber: "05",
      title: "Review & Canonical Sync",
      href: "/onboard/review",
      badgeText:
        activeSlug !== "unassigned" && totalActivePosObjects > 0
          ? "Ready to Sync"
          : "Awaiting Catalog",
      badgeClass:
        activeSlug !== "unassigned" && totalActivePosObjects > 0
          ? "bg-emerald-950/90 text-emerald-300 border-emerald-500/50"
          : "bg-slate-800 text-slate-400 border-slate-700",
      description:
        "Verify canonical catalog hygiene, execute batch upsert to Square/Clover Cloud POS, and publish normalized menu records to Supabase.",
      metrics: [
        { label: "Tenant Scope", value: activeSlug },
        { label: "Canonical Items", value: `${drinksCount + retailCount}` },
        { label: "Unified Mods", value: `${modifiersCount}` },
        {
          label: "Docs Ingested",
          value: `${uploadedDocsCount} File(s)`,
        },
      ],
      ctaLabel: "Open Review & Sync →",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-24">
      {/* Top Master Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center font-black text-slate-950 text-xl shadow-lg shadow-amber-500/20">
              B
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <span className="font-extrabold tracking-tight text-lg text-white">
                  BarMaid Command Center
                </span>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 font-mono border border-amber-500/30">
                  Master Hub
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Multi-Client POS Optimization &amp; Canonical Catalog Engine &middot; D6 Digital LLC
              </p>
            </div>
          </div>

          {/* Center Active Client Badge */}
          <div className="bg-slate-950 border border-slate-800 rounded-full px-4 py-1.5 flex items-center space-x-2.5 shadow-inner">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                activeSlug !== "unassigned"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-slate-600"
              }`}
            ></span>
            <span className="text-xs text-slate-400">Active Stand:</span>
            <span className="text-xs font-bold text-white">{activeDba}</span>
            <span className="text-xs font-mono text-amber-400">
              ({activeSlug})
            </span>
          </div>

          {/* Right Global Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCreateNewClientFolder}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold transition shadow-md shadow-amber-500/20 cursor-pointer"
            >
              + New Client Folder
            </button>

            {savedSessions.length > 0 && (
              <button
                type="button"
                onClick={() => exportAllSessionsJson(savedSessions)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
              >
                Export All ({savedSessions.length})
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-10">
        {statusBanner && (
          <div className="p-3.5 rounded-xl bg-slate-900/95 border border-amber-500/40 flex items-center justify-between gap-4">
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

        {/* SECTION 1: LAYERED CLIENT FOLDERS SYSTEM */}
        <section aria-label="Layered Client Folders Stack" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                Multi-Tenant Filing System
              </span>
              <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
                Layered Client Folders ({savedSessions.length} Saved)
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Select any stand tab in the folder stack to bring its catalog to the front workspace, or open a{" "}
                <strong className="text-amber-300">+ New Client Folder</strong> for a fresh field intake.
              </p>
            </div>

            {savedSessions.length > 0 && (
              <div className="flex items-center gap-2">
                {!confirmPurgeAll ? (
                  <button
                    type="button"
                    onClick={() => setConfirmPurgeAll(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/50 border border-slate-800 hover:border-rose-500/40 text-xs font-mono text-slate-400 hover:text-rose-300 transition cursor-pointer"
                  >
                    Purge All Folders
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-rose-950/50 border border-rose-500/50 rounded-xl px-3 py-1.5">
                    <span className="text-xs text-rose-200 font-semibold">
                      Confirm Master Purge?
                    </span>
                    <button
                      type="button"
                      onClick={handlePurgeAllFolders}
                      className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                    >
                      Yes, Purge
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPurgeAll(false)}
                      className="px-2 py-1 text-xs text-slate-300 hover:text-white cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Interactive Folder Stack Container */}
          <div className="pt-2">
            {/* Folder Index Tabs Row (Active Tab + Background Stand Tabs + '+ New Client Folder' Tab) */}
            <div className="flex flex-wrap items-end gap-1.5 px-2">
              {/* Active Front Folder Tab */}
              <div className="relative z-20 -mb-px px-4 py-2.5 rounded-t-2xl bg-slate-900 border-t-2 border-x border-t-amber-500 border-x-slate-700 text-amber-300 text-xs font-extrabold flex items-center space-x-2 shadow-lg">
                <span>📂</span>
                <span>{activeDba}</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-mono text-[10px]">
                  {activeSlug}
                </span>
              </div>

              {/* Stacked Background Tabs for Other Saved Client Stands */}
              {backgroundSessions.map((session, idx) => {
                const slug = session.storeProfile.merchantSlug || session.id;
                const tabName =
                  session.storeProfile.dbaName ||
                  session.storeProfile.legalName ||
                  slug;
                const totalItems =
                  session.counts.drinks +
                  session.counts.modifiers +
                  session.counts.retail;

                return (
                  <button
                    key={session.id || idx}
                    type="button"
                    onClick={() => handleSelectClientFolder(session)}
                    title={`Bring ${tabName} (${slug}) to front`}
                    className="relative z-10 px-4 py-2 rounded-t-xl bg-slate-950/90 hover:bg-slate-800/90 border-t border-x border-slate-800 hover:border-amber-500/40 text-slate-400 hover:text-slate-100 text-xs font-semibold transition-all duration-150 flex items-center space-x-2 cursor-pointer translate-y-0.5 hover:translate-y-0"
                  >
                    <span>📁</span>
                    <span className="truncate max-w-[160px]">{tabName}</span>
                    <span className="text-[10px] font-mono text-slate-500">
                      ({totalItems})
                    </span>
                  </button>
                );
              })}

              {/* '+ New Client Folder' Tab */}
              <button
                type="button"
                onClick={handleCreateNewClientFolder}
                className="relative z-10 px-4 py-2 rounded-t-xl bg-amber-950/30 hover:bg-amber-500/20 border-t border-x border-dashed border-amber-500/50 text-amber-300 hover:text-amber-200 text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer ml-1"
              >
                <span>+ New Client Folder</span>
              </button>
            </div>

            {/* Layered Visual Stack Behind Front Folder */}
            <div className="relative">
              {backgroundSessions.length > 0 && (
                <div
                  aria-hidden="true"
                  className="absolute -top-1.5 inset-x-3 h-6 rounded-t-2xl bg-slate-900/60 border border-slate-800/80 z-0"
                ></div>
              )}

              {/* Front Active Folder Card */}
              <div className="relative z-10 bg-slate-900 border border-slate-700/90 rounded-b-2xl rounded-tr-2xl p-6 shadow-2xl space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-mono font-black uppercase tracking-wider">
                        Active Front Folder
                      </span>
                      <span className="text-xs font-mono text-amber-400 bg-slate-950 border border-slate-800 px-2.5 py-0.5 rounded-full">
                        merchant_slug: {activeSlug}
                      </span>
                      {activePosAuth ? (
                        <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs font-bold flex items-center space-x-1.5">
                          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                          <span>
                            {activePosAuth.provider === "clover"
                              ? "Clover POS Connected"
                              : "Square POS Connected"}
                          </span>
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-slate-400 text-xs font-mono">
                          POS: Awaiting Handshake
                        </span>
                      )}
                    </div>

                    <h2 className="text-2xl font-extrabold text-white tracking-tight">
                      {activeDba}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
                      <span>
                        <strong className="text-slate-300">Legal Entity:</strong>{" "}
                        {activeLegal}
                      </span>
                      <span>
                        <strong className="text-slate-300">Address:</strong>{" "}
                        {activeAddressLine}
                      </span>
                    </div>
                  </div>

                  {/* Direct Jump Buttons & Folder Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/onboard/intake"
                      className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition shadow-md shadow-amber-500/20"
                    >
                      Jump to Intake →
                    </Link>
                    <Link
                      href="/"
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-amber-500/40 text-amber-300 font-bold text-xs transition"
                    >
                      Jump to 5x4 Studio →
                    </Link>

                    {activeSlug !== "unassigned" && (
                      <>
                        <button
                          type="button"
                          onClick={handleExportActiveFolder}
                          className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-white text-xs font-mono transition cursor-pointer"
                        >
                          Export JSON
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleDeleteClientFolder(activeSlug, activeDba)
                          }
                          className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 text-xs font-mono transition cursor-pointer"
                        >
                          Delete Folder
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Staged Catalog Counts inside Active Front Folder */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4">
                    <span className="text-[10px] font-mono uppercase text-cyan-400">
                      Drinks &amp; Food
                    </span>
                    <p className="text-2xl font-black text-white mt-1">
                      {drinksCount}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      Staged menu items
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4">
                    <span className="text-[10px] font-mono uppercase text-amber-400">
                      Modifiers
                    </span>
                    <p className="text-2xl font-black text-white mt-1">
                      {modifiersCount}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      Syrups, milks &amp; boosts
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4">
                    <span className="text-[10px] font-mono uppercase text-emerald-400">
                      Retail SKUs
                    </span>
                    <p className="text-2xl font-black text-white mt-1">
                      {retailCount}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      Bagged beans &amp; merch
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-4">
                    <span className="text-[10px] font-mono uppercase text-slate-400">
                      Operational Supplies
                    </span>
                    <p className="text-2xl font-black text-slate-300 mt-1">
                      {suppliesCount}
                    </p>
                    <span className="text-[11px] text-slate-500">
                      Excluded backroom items
                    </span>
                  </div>
                </div>

                {/* Stacked Background Folders Drawer / List with Individual Export & Delete Controls */}
                {backgroundSessions.length > 0 && (
                  <div className="pt-4 border-t border-slate-800/80 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-400 font-mono">
                        Other Saved Client Folders in Stack ({backgroundSessions.length})
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Click any folder to swap into the active workspace
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {backgroundSessions.map((session) => {
                        const slug =
                          session.storeProfile.merchantSlug || session.id;
                        const dba =
                          session.storeProfile.dbaName ||
                          session.storeProfile.legalName ||
                          slug;
                        const legal =
                          session.storeProfile.legalName || "Unverified Entity";
                        const sessionPos = posMap[slug];

                        return (
                          <div
                            key={session.id}
                            className="bg-slate-950/90 border border-slate-800 hover:border-amber-500/40 rounded-xl p-4 flex flex-col justify-between gap-3 transition"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="text-sm font-bold text-white">
                                    {dba}
                                  </span>
                                  <span className="text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                                    {slug}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                  Legal: {legal}
                                </p>
                              </div>

                              <span
                                className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${
                                  sessionPos
                                    ? "bg-emerald-950 text-emerald-300 border border-emerald-700/50"
                                    : "bg-slate-900 text-slate-500 border border-slate-800"
                                }`}
                              >
                                {sessionPos
                                  ? `${sessionPos.provider.toUpperCase()} Linked`
                                  : "No POS Token"}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                                {session.counts.drinks} Drinks
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                                {session.counts.modifiers} Mods
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">
                                {session.counts.retail} Retail
                              </span>
                              <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                                {session.counts.supplies} Supplies
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-900">
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectClientFolder(session)
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                                >
                                  Make Active
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectClientFolder(session);
                                    router.push("/onboard/intake");
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
                                >
                                  Intake
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleSelectClientFolder(session);
                                    router.push("/");
                                  }}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-300 text-xs font-semibold transition cursor-pointer"
                                >
                                  Studio
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleExportSingleFolder(session)
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-[11px] font-mono transition cursor-pointer"
                                >
                                  Export JSON
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteClientFolder(slug, dba)
                                  }
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-300 text-[11px] font-mono transition cursor-pointer"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: HUB NAVIGATION CARDS */}
        <section aria-label="Pipeline Hub Navigation Cards" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400">
                End-to-End POS Pipeline
              </span>
              <h2 className="text-xl font-bold text-white mt-0.5">
                Workspace Modules for {activeDba} ({activeSlug})
              </h2>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {loaded ? "Live LocalStorage State Synchronized" : "Hydrating..."}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {hubCards.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                className="group bg-slate-900 hover:bg-slate-900/95 border border-slate-800 hover:border-amber-500/60 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition-all duration-150 shadow-lg hover:shadow-amber-500/5"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono font-bold text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 rounded-lg">
                      Module {card.stepNumber}
                    </span>
                    <span
                      className={`text-[11px] font-mono font-semibold px-2.5 py-0.5 rounded-full border ${card.badgeClass}`}
                    >
                      {card.badgeText}
                    </span>
                  </div>

                  <h3 className="text-lg font-extrabold text-white group-hover:text-amber-300 transition">
                    {card.title}
                  </h3>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    {card.description}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800/80">
                    {card.metrics.map((m) => (
                      <div
                        key={m.label}
                        className="bg-slate-950/70 border border-slate-800/70 rounded-lg px-2.5 py-2"
                      >
                        <span className="block text-[10px] font-mono uppercase text-slate-500 truncate">
                          {m.label}
                        </span>
                        <span className="text-xs font-bold text-slate-200 font-mono truncate block mt-0.5">
                          {m.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="w-full py-2.5 px-4 rounded-xl bg-slate-950 group-hover:bg-amber-500 text-amber-400 group-hover:text-slate-950 border border-slate-800 group-hover:border-amber-400 text-xs font-bold transition flex items-center justify-between">
                    <span>{card.ctaLabel}</span>
                    <span>→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

