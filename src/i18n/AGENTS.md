# Localization

`i18n.ts` provides the English/Estonian language registry, persisted/query-selected language, typed UI translations and interpolation, item/mushroom copy, localized labels, and React/external subscriptions. `i18n.test.ts` checks localization behavior.

Add matching translations for every supported language. Preserve typed key parity and interpolation parameters. Keep gameplay rules and canonical item/species IDs independent of translated text.

The F8 capture controls use localized labels. Keep exported performance log keys stable across languages.

React uses `useLanguage`; the imperative world uses `t` and `subscribeLanguage`. Interactive props expose getter callbacks for current-language names/descriptions. Preserve live switching for prompts, carried-item labels, HUD, and snapshots rather than caching translated strings at construction.

Run the localization tests and type checking. Check language switching during gameplay and inside affected modals when modifying displayed copy or subscription wiring.

The title spinner uses the English and Estonian `title.loading.*` keys selected by the runtime stage.
