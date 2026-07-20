import type { BrandConfig } from '@tileborne/core';
import { Button } from '@tileborne/ui';
import type { ReactElement } from 'react';

import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { SlotHost } from './slot-host.js';

/** A single neutral results row. Plugins/products enrich via the results slot. */
export interface MatchResultRow {
  readonly rank: number;
  readonly name: string;
  readonly score: number;
}

export interface MatchResults {
  readonly title?: string;
  readonly rows?: readonly MatchResultRow[];
}

export interface ResultsScreenProps {
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly results?: MatchResults | undefined;
  readonly subtitle?: string | undefined;
  readonly playAgainLabel?: string | undefined;
  readonly backLabel?: string | undefined;
  readonly onPlayAgain: () => void;
  readonly onBackToMenu: () => void;
  readonly chrome?: boolean | undefined;
  readonly showDefaultActions?: boolean | undefined;
}

/** End-of-match results screen: optional table + Play again / Back to menu + slot. */
export function ResultsScreen({
  brand,
  sections,
  results,
  subtitle,
  playAgainLabel,
  backLabel,
  onPlayAgain,
  onBackToMenu,
  chrome = true,
  showDefaultActions = true,
}: ResultsScreenProps): ReactElement {
  const rows = results?.rows ?? [];
  const body = (
    <>
      {chrome ? (
        <h2 className="tb-title">{results?.title ?? 'Match complete'}</h2>
      ) : results?.title !== undefined ? (
        <h2 className="tb-title">{results.title}</h2>
      ) : null}
      {rows.length > 0 ? (
        <table style={{ width: '100%', borderCollapse: 'collapse', margin: '0.75rem 0' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--tb-menu-text-muted)' }}>
              <th>#</th>
              <th>Player</th>
              <th style={{ textAlign: 'right' }}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.rank}-${row.name}`}>
                <td>{row.rank}</td>
                <td>{row.name}</td>
                <td style={{ textAlign: 'right' }}>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <p className="tb-tagline">{subtitle ?? 'Thanks for playing.'}</p>

      <SlotHost
        slot="results.actions"
        sections={sections}
        onPlay={onPlayAgain}
        onBack={onBackToMenu}
        title={brand.title}
      />

      {showDefaultActions ? (
        <div className="tb-actions">
          <Button onClick={onPlayAgain} data-testid="play-again">
            {playAgainLabel ?? 'Play again'}
          </Button>
          <Button variant="outline" onClick={onBackToMenu} data-testid="results-back">
            {backLabel ?? 'Back to menu'}
          </Button>
        </div>
      ) : null}
    </>
  );
  if (!chrome) return <>{body}</>;
  return (
    <div className="tb-scrim">
      <div
        className="tb-panel"
        role="dialog"
        aria-label="Match results"
        data-testid="results-screen"
      >
        {body}
      </div>
    </div>
  );
}
