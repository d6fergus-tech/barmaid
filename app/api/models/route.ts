import { NextResponse } from "next/server";
import { GoogleGenAI, type Model } from "@google/genai";

interface ModelSummary {
  name?: string;
  displayName?: string;
  supportedActions?: string[];
}

export async function GET() {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    // Fetch the live list of models available to this API key
    const response = await ai.models.list();

    const modelNames: ModelSummary[] = [];
    for await (const model of response) {
      const typedModel: Model = model;
      modelNames.push({
        name: typedModel.name,
        displayName: typedModel.displayName,
        supportedActions: typedModel.supportedActions,
      });
    }

    return NextResponse.json({
      success: true,
      total: modelNames.length,
      models: modelNames,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list models";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
