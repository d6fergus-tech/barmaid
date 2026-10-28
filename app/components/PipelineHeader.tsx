"use client";

import React from "react";
import Link from "next/link";
import type { OnboardingSession } from "@/app/onboard/intake/page";

export type PipelineStepNumber = 1 | 2 | 3 | 4 | 5;

export interface PipelineHeaderProps {
  activeStep: PipelineStepNumber;
  merchantSlug: string;
  merchantDba: string;
  savedSessions?: OnboardingSession[];
  onSwitchClient?: (slugOrNew: string) => void;
  onNavigateStep?: (targetStep: PipelineStepNumber, defaultHref: string) => void;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}

interface StepDefinition {
  step: PipelineStepNumber;
  shortLabel: string;
  fullLabel: string;
  buildHref: (slug: string) => string;
}

const PIPELINE_STEPS: StepDefinition[] = [
  {
    step: 1,
    shortLabel: "Step 1: Document Intake",
    fullLabel: "Step 1: Document Intake",
    buildHref: (slug) =>
      `/onboard/intake?merchant=${encodeURIComponent(slug || "unassigned")}`,
  },
  {
    step: 2,
    shortLabel: "Step 2: Business Rules",
    fullLabel: "Step 2: Business Rules",
    buildHref: (slug) =>
      `/onboard/rules?merchant=${encodeURIComponent(slug || "unassigned")}`,
  },
  {
    step: 3,
    shortLabel: "Step 3: POS Connect",
    fullLabel: "Step 3: POS Connect",
    buildHref: (slug) =>
      `/onboard/connect?merchant=${encodeURIComponent(slug || "unassigned")}`,
  },
  {
    step: 4,
    shortLabel: "Step 4: Ergonomics Studio",
    fullLabel: "Step 4: Ergonomics Studio",
    buildHref: (slug) =>
      `/?tab=studio&merchant=${encodeURIComponent(slug || "unassigned")}`,
  },
  {
    step: 5,
    shortLabel: "Step 5: Review & Deploy",
    fullLabel: "Step 5: Review & Deploy",
    buildHref: (slug) =>
      `/onboard/review?merchant=${encodeURIComponent(slug || "unassigned")}`,
  },
];

export default function PipelineHeader({
  activeStep,
  merchantSlug,
  merchantDba,
  savedSessions = [],
  onSwitchClient,
  onNavigateStep,
  subtitle = "Unified 5-Step POS Optimization & Canonical Catalog Pipeline",
  rightSlot,
}: PipelineHeaderProps) {
  const normalizedSlug =
    merchantSlug && merchantSlug.trim() ? merchantSlug.trim() : "unassigned";
  const displayDba =
    merchantDba && merchantDba.trim()
      ? merchantDba.trim()
      : normalizedSlug !== "unassigned"
      ? normalizedSlug
      : "Unassigned Client";

  return (
    <div className="sticky top-0 z-50">
      {/* Top Command Utility Bar */}
      <div className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur px-6 py-2">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <Link
              href="/dashboard"
              className="px-3.5 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-amber-500/50 text-amber-400 hover:text-amber-300 text-xs font-bold transition flex items-center space-x-1.5 shadow-sm"
            >
              <span>← Master Dashboard</span>
            </Link>

            <div className="hidden sm:flex items-center space-x-2">
              <div className="h-6 w-6 rounded-md bg-amber-500 flex items-center justify-center font-black text-slate-950 text-xs shadow-sm">
                B
              </div>
              <span className="font-extrabold tracking-tight text-sm text-white">
                BarMaid
              </span>
              <span className="text-[11px] text-slate-500 font-mono hidden md:inline">
                • {subtitle}
              </span>
            </div>
          </div>

          {/* Center Badge: Active Client DBA & Slug */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-full px-3.5 py-1 flex items-center space-x-2 shadow-inner">
            <span
              className={`h-2 w-2 rounded-full ${
                normalizedSlug !== "unassigned"
                  ? "bg-amber-400"
                  : "bg-slate-600"
              }`}
            />
            <span className="text-xs font-bold text-white">{displayDba}</span>
            <span className="text-xs font-mono text-amber-400">
              ({normalizedSlug})
            </span>
          </div>

          {/* Right Fast Switcher & Optional Page Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {onSwitchClient && (
              <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1">
                <span className="text-amber-400 text-xs" aria-hidden="true">
                  📁
                </span>
                <select
                  aria-label="Fast switch client folder"
                  value={
                    savedSessions.some(
                      (s) =>
                        s.storeProfile.merchantSlug === normalizedSlug ||
                        s.id === normalizedSlug
                    )
                      ? normalizedSlug
                      : ""
                  }
                  onChange={(e) => onSwitchClient(e.target.value)}
                  className="bg-slate-900 text-xs font-semibold text-slate-200 focus:outline-none cursor-pointer pr-1"
                >
                  <option value="">
                    {normalizedSlug !== "unassigned"
                      ? `Active: ${displayDba}`
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
            )}
            {rightSlot}
          </div>
        </div>
      </div>

      {/* Unified 5-Step Pipeline Stepper Bar */}
      <header className="border-b border-slate-800 bg-slate-900/95 backdrop-blur px-6 py-3 shadow-md">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-3 overflow-x-auto">
          <nav
            aria-label="5-Step Onboarding & Studio Pipeline"
            className="flex items-center space-x-1.5 sm:space-x-2 text-xs font-semibold min-w-max"
          >
            {PIPELINE_STEPS.map((item, idx) => {
              const isCurrent = item.step === activeStep;
              const isCompleted = item.step < activeStep;
              const href = item.buildHref(normalizedSlug);

              const pillClasses = isCurrent
                ? "bg-amber-500 text-slate-950 font-extrabold shadow-md shadow-amber-500/20 border border-amber-400"
                : isCompleted
                ? "bg-emerald-950/70 border border-emerald-700/60 text-emerald-300 hover:bg-emerald-900/60 hover:text-emerald-200"
                : "bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white hover:border-slate-700";

              const badgeClasses = isCurrent
                ? "bg-slate-950 text-amber-400 font-mono font-bold"
                : isCompleted
                ? "bg-emerald-500 text-slate-950 font-bold"
                : "bg-slate-800 text-slate-400 font-mono";

              return (
                <React.Fragment key={item.step}>
                  {idx > 0 && (
                    <span
                      className={`font-mono text-xs select-none ${
                        isCompleted || isCurrent
                          ? "text-amber-500/70"
                          : "text-slate-700"
                      }`}
                      aria-hidden="true"
                    >
                      →
                    </span>
                  )}

                  {onNavigateStep ? (
                    <button
                      type="button"
                      onClick={() => onNavigateStep(item.step, href)}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl transition cursor-pointer ${pillClasses}`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${badgeClasses}`}
                      >
                        {isCompleted ? "✓" : item.step}
                      </span>
                      <span className="whitespace-nowrap">
                        {item.shortLabel}
                      </span>
                    </button>
                  ) : (
                    <Link
                      href={href}
                      aria-current={isCurrent ? "step" : undefined}
                      className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl transition ${pillClasses}`}
                    >
                      <span
                        className={`h-5 w-5 rounded-full flex items-center justify-center text-[11px] shrink-0 ${badgeClasses}`}
                      >
                        {isCompleted ? "✓" : item.step}
                      </span>
                      <span className="whitespace-nowrap">
                        {item.shortLabel}
                      </span>
                    </Link>
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          <span className="hidden xl:inline-flex items-center px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-400 shrink-0">
            Step {activeStep} of 5
          </span>
        </div>
      </header>
    </div>
  );
}

