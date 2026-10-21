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
import type {
  InvoiceOcrResponse,
  InvoiceRetailItem,
  InvoiceModifierOption,
  InvoiceOperationalSupply,
} from "@/app/api/ocr/invoice/route";

export const INTAKE_STAGE_STORAGE_KEY = "barmaid_intake_stage";

type DropzoneKey = "license" | "menu" | "invoice";

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

export interface StoreProfileData {
  legalName: string;
  dbaName: string;
  merchantSlug: string;
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
  sourceFileName: string;
}

export interface StagedRetailItem extends InvoiceRetailItem {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "retail_item";
  sourceFileName: string;
}

export interface StagedModifierOption extends InvoiceModifierOption {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "modifier_option";
  sourceFileName: string;
}

export interface StagedSupplyItem extends InvoiceOperationalSupply {
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

interface MenuOcrApiResponse {
  success?: boolean;
  error?: string;
  data?: {
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
    legalName?: string;
    dbaName?: string;
    address?: string;
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
  streetAddress: "",
  city: "",
  state: "",
  zipCode: "",
};

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
  const addressRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const slugManuallyEditedRef = useRef<boolean>(false);
  const storeProfileRef = useRef<StoreProfileData>({ ...EMPTY_STORE_PROFILE });
  const isHydratedRef = useRef<boolean>(false);

  const [activeSlugBadge, setActiveSlugBadge] = useState<string>("");
  const [licenseDetected, setLicenseDetected] = useState<boolean>(false);

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
    const streetAddress =
      addressRef.current?.value.trim() ?? storeProfileRef.current.streetAddress;
    const city = cityRef.current?.value.trim() ?? storeProfileRef.current.city;
    const state = stateRef.current?.value.trim() ?? storeProfileRef.current.state;
    const zipCode = zipRef.current?.value.trim() ?? storeProfileRef.current.zipCode;

    const snapshot: StoreProfileData = {
      legalName,
      dbaName,
      merchantSlug,
      streetAddress,
      city,
      state,
      zipCode,
    };
    storeProfileRef.current = snapshot;
    return snapshot;
  }, []);

  // Write values into uncontrolled DOM inputs (used on mount hydration, OCR completion, or Reset)
  const writeStoreProfileToInputs = useCallback((profile: StoreProfileData) => {
    storeProfileRef.current = { ...profile };
    if (legalNameRef.current) legalNameRef.current.value = profile.legalName || "";
    if (dbaNameRef.current) dbaNameRef.current.value = profile.dbaName || "";
    if (slugRef.current) slugRef.current.value = profile.merchantSlug || "";
    if (addressRef.current) addressRef.current.value = profile.streetAddress || "";
    if (cityRef.current) cityRef.current.value = profile.city || "";
    if (stateRef.current) stateRef.current.value = profile.state || "";
    if (zipRef.current) zipRef.current.value = profile.zipCode || "";
    setActiveSlugBadge(profile.merchantSlug || "");
  }, []);

  // Build and persist canonical IntakeStageData to localStorage
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
    }) => {
      if (typeof window === "undefined") return;

      const profile = overrides?.profile ?? readStoreProfileFromDom();
      const drinks = overrides?.drinks ?? stagedMenuItems;
      const modifiers = overrides?.modifiers ?? stagedModifiers;
      const retail = overrides?.retail ?? stagedRetailItems;
      const supplies = overrides?.supplies ?? stagedSupplies;
      const licFiles = overrides?.licFiles ?? licenseFiles;
      const menFiles = overrides?.menFiles ?? menuFiles;
      const invFiles = overrides?.invFiles ?? invoiceFiles;
      const licDetected = overrides?.licDetected ?? licenseDetected;

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

  // Hydrate from localStorage on mount so HMR reloads, Wi-Fi reconnects, and Step 2 back-navigation preserve all state
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(INTAKE_STAGE_STORAGE_KEY) ||
        sessionStorage.getItem(INTAKE_STAGE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<IntakeStageData>;

        if (parsed.storeProfile) {
          const hydratedProfile: StoreProfileData = {
            legalName: parsed.storeProfile.legalName || "",
            dbaName: parsed.storeProfile.dbaName || "",
            merchantSlug:
              parsed.storeProfile.merchantSlug ||
              toSlug(
                parsed.storeProfile.dbaName || parsed.storeProfile.legalName || ""
              ),
            streetAddress: parsed.storeProfile.streetAddress || "",
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
          setStagedMenuItems(parsed.stagedItems);
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

  // Sync storeProfile to localStorage on every input change WITHOUT triggering any React state re-render!
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

    const currentProfile = readStoreProfileFromDom();
    persistStageToStorage({ profile: currentProfile });
  };

  // On blur, normalize slug input formatting and update the top header badge
  const handleStoreInputBlur = () => {
    if (slugRef.current) {
      const rawSlug = slugRef.current.value.trim();
      const dbaVal = dbaNameRef.current?.value.trim() || "";
      const legalVal = legalNameRef.current?.value.trim() || "";
      slugRef.current.value = toSlug(rawSlug || dbaVal || legalVal);
    }
    const updated = readStoreProfileFromDom();
    setActiveSlugBadge(updated.merchantSlug);
    persistStageToStorage({ profile: updated });
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

  // Single consolidated Reset Intake handler
  const handleResetIntake = () => {
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

    try {
      localStorage.removeItem(INTAKE_STAGE_STORAGE_KEY);
      sessionStorage.removeItem(INTAKE_STAGE_STORAGE_KEY);
    } catch {
      // Ignore storage access errors
    }

    setStatusBanner("Intake reset to a clean blank slate.");
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
        const dba = extracted.dbaName?.trim() || current.dbaName;
        const legal = extracted.legalName?.trim() || current.legalName;
        const resolvedSlug =
          extracted.merchantSlug?.trim() ||
          extracted.suggestedSlug?.trim() ||
          toSlug(dba || legal) ||
          current.merchantSlug;

        const nextProfile: StoreProfileData = {
          legalName: legal,
          dbaName: dba,
          merchantSlug: resolvedSlug,
          streetAddress:
            extracted.streetAddress?.trim() ||
            extracted.address?.trim() ||
            current.streetAddress,
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
        setStatusBanner(`Business identity verified from "${file.name}".`);
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
              .map((v) => ({ size: v.size.trim(), price: v.price }));

            extractedDrinks.push({
              id: `drink_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: rawName,
              categoryName,
              variations: validVars.length > 0 ? validVars : fallbackVars,
              included: true,
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

        setMenuFiles((prev) =>
          prev.map((a) => (a.id === asset.id ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(
          `Appended ${extractedDrinks.length} menu items from "${file.name}" into staging.`
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

  // Native input onChange handlers: copy FileList into array BEFORE clearing input value
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

  // Drag-and-drop handlers for each dropzone card
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

  // Summary counts
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
      toSlug(currentProfile.dbaName || currentProfile.legalName);

    const finalProfile: StoreProfileData = {
      ...currentProfile,
      merchantSlug: resolvedSlug,
    };

    persistStageToStorage({ profile: finalProfile });
    router.push("/onboard/rules");
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
                Multi-Source Document Intake &amp; POS Staging Engine
              </p>
            </div>
          </div>

          {/* Wizard Step Indicators */}
          <nav
            aria-label="Onboarding progress"
            className="flex items-center space-x-2 sm:space-x-3 text-xs font-semibold"
          >
            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/20">
              <span className="h-5 w-5 rounded-full bg-slate-950 text-amber-400 flex items-center justify-center text-[11px] font-mono">
                1
              </span>
              <span>Step 1: Document Intake</span>
            </div>

            <span className="text-slate-600 font-mono">→</span>

            <button
              type="button"
              onClick={handleContinueToBusinessRules}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl border bg-slate-900 border-slate-800 text-slate-400 hover:text-white hover:border-slate-700 transition cursor-pointer"
            >
              <span className="h-5 w-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[11px] font-mono">
                2
              </span>
              <span>Step 2: Rules &amp; Sizing</span>
            </button>

            <span className="text-slate-600 font-mono">→</span>

            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-500">
              <span className="h-5 w-5 rounded-full bg-slate-800 text-slate-500 flex items-center justify-center text-[11px] font-mono">
                3
              </span>
              <span>Step 3: POS Connect</span>
            </div>
          </nav>

          {/* Active Tenant Pill & Single Consolidated Reset Intake Button */}
          <div className="flex items-center space-x-3">
            <div className="bg-slate-950 border border-slate-800 rounded-full px-3.5 py-1.5 flex items-center space-x-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  activeSlugBadge ? "bg-amber-400" : "bg-slate-600"
                }`}
              ></span>
              <span className="text-xs text-slate-400">merchant_slug:</span>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {activeSlugBadge || "unassigned"}
              </span>
            </div>

            <button
              type="button"
              onClick={handleResetIntake}
              className="px-3.5 py-1.5 rounded-xl bg-slate-950 hover:bg-rose-950/50 border border-slate-700 hover:border-rose-500/50 text-slate-300 hover:text-rose-300 text-xs font-semibold transition cursor-pointer"
            >
              Reset Intake
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
        {/* Page Title */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Multi-Source Intake &amp; Catalog Staging
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

        {/* Section 2: Uncontrolled Store Info with Live LocalStorage Sync (Zero Keystroke Re-renders) */}
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
                Legal Name
              </label>
              <input
                id="store-legal-name"
                ref={legalNameRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="Legal business entity"
                onChange={() => handleStoreInputChange("legalName")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
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
                placeholder="Shop / trade name"
                onChange={() => handleStoreInputChange("dbaName")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
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
            </div>

            <div>
              <label
                htmlFor="store-address"
                className="block text-[11px] font-mono uppercase text-slate-400 mb-1"
              >
                Street Address
              </label>
              <input
                id="store-address"
                ref={addressRef}
                type="text"
                defaultValue=""
                autoComplete="off"
                placeholder="Street address"
                onChange={() => handleStoreInputChange("streetAddress")}
                onBlur={handleStoreInputBlur}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-base sm:text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
              />
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
                Aggregated, deduplicated preview across Menu Boards and Vendor Invoices. Toggle checkboxes to include/exclude items or reassign modifier groups before Step 2.
              </p>
            </div>

            {/* Filter Tabs */}
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
                  label: `Drinks & Categories (${stagedMenuItems.length})`,
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

          {/* Sub-Table A: Drinks & Categories */}
          {(activeReviewTab === "all" || activeReviewTab === "drinks") &&
            stagedMenuItems.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-cyan-400">
                    Drinks &amp; Categories (Menu Board Extractions)
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
                        <th className="py-2.5 px-3">Drink Name</th>
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
                            <span className="px-2 py-0.5 rounded bg-amber-950/70 border border-amber-800/50 text-amber-300 font-mono text-[11px]">
                              {mod.classification}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <select
                              value={mod.targetGroup}
                              onChange={(e) =>
                                updateModifierTargetGroup(mod.id, e.target.value)
                              }
                              aria-label={`Modifier group for ${mod.name}`}
                              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-amber-300 font-medium focus:outline-none focus:border-amber-500"
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
                            <span className="px-2 py-0.5 rounded bg-emerald-950/70 border border-emerald-800/50 text-emerald-300 font-mono text-[11px]">
                              {item.classification}
                            </span>
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
                            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400 font-mono text-[11px]">
                              {sup.classification}
                            </span>
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
              Drinks: <strong className="text-white">{summaryCounts.activeDrinks}</strong>
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
            <span>Continue to Business Rules</span>
            <span>→</span>
          </button>
        </div>
      </footer>
    </div>
  );
}
