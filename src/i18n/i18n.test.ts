import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getItemDescription,
  getItemName,
  getItemTranslationRecord,
  getLanguage,
  getMushroomCopy,
  getMushroomTranslationRecord,
  setLanguage,
  SUPPORTED_LANGUAGES,
  t,
  TRANSLATIONS,
  TranslationKey,
} from './i18n';
import {
  createDefaultPackingSelection,
  createInventoryFromPacking,
  ITEM_CATALOG,
  ItemId,
} from '../game/itemCatalog';
import {
  buildInteractionPrompt,
  formatResolutionSummary,
  MUSHROOM_SPECIES_INFO,
  MushroomSpecies,
} from '../game/gameLogic';
import {
  createInitialSurvivalState,
  drinkFromBottle,
  eatFoodItem,
  previewSleepOutcome,
  tryIgniteCampfire,
} from '../game/survivalEngine';
import { BASE_GAME_HOURS_PER_SEC } from '../world/weatherAndSky';

test('all supported languages have complete, non-empty translation parity', () => {
  const enKeys = Object.keys(TRANSLATIONS.en) as TranslationKey[];
  assert.ok(enKeys.length > 100);

  for (const meta of SUPPORTED_LANGUAGES) {
    const dict = TRANSLATIONS[meta.code];
    assert.ok(dict, `Missing dictionary for ${meta.code}`);
    assert.equal(Object.keys(dict).length, enKeys.length);
    for (const key of enKeys) {
      assert.ok(
        typeof dict[key] === 'string' && dict[key].trim().length > 0,
        `Empty translation for ${meta.code}.${key}`
      );
    }
  }
});

test('all 27 catalog items and 7 mushroom species have EN and ET translations', () => {
  const allItemIds = Object.keys(ITEM_CATALOG) as ItemId[];
  assert.equal(allItemIds.length, 27);
  for (const meta of SUPPORTED_LANGUAGES) {
    const itemRecord = getItemTranslationRecord(meta.code);
    for (const itemId of allItemIds) {
      const entry = itemRecord[itemId];
      assert.ok(entry, `Missing item translation ${meta.code}.${itemId}`);
      assert.ok(entry.name.trim().length > 0);
      assert.ok(entry.description.trim().length > 0);
      assert.equal(getItemName(itemId, meta.code), entry.name);
      assert.equal(getItemDescription(itemId, meta.code), entry.description);
    }
  }

  const speciesList = Object.keys(MUSHROOM_SPECIES_INFO) as MushroomSpecies[];
  assert.equal(speciesList.length, 7);
  for (const meta of SUPPORTED_LANGUAGES) {
    const mushRecord = getMushroomTranslationRecord(meta.code);
    for (const sp of speciesList) {
      const entry = mushRecord[sp];
      assert.ok(entry, `Missing mushroom translation ${meta.code}.${sp}`);
      assert.ok(entry.name.trim().length > 0);
      assert.ok(entry.note.trim().length > 0);
      assert.equal(getMushroomCopy(sp, meta.code).name, entry.name);
    }
  }
});

test('runtime language switching updates prompts, resolution summary, and survival engine output', () => {
  assert.equal(getLanguage(), 'en');

  try {
    setLanguage('et');
    assert.equal(getLanguage(), 'et');
    assert.equal(t('title.enterCountryside'), 'Astu maale');

    const promptEt = buildInteractionPrompt(
      {
        name: 'Lamav känd',
        desc: 'Kuiv känd',
        gatherable: false,
        carryable: false,
        kickable: true,
        breakable: true,
        hasUse: false,
      },
      false
    );
    assert.ok(promptEt !== null);
    assert.ok(promptEt.actionsText.includes('[F] Löö puruks'));
    assert.ok(promptEt.actionsText.includes('[R] Uuri'));

    const resSummaryEt = formatResolutionSummary(1440, 900, 1, true);
    assert.ok(resSummaryEt.includes('Automaatne'));

    const inv = createInventoryFromPacking(createDefaultPackingSelection());
    const surv = createInitialSurvivalState(5);
    const eatRes = eatFoodItem(surv, inv, 'chocolate_bar');
    assert.ok(eatRes.ok);
    assert.ok(eatRes.message.includes('Sõid:'));

    const drinkRes = drinkFromBottle(surv, inv, inv.bottles[0].uid);
    assert.ok(drinkRes.ok);
    assert.ok(drinkRes.message.includes('Jõid'));

    const igniteRes = tryIgniteCampfire(inv, 'clear', 0, 0.1);
    assert.ok(igniteRes.ok);
    assert.ok(igniteRes.message.includes('Süütasid'));

    surv.stomachFullness = 0;
    const sleepPreview = previewSleepOutcome(surv, inv, 6, 22, 'clear', 0.4, 'outdoor', 0);
    assert.ok(sleepPreview.warnings.some((w) => w.includes('Tühi kõht')));
  } finally {
    setLanguage('en');
  }

  assert.equal(getLanguage(), 'en');
  assert.equal(t('title.enterCountryside'), 'Enter Countryside');
});

test('base game time speed is reduced by one third (0.06 -> 0.04 game hours per real second)', () => {
  assert.equal(BASE_GAME_HOURS_PER_SEC, 0.04);
});
