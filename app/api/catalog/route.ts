import { NextResponse } from "next/server";
import { Client, Environment } from "square/legacy";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedSlug =
      searchParams.get("merchant_slug") ||
      process.env.NEXT_PUBLIC_DEFAULT_MERCHANT_SLUG ||
      "highway-espresso";

    const headerToken =
      request.headers.get("x-square-access-token")?.trim() ||
      request.headers
        .get("authorization")
        ?.replace(/^Bearer\s+/i, "")
        .trim() ||
      "";

    const envToken = process.env.SQUARE_ACCESS_TOKEN?.trim() || "";
    const primaryToken =
      headerToken && headerToken !== "USE_SERVER_ENV" ? headerToken : envToken;

    if (!primaryToken) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Square Access Token is missing. Paste a valid Bearer token or configure SQUARE_ACCESS_TOKEN.",
        },
        { status: 400 }
      );
    }

    let response;
    try {
      const client = new Client({
        accessToken: primaryToken,
        environment: Environment.Production,
      });
      response = await client.catalogApi.listCatalog(
        undefined,
        "CATEGORY,ITEM,MODIFIER_LIST"
      );
    } catch (primaryErr: unknown) {
      if (envToken && primaryToken !== envToken) {
        const fallbackClient = new Client({
          accessToken: envToken,
          environment: Environment.Production,
        });
        response = await fallbackClient.catalogApi.listCatalog(
          undefined,
          "CATEGORY,ITEM,MODIFIER_LIST"
        );
      } else {
        throw primaryErr;
      }
    }

    const objects = response.result.objects || [];

    const categories = objects
      .filter((obj) => obj.type === "CATEGORY")
      .map((cat) => ({
        id: cat.id,
        name: cat.categoryData?.name || "Unnamed Category",
        category_data: {
          name: cat.categoryData?.name || "Unnamed Category",
        },
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
        modifier_list_data: {
          name: modList.modifierListData?.name || "Unnamed Modifier List",
          modifiers: (modList.modifierListData?.modifiers || []).map((m) => ({
            id: m.id,
            modifier_data: {
              name: m.modifierData?.name || "Unnamed Modifier",
              price_money: {
                amount: Number(m.modifierData?.priceMoney?.amount || 0),
              },
            },
          })),
        },
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
        item_data: {
          name: item.itemData?.name || "Unnamed Item",
          category_id: item.itemData?.categoryId || undefined,
          variations: (item.itemData?.variations || []).map((v) => ({
            id: v.id,
            item_variation_data: {
              name: v.itemVariationData?.name || "Regular",
              price_money: {
                amount: Number(v.itemVariationData?.priceMoney?.amount || 0),
              },
            },
          })),
        },
      }));

    return NextResponse.json({
      success: true,
      merchantSlug: requestedSlug,
      totalObjects: objects.length,
      categories,
      modifierLists,
      items,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to fetch catalog from Square";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
