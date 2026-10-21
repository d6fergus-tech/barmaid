"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  INTAKE_STAGE_STORAGE_KEY,
  toSlug,
  type IntakeStageData,
} from "@/app/onboard/intake/page";

export default function OnboardingRulesStepPage() {
  const router = useRouter();
  const [stageData, setStageData] = useState<IntakeStageData | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as IntakeStageData;
        setStageData(parsed);
      }
    } catch {
      // Ignore storage parse errors
    } finally {
      setLoaded(true);
    }
  }, []);

  const storeProfile = stageData?.storeProfile;
  const resolvedSlug =
    storeProfile?.merchantSlug ||
    toSlug(storeProfile?.dbaName || storeProfile?.legalName || "") ||
    "unassigned";

  const drinksCount =
    stageData?.stagedCounts?.drinksCount ??
    stageData?.stagedItems?.filter((d) => d.included).length ??
    0;
  const modifiersCount =
    stageData?.stagedCounts?.modifiersCount ??
    stageData?.modifiers?.filter((m) => m.included).length ??
    0;
  const retailCount =
    stageData?.stagedCounts?.retailCount ??
    stageData?.retailItems?.filter((r) => r.included).length ??
    0;
  const suppliesCount =
    stageData?.stagedCounts?.suppliesCount ??
    stageData?.supplies?.filter((s) => !s.included).length ??
    0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Onboarding Wizard Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-50 px-6 py-4">
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
                Guided Business Rules &amp; Regional Sizing Heuristics
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

            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-500">
              <span className="h-5 w-5 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center text-[11px] font-mono">
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

      {/* Main Content */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Step 2: Business Rules &amp; Sizing
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Confirm regional cup size defaults, espresso shot recipes, and modifier upcharge thresholds for your staged intake catalog.
            </p>
          </div>

          <button
            type="button"
            onClick={() => router.push("/onboard/intake")}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
          >
            ← Back to Step 1: Document Intake
          </button>
        </div>

        {!loaded ? (
          <div className="p-8 rounded-2xl bg-slate-900 border border-slate-800 text-center text-xs text-slate-400">
            Loading staged intake payload...
          </div>
        ) : (
          <>
            {/* Confirmed Merchant Identity */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-base font-bold text-white">
                  Confirmed Merchant Identity
                </h2>
                <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2.5 py-0.5 rounded-full">
                  barmaid_intake_stage Hydrated
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-500">
                    DBA / Trade Name
                  </span>
                  <p className="text-sm font-bold text-white mt-1">
                    {storeProfile?.dbaName || storeProfile?.legalName || "—"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {storeProfile?.legalName || "—"}
                  </p>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-500">
                    Tenant Scope (merchant_slug)
                  </span>
                  <p className="text-sm font-bold text-amber-400 font-mono mt-1">
                    {resolvedSlug}
                  </p>
                  <p className="text-[11px] text-emerald-400 mt-0.5">
                    Multi-Tenant Isolated
                  </p>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3.5">
                  <span className="text-[10px] font-mono uppercase text-slate-500">
                    Location Address
                  </span>
                  <p className="text-sm font-bold text-white mt-1">
                    {storeProfile?.streetAddress || "—"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {[
                      storeProfile?.city,
                      storeProfile?.state,
                      storeProfile?.zipCode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "—"}
                  </p>
                </div>
              </div>
            </div>

            {/* Received Staged Catalog Counts */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-white">
                  Received Staged Catalog Counts
                </h2>
                {stageData?.uploadedFileNames && (
                  <span className="text-xs font-mono text-slate-400">
                    Files:{" "}
                    {(stageData.uploadedFileNames.license?.length || 0) +
                      (stageData.uploadedFileNames.menus?.length || 0) +
                      (stageData.uploadedFileNames.invoices?.length || 0)}{" "}
                    uploaded
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                  <span className="text-[11px] font-mono uppercase text-cyan-400">
                    Staged Drinks
                  </span>
                  <p className="text-2xl font-extrabold text-white mt-1">
                    {drinksCount}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    From Menu Boards
                  </span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                  <span className="text-[11px] font-mono uppercase text-amber-400">
                    Modifier Options
                  </span>
                  <p className="text-2xl font-extrabold text-white mt-1">
                    {modifiersCount}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Syrups, Sauces &amp; Milks
                  </span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                  <span className="text-[11px] font-mono uppercase text-emerald-400">
                    Retail SKUs
                  </span>
                  <p className="text-2xl font-extrabold text-white mt-1">
                    {retailCount}
                  </p>
                  <span className="text-[11px] text-slate-400">
                    Whole Bean &amp; RTD
                  </span>
                </div>

                <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
                  <span className="text-[11px] font-mono uppercase text-slate-400">
                    Excluded Supplies
                  </span>
                  <p className="text-2xl font-extrabold text-slate-300 mt-1">
                    {suppliesCount}
                  </p>
                  <span className="text-[11px] text-slate-500">
                    Backroom Disposables
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
