// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CompatibilityBadge, type CompatibilityStatus } from './CompatibilityBadge';
const STATUSES: CompatibilityStatus[] = ['compatible', 'partial', 'incompatible', 'unknown'];

describe('CompatibilityBadge', () => {
  it('renders the correct label for each status', () => {
    const labels: Record<CompatibilityStatus, string> = {
      compatible: 'Compatible',
      partial: 'Partial',
      incompatible: 'Incompatible',
      unknown: 'Unknown',
    };

    for (const status of STATUSES) {
      const { unmount } = render(<CompatibilityBadge status={status} />);
      expect(screen.getByText(labels[status])).toBeTruthy();
      unmount();
    }
  });

  it('renders a status dot indicator', () => {
    const { container } = render(<CompatibilityBadge status="compatible" />);
    // The dot is a span with a circular border-radius
    const dot = container.querySelector('span > span');
    expect(dot).toBeTruthy();
  });

  it('applies title attribute when notes are provided', () => {
    const { container } = render(
      <CompatibilityBadge status="partial" notes="Requires desktop build" />,
    );
    const badge = container.querySelector('span[title]');
    expect(badge?.getAttribute('title')).toBe('Requires desktop build');
  });

  it('does not apply title when notes are absent', () => {
    const { container } = render(<CompatibilityBadge status="compatible" />);
    const badge = container.querySelector('span[title]');
    expect(badge).toBeNull();
  });

  it('renders in small size with smaller font', () => {
    const { container } = render(<CompatibilityBadge status="unknown" size="small" />);
    const badge = container.querySelector('span');
    expect(badge).toBeTruthy();
    // small size should have 10px font
    expect(badge?.style.fontSize).toBe('10px');
  });

  it('renders in normal size with 11px font', () => {
    const { container } = render(<CompatibilityBadge status="unknown" />);
    const badge = container.querySelector('span');
    expect(badge?.style.fontSize).toBe('11px');
  });
});
