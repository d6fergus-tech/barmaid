import { NextResponse } from "next/server";
import { Client, Environment } from "square/legacy";
import crypto from "crypto";

export async function POST() {
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

    // 1. Fetch existing objects to identify steakhouse junk
    const existing = await client.catalogApi.listCatalog(
      undefined,
      "CATEGORY,MODIFIER_LIST"
    );
    const objects = existing.result.objects || [];

    const junkNames = ["Liquor", "Beer", "Wine", "Temperature"];
    const objectIdsToDelete = objects
      .filter((obj) => {
        const catName = obj.categoryData?.name;
        const modName = obj.modifierListData?.name;
        return (catName && junkNames.includes(catName)) || (modName && junkNames.includes(modName));
      })
      .map((obj) => obj.id);

    if (objectIdsToDelete.length > 0) {
      await client.catalogApi.batchDeleteCatalogObjects({
        objectIds: objectIdsToDelete,
      });
    }

    // 2. Batch upsert clean coffee structure
    const idempotencyKey = crypto.randomUUID();

    const upsertResponse = await client.catalogApi.batchUpsertCatalogObjects({
      idempotencyKey,
      batches: [
        {
          objects: [
            // Category 1: Espresso Drinks
            {
              type: "CATEGORY",
              id: "#cat_espresso",
              categoryData: {
                name: "Espresso Drinks",
              },
            },
            // Category 2: Cold Bar
            {
              type: "CATEGORY",
              id: "#cat_cold",
              categoryData: {
                name: "Cold Bar",
              },
            },
            // Category 3: Drip & Tea
            {
              type: "CATEGORY",
              id: "#cat_drip",
              categoryData: {
                name: "Drip & Tea",
              },
            },
            // Modifier List: Milk Choice
            {
              type: "MODIFIER_LIST",
              id: "#mod_milks",
              modifierListData: {
                name: "Milk Choice",
                selectionType: "MULTIPLE",
                modifiers: [
                  {
                    type: "MODIFIER",
                    id: "#mod_whole",
                    modifierData: {
                      name: "Whole Milk",
                      priceMoney: { amount: BigInt(0), currency: "USD" },
                    },
                  },
                  {
                    type: "MODIFIER",
                    id: "#mod_oat",
                    modifierData: {
                      name: "Oat Milk",
                      priceMoney: { amount: BigInt(75), currency: "USD" },
                    },
                  },
                  {
                    type: "MODIFIER",
                    id: "#mod_almond",
                    modifierData: {
                      name: "Almond Milk",
                      priceMoney: { amount: BigInt(75), currency: "USD" },
                    },
                  },
                  {
                    type: "MODIFIER",
                    id: "#mod_breve",
                    modifierData: {
                      name: "Breve",
                      priceMoney: { amount: BigInt(75), currency: "USD" },
                    },
                  },
                ],
              },
            },
            // Item: Caffe Latte
            {
              type: "ITEM",
              id: "#item_latte",
              itemData: {
                name: "Caffe Latte",
                categoryId: "#cat_espresso",
                modifierListInfo: [
                  {
                    modifierListId: "#mod_milks",
                    minSelectedModifiers: 1,
                    maxSelectedModifiers: 1,
                    enabled: true,
                  },
                ],
                variations: [
                  {
                    type: "ITEM_VARIATION",
                    id: "#var_latte_12",
                    itemVariationData: {
                      name: "12oz",
                      pricingType: "FIXED_PRICING",
                      priceMoney: { amount: BigInt(450), currency: "USD" },
                    },
                  },
                  {
                    type: "ITEM_VARIATION",
                    id: "#var_latte_16",
                    itemVariationData: {
                      name: "16oz",
                      pricingType: "FIXED_PRICING",
                      priceMoney: { amount: BigInt(525), currency: "USD" },
                    },
                  },
                ],
              },
            },
            // Item: Americano
            {
              type: "ITEM",
              id: "#item_americano",
              itemData: {
                name: "Caffe Americano",
                categoryId: "#cat_espresso",
                variations: [
                  {
                    type: "ITEM_VARIATION",
                    id: "#var_amer_12",
                    itemVariationData: {
                      name: "12oz",
                      pricingType: "FIXED_PRICING",
                      priceMoney: { amount: BigInt(375), currency: "USD" },
                    },
                  },
                  {
                    type: "ITEM_VARIATION",
                    id: "#var_amer_16",
                    itemVariationData: {
                      name: "16oz",
                      pricingType: "FIXED_PRICING",
                      priceMoney: { amount: BigInt(425), currency: "USD" },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    return NextResponse.json({
      success: true,
      deletedObjectsCount: objectIdsToDelete.length,
      createdObjectsCount: upsertResponse.result.objects?.length || 0,
      message: "Catalog successfully cleaned and seeded with coffee baseline.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to seed catalog";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}