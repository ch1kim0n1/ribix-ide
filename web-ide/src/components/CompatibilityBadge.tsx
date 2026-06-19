/**
 * Compatibility badge for the Extensions panel (issues #35, #28).
 *
 * Renders a small colored pill next to each extension entry indicating its
 * Ribix compatibility status: compatible (green), partial (yellow),
 * incompatible (red), or unknown (grey). The status comes from the
 * MarketplaceCompatibilityManager on the desktop side, or from the
 * `compatibility` field attached by `marketplaceStore` on the web side.
 */

import type { CSSProperties } from 'react';

export type CompatibilityStatus = 'compatible' | 'partial' | 'incompatible' | 'unknown';

interface CompatibilityBadgeProps {
  status: CompatibilityStatus;
  notes?: string;
  size?: 'small' | 'normal';
}

const STATUS_LABELS: Record<CompatibilityStatus, string> = {
  compatible: 'Compatible',
  partial: 'Partial',
  incompatible: 'Incompatible',
  unknown: 'Unknown',
};

const STATUS_COLORS: Record<CompatibilityStatus, { bg: string; fg: string; border: string }> = {
  compatible: { bg: 'rgba(78, 201, 176, 0.15)', fg: '#4ec9b0', border: 'rgba(78, 201, 176, 0.4)' },
  partial: { bg: 'rgba(204, 188, 33, 0.15)', fg: '#ccbc21', border: 'rgba(204, 188, 33, 0.4)' },
  incompatible: { bg: 'rgba(244, 90, 90, 0.15)', fg: '#f45a5a', border: 'rgba(244, 90, 90, 0.4)' },
  unknown: { bg: 'rgba(136, 136, 136, 0.15)', fg: '#888', border: 'rgba(136, 136, 136, 0.4)' },
};

export function CompatibilityBadge({ status, notes, size = 'normal' }: CompatibilityBadgeProps) {
  const colors = STATUS_COLORS[status];
  const label = STATUS_LABELS[status];

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: size === 'small' ? '1px 6px' : '2px 8px',
    borderRadius: '10px',
    fontSize: size === 'small' ? '10px' : '11px',
    fontWeight: 600,
    backgroundColor: colors.bg,
    color: colors.fg,
    border: `1px solid ${colors.border}`,
    cursor: notes ? 'help' : 'default',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  };

  return (
    <span style={style} title={notes || undefined}>
      <span
        style={{
          width: size === 'small' ? '6px' : '8px',
          height: size === 'small' ? '6px' : '8px',
          borderRadius: '50%',
          backgroundColor: colors.fg,
        }}
      />
      {label}
    </span>
  );
}
