import { NextResponse } from 'next/server';

export async function POST() {
  try {
    const squareToken = process.env.SQUARE_ACCESS_TOKEN;
    if (!squareToken) {
      return NextResponse.json(
        { error: 'SQUARE_ACCESS_TOKEN is missing in .env.local' },
        { status: 500 }
      );
    }

    // 1. Fetch all items, categories, and modifier lists currently in Square
    const listRes = await fetch(
      'https://connect.squareup.com/v2/catalog/list?types=ITEM,CATEGORY,MODIFIER_LIST',
      {
        method: 'GET',
        headers: {
          'Square-Version': '2025-01-23',
          Authorization: `Bearer ${squareToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const listData = await listRes.json();
    if (!listRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch catalog list', details: listData },
        { status: listRes.status }
      );
    }

    const allObjects = listData.objects || [];
    const items = allObjects.filter((obj: { type: string }) => obj.type === 'ITEM');

    // 2. Identify duplicates by normalizing item names
    // Examples: "Caffe Americano" -> "americano", "Americano" -> "americano"
    const normalize = (str: string) =>
      str
        .toLowerCase()
        .replace(/caffe\s+/g, '')
        .replace(/[^a-z0-9]/g, '');

    const groupedByName: { [key: string]: any[] } = {};

    for (const item of items) {
      const nameKey = normalize(item.item_data.name);
      if (!groupedByName[nameKey]) {
        groupedByName[nameKey] = [];
      }
      groupedByName[nameKey].push(item);
    }

    const idsToDelete: string[] = [];
    const preservedItemNames: string[] = [];

    for (const [key, group] of Object.entries(groupedByName)) {
      if (group.length > 1) {
        // Sort descending: keep the item that has the most complete configuration
        // (modifier attachments and variations) or the newest updated_at
        group.sort((a, b) => {
          const aModifiers = a.item_data.modifier_list_info?.length || 0;
          const bModifiers = b.item_data.modifier_list_info?.length || 0;
          if (bModifiers !== aModifiers) return bModifiers - aModifiers;

          const aVariations = a.item_data.variations?.length || 0;
          const bVariations = b.item_data.variations?.length || 0;
          if (bVariations !== aVariations) return bVariations - aVariations;

          return (
            new Date(b.updated_at || 0).getTime() -
            new Date(a.updated_at || 0).getTime()
          );
        });

        const keep = group[0];
        preservedItemNames.push(keep.item_data.name);

        // Mark all older/inferior copies for deletion
        for (let i = 1; i < group.length; i++) {
          idsToDelete.push(group[i].id);
        }
      } else {
        preservedItemNames.push(group[0].item_data.name);
      }
    }

    // 3. Batch delete all duplicate item IDs if any were found
    let deleteResult = null;
    if (idsToDelete.length > 0) {
      const deleteRes = await fetch(
        'https://connect.squareup.com/v2/catalog/batch-delete',
        {
          method: 'POST',
          headers: {
            'Square-Version': '2025-01-23',
            Authorization: `Bearer ${squareToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            object_ids: idsToDelete,
          }),
        }
      );

      deleteResult = await deleteRes.json();
      if (!deleteRes.ok) {
        return NextResponse.json(
          { error: 'Failed to delete duplicates', details: deleteResult },
          { status: deleteRes.status }
        );
      }
    }

    return NextResponse.json({
      success: true,
      deletedCount: idsToDelete.length,
      deletedObjectIds: idsToDelete,
      preservedItems: preservedItemNames,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}