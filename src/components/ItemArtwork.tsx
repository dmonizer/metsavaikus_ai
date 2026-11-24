import React from 'react';
import { ItemId, WaterQuality } from '../game/itemCatalog';

interface ItemArtworkProps {
  itemId: ItemId;
  className?: string;
  /** Optional 0..1 water fill ratio for water bottles */
  waterFillRatio?: number;
  /** Optional water quality tint for bottles */
  waterQuality?: WaterQuality;
}

function getWaterFillColor(quality: WaterQuality): { top: string; bottom: string } {
  if (quality === 'stale') return { top: '#7c9a4d', bottom: '#4d6629' };
  if (quality === 'bog') return { top: '#a8844c', bottom: '#6b4e27' };
  return { top: '#73c2e1', bottom: '#367da3' };
}

/**
 * Bespoke crisp vector artwork for every item in Metsavaikus.
 * Adding a new item later only requires adding a matching case here.
 */
export const ItemArtwork: React.FC<ItemArtworkProps> = ({
  itemId,
  className = 'w-11 h-11',
  waterFillRatio = 1,
  waterQuality = 'clean',
}) => {
  const clampedFill = Math.max(0, Math.min(1, waterFillRatio));
  const waterCols = getWaterFillColor(waterQuality);

  switch (itemId) {
    case 'compass':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <circle cx="32" cy="11" r="4.5" fill="none" stroke="#c8a86b" strokeWidth="2.5" />
          <circle cx="32" cy="35" r="21" fill="#8b6e3f" stroke="#d9be83" strokeWidth="2.5" />
          <circle cx="32" cy="35" r="17" fill="#16201a" stroke="#57472a" strokeWidth="1.5" />
          <circle cx="32" cy="35" r="14.5" fill="none" stroke="#475c4b" strokeWidth="0.9" strokeDasharray="2 2" />
          <path d="M32 20v3M32 47v3M17 35h3M44 35h3" stroke="#9db59c" strokeWidth="1.4" strokeLinecap="round" />
          <polygon points="32,22 36,35 32,33 28,35" fill="#d94f3d" />
          <polygon points="32,48 36,35 32,37 28,35" fill="#e6decb" />
          <circle cx="32" cy="35" r="2.6" fill="#d9be83" stroke="#221b11" strokeWidth="1" />
          <path d="M22 25a13 13 0 0 1 16-2" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'paper_map':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <polygon points="8,16 24,11 24,50 8,55" fill="#d9cca8" stroke="#66583d" strokeWidth="1.6" />
          <polygon points="24,11 40,16 40,55 24,50" fill="#c7b992" stroke="#66583d" strokeWidth="1.6" />
          <polygon points="40,16 56,11 56,50 40,55" fill="#dfd2b0" stroke="#66583d" strokeWidth="1.6" />
          <ellipse cx="47" cy="35" rx="6" ry="9" fill="#5e8c9e" opacity="0.78" />
          <path d="M12 25c4-3 8-2 10 2s-2 8-7 7" fill="#6f8d5b" opacity="0.7" />
          <path d="M27 22c5 2 8 6 10 12" fill="none" stroke="#a64b37" strokeWidth="2" strokeDasharray="3 2" strokeLinecap="round" />
          <path d="M11 44c8-6 18-3 27 2" fill="none" stroke="#7d6c4d" strokeWidth="1.2" />
          <path d="M27 38c6-1 9-4 11-9" fill="none" stroke="#7d6c4d" strokeWidth="1.1" />
          <circle cx="29" cy="24" r="2.2" fill="#9c3f2e" />
        </svg>
      );

    case 'bottle_05l': {
      const h = 24 * clampedFill;
      const y = 51 - h;
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="26" y="10" width="12" height="6" rx="2" fill="#46584f" stroke="#8aa396" strokeWidth="1.4" />
          <path d="M27 16h10l4 7v26a5 5 0 0 1-5 5H28a5 5 0 0 1-5-5V23l4-7z" fill="#1e2c2a" stroke="#93b4b0" strokeWidth="1.8" />
          {clampedFill > 0.01 && (
            <rect x="24.5" y={y} width="15" height={h} rx="2.5" fill={waterCols.top} opacity="0.88" />
          )}
          <rect x="24.5" y="34" width="15" height="3" fill="#2e3f3a" opacity="0.7" />
          <path d="M27 24v22" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    }

    case 'bottle_1l': {
      const h = 28 * clampedFill;
      const y = 53 - h;
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="25" y="8" width="14" height="6" rx="2" fill="#3a4c42" stroke="#86a190" strokeWidth="1.5" />
          <path d="M39 11c5 0 7 4 5 8" fill="none" stroke="#86a190" strokeWidth="1.6" strokeLinecap="round" />
          <rect x="19" y="18" width="26" height="37" rx="6" fill="#1b2a27" stroke="#8eb3ad" strokeWidth="1.8" />
          {clampedFill > 0.01 && (
            <rect x="21" y={y} width="22" height={h} rx="4" fill={waterCols.top} opacity="0.88" />
          )}
          <path d="M21 31h22M21 40h22" stroke="#1b2a27" strokeOpacity="0.45" strokeWidth="1.5" />
          <path d="M24 23v26" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    }

    case 'bottle_2l': {
      const h = 30 * clampedFill;
      const y = 54 - h;
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="24" y="7" width="14" height="6" rx="2" fill="#4e6157" stroke="#99b3a4" strokeWidth="1.5" />
          <path d="M46 24h5a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4h-5" fill="none" stroke="#8eb3ad" strokeWidth="3.2" strokeLinecap="round" />
          <rect x="13" y="16" width="34" height="40" rx="7" fill="#192826" stroke="#8eb3ad" strokeWidth="1.8" />
          {clampedFill > 0.01 && (
            <rect x="15.5" y={y} width="29" height={h} rx="4.5" fill={waterCols.bottom} opacity="0.9" />
          )}
          {clampedFill > 0.05 && (
            <rect x="15.5" y={y} width="29" height={Math.min(7, h)} rx="2" fill={waterCols.top} opacity="0.85" />
          )}
          <path d="M18 22v28" stroke="#ffffff" strokeOpacity="0.26" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
      );
    }

    case 'raw_steak':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path
            d="M12 36c0-13 11-20 24-20 12 0 18 6 18 15 0 11-9 18-23 18-12 0-19-5-19-13z"
            fill="#8c2623"
            stroke="#e3c6b5"
            strokeWidth="2.4"
          />
          <path
            d="M17 35c0-9 8-14 19-14 8 0 13 4 13 10 0 8-7 13-18 13-9 0-14-3-14-9z"
            fill="#b33832"
          />
          <path
            d="M22 27c5 2 8 6 6 12M31 23c2 5 6 7 12 6M35 37c4-2 8-1 10 2"
            fill="none"
            stroke="#f0d9c9"
            strokeWidth="1.8"
            strokeLinecap="round"
            opacity="0.75"
          />
          <ellipse cx="26" cy="34" rx="4" ry="2.8" fill="#f3e6d8" stroke="#c9b49e" strokeWidth="1.2" />
        </svg>
      );

    case 'seared_steak':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path
            d="M11 36c0-13 11-20 24-20 12 0 18 6 18 15 0 11-9 18-23 18-12 0-19-5-19-13z"
            fill="#5e2d1a"
            stroke="#36180d"
            strokeWidth="2.2"
          />
          <path
            d="M16 35c0-9 8-14 19-14 8 0 13 4 13 10 0 8-7 13-18 13-9 0-14-3-14-9z"
            fill="#7d3d22"
          />
          <path
            d="M21 25l10 17M29 22l11 18M38 23l8 13"
            stroke="#291108"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
          <path d="M23 16c0-3 2-5 1-8M33 14c0-3 2-5 1-7M42 16c0-2 2-4 1-6" stroke="#f0d9b5" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );

    case 'smoked_sausage':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path
            d="M14 40c5 10 24 12 35-1 5-6 6-14 2-20-3-4-9-4-12 1-3 5-5 12-13 14-6 1-11-1-13 2-1 1-1 3 1 4z"
            fill="#7a2c1e"
            stroke="#3b150e"
            strokeWidth="2"
          />
          <path
            d="M19 39c6 6 19 6 26-3 3-4 4-9 2-13"
            fill="none"
            stroke="#b85942"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.7"
          />
          <path d="M12 40l-4 3M50 17l4-3" stroke="#cbb892" strokeWidth="2" strokeLinecap="round" />
          <circle cx="29" cy="40" r="1.4" fill="#e6cfa8" opacity="0.65" />
          <circle cx="38" cy="35" r="1.3" fill="#e6cfa8" opacity="0.65" />
          <circle cx="44" cy="27" r="1.3" fill="#e6cfa8" opacity="0.65" />
        </svg>
      );

    case 'rye_bread':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path
            d="M10 38c0-13 10-20 22-20s22 7 22 20v6a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4v-6z"
            fill="#4d3423"
            stroke="#291a10"
            strokeWidth="2"
          />
          <path
            d="M13 38c0-10 8-16 19-16s19 6 19 16"
            fill="#66452e"
          />
          <path
            d="M21 25l-4 8M31 23l-4 9M41 25l-4 8"
            stroke="#c7b597"
            strokeWidth="2.2"
            strokeLinecap="round"
            opacity="0.75"
          />
          <rect x="12" y="40" width="40" height="5" rx="2" fill="#3a2618" />
        </svg>
      );

    case 'chocolate_bar':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="17" y="10" width="30" height="44" rx="3" fill="#472819" stroke="#26140c" strokeWidth="1.8" />
          <g fill="#5e3623" stroke="#331c11" strokeWidth="1">
            <rect x="20" y="13" width="10.5" height="8" rx="1" />
            <rect x="33.5" y="13" width="10.5" height="8" rx="1" />
            <rect x="20" y="23" width="10.5" height="8" rx="1" />
            <rect x="33.5" y="23" width="10.5" height="8" rx="1" />
          </g>
          <polygon points="15,31 49,26 49,34 15,38" fill="#c7d0d4" />
          <polygon points="15,35 49,30 49,54 15,54" fill="#7a3228" stroke="#b8915c" strokeWidth="1.4" />
          <line x1="21" y1="43" x2="43" y2="41" stroke="#e3c68a" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );

    case 'dried_berries':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M18 22c6-9 17-10 22-3-6 4-14 6-22 3z" fill="#4f7545" stroke="#2e4727" strokeWidth="1.4" />
          <circle cx="24" cy="36" r="8" fill="#a82a2a" stroke="#521212" strokeWidth="1.6" />
          <circle cx="38" cy="34" r="8.5" fill="#2d3c66" stroke="#161f38" strokeWidth="1.6" />
          <circle cx="31" cy="45" r="8" fill="#bf3630" stroke="#591512" strokeWidth="1.6" />
          <circle cx="44" cy="44" r="6.5" fill="#3a4c7d" stroke="#18223d" strokeWidth="1.5" />
          <circle cx="21" cy="33" r="2" fill="#f08982" opacity="0.65" />
          <circle cx="35" cy="31" r="2" fill="#8299d6" opacity="0.6" />
          <circle cx="28" cy="42" r="2" fill="#f59a8e" opacity="0.65" />
        </svg>
      );

    case 'roasted_mushrooms':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <line x1="10" y1="54" x2="54" y2="10" stroke="#c7a97b" strokeWidth="3" strokeLinecap="round" />
          <g transform="translate(22 42) rotate(-45)">
            <ellipse cx="0" cy="-3" rx="9" ry="5.5" fill="#a86832" stroke="#42250e" strokeWidth="1.5" />
            <rect x="-3.5" y="1" width="7" height="6" rx="2" fill="#decba8" />
          </g>
          <g transform="translate(33 31) rotate(-45)">
            <ellipse cx="0" cy="-3" rx="9.5" ry="5.5" fill="#c77e2c" stroke="#4a2b0d" strokeWidth="1.5" />
            <rect x="-3.5" y="1" width="7" height="6" rx="2" fill="#e6d4b3" />
          </g>
          <g transform="translate(44 20) rotate(-45)">
            <ellipse cx="0" cy="-3" rx="8.5" ry="5" fill="#8f5326" stroke="#3b1f0b" strokeWidth="1.5" />
            <rect x="-3" y="1" width="6" height="5.5" rx="2" fill="#d9c6a3" />
          </g>
        </svg>
      );

    case 'flashlight':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <polygon points="44,12 60,6 58,24 44,24" fill="#ffe79e" opacity="0.32" />
          <g transform="rotate(-38 32 34)">
            <rect x="10" y="27" width="28" height="13" rx="3" fill="#324038" stroke="#7d9185" strokeWidth="1.7" />
            <polygon points="38,26 48,22 48,45 38,41" fill="#46574d" stroke="#8ea397" strokeWidth="1.7" />
            <ellipse cx="48.5" cy="33.5" rx="2.5" ry="10.5" fill="#ffdf8a" />
            <rect x="26" y="25" width="5" height="3" rx="1" fill="#c94b3b" />
            <path d="M16 29v9M20 29v9M24 29v9" stroke="#1b241f" strokeWidth="1.4" />
          </g>
        </svg>
      );

    case 'extra_battery':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <g transform="translate(15 12)">
            <rect x="4" y="0" width="8" height="4" rx="1" fill="#c9ced1" />
            <rect x="0" y="4" width="16" height="38" rx="2.5" fill="#1e2421" stroke="#6d7c74" strokeWidth="1.5" />
            <rect x="0.8" y="4.8" width="14.4" height="12" rx="1.8" fill="#c97e38" />
            <path d="M8 8v5M5.5 10.5h5" stroke="#241609" strokeWidth="1.6" strokeLinecap="round" />
          </g>
          <g transform="translate(34 16)">
            <rect x="4" y="0" width="8" height="4" rx="1" fill="#c9ced1" />
            <rect x="0" y="4" width="16" height="38" rx="2.5" fill="#1e2421" stroke="#6d7c74" strokeWidth="1.5" />
            <rect x="0.8" y="4.8" width="14.4" height="12" rx="1.8" fill="#c97e38" />
            <path d="M8 8v5M5.5 10.5h5" stroke="#241609" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        </svg>
      );

    case 'lighter':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M32 9c4 5 5 9 3 13a4.5 4.5 0 0 1-7 0c-2-4-1-8 4-13z" fill="#ff9d2e" />
          <path d="M32 14c2 3 2.5 5 1.5 7.5a2.2 2.2 0 0 1-3.4 0c-1-2.5-.5-4.5 1.9-7.5z" fill="#fff0ad" />
          <polygon points="18,22 25,29 21,32 13,25" fill="#bfa167" stroke="#5e4b28" strokeWidth="1.5" />
          <rect x="27" y="23" width="10" height="8" rx="1" fill="#7c8782" stroke="#3d4541" strokeWidth="1.4" />
          <rect x="21" y="31" width="22" height="24" rx="3" fill="#b8985c" stroke="#594725" strokeWidth="1.8" />
          <rect x="25" y="34" width="3" height="17" rx="1" fill="#e8d3a2" opacity="0.55" />
        </svg>
      );

    case 'matches':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="13" y="24" width="32" height="28" rx="2.5" fill="#a84332" stroke="#4f1c14" strokeWidth="1.7" />
          <rect x="18" y="29" width="22" height="18" rx="1.5" fill="#e6d6b1" />
          <polygon points="29,32 34,42 24,42" fill="#3a633d" />
          <rect x="45" y="25" width="5" height="26" rx="1" fill="#4f2c1f" />
          <line x1="22" y1="24" x2="22" y2="12" stroke="#e0c794" strokeWidth="3" strokeLinecap="round" />
          <circle cx="22" cy="11" r="3" fill="#c93628" />
          <line x1="30" y1="24" x2="32" y2="10" stroke="#e0c794" strokeWidth="3" strokeLinecap="round" />
          <circle cx="32.2" cy="9.5" r="3" fill="#c93628" />
          <line x1="38" y1="24" x2="43" y2="13" stroke="#e0c794" strokeWidth="3" strokeLinecap="round" />
          <circle cx="43.5" cy="12" r="3" fill="#c93628" />
        </svg>
      );

    case 'firewood':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <g transform="rotate(-14 32 32)">
            <rect x="10" y="34" width="42" height="12" rx="4" fill="#d9d1c1" stroke="#474137" strokeWidth="1.7" />
            <ellipse cx="51" cy="40" rx="4" ry="5.5" fill="#c99c65" stroke="#594126" strokeWidth="1.4" />
            <path d="M18 38h8M31 41h9" stroke="#3d372e" strokeWidth="1.8" strokeLinecap="round" />
          </g>
          <g transform="rotate(11 32 30)">
            <rect x="11" y="22" width="42" height="12" rx="4" fill="#e6dfd1" stroke="#4a443b" strokeWidth="1.7" />
            <ellipse cx="12" cy="28" rx="4" ry="5.5" fill="#d6ac76" stroke="#5e4629" strokeWidth="1.4" />
            <path d="M23 26h9M36 29h8" stroke="#3d372e" strokeWidth="1.8" strokeLinecap="round" />
          </g>
          <rect x="16" y="13" width="32" height="10" rx="3.5" fill="#d1a670" stroke="#594024" strokeWidth="1.6" />
        </svg>
      );

    case 'tent':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          {/* Guy lines & ground stakes */}
          <line x1="15" y1="27" x2="7" y2="49" stroke="#d4c79c" strokeWidth="1.4" strokeDasharray="2 1.5" />
          <line x1="49" y1="27" x2="57" y2="49" stroke="#d4c79c" strokeWidth="1.4" strokeDasharray="2 1.5" />
          <line x1="6" y1="47" x2="8" y2="52" stroke="#b8a882" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="58" y1="47" x2="56" y2="52" stroke="#b8a882" strokeWidth="2.2" strokeLinecap="round" />
          {/* Rear side canopy */}
          <polygon points="32,14 54,48 44,50 24,18" fill="#415f44" stroke="#1e2e20" strokeWidth="1.6" strokeLinejoin="round" />
          {/* Front A-frame rainfly */}
          <polygon points="28,15 10,50 46,50" fill="#5b7d53" stroke="#223322" strokeWidth="1.8" strokeLinejoin="round" />
          {/* Ridge highlight seam */}
          <line x1="28" y1="15" x2="34" y2="14" stroke="#cfe0bf" strokeWidth="2.4" strokeLinecap="round" />
          <line x1="28" y1="16" x2="11" y2="49" stroke="#85a87a" strokeWidth="1.3" strokeOpacity="0.65" />
          {/* Open triangular vestibule doorway */}
          <polygon points="28,24 19,50 37,50" fill="#172019" stroke="#2d4030" strokeWidth="1.4" strokeLinejoin="round" />
          {/* Rolled door flap & interior sleeping pad hint */}
          <path d="M28 24l6 15" stroke="#8aa87c" strokeWidth="2.6" strokeLinecap="round" />
          <rect x="22" y="46.5" width="12" height="3.2" rx="1.2" fill="#c78442" />
          {/* Waterproof groundsheet */}
          <rect x="9" y="49" width="46" height="3.6" rx="1.6" fill="#2a332d" stroke="#131915" strokeWidth="1.2" />
        </svg>
      );

    case 'sleeping_bag':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          {/* Rolled insulated sleeping bag body */}
          <g transform="rotate(-18 32 33)">
            <rect x="11" y="20" width="38" height="24" rx="10" fill="#8f3c2d" stroke="#3d1710" strokeWidth="1.9" />
            {/* Quilted baffle stitching */}
            <path d="M22 21v22M31 21v22M40 21v22" stroke="#5e2318" strokeWidth="1.5" strokeDasharray="3 2" />
            {/* Warm loft sheen */}
            <path d="M16 25h28" stroke="#c96b54" strokeWidth="2.4" strokeLinecap="round" opacity="0.6" />
            {/* Spiral rolled end cap with cream fleece lining */}
            <ellipse cx="47" cy="32" rx="6.5" ry="11.5" fill="#d9c6a3" stroke="#472016" strokeWidth="1.8" />
            <ellipse cx="47" cy="32" rx="3.8" ry="7.2" fill="#8f3c2d" stroke="#572318" strokeWidth="1.2" />
            <ellipse cx="47" cy="32" rx="1.6" ry="3.2" fill="#e6d6b5" />
            {/* Compression straps & buckles */}
            <rect x="19" y="19" width="3.8" height="26" rx="1" fill="#29302b" />
            <rect x="34" y="19" width="3.8" height="26" rx="1" fill="#29302b" />
            <rect x="18.2" y="29" width="5.4" height="5.5" rx="1.2" fill="#d1b171" stroke="#362c18" strokeWidth="1" />
            <rect x="33.2" y="29" width="5.4" height="5.5" rx="1.2" fill="#d1b171" stroke="#362c18" strokeWidth="1" />
          </g>
        </svg>
      );

    case 'rain_jacket':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          {/* Hood */}
          <path
            d="M22 19c1-8 5-12 10-12s9 4 10 12c-3 3-17 3-20 0z"
            fill="#d99a26"
            stroke="#3d2b0b"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M25.5 18c1-5 3.5-7.5 6.5-7.5s5.5 2.5 6.5 7.5c-2.5 1.8-10.5 1.8-13 0z"
            fill="#28352f"
          />
          {/* Left & Right Sleeves */}
          <path
            d="M20 20L8 37l6.5 4.2L22 30z"
            fill="#c98c1f"
            stroke="#3d2b0b"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M44 20l12 17-6.5 4.2L42 30z"
            fill="#c98c1f"
            stroke="#3d2b0b"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Main Jacket Torso */}
          <path
            d="M20 20c4-2 20-2 24 0l2 34c-6 2.5-22 2.5-28 0z"
            fill="#e2a630"
            stroke="#3d2b0b"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          {/* Storm Flap & Zipper Line */}
          <path d="M32 20v35" stroke="#47330e" strokeWidth="1.8" />
          <path d="M34.2 20v35" stroke="#f5cb6e" strokeWidth="1.2" opacity="0.7" />
          {/* Snap Buttons */}
          <circle cx="30" cy="25" r="1.2" fill="#3a2c12" />
          <circle cx="30" cy="33" r="1.2" fill="#3a2c12" />
          <circle cx="30" cy="41" r="1.2" fill="#3a2c12" />
          <circle cx="30" cy="49" r="1.2" fill="#3a2c12" />
          {/* Storm Pockets */}
          <path d="M21 40h7v6h-7zM36 40h7v6h-7z" fill="#c4861c" stroke="#47330e" strokeWidth="1.2" />
          {/* Water droplets beading off */}
          <circle cx="15" cy="14" r="1.7" fill="#8fd2f0" opacity="0.9" />
          <circle cx="49" cy="15" r="1.5" fill="#8fd2f0" opacity="0.85" />
          <circle cx="52" cy="22" r="1.2" fill="#8fd2f0" opacity="0.75" />
        </svg>
      );

    case 'mushroom_kukeseen':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M24 52c1-11-1-17-9-24 6-3 12-1 17-3 6-2 12-4 17 1-7 7-11 13-11 26z" fill="#e89f1e" stroke="#633f09" strokeWidth="1.8" />
          <path d="M16 27c8 5 22 4 32-1" fill="none" stroke="#ffd878" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M24 31l4 15M32 31v16M40 30l-4 15" stroke="#b5710e" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );

    case 'mushroom_kivipuravik':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M23 32c-3 8-4 16 1 20h16c5-4 4-12 1-20z" fill="#e3d4b8" stroke="#5e503d" strokeWidth="1.7" />
          <path d="M11 33c0-13 9-20 21-20s21 7 21 20c-8 3-34 3-42 0z" fill="#7d4a26" stroke="#3b200d" strokeWidth="1.8" />
          <path d="M18 22c5-4 13-5 20-2" fill="none" stroke="#b87e52" strokeWidth="2.4" strokeLinecap="round" opacity="0.65" />
        </svg>
      );

    case 'mushroom_kasepuravik':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M27 30l-2 23h14l-2-23z" fill="#dfd9cc" stroke="#4f4b43" strokeWidth="1.6" />
          <path d="M28 36h3M33 41h3M27 46h4M32 49h3" stroke="#302e2a" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M14 31c0-11 8-17 18-17s18 6 18 17c-7 2.5-29 2.5-36 0z" fill="#9c8064" stroke="#423426" strokeWidth="1.8" />
        </svg>
      );

    case 'mushroom_kuuseriisikas':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <rect x="27" y="31" width="10" height="21" rx="3" fill="#d97b34" stroke="#5e3010" strokeWidth="1.6" />
          <ellipse cx="32" cy="27" rx="21" ry="10" fill="#df7826" stroke="#5e2e0c" strokeWidth="1.8" />
          <ellipse cx="32" cy="27" rx="14" ry="6" fill="none" stroke="#9e4512" strokeWidth="2" />
          <ellipse cx="32" cy="27" rx="7" ry="3" fill="#b85418" />
        </svg>
      );

    case 'mushroom_sapipuravik':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M24 33c-2 8-3 15 1 19h14c4-4 3-11 1-19z" fill="#c9b493" stroke="#524635" strokeWidth="1.6" />
          <ellipse cx="32" cy="33" rx="18" ry="4.5" fill="#dfa0a8" stroke="#6b4449" strokeWidth="1.2" />
          <path d="M13 32c1-12 9-18 19-18s18 6 19 18c-8 2-30 2-38 0z" fill="#8f7351" stroke="#3d3020" strokeWidth="1.8" />
        </svg>
      );

    case 'mushroom_punakarbseseen':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M26 32l-2 20c0 2 16 2 16 0l-2-20z" fill="#f2ede1" stroke="#666054" strokeWidth="1.6" />
          <path d="M24 38c4 3 12 3 16 0" fill="none" stroke="#d4ccb8" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M11 33c0-13 9-20 21-20s21 7 21 20c-8 3-34 3-42 0z" fill="#c92e24" stroke="#59120d" strokeWidth="1.8" />
          <circle cx="22" cy="23" r="2.6" fill="#f7f2e4" />
          <circle cx="32" cy="18" r="2.8" fill="#f7f2e4" />
          <circle cx="42" cy="24" r="2.5" fill="#f7f2e4" />
          <circle cx="28" cy="28" r="2.2" fill="#f7f2e4" />
          <circle cx="38" cy="29" r="2" fill="#f7f2e4" />
        </svg>
      );

    case 'mushroom_valgekarbseseen':
      return (
        <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
          <path d="M23 47c0 6 18 6 18 0l-2-4H25z" fill="#e3dfd3" stroke="#6e6a5f" strokeWidth="1.5" />
          <path d="M28 29l-1 22h10l-1-22z" fill="#f5f3eb" stroke="#78756a" strokeWidth="1.5" />
          <path d="M26 36c3 2.5 9 2.5 12 0" fill="none" stroke="#d6d2c5" strokeWidth="2" strokeLinecap="round" />
          <path d="M17 31c1-13 7-21 15-21s14 8 15 21c-6 2.5-24 2.5-30 0z" fill="#faf9f2" stroke="#7d7a70" strokeWidth="1.7" />
        </svg>
      );
  }
};
