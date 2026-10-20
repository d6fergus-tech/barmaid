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

    // 1. Generate unique temporary client IDs for batch linking
    const idCatHot = '#cat_hot_classics';
    const idCatCold = '#cat_cold_bar';
    const idCatFood = '#cat_food_bakery';
    const idCatRetail = '#cat_retail';
    const idCatSpeed = '#cat_speed_keys';

    const idModMilk = '#modlist_milk';
    const idModSyrup = '#modlist_syrups';
    const idModEspresso = '#modlist_espresso';

    // 2. Define full catalog objects matching the 20-slot Ergonomics Studio grid
    const batchObjects = [
      // CATEGORIES
      {
        type: 'CATEGORY',
        id: idCatHot,
        category_data: { name: 'Hot Classics' },
      },
      {
        type: 'CATEGORY',
        id: idCatCold,
        category_data: { name: 'Cold Bar' },
      },
      {
        type: 'CATEGORY',
        id: idCatFood,
        category_data: { name: 'Food & Bakery' },
      },
      {
        type: 'CATEGORY',
        id: idCatRetail,
        category_data: { name: 'Retail Beans' },
      },
      {
        type: 'CATEGORY',
        id: idCatSpeed,
        category_data: { name: 'Speed Modifiers' },
      },

      // MODIFIER LIST: Milk Options
      {
        type: 'MODIFIER_LIST',
        id: idModMilk,
        modifier_list_data: {
          name: 'Milk Choice',
          selection_type: 'SINGLE',
          modifiers: [
            {
              type: 'MODIFIER',
              id: '#mod_whole',
              modifier_data: {
                name: 'Whole Milk',
                price_money: { amount: 0, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_oat',
              modifier_data: {
                name: 'Oat Milk',
                price_money: { amount: 75, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_almond',
              modifier_data: {
                name: 'Almond Milk',
                price_money: { amount: 75, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_breve',
              modifier_data: {
                name: 'Breve',
                price_money: { amount: 85, currency: 'USD' },
              },
            },
          ],
        },
      },

      // MODIFIER LIST: Syrups
      {
        type: 'MODIFIER_LIST',
        id: idModSyrup,
        modifier_list_data: {
          name: 'Flavor Syrups',
          selection_type: 'MULTIPLE',
          modifiers: [
            {
              type: 'MODIFIER',
              id: '#mod_vanilla',
              modifier_data: {
                name: 'Vanilla Syrup',
                price_money: { amount: 60, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_caramel',
              modifier_data: {
                name: 'Caramel Sauce',
                price_money: { amount: 75, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_sf_vanilla',
              modifier_data: {
                name: 'SF Vanilla',
                price_money: { amount: 60, currency: 'USD' },
              },
            },
          ],
        },
      },

      // MODIFIER LIST: Espresso Tuning
      {
        type: 'MODIFIER_LIST',
        id: idModEspresso,
        modifier_list_data: {
          name: 'Espresso Mods',
          selection_type: 'MULTIPLE',
          modifiers: [
            {
              type: 'MODIFIER',
              id: '#mod_extra_shot',
              modifier_data: {
                name: 'Extra Shot',
                price_money: { amount: 95, currency: 'USD' },
              },
            },
            {
              type: 'MODIFIER',
              id: '#mod_decaf',
              modifier_data: {
                name: 'Decaf',
                price_money: { amount: 0, currency: 'USD' },
              },
            },
          ],
        },
      },

      // ROW 1: HOT CLASSICS
      {
        type: 'ITEM',
        id: '#item_drip',
        item_data: {
          name: 'Drip Coffee',
          category_id: idCatHot,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_drip_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 275, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_drip_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 325, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_americano',
        item_data: {
          name: 'Americano',
          category_id: idCatHot,
          modifier_list_info: [
            { modifier_list_id: idModEspresso, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_ame_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 375, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_ame_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 425, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_latte',
        item_data: {
          name: 'Latte',
          category_id: idCatHot,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModSyrup, enabled: true },
            { modifier_list_id: idModEspresso, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_lat_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 450, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_lat_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 525, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_mocha',
        item_data: {
          name: 'Mocha',
          category_id: idCatHot,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModSyrup, enabled: true },
            { modifier_list_id: idModEspresso, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_moc_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 500, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_moc_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 575, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_cappuccino',
        item_data: {
          name: 'Cappuccino',
          category_id: idCatHot,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModEspresso, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_cap_8',
              item_variation_data: {
                name: '8oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 425, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_cap_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 475, currency: 'USD' },
              },
            },
          ],
        },
      },

      // ROW 2: COLD BAR & SPECIALTY
      {
        type: 'ITEM',
        id: '#item_coldbrew',
        item_data: {
          name: 'Cold Brew',
          category_id: idCatCold,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModSyrup, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_cb_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 450, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_cb_20',
              item_variation_data: {
                name: '20oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 525, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_nitrobeer',
        item_data: {
          name: 'Nitro Brew',
          category_id: idCatCold,
          modifier_list_info: [
            { modifier_list_id: idModSyrup, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_nitro_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 550, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_icedtea',
        item_data: {
          name: 'Iced Tea',
          category_id: idCatCold,
          modifier_list_info: [
            { modifier_list_id: idModSyrup, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_tea_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 325, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_tea_24',
              item_variation_data: {
                name: '24oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 395, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_chai',
        item_data: {
          name: 'Chai Latte',
          category_id: idCatCold,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModEspresso, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_chai_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 475, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_chai_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 550, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_matcha',
        item_data: {
          name: 'Matcha',
          category_id: idCatCold,
          modifier_list_info: [
            { modifier_list_id: idModMilk, enabled: true },
            { modifier_list_id: idModSyrup, enabled: true },
          ],
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_mat_12',
              item_variation_data: {
                name: '12oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 525, currency: 'USD' },
              },
            },
            {
              type: 'ITEM_VARIATION',
              id: '#var_mat_16',
              item_variation_data: {
                name: '16oz',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 595, currency: 'USD' },
              },
            },
          ],
        },
      },

      // ROW 3: FOOD & RETAIL
      {
        type: 'ITEM',
        id: '#item_croissant',
        item_data: {
          name: 'Croissant',
          category_id: idCatFood,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_croiss',
              item_variation_data: {
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 475, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_bagel',
        item_data: {
          name: 'Bagel w/ Cream',
          category_id: idCatFood,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_bagel',
              item_variation_data: {
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 425, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_cookie',
        item_data: {
          name: 'Cookie',
          category_id: idCatFood,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_cookie',
              item_variation_data: {
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 350, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_burrito',
        item_data: {
          name: 'Breakfast Burrito',
          category_id: idCatFood,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_burrito',
              item_variation_data: {
                name: 'Regular',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 750, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_beans',
        item_data: {
          name: 'Retail Beans 12oz',
          category_id: idCatRetail,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_beans',
              item_variation_data: {
                name: 'Whole Bean',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 1800, currency: 'USD' },
              },
            },
          ],
        },
      },

      // ROW 4: SPEED MODIFIERS (Direct Register Action Keys)
      {
        type: 'ITEM',
        id: '#item_sub_oat',
        item_data: {
          name: 'Sub Oat',
          category_id: idCatSpeed,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_sub_oat',
              item_variation_data: {
                name: 'Modifier Key',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 75, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_sub_breve',
        item_data: {
          name: 'Sub Breve',
          category_id: idCatSpeed,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_sub_breve',
              item_variation_data: {
                name: 'Modifier Key',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 85, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_extra_shot',
        item_data: {
          name: 'Extra Shot',
          category_id: idCatSpeed,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_extra_shot',
              item_variation_data: {
                name: 'Modifier Key',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 95, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_vanilla_syrup',
        item_data: {
          name: 'Vanilla Syrup',
          category_id: idCatSpeed,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_vanilla_syrup',
              item_variation_data: {
                name: 'Modifier Key',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 60, currency: 'USD' },
              },
            },
          ],
        },
      },
      {
        type: 'ITEM',
        id: '#item_caramel_sauce',
        item_data: {
          name: 'Caramel Sauce',
          category_id: idCatSpeed,
          variations: [
            {
              type: 'ITEM_VARIATION',
              id: '#var_caramel_sauce',
              item_variation_data: {
                name: 'Modifier Key',
                pricing_type: 'FIXED_PRICING',
                price_money: { amount: 75, currency: 'USD' },
              },
            },
          ],
        },
      },
    ];

    // 3. Batch upsert the full catalog into Square Production
    const squareRes = await fetch(
      'https://connect.squareup.com/v2/catalog/batch-upsert',
      {
        method: 'POST',
        headers: {
          'Square-Version': '2025-01-23',
          Authorization: `Bearer ${squareToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idempotency_key: `deploy_full_grid_${Date.now()}`,
          batches: [{ objects: batchObjects }],
        }),
      }
    );

    const data = await squareRes.json();

    if (!squareRes.ok) {
      return NextResponse.json(
        { error: 'Failed to deploy to Square', details: data },
        { status: squareRes.status }
      );
    }

    return NextResponse.json({
      success: true,
      merchantSlug: 'konowac-coffee',
      deployedCount: batchObjects.length,
      objects: data.objects,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}