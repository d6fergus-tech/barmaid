import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const squareToken = process.env.SQUARE_ACCESS_TOKEN;
    if (!squareToken) {
      return NextResponse.json(
        { error: "SQUARE_ACCESS_TOKEN is missing in .env.local" },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { categories, modifiers } = body;

    if (!categories || !Array.isArray(categories)) {
      return NextResponse.json({ error: "Invalid payload format" }, { status: 400 });
    }

    const batches: any[] = [];

    // 1. Modifiers batch
    let modifierListId = "#modlist_ocr_addons";
    if (modifiers && modifiers.length > 0) {
      batches.push({
        type: "MODIFIER_LIST",
        id: modifierListId,
        modifier_list_data: {
          name: "Add-ons & Substitutions",
          selection_type: "MULTIPLE",
          modifiers: modifiers.map((mod: { name: string; price: number }, idx: number) => ({
            type: "MODIFIER",
            id: `#mod_item_${idx}`,
            modifier_data: {
              name: mod.name,
              price_money: {
                amount: Math.round(Number(mod.price || 0) * 100),
                currency: "USD",
              },
            },
          })),
        },
      });
    }

    // 2. Categories & Items
    categories.forEach((cat: { categoryName: string; items: any[] }, catIdx: number) => {
      const catId = `#cat_ocr_${catIdx}`;
      batches.push({
        type: "CATEGORY",
        id: catId,
        category_data: {
          name: cat.categoryName,
        },
      });

      cat.items.forEach((item: { name: string; description?: string; variations: any[] }, itemIdx: number) => {
        const itemId = `#item_ocr_${catIdx}_${itemIdx}`;
        batches.push({
          type: "ITEM",
          id: itemId,
          item_data: {
            name: item.name,
            description: item.description || "",
            category_id: catId,
            modifier_list_info: modifiers && modifiers.length > 0 ? [{ modifier_list_id: modifierListId }] : [],
            variations: (item.variations || [{ size: "Regular", price: 3.5 }]).map(
              (v: { size: string; price: number }, vIdx: number) => ({
                type: "ITEM_VARIATION",
                id: `#var_ocr_${catIdx}_${itemIdx}_${vIdx}`,
                item_variation_data: {
                  name: v.size || "Regular",
                  pricing_type: "FIXED_PRICING",
                  price_money: {
                    amount: Math.round(Number(v.price || 0) * 100),
                    currency: "USD",
                  },
                },
              })
            ),
          },
        });
      });
    });

    const res = await fetch("https://connect.squareup.com/v2/catalog/batch-upsert", {
      method: "POST",
      headers: {
        "Square-Version": "2025-01-23",
        Authorization: `Bearer ${squareToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: `ocr_inject_${Date.now()}`,
        batches: [{ objects: batches }],
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: "Square injection failed", details: data }, { status: res.status });
    }

    return NextResponse.json({
      success: true,
      injectedObjectsCount: data.objects ? data.objects.length : batches.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error injecting OCR catalog";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}