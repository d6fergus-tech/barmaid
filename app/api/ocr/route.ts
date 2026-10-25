import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";

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
    const file = formData.get("file") as File | null;
    const documentType = (formData.get("documentType") as string | null) || "menu";

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");
    const mimeType = file.type || "image/jpeg";

    const ai = new GoogleGenAI({ apiKey });

    if (documentType === "license") {
      const licensePrompt = `
You are an expert business registration and municipal license OCR parser for BarMaid.
Analyze the provided business license, health permit, or state registration document image.
Extract:
- legalEntityName: Official legal entity name on the registration/license (e.g., "Konnowac Coffee Roasters LLC")
- legalName: Same as legalEntityName for backwards compatibility
- tradeName: Explicit DBA / Trade name if listed on the license (e.g., "Highway Espresso"). If the license does NOT explicitly state a separate DBA or Trade Name, return "" (empty string) rather than repeating the legal entity name.
- dbaName: Same as tradeName for backwards compatibility
- hasExplicitTradeName: true ONLY if the license explicitly specifies a DBA / Trade Name / Doing Business As distinct from the legal entity name, otherwise false
- physicalAddress: Physical stand / premises / "Ship To" / location address if present, or null
- mailingAddress: Mailing / corporate office / PO Box / "Bill To" address if present, or null
- address: Fallback single street/full address if only one address block exists (or the physical address)
- city: City name
- state: 2-letter state code (e.g., "WA")
- zip: Postal ZIP code
- suggestedSlug: Lowercase kebab-case tenant identifier derived from the tradeName (if present) or legalEntityName (e.g., "highway-espresso")
Return strictly valid JSON matching the schema.
`;

      const licenseSchema = {
        type: Type.OBJECT,
        properties: {
          legalEntityName: { type: Type.STRING },
          legalName: { type: Type.STRING },
          tradeName: { type: Type.STRING },
          dbaName: { type: Type.STRING },
          hasExplicitTradeName: { type: Type.BOOLEAN },
          physicalAddress: { type: Type.STRING, nullable: true },
          mailingAddress: { type: Type.STRING, nullable: true },
          address: { type: Type.STRING, nullable: true },
          city: { type: Type.STRING },
          state: { type: Type.STRING },
          zip: { type: Type.STRING },
          suggestedSlug: { type: Type.STRING },
        },
        required: [
          "legalEntityName",
          "legalName",
          "tradeName",
          "dbaName",
          "hasExplicitTradeName",
          "address",
          "city",
          "state",
          "zip",
          "suggestedSlug",
        ],
      };

      let licenseResponse;
      try {
        licenseResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash-lite",
          contents: [
            {
              role: "user",
              parts: [
                { text: licensePrompt },
                { inlineData: { data: base64Data, mimeType } },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: licenseSchema,
          },
        });
      } catch {
        licenseResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: [
            {
              role: "user",
              parts: [
                { text: licensePrompt },
                { inlineData: { data: base64Data, mimeType } },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: licenseSchema,
          },
        });
      }

      const parsedLicense = JSON.parse(licenseResponse.text || "{}");
      return NextResponse.json({
        success: true,
        data: parsedLicense,
      });
    }

    const prompt = `
You are an expert café POS and specialty coffee menu architect.
Analyze the provided café menu image (chalkboard, drive-thru panel, printed flyer, or wall board).
Extract the storefront/signboard trade name (if visible), all categories, drink/food items, size variations, and modifiers/add-ons.

Rules:
1. Look closely for shop titles, banner text, logo headers, or top-level signboard branding (e.g., "Highway Espresso", "Old Town Cafe"). Populate detectedStoreName with the clean shop/trade name if visible, or null if no store branding header appears on the board.
2. Normalize item names into standard coffee shop casing (e.g., "Vanilla Latte", "Cold Brew", "Caramel Macchiato").
3. Capture numeric prices in dollars as decimals (e.g., 4.75). If only a single price is shown, assume standard single variation.
4. Group sizes under variations (e.g. size: "16oz", price: 5.25).
5. Extract universal modifiers (e.g., Oat Milk, Breve, Extra Shot, Flavor Syrups) under modifiers.
Return cleanly formatted data matching the schema.
`;

    const menuSchema = {
      type: Type.OBJECT,
      properties: {
        detectedStoreName: {
          type: Type.STRING,
          nullable: true,
        },
        categories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              categoryName: { type: Type.STRING },
              items: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    description: { type: Type.STRING },
                    variations: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          size: { type: Type.STRING },
                          price: { type: Type.NUMBER },
                        },
                        required: ["size", "price"],
                      },
                    },
                  },
                  required: ["name", "variations"],
                },
              },
            },
            required: ["categoryName", "items"],
          },
        },
        modifiers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              price: { type: Type.NUMBER },
            },
            required: ["name", "price"],
          },
        },
      },
      required: ["categories"],
    };

    let response;
    try {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash-lite",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: menuSchema,
        },
      });
    } catch {
      response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: mimeType,
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: menuSchema,
        },
      });
    }

    const parsedJson = JSON.parse(response.text || "{}");

    return NextResponse.json({
      success: true,
      data: parsedJson,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error processing menu OCR";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
