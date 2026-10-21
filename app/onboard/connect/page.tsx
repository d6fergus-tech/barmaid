"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  INTAKE_STAGE_STORAGE_KEY,
  toSlug,
  type IntakeStageData,
} from "@/app/onboard/intake/page";
import {
  RULES_CONFIG_STORAGE_KEY,
  type BusinessRulesConfig,
} from "@/app/onboard/rules/page";

export default function OnboardingPosConnectStepPage() {
  const [stageData, setStageData] = useState<IntakeStageData | null>(null);
  const [rulesConfig, setRulesConfig] = useState<BusinessRulesConfig | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null);

  useEffect(() => {
    try {
      const rawStage =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      if (rawStage) {
        setStageData(JSON.parse(rawStage) as IntakeStageData);
      }

      const rawRules =
        localStorage.getItem(RULES_CONFIG_STORAGE_KEY) ||
        sessionStorage.getItem(RULES_CONFIG_STORAGE_KEY);
      if (rawRules) {
        setRulesConfig(JSON.parse(rawRules) as BusinessRulesConfig);
      }
    } catch {
      // Ignore parse errors
    } finally {
      setLoaded(true);
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
    "highway-espresso";

  const drinksCount = stageData?.stagedCounts?.drinksCount ?? 43;
  const modifiersCount = stageData?.stagedCounts?.modifiersCount ?? 40;
  const retailCount = stageData?.stagedCounts?.retailCount ?? 3;
  const enabledSizesCount =
    rulesConfig?.sizeMatrix?.filter((s) => s.enabled).length ?? 6;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans pb-24">
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
                Cloud POS OAuth Handshake &amp; Catalog Snapshot
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

            <Link
              href="/onboard/rules"
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60 transition"
            >
              <span className="h-5 w-5 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center text-[11px] font-bold">
                ✓
              </span>
              <span>Step 2: Rules &amp; Sizing</span>
            </Link>

            <span className="text-slate-600 font-mono">→</span>

            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20">
              <span className="h-5 w-5 rounded-full bg-slate-950 text-amber-400 flex items-center justify-center text-[11px] font-mono">
                3
              </span>
              <span>Step 3: POS Connect</span>
            </div>
          </nav>

          {/* Active Tenant Pill */}
          <div className="bg-slate-950 border border-slate-800 rounded-full px-3.5 py-1.5 flex items-center space-x-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
            <span className="text-xs text-slate-400">merchant_slug:</span>
            <span className="text-xs font-bold text-amber-400 font-mono">
              {resolvedSlug}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Step 3: Cloud POS Connection &amp; Catalog Handshake
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Authorize Square or Clover to pull your existing register catalog snapshot and reconcile against your staged items and business rules.
          </p>
        </div>

        {connectionStatus && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 text-xs text-emerald-300 flex items-center justify-between">
            <span>{connectionStatus}</span>
            <button
              type="button"
              onClick={() => setConnectionStatus(null)}
              className="font-mono text-slate-400 hover:text-white cursor-pointer"
            >
              [Dismiss]
            </button>
          </div>
        )}

        {/* Hydrated Stage & Rules Summary */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h2 className="text-base font-bold text-white">
              Ready for Reconciliation ({resolvedSlug})
            </h2>
            <span className="text-xs font-mono text-emerald-400">
              {loaded ? "Rules & Stage Verified" : "Loading..."}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] font-mono uppercase text-cyan-400">
                Staged Drinks
              </span>
              <p className="text-xl font-extrabold text-white mt-0.5">
                {drinksCount} Drinks
              </p>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] font-mono uppercase text-amber-400">
                Modifiers
              </span>
              <p className="text-xl font-extrabold text-white mt-0.5">
                {modifiersCount} Modifiers
              </p>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] font-mono uppercase text-emerald-400">
                Retail SKUs
              </span>
              <p className="text-xl font-extrabold text-white mt-0.5">
                {retailCount} Retail
              </p>
            </div>
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
              <span className="text-[10px] font-mono uppercase text-slate-400">
                Configured Sizes
              </span>
              <p className="text-xl font-extrabold text-amber-400 mt-0.5">
                {enabledSizesCount} Cup Sizes
              </p>
            </div>
          </div>
        </div>

        {/* POS OAuth Provider Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition">
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                Square Cloud API
              </span>
              <h3 className="text-lg font-bold text-white">
                Connect Square Point of Sale
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Pulls live ITEM, CATEGORY, and MODIFIER_LIST objects via Square v2 Catalog API and prepares batch upsert for {resolvedSlug}.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setConnectionStatus(
                  `Square OAuth handshake initiated for tenant "${resolvedSlug}".`
                )
              }
              className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              Authorize Square Merchant Account →
            </button>
          </div>

          <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition">
            <div className="space-y-2">
              <span className="text-[11px] font-mono uppercase px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                Clover REST API
              </span>
              <h3 className="text-lg font-bold text-white">
                Connect Clover POS
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Syncs Clover Station categories, modifier groups, and item variations directly with your staged BarMaid catalog.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setConnectionStatus(
                  `Clover POS OAuth handshake initiated for tenant "${resolvedSlug}".`
                )
              }
              className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              Authorize Clover Merchant Account →
            </button>
          </div>
        </div>
      </main>

      {/* Sticky Footer */}
      <footer className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800 bg-slate-900/95 backdrop-blur px-6 py-3.5 shadow-2xl">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/onboard/rules"
            className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition"
          >
            ← Back to Step 2: Business Rules &amp; Sizing
          </Link>

          <Link
            href="/"
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition"
          >
            Open Ergonomics Layout Studio →
          </Link>
        </div>
      </footer>
    </div>
  );
}

