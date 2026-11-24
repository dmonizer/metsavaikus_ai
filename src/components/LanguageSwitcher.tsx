import React from 'react';
import { Globe } from 'lucide-react';
import { LanguageCode, SUPPORTED_LANGUAGES, useLanguage } from '../i18n/i18n';

interface LanguageSwitcherProps {
  compact?: boolean;
  className?: string;
}

/**
 * Instant, zero-reload language switcher.
 * Renders a crisp segmented control for up to 3 languages and automatically
 * switches to a compact select menu if more languages are registered later.
 */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({
  compact = false,
  className = '',
}) => {
  const { lang, setLang, t } = useLanguage();

  if (SUPPORTED_LANGUAGES.length > 3) {
    return (
      <label
        className={`inline-flex items-center gap-1.5 rounded-md bg-[#0c120e]/85 border border-white/12 px-2 py-1 text-xs text-[#d6e2d5] ${className}`}
      >
        <Globe className="w-3.5 h-3.5 text-[#98b197] shrink-0" aria-hidden="true" />
        <select
          data-testid="lang-select"
          aria-label={t('lang.ariaLabel')}
          value={lang}
          onChange={(e) => {
            setLang(e.target.value as LanguageCode);
            e.currentTarget.blur();
          }}
          className="bg-transparent text-xs font-medium text-[#e9f0e6] focus:outline-none cursor-pointer"
        >
          {SUPPORTED_LANGUAGES.map((meta) => (
            <option key={meta.code} value={meta.code} className="bg-[#0e1511] text-[#e9f0e6]">
              {meta.nativeName}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('lang.ariaLabel')}
      data-testid="language-switcher"
      className={`inline-flex items-center rounded-md bg-[#0c120e]/85 border border-white/12 p-0.5 ${className}`}
    >
      {!compact && (
        <Globe
          className="w-3.5 h-3.5 text-[#8ea58d] mx-1.5 shrink-0"
          aria-hidden="true"
        />
      )}
      {SUPPORTED_LANGUAGES.map((meta) => {
        const active = meta.code === lang;
        return (
          <button
            key={meta.code}
            type="button"
            tabIndex={-1}
            data-testid={`lang-switch-${meta.code}`}
            aria-pressed={active}
            title={meta.nativeName}
            onClick={(e) => {
              e.currentTarget.blur();
              setLang(meta.code);
            }}
            className={`px-2 py-1 text-[11px] font-mono font-semibold tracking-wider uppercase rounded-[4px] transition-colors cursor-pointer ${
              active
                ? 'bg-[#35523b] text-[#f4f7f2]'
                : 'text-[#9fb39e] hover:text-[#edf3ea] hover:bg-white/6'
            }`}
          >
            {meta.shortLabel}
          </button>
        );
      })}
    </div>
  );
};
