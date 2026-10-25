import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";

export interface InvoiceRetailItem {
  name: string;
  unitCostCents?: number;
  suggestedPriceCents?: number;
  sku?: string;
  classification?: "retail_item";
}

export interface InvoiceModifierOption {
  name: string;
  targetGroup: string;
  unitCostCents?: number;
  classification?: "modifier_option";
}

export interface InvoiceOperationalSupply {
  name: string;
  packSize?: string;
  classification?: "operational_supply";
}

export interface InvoiceOcrResponse {
  vendorName: string;
  invoiceDate?: string;
  physicalAddress?: string | null;
  mailingAddress?: string | null;
  address?: string | null;
  retailItems: InvoiceRetailItem[];
  modifierOptions: InvoiceModifierOption[];
  supplies: InvoiceOperationalSupply[];
}

interface RawParsedInvoice {
  vendorName?: string;
  invoiceDate?: string;
  physicalAddress?: string | null;
  mailingAddress?: string | null;
  address?: string | null;
  retailItems?: Array<{
    name?: string;
    unitCostCents?: number;
    suggestedPriceCents?: number;
    sku?: string;
  }>;
  modifierOptions?: Array<{
    name?: string;
    targetGroup?: string;
    unitCostCents?: number;
  }>;
  supplies?: Array<{
    name?: string;
    packSize?: string;
  }>;
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY is not defined in .env.local" },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const multiFiles = formData.getAll("files").filter((entry): entry is File => entry instanceof File);
    const singleFile = formData.get("file");
    const filesToProcess: File[] =
      multiFiles.length > 0
        ? multiFiles
        : singleFile instanceof File
        ? [singleFile]
        : [];

    if (filesToProcess.length === 0) {
      return NextResponse.json(
        { error: "No invoice image file(s) provided" },
        { status: 400 }
      );
    }

    const imageParts = await Promise.all(
      filesToProcess.map(async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return {
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: file.type || "image/jpeg",
          },
        };
      })
    );

    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
You are an expert specialty coffee supply chain and POS catalog analyst for BarMaid.
Analyze the provided coffee shop distributor invoice / packing slip image(s) (e.g., Dillanos Coffee Roasters, Torani, Big Train, DaVinci, Ghirardelli, Oatly, Sysco, US Foods).

Extract the vendor name, invoice date (if visible), customer delivery/billing addresses, and classify all line items using these strict heuristics:

0. Customer Stand Addresses (Physical / Ship-To vs. Mailing / Bill-To):
   - physicalAddress: Extract the customer's "Ship To", "Deliver To", delivery address, or physical coffee stand location address (exclude the distributor/vendor's own warehouse address). Return null if not present.
   - mailingAddress: Extract the customer's "Bill To", "Sold To", corporate office, or PO Box mailing address (exclude the distributor/vendor's own remit-to address). Return null if not present.
   - address: Fallback single customer address if only one customer address block exists on the document (or the physical/Ship-To address when both exist). Return null if no customer address is visible.

1. Retail Products ('retail_item' -> place in retailItems):
   - Whole bean coffee bags for retail sale (12oz, 2lb, 5lb retail bags), RTD (Ready-to-Drink) cans/bottles, bottled water/sodas, and pre-packaged grab-and-go snacks/pastries.
   - Normalize the item name cleanly (e.g., "Dillanos One Love 12oz Whole Bean", "San Pellegrino Sparkling 500ml").
   - Estimate or extract unitCostCents (in integer cents, e.g., 850 for $8.50) and suggestedPriceCents (in integer cents, typically 2x-2.5x retail markup, e.g., 1800 for $18.00). Include SKU if printed on the slip.

2. Modifier Options ('modifier_option' -> place in modifierOptions):
   - Flavor syrups (750ml / 1L bottles, e.g., Torani Vanilla, Lavender, Hazelnut), sauces (64oz jugs, e.g., Ghirardelli Caramel, White Mocha), alternative milks (Oat, Almond, Coconut, Soy, Breve), and frappe/chai/matcha powders (e.g., Big Train Spiced Chai, Blended Creme).
   - Strip packaging clutter from the modifier name so it is POS-ready (e.g., "Torani Vanilla Syrup 750ml" -> "Vanilla Syrup", "Pacific Barista Oat Milk 32oz" -> "Oat Milk").
   - Assign targetGroup to one of the canonical modifier groups:
     * "Flavor Syrups"
     * "Sauces"
     * "Milk Options"
     * "Powders & Frappe Bases"
     * "Energy & Boosters"
   - Include unitCostCents (integer cents per bottle/carton/unit if visible).

3. Operational Supplies ('operational_supply' -> place in supplies):
   - Hot/cold cups, dome/flat lids, cup sleeves/jackets, straws, espresso filters, napkins, trash liners, sanitizer, and backroom cleaning supplies.
   - These are non-menu backroom items excluded from the POS screen by default.
   - Extract name and packSize (e.g., "1000/cs", "20x50ct").

Return strictly valid JSON matching the schema.
`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        vendorName: { type: Type.STRING },
        invoiceDate: { type: Type.STRING },
        physicalAddress: { type: Type.STRING, nullable: true },
        mailingAddress: { type: Type.STRING, nullable: true },
        address: { type: Type.STRING, nullable: true },
        retailItems: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              unitCostCents: { type: Type.INTEGER },
              suggestedPriceCents: { type: Type.INTEGER },
              sku: { type: Type.STRING },
            },
            required: ["name"],
          },
        },
        modifierOptions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              targetGroup: { type: Type.STRING },
              unitCostCents: { type: Type.INTEGER },
            },
            required: ["name", "targetGroup"],
          },
        },
        supplies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              packSize: { type: Type.STRING },
            },
            required: ["name"],
          },
        },
      },
      required: ["vendorName", "retailItems", "modifierOptions", "supplies"],
    };

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });
    } catch {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema,
        },
      });
    }

    const rawParsed = JSON.parse(response.text || "{}") as RawParsedInvoice;

    const rawPhysical =
      typeof rawParsed.physicalAddress === "string" &&
      rawParsed.physicalAddress.trim().length > 0
        ? rawParsed.physicalAddress.trim()
        : null;
    const rawMailing =
      typeof rawParsed.mailingAddress === "string" &&
      rawParsed.mailingAddress.trim().length > 0
        ? rawParsed.mailingAddress.trim()
        : null;
    const rawFallbackAddress =
      typeof rawParsed.address === "string" &&
      rawParsed.address.trim().length > 0
        ? rawParsed.address.trim()
        : rawPhysical || rawMailing || null;

    const cleanResult: InvoiceOcrResponse = {
      vendorName: (rawParsed.vendorName || "Specialty Coffee Distributor").trim(),
      ...(rawParsed.invoiceDate ? { invoiceDate: rawParsed.invoiceDate.trim() } : {}),
      physicalAddress: rawPhysical,
      mailingAddress: rawMailing,
      address: rawFallbackAddress,
      retailItems: (rawParsed.retailItems || [])
        .filter((item): item is NonNullable<typeof item> & { name: string } => Boolean(item?.name))
        .map((item) => ({
          name: item.name.trim(),
          ...(typeof item.unitCostCents === "number"
            ? { unitCostCents: Math.round(item.unitCostCents) }
            : {}),
          ...(typeof item.suggestedPriceCents === "number"
            ? { suggestedPriceCents: Math.round(item.suggestedPriceCents) }
            : {}),
          ...(item.sku ? { sku: item.sku.trim() } : {}),
        })),
      modifierOptions: (rawParsed.modifierOptions || [])
        .filter((mod): mod is NonNullable<typeof mod> & { name: string } => Boolean(mod?.name))
        .map((mod) => ({
          name: mod.name.trim(),
          targetGroup: (mod.targetGroup || "Flavor Syrups").trim(),
          ...(typeof mod.unitCostCents === "number"
            ? { unitCostCents: Math.round(mod.unitCostCents) }
            : {}),
        })),
      supplies: (rawParsed.supplies || [])
        .filter((sup): sup is NonNullable<typeof sup> & { name: string } => Boolean(sup?.name))
        .map((sup) => ({
          name: sup.name.trim(),
          ...(sup.packSize ? { packSize: sup.packSize.trim() } : {}),
        })),
    };

    return NextResponse.json(cleanResult);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Error processing vendor invoice OCR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

