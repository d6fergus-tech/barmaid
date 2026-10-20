import { NextResponse } from "next/server";
import { Client, Environment } from "square/legacy";

export async function GET() {
  try {
    const accessToken = process.env.SQUARE_ACCESS_TOKEN;

    if (!accessToken) {
      return NextResponse.json(
        { error: "SQUARE_ACCESS_TOKEN is missing from environment variables." },
        { status: 500 }
      );
    }

    const client = new Client({
      accessToken: accessToken,
      environment: Environment.Production,
    });

    const response = await client.catalogApi.listCatalog(
      undefined,
      "CATEGORY,ITEM,MODIFIER_LIST"
    );

    const objects = response.result.objects || [];

    const categories = objects
      .filter((obj) => obj.type === "CATEGORY")
      .map((cat) => ({
        id: cat.id,
        name: cat.categoryData?.name || "Unnamed Category",
      }));

    const modifierLists = objects
      .filter((obj) => obj.type === "MODIFIER_LIST")
      .map((modList) => ({
        id: modList.id,
        name: modList.modifierListData?.name || "Unnamed Modifier List",
        modifiers: (modList.modifierListData?.modifiers || []).map((m) => ({
          id: m.id,
          name: m.modifierData?.name || "Unnamed Modifier",
          priceCents: Number(m.modifierData?.priceMoney?.amount || 0),
        })),
      }));

    const items = objects
      .filter((obj) => obj.type === "ITEM")
      .map((item) => ({
        id: item.id,
        name: item.itemData?.name || "Unnamed Item",
        categoryId: item.itemData?.categoryId || null,
        variations: (item.itemData?.variations || []).map((v) => ({
          id: v.id,
          name: v.itemVariationData?.name || "Regular",
          priceCents: Number(v.itemVariationData?.priceMoney?.amount || 0),
        })),
        modifierListInfo: item.itemData?.modifierListInfo || [],
      }));

    return NextResponse.json({
      success: true,
      merchantSlug: process.env.NEXT_PUBLIC_DEFAULT_MERCHANT_SLUG || "konowac-coffee",
      totalObjects: objects.length,
      categories,
      modifierLists,
      items,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch catalog from Square";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}