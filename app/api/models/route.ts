import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export async function GET() {
  try {
    const ai = new GoogleGenAI();
    // Fetch the live list of models available to this API key
    const response = await ai.models.list();
    
    const modelNames = [];
    for await (const model of response) {
      modelNames.push({
        name: model.name,
        displayName: model.displayName,
        supportedActions: model.supportedGenerationMethods,
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