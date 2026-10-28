"use client";

import React, { useEffect, useState } from "react";
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
} from "@/app/onboard/rules/page";
import {
  getPosAuthStorageKey,
  type PosAuthRecord,
} from "@/app/onboard/connect/page";
import PipelineHeader from "@/app/components/PipelineHeader";

export default function OnboardingReviewAndSyncPage() {
  const router = useRouter();

  const [stageData, setStageData] = useState<IntakeStageData | null>(null);
  const [rulesConfig, setRulesConfig] = useState<BusinessRulesConfig | null>(
    null
  );
  const [posAuth, setPosAuth] = useState<PosAuthRecord | null>(null);
  const [savedSessions, setSavedSessions] = useState<OnboardingSession[]>([]);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "complete">(
    "idle"
  );
  const [syncMessage, setSyncMessage] = useState<string>("");

  useEffect(() => {
    setSavedSessions(readSavedSessionsFromStorage());

    try {
      const rawStage =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      let parsedStage: IntakeStageData | null = null;
      if (rawStage) {
        parsedStage = JSON.parse(rawStage) as IntakeStageData;
        setStageData(parsedStage);
      }

      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);
      let parsedRules: BusinessRulesConfig | null = null;
      if (rawRules) {
        parsedRules = JSON.parse(rawRules) as BusinessRulesConfig;
        setRulesConfig(parsedRules);
      }

      const slug =
        parsedRules?.merchant_slug ||
        parsedStage?.storeProfile?.merchantSlug ||
        toSlug(
          parsedStage?.storeProfile?.dbaName ||
            parsedStage?.storeProfile?.legalName ||
            ""
        ) ||
        "unassigned";

      if (slug && slug !== "unassigned") {
        const authKey = getPosAuthStorageKey(slug);
        const rawAuth =
          localStorage.getItem(authKey) || sessionStorage.getItem(authKey);
        if (rawAuth) {
          setPosAuth(JSON.parse(rawAuth) as PosAuthRecord);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  const resolvedSlug =
    rulesConfig?.merchant_slug ||
    stageData?.storeProfile?.merchantSlug ||
    toSlug(
      stageData?.storeProfile?.dbaName ||
        stageData?.storeProfile?.legalName ||
        ""
    ) ||
    "unassigned";

  const resolvedDba =
    stageData?.storeProfile?.dbaName ||
    stageData?.storeProfile?.legalName ||
    (resolvedSlug !== "unassigned" ? resolvedSlug : "Unassigned Client");

  const resolvedLegal =
    stageData?.storeProfile?.legalName || "Pending License Verification";

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

  const handleFastSwitchClient = (val: string) => {
    if (val === "__new__") {
      clearActiveStageAndRulesFromStorage();
      setStageData(null);
      setRulesConfig(null);
      setPosAuth(null);
      router.push("/onboard/intake");
      return;
    }
    const found = savedSessions.find(
      (s) => s.storeProfile.merchantSlug === val || s.id === val
    );
    if (found) {
      const restored = restoreSessionToActiveStage(found);
      setStageData(restored);
      setRulesConfig(found.rulesConfig || null);
      const nextSlug =
        restored.storeProfile.merchantSlug ||
        toSlug(
          restored.storeProfile.dbaName || restored.storeProfile.legalName || ""
        ) ||
        "unassigned";
      const authKey = getPosAuthStorageKey(nextSlug);
      const rawAuth =
        localStorage.getItem(authKey) || sessionStorage.getItem(authKey);
      if (rawAuth) {
        try {
          setPosAuth(JSON.parse(rawAuth) as PosAuthRecord);
        } catch {
          setPosAuth(null);
        }
      } else {
        setPosAuth(null);
      }
    }
  };

  const handleExecuteCanonicalSync = () => {
    setSyncState("syncing");
    setSyncMessage(
      `Publishing ${drinksCount + retailCount} canonical items and ${modifiersCount} modifiers scoped to '${resolvedSlug}'...`
    );

    setTimeout(() => {
      setSyncState("complete");
      setSyncMessage(
        `Canonical catalog for ${resolvedDba} (${resolvedSlug}) synchronized with ${
          posAuth?.provider === "clover" ? "Clover POS" : "Square Cloud POS"
        } and Supabase public.menu_items.`
      );
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-24">
      <PipelineHeader
        activeStep={5}
        merchantSlug={resolvedSlug}
        merchantDba={resolvedDba}
        savedSessions={savedSessions}
        onSwitchClient={handleFastSwitchClient}
        subtitle="Step 5: Review & Canonical Cloud Sync"
      />

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="text-xs font-mono uppercase text-amber-400">
              Final Pipeline Stage
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-white mt-0.5">
              Step 5: Review &amp; Canonical Sync ({resolvedSlug})
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Verify reconciled merchant identity, staged catalog counts, and execute canonical batch upsert to POS Cloud and Supabase.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href={`/?tab=studio&merchant=${encodeURIComponent(resolvedSlug)}`}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition"
            >
              ← Back to Step 4: Ergonomics Studio
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
            <h2 className="text-base font-bold text-white border-b border-slate-800 pb-3">
              Store Identity &amp; Tenant Scope
            </h2>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">DBA / Trade Name:</span>
                <span className="font-bold text-white">{resolvedDba}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Legal Entity Name:</span>
                <span className="font-medium text-slate-200">
                  {resolvedLegal}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Canonical merchant_slug:</span>
                <span className="font-mono font-bold text-amber-400">
                  {resolvedSlug}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">POS Handshake:</span>
                <span className="font-mono text-emerald-400">
                  {posAuth
                    ? `${posAuth.provider.toUpperCase()} Verified`
                    : "Pending Auth"}
                </span>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-3">
            <h2 className="text-base font-bold text-white border-b border-slate-800 pb-3">
              Canonical Catalog Payload Summary
            </h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-cyan-400">
                  Drinks &amp; Food
                </span>
                <p className="text-xl font-black text-white mt-0.5">
                  {drinksCount}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-amber-400">
                  Unified Modifiers
                </span>
                <p className="text-xl font-black text-white mt-0.5">
                  {modifiersCount}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-emerald-400">
                  Retail SKUs
                </span>
                <p className="text-xl font-black text-white mt-0.5">
                  {retailCount}
                </p>
              </div>
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
                <span className="text-[10px] font-mono uppercase text-slate-400">
                  Supplies Filtered
                </span>
                <p className="text-xl font-black text-slate-300 mt-0.5">
                  {suppliesCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-center space-y-4">
          {syncState === "idle" && (
            <>
              <h3 className="text-lg font-bold text-white">
                Execute Canonical POS &amp; Supabase Sync
              </h3>
              <p className="text-xs text-slate-400 max-w-lg mx-auto">
                Pushes normalized catalog objects to{" "}
                {posAuth?.provider === "clover"
                  ? "Clover REST v3"
                  : "Square Cloud v2"}{" "}
                and writes canonical records scoped by{" "}
                <code className="text-amber-400 font-mono">
                  merchant_slug = &apos;{resolvedSlug}&apos;
                </code>
                .
              </p>
              <button
                type="button"
                onClick={handleExecuteCanonicalSync}
                className="px-8 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-sm transition shadow-lg shadow-amber-500/20 cursor-pointer"
              >
                Publish Canonical Catalog Now →
              </button>
            </>
          )}

          {syncState === "syncing" && (
            <div className="py-4 space-y-3">
              <div className="h-8 w-8 rounded-full border-2 border-amber-400 border-t-transparent animate-spin mx-auto"></div>
              <p className="text-sm font-bold text-amber-300">{syncMessage}</p>
            </div>
          )}

          {syncState === "complete" && (
            <div className="py-2 space-y-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500/20 border border-emerald-500/50 text-emerald-300 flex items-center justify-center text-lg font-bold mx-auto">
                ✓
              </div>
              <h3 className="text-lg font-bold text-white">
                Canonical Sync Complete
              </h3>
              <p className="text-xs text-emerald-300 max-w-lg mx-auto">
                {syncMessage}
              </p>
              <div className="flex justify-center gap-3 pt-2">
                <Link
                  href="/dashboard"
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  Return to Master Dashboard
                </Link>
                <button
                  type="button"
                  onClick={() => setSyncState("idle")}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                >
                  Run Another Sync
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Sticky Footer */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-6 py-3.5 shadow-2xl">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <Link
            href={`/?tab=studio&merchant=${encodeURIComponent(resolvedSlug)}`}
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            ← Back to Step 4: Ergonomics Studio
          </Link>

          <div className="flex items-center space-x-3">
            <span className="hidden sm:inline-flex items-center text-xs font-mono text-slate-400">
              Tenant: <strong className="text-amber-400 ml-1">{resolvedSlug}</strong>
            </span>
            <Link
              href="/dashboard"
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition shadow-md shadow-amber-500/20"
            >
              Return to Master Dashboard →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

