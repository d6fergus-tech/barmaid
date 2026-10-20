"use client";

import React, { useState, useRef, useMemo, ChangeEvent } from "react";
import Link from "next/link";
import type {
  InvoiceOcrResponse,
  InvoiceRetailItem,
  InvoiceModifierOption,
  InvoiceOperationalSupply,
} from "@/app/api/ocr/invoice/route";

type DropzoneKey = "license" | "menu" | "invoice";

interface UploadedAsset {
  id: string;
  zone: DropzoneKey;
  fileName: string;
  fileSize: number;
  previewUrl: string;
  status: "processing" | "ready" | "error";
  errorMessage?: string;
}

interface StoreIdentity {
  legalName: string;
  dbaName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  suggestedSlug: string;
  sourceFileId?: string;
}

interface MenuVariation {
  size: string;
  price: number;
}

interface StagedMenuItem {
  id: string;
  name: string;
  categoryName: string;
  variations: MenuVariation[];
  included: boolean;
  sourceFileName: string;
}

interface StagedRetailItem extends InvoiceRetailItem {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "retail_item";
  sourceFileName: string;
}

interface StagedModifierOption extends InvoiceModifierOption {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "modifier_option";
  sourceFileName: string;
}

interface StagedSupplyItem extends InvoiceOperationalSupply {
  id: string;
  vendorName: string;
  included: boolean;
  classification: "operational_supply";
  sourceFileName: string;
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
  data?: Partial<StoreIdentity>;
}

const MODIFIER_GROUPS = [
  "Flavor Syrups",
  "Sauces",
  "Milk Options",
  "Powders & Frappe Bases",
  "Energy & Boosters",
  "Sweeteners & Toppings",
] as const;

const INITIAL_IDENTITY: StoreIdentity = {
  legalName: "Konnowac Coffee Roasters LLC",
  dbaName: "Konnowac Coffee",
  address: "412 Yakima Valley Hwy",
  city: "Zillah",
  state: "WA",
  zip: "98953",
  suggestedSlug: "konnowac-coffee",
};

function toSlug(input: string): string {
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

export default function MultiSourceIntakeStagingPage() {
  // Multi-file upload state per dropzone
  const [licenseFiles, setLicenseFiles] = useState<UploadedAsset[]>([]);
  const [menuFiles, setMenuFiles] = useState<UploadedAsset[]>([]);
  const [invoiceFiles, setInvoiceFiles] = useState<UploadedAsset[]>([]);

  // Staged extracted data
  const [storeIdentity, setStoreIdentity] = useState<StoreIdentity>(INITIAL_IDENTITY);
  const [licenseDetected, setLicenseDetected] = useState<boolean>(false);

  const [stagedMenuItems, setStagedMenuItems] = useState<StagedMenuItem[]>([]);
  const [stagedRetailItems, setStagedRetailItems] = useState<StagedRetailItem[]>([]);
  const [stagedModifiers, setStagedModifiers] = useState<StagedModifierOption[]>([]);
  const [stagedSupplies, setStagedSupplies] = useState<StagedSupplyItem[]>([]);

  // UI & handoff states
  const [activeReviewTab, setActiveReviewTab] = useState<
    "all" | "drinks" | "modifiers" | "retail" | "supplies"
  >("all");
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [handoffSuccess, setHandoffSuccess] = useState<boolean>(false);

  // Hidden input refs
  const licenseInputRef = useRef<HTMLInputElement>(null);
  const menuInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  const readFilePreview = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve((ev.target?.result as string) || "");
      reader.onerror = () => reject(new Error("Failed to read file preview"));
      reader.readAsDataURL(file);
    });

  // Dropzone 1: Business License Upload Handler
  const handleLicenseUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    for (const file of files) {
      const assetId = `lic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = await readFilePreview(file);

      const newAsset: UploadedAsset = {
        id: assetId,
        zone: "license",
        fileName: file.name,
        fileSize: file.size,
        previewUrl,
        status: "processing",
      };

      setLicenseFiles((prev) => [...prev, newAsset]);
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
        const dba = extracted.dbaName?.trim() || storeIdentity.dbaName;
        const legal = extracted.legalName?.trim() || storeIdentity.legalName;

        setStoreIdentity({
          legalName: legal,
          dbaName: dba,
          address: extracted.address?.trim() || storeIdentity.address,
          city: extracted.city?.trim() || storeIdentity.city,
          state: extracted.state?.trim() || storeIdentity.state,
          zip: extracted.zip?.trim() || storeIdentity.zip,
          suggestedSlug:
            extracted.suggestedSlug?.trim() || toSlug(dba || legal || "konnowac-coffee"),
          sourceFileId: assetId,
        });
        setLicenseDetected(true);

        setLicenseFiles((prev) =>
          prev.map((a) => (a.id === assetId ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(`Business identity verified from "${file.name}".`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse license";
        setLicenseFiles((prev) =>
          prev.map((a) =>
            a.id === assetId ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`License OCR alert: ${msg}`);
      }
    }
  };

  // Dropzone 2: Menu & Signage Upload Handler (Appends without overwriting)
  const handleMenuUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    for (const file of files) {
      const assetId = `menu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = await readFilePreview(file);

      const newAsset: UploadedAsset = {
        id: assetId,
        zone: "menu",
        fileName: file.name,
        fileSize: file.size,
        previewUrl,
        status: "processing",
      };

      setMenuFiles((prev) => [...prev, newAsset]);
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

        // Append & deduplicate menu drinks without overwriting previous uploads
        setStagedMenuItems((prev) => {
          const map = new Map<string, StagedMenuItem>();
          prev.forEach((existing) => {
            map.set(normalizeKey(existing.name), existing);
          });
          extractedDrinks.forEach((incoming) => {
            const key = normalizeKey(incoming.name);
            const match = map.get(key);
            if (match) {
              // Merge variations if new sizes detected
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

        // If the menu board also had explicit add-on modifiers, stage them too
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
          prev.map((a) => (a.id === assetId ? { ...a, status: "ready" } : a))
        );
        setStatusBanner(
          `Appended ${extractedDrinks.length} menu items from "${file.name}" into staging.`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to parse menu board";
        setMenuFiles((prev) =>
          prev.map((a) =>
            a.id === assetId ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`Menu OCR alert: ${msg}`);
      }
    }
  };

  // Dropzone 3: Vendor Invoice Upload Handler
  const handleInvoiceUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    e.target.value = "";

    for (const file of files) {
      const assetId = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const previewUrl = await readFilePreview(file);

      const newAsset: UploadedAsset = {
        id: assetId,
        zone: "invoice",
        fileName: file.name,
        fileSize: file.size,
        previewUrl,
        status: "processing",
      };

      setInvoiceFiles((prev) => [...prev, newAsset]);
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

        // 1. Append & deduplicate Retail Products ('retail_item')
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

        // 2. Append & deduplicate Modifier Options ('modifier_option')
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

        // 3. Append & deduplicate Operational Supplies ('operational_supply', excluded by default)
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
                  included: false, // Flagged as non-menu / excluded from POS screen by default
                  classification: "operational_supply",
                  sourceFileName: file.name,
                });
              }
            });
            return Array.from(map.values());
          });
        }

        setInvoiceFiles((prev) =>
          prev.map((a) => (a.id === assetId ? { ...a, status: "ready" } : a))
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
            a.id === assetId ? { ...a, status: "error", errorMessage: msg } : a
          )
        );
        setStatusBanner(`Invoice OCR alert: ${msg}`);
      }
    }
  };

  // Remove uploaded file card from a dropzone
  const handleRemoveAsset = (zone: DropzoneKey, assetId: string, fileName: string) => {
    if (zone === "license") {
      setLicenseFiles((prev) => prev.filter((f) => f.id !== assetId));
    } else if (zone === "menu") {
      setMenuFiles((prev) => prev.filter((f) => f.id !== assetId));
      setStagedMenuItems((prev) => prev.filter((i) => i.sourceFileName !== fileName));
    } else if (zone === "invoice") {
      setInvoiceFiles((prev) => prev.filter((f) => f.id !== assetId));
      setStagedRetailItems((prev) => prev.filter((i) => i.sourceFileName !== fileName));
      setStagedModifiers((prev) => prev.filter((i) => i.sourceFileName !== fileName));
      setStagedSupplies((prev) => prev.filter((i) => i.sourceFileName !== fileName));
    }
  };

  // Load realistic Konnowac Coffee sample dataset for instant testing/inspection
  const handleLoadDemoFixtures = () => {
    setStoreIdentity({
      legalName: "Konnowac Coffee Roasters LLC",
      dbaName: "Konnowac Coffee",
      address: "412 Yakima Valley Hwy",
      city: "Zillah",
      state: "WA",
      zip: "98953",
      suggestedSlug: "konnowac-coffee",
    });
    setLicenseDetected(true);

    setStagedMenuItems([
      {
        id: "demo_drink_1",
        name: "Caramel Macchiato",
        categoryName: "Espresso Classics",
        variations: [
          { size: "12oz", price: 4.75 },
          { size: "16oz", price: 5.25 },
          { size: "20oz", price: 5.75 },
        ],
        included: true,
        sourceFileName: "drive-thru-main-board.jpg",
      },
      {
        id: "demo_drink_2",
        name: "White Chocolate Americano",
        categoryName: "Espresso Classics",
        variations: [
          { size: "12oz", price: 4.25 },
          { size: "16oz", price: 4.75 },
          { size: "20oz", price: 5.25 },
        ],
        included: true,
        sourceFileName: "drive-thru-main-board.jpg",
      },
      {
        id: "demo_drink_3",
        name: "Blue Raspberry Lotus Fusion",
        categoryName: "Plant Energy Bar",
        variations: [
          { size: "16oz", price: 5.5 },
          { size: "24oz", price: 6.5 },
          { size: "32oz", price: 7.5 },
        ],
        included: true,
        sourceFileName: "summer-energy-flyer.png",
      },
      {
        id: "demo_drink_4",
        name: "Spiced Chai Frappe",
        categoryName: "Big Train Blended",
        variations: [
          { size: "16oz", price: 5.75 },
          { size: "24oz", price: 6.5 },
        ],
        included: true,
        sourceFileName: "summer-energy-flyer.png",
      },
    ]);

    setStagedRetailItems([
      {
        id: "demo_ret_1",
        name: "Dillanos One Love Whole Bean (12oz)",
        unitCostCents: 875,
        suggestedPriceCents: 1850,
        sku: "DIL-12-ONELOVE",
        vendorName: "Dillanos Coffee Roasters",
        included: true,
        classification: "retail_item",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_ret_2",
        name: "Dillanos Espresso Blend (5lb Bulk Bag)",
        unitCostCents: 4200,
        suggestedPriceCents: 7800,
        sku: "DIL-5LB-ESP",
        vendorName: "Dillanos Coffee Roasters",
        included: true,
        classification: "retail_item",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_ret_3",
        name: "San Pellegrino Sparkling (500ml RTD)",
        unitCostCents: 115,
        suggestedPriceCents: 325,
        sku: "SP-500-RTD",
        vendorName: "Dillanos Coffee Roasters",
        included: true,
        classification: "retail_item",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
    ]);

    setStagedModifiers([
      {
        id: "demo_mod_1",
        name: "Vanilla Bean Syrup",
        targetGroup: "Flavor Syrups",
        unitCostCents: 685,
        vendorName: "Torani / Dillanos",
        included: true,
        classification: "modifier_option",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_mod_2",
        name: "Lavender Syrup",
        targetGroup: "Flavor Syrups",
        unitCostCents: 710,
        vendorName: "Torani / Dillanos",
        included: true,
        classification: "modifier_option",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_mod_3",
        name: "Caramel Sauce",
        targetGroup: "Sauces",
        unitCostCents: 1890,
        vendorName: "Ghirardelli / Dillanos",
        included: true,
        classification: "modifier_option",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_mod_4",
        name: "Barista Series Oat Milk",
        targetGroup: "Milk Options",
        unitCostCents: 395,
        vendorName: "Pacific Foods",
        included: true,
        classification: "modifier_option",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_mod_5",
        name: "Spiced Chai Powder",
        targetGroup: "Powders & Frappe Bases",
        unitCostCents: 1650,
        vendorName: "Big Train",
        included: true,
        classification: "modifier_option",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
    ]);

    setStagedSupplies([
      {
        id: "demo_sup_1",
        name: "16oz Double-Wall Hot Cups",
        packSize: "1000/cs",
        vendorName: "Dillanos Coffee Roasters",
        included: false,
        classification: "operational_supply",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_sup_2",
        name: "24oz Clear PET Cold Cups + Flat Strawless Lids",
        packSize: "600/cs",
        vendorName: "Dillanos Coffee Roasters",
        included: false,
        classification: "operational_supply",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
      {
        id: "demo_sup_3",
        name: "Urnex Cafiza Espresso Machine Cleaner",
        packSize: "20oz jar",
        vendorName: "Dillanos Coffee Roasters",
        included: false,
        classification: "operational_supply",
        sourceFileName: "dillanos-invoice-1019.jpg",
      },
    ]);

    setStatusBanner(
      "Loaded Konnowac Coffee sample intake staging fixtures (License + Menu Boards + Dillanos/Torani/Big Train Invoice)."
    );
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
    const payload = {
      merchant_slug: storeIdentity.suggestedSlug || "konnowac-coffee",
      storeIdentity,
      stagedDrinks: stagedMenuItems.filter((d) => d.included),
      stagedModifiers: stagedModifiers.filter((m) => m.included),
      stagedRetailItems: stagedRetailItems.filter((r) => r.included),
      excludedOperationalSupplies: stagedSupplies.filter((s) => !s.included),
      stagedAt: new Date().toISOString(),
    };

    try {
      sessionStorage.setItem("barmaid_onboarding_step1_payload", JSON.stringify(payload));
      localStorage.setItem(
        `barmaid_staging_${payload.merchant_slug}`,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore storage quota errors in restricted environments
    }

    setHandoffSuccess(true);
    setStatusBanner(
      `Staged state locked for tenant "${payload.merchant_slug}" and passed to Step 2: Rules & Sizing.`
    );
  };

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

            <div
              className={`flex items-center space-x-2 px-3.5 py-2 rounded-xl border ${
                handoffSuccess
                  ? "bg-emerald-950/80 border-emerald-500/60 text-emerald-300"
                  : "bg-slate-900 border-slate-800 text-slate-400"
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-[11px] font-mono">
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
          <div className="flex items-center space-x-2">
            <div className="bg-slate-950 border border-slate-800 rounded-full px-3.5 py-1.5 flex items-center space-x-2">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              <span className="text-xs text-slate-400">merchant_slug:</span>
              <span className="text-xs font-bold text-amber-400 font-mono">
                {storeIdentity.suggestedSlug || "konnowac-coffee"}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-8">
        {/* Page Title & Demo Fixture Helper */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Multi-Source Intake &amp; Catalog Staging
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Ingest physical business licenses, walk-up menu boards, and vendor packing slips (Dillanos, Torani, Big Train) to isolate retail SKUs, modifiers, and operational supplies.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadDemoFixtures}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-amber-400 text-xs font-semibold transition flex items-center space-x-2"
          >
            <span>⚡</span>
            <span>Load Sample Konnowac Intake Data</span>
          </button>
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
              className="text-xs text-slate-400 hover:text-white font-mono"
            >
              [Dismiss]
            </button>
          </div>
        )}

        {/* Hidden Multi-File Inputs */}
        <input
          ref={licenseInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleLicenseUpload}
          className="hidden"
        />
        <input
          ref={menuInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleMenuUpload}
          className="hidden"
        />
        <input
          ref={invoiceInputRef}
          type="file"
          accept="image/*"
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
          <div className="bg-slate-900 border border-slate-800 hover:border-amber-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30">
                  Dropzone 1 &middot; Identity
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {licenseFiles.length} file{licenseFiles.length === 1 ? "" : "s"}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Business Identity &amp; Permit
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload state business license or health permit image. Automatically extracts Legal Name, DBA/Trade Name, Address, City, State, Zip, and Suggested Slug.
              </p>
            </div>

            {/* Multi-file Preview Cards */}
            {licenseFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {licenseFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={asset.previewUrl}
                        alt={asset.fileName}
                        className="h-11 w-11 rounded-lg object-cover border border-slate-700 shrink-0 bg-slate-900"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <p className="text-[11px] font-mono text-slate-400">
                          {asset.status === "processing"
                            ? "Extracting identity..."
                            : asset.status === "error"
                            ? asset.errorMessage || "Error"
                            : "Identity Parsed"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveAsset("license", asset.id, asset.fileName)
                      }
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-800 rounded-xl p-5 text-center text-xs text-slate-500">
                No license image uploaded yet. Defaulting to tenant{" "}
                <span className="text-amber-400 font-mono">konnowac-coffee</span>.
              </div>
            )}

            <button
              type="button"
              onClick={() => licenseInputRef.current?.click()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2"
            >
              <span>+ Upload Business License / Permit</span>
            </button>
          </div>

          {/* Dropzone 2: Menu & Signage */}
          <div className="bg-slate-900 border border-slate-800 hover:border-cyan-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                  Dropzone 2 &middot; Menu &amp; Signage
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {menuFiles.length} file{menuFiles.length === 1 ? "" : "s"}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Chalkboards, Drive-Thru &amp; Flyers
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload 1 or more images of walk-up boards, drive-thru panels, or seasonal flyers. Appends items to menu staging without overwriting previous uploads.
              </p>
            </div>

            {/* Multi-file Preview Cards */}
            {menuFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {menuFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={asset.previewUrl}
                        alt={asset.fileName}
                        className="h-11 w-11 rounded-lg object-cover border border-slate-700 shrink-0 bg-slate-900"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <p className="text-[11px] font-mono text-cyan-400">
                          {asset.status === "processing"
                            ? "Scanning board..."
                            : asset.status === "error"
                            ? asset.errorMessage || "Error"
                            : "Appended to Menu"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveAsset("menu", asset.id, asset.fileName)
                      }
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-800 rounded-xl p-5 text-center text-xs text-slate-500">
                Drop multiple menu board photos to accumulate categories, base sizes, and prices.
              </div>
            )}

            <button
              type="button"
              onClick={() => menuInputRef.current?.click()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2"
            >
              <span>+ Upload Menu Board / Flyer Image(s)</span>
            </button>
          </div>

          {/* Dropzone 3: Vendor Invoices */}
          <div className="bg-slate-900 border border-slate-800 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col justify-between space-y-5 transition shadow-lg">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-mono uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                  Dropzone 3 &middot; Vendor Invoices
                </span>
                <span className="text-xs font-mono text-slate-400">
                  {invoiceFiles.length} file{invoiceFiles.length === 1 ? "" : "s"}
                </span>
              </div>
              <h2 className="text-base font-bold text-white">
                Distributor Delivery Invoices
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Upload distributor packing slips (Dillanos, Torani, Big Train). Classifies retail bags/RTDs, syrups/sauces/milks, and filters out operational supplies.
              </p>
            </div>

            {/* Multi-file Preview Cards */}
            {invoiceFiles.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {invoiceFiles.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between bg-slate-950/80 border border-slate-800 rounded-xl p-2.5 gap-3"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={asset.previewUrl}
                        alt={asset.fileName}
                        className="h-11 w-11 rounded-lg object-cover border border-slate-700 shrink-0 bg-slate-900"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-200 truncate">
                          {asset.fileName}
                        </p>
                        <p className="text-[11px] font-mono text-emerald-400">
                          {asset.status === "processing"
                            ? "Classifying SKUs..."
                            : asset.status === "error"
                            ? asset.errorMessage || "Error"
                            : "Classified & Staged"}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveAsset("invoice", asset.id, asset.fileName)
                      }
                      aria-label={`Remove ${asset.fileName}`}
                      className="px-2 py-1 text-xs font-mono text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-dashed border-slate-800 rounded-xl p-5 text-center text-xs text-slate-500">
                Upload Dillanos, Torani, or Big Train invoices to auto-populate modifiers &amp; retail items.
              </div>
            )}

            <button
              type="button"
              onClick={() => invoiceInputRef.current?.click()}
              className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center space-x-2"
            >
              <span>+ Upload Vendor Invoice / Packing Slip(s)</span>
            </button>
          </div>
        </section>

        {/* Section 2: Detected Store Info (from License) */}
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
                  {licenseDetected ? "OCR Verified" : "Default Tenant"}
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
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                Legal Name
              </label>
              <input
                type="text"
                value={storeIdentity.legalName}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({ ...prev, legalName: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                DBA / Trade Name
              </label>
              <input
                type="text"
                value={storeIdentity.dbaName}
                onChange={(e) => {
                  const dbaName = e.target.value;
                  setStoreIdentity((prev) => ({
                    ...prev,
                    dbaName,
                    suggestedSlug: toSlug(dbaName || prev.legalName),
                  }));
                }}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                Suggested Slug (merchant_slug)
              </label>
              <input
                type="text"
                value={storeIdentity.suggestedSlug}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({
                    ...prev,
                    suggestedSlug: toSlug(e.target.value),
                  }))
                }
                className="w-full bg-slate-950 border border-amber-500/40 rounded-lg px-3 py-2 text-xs font-mono text-amber-400 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                Street Address
              </label>
              <input
                type="text"
                value={storeIdentity.address}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({ ...prev, address: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                City
              </label>
              <input
                type="text"
                value={storeIdentity.city}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({ ...prev, city: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                State
              </label>
              <input
                type="text"
                value={storeIdentity.state}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({ ...prev, state: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-mono uppercase text-slate-400 mb-1">
                ZIP Code
              </label>
              <input
                type="text"
                value={storeIdentity.zip}
                onChange={(e) =>
                  setStoreIdentity((prev) => ({ ...prev, zip: e.target.value }))
                }
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono"
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
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
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
                  Upload photos of menu boards or vendor invoices in the dropzones above, or load the sample Konnowac Coffee dataset to inspect the staging table.
                </p>
              </div>
            )}

          {/* Sub-Table A: Drinks & Categories (from Menu Boards) */}
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

          {/* Sub-Table B: Ingested Modifiers (from Invoices & Boards, with Group Reassignment) */}
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

          {/* Sub-Table C: Retail Products (from Invoices) */}
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

          {/* Sub-Table D: Operational Supplies (Excluded from POS by Default) */}
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

          {/* Footer Action Bar: Continue to Business Rules */}
          <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4 text-xs font-mono text-slate-400">
              <span>
                Tenant:{" "}
                <strong className="text-amber-400">
                  {storeIdentity.suggestedSlug || "konnowac-coffee"}
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
              className="px-6 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl shadow-lg shadow-amber-500/20 transition flex items-center space-x-2 cursor-pointer"
            >
              <span>Continue to Business Rules</span>
              <span>→</span>
            </button>
          </div>

          {/* Step 2 Handoff Confirmation Card */}
          {handoffSuccess && (
            <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-500/50 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-bold text-emerald-300">
                  ✓ Step 1 Staging Snapshot Committed for{" "}
                  <span className="font-mono">{storeIdentity.suggestedSlug}</span>
                </p>
                <p className="text-xs text-slate-300">
                  {summaryCounts.totalActivePosObjects} POS catalog objects ({summaryCounts.activeDrinks} drinks,{" "}
                  {summaryCounts.activeModifiers} modifiers, {summaryCounts.activeRetail} retail items) staged for Step 2: Guided Rule &amp; Sizing Verification.
                </p>
              </div>
              <Link
                href="/"
                className="px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition"
              >
                Open Ergonomics Studio →
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

