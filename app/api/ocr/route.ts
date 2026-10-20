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
- legalName: Legal entity name (e.g., "Konnowac Coffee Roasters LLC")
- dbaName: DBA / Trade name (e.g., "Konnowac Coffee")
- address: Street address
- city: City name
- state: 2-letter state code (e.g., "WA")
- zip: Postal ZIP code
- suggestedSlug: Lowercase kebab-case tenant identifier derived from the DBA or Legal Name (e.g., "konnowac-coffee")
Return strictly valid JSON matching the schema.
`;

      const licenseSchema = {
        type: Type.OBJECT,
        properties: {
          legalName: { type: Type.STRING },
          dbaName: { type: Type.STRING },
          address: { type: Type.STRING },
          city: { type: Type.STRING },
          state: { type: Type.STRING },
          zip: { type: Type.STRING },
          suggestedSlug: { type: Type.STRING },
        },
        required: [
          "legalName",
          "dbaName",
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
Analyze the provided café menu image (chalkboard, printed paper menu, or wall board).
Extract all categories, drink/food items, size variations, and modifiers/add-ons.

Rules:
1. Normalize names into standard coffee shop casing (e.g., "Vanilla Latte", "Cold Brew", "Caramel Macchiato").
2. Capture numeric prices in dollars as decimals (e.g., 4.75). If only a single price is shown, assume standard single variation.
3. Group sizes under variations (e.g. name: "16oz", price: 5.25).
4. Extract universal modifiers (e.g., Oat Milk, Breve, Extra Shot, Flavor Syrups) under modifiers.
Return cleanly formatted data matching the schema.
`;

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
          responseSchema: {
            type: Type.OBJECT,
            properties: {
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
          },
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
