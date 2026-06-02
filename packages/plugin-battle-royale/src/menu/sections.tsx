import type { MenuSectionProps } from "@tileborne/game-client";
import { Button } from "@tileborne/ui";
import { useState, type ReactElement } from "react";

import { DEFAULT_MAX_PLAYERS, ZONE } from "../constants.js";
import { DEFAULT_BATTLE_ROYALE_MODELS } from "../player-models/models.js";
import { resolveSelectedModelId, writeSelectedModelId } from "../player-models/loadout.js";

/**
 * Neutral, brand-free Battle Royale menu sections (ADR-0022 decision #2). These
 * ship executable React per ADR-0004 and mount into the generic shell's named
 * slots. No branding/product names appear here.
 */

/** main.primaryActions — quick-play entry into the BR lobby. */
export function BattleRoyaleLobbySection({ onPlay }: MenuSectionProps): ReactElement {
  return (
    <Button onClick={onPlay} data-testid="br-quick-play">
      Battle Royale — Quick Play
    </Button>
  );
}

/** main.tabs — loadout + model/skin select with persisted selection. */
export function BattleRoyaleLoadoutSection(): ReactElement {
  const [selected, setSelected] = useState<string | undefined>(() => resolveSelectedModelId());
  const pick = (modelId: string) => {
    writeSelectedModelId(modelId);
    setSelected(modelId);
  };
  return (
    <div data-testid="br-loadout" className="tb-actions">
      <div className="tb-section-label">Loadout — model</div>
      <div className="tb-actions-row">
        {DEFAULT_BATTLE_ROYALE_MODELS.map((model) => (
          <Button
            key={model.id}
            size="sm"
            variant={model.id === selected ? "default" : "outline"}
            aria-pressed={model.id === selected}
            onClick={() => pick(model.id)}
            data-testid={`br-model-${model.id}`}
          >
            {model.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** settings.tabs — read-only match-rules summary. */
export function BattleRoyaleMatchRulesSection(): ReactElement {
  const shrinkPhases = ZONE.schedule.shrinkPhases;
  return (
    <div data-testid="br-match-rules">
      <div className="tb-section-label">Match rules</div>
      <ul style={{ margin: 0, paddingLeft: "1.1rem", fontSize: "0.8125rem" }}>
        <li>Max players: {DEFAULT_MAX_PLAYERS}</li>
        <li>Friendly fire: off</li>
        <li>
          Zone: {shrinkPhases} shrink phases, {ZONE.damagePerSecond} dmg/s outside
        </li>
      </ul>
    </div>
  );
}

/** main.secondaryActions — create/join a private room by code. */
export function BattleRoyalePrivateRoomSection({ onPlay }: MenuSectionProps): ReactElement {
  const [code, setCode] = useState("");
  return (
    <div data-testid="br-private-room" className="tb-actions">
      <div className="tb-section-label">Private room</div>
      <div className="tb-actions-row">
        <input
          aria-label="Room code"
          placeholder="Room code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
          data-testid="br-room-code"
          style={{
            background: "var(--tb-menu-bg)",
            color: "var(--tb-menu-text)",
            border: "1px solid var(--tb-menu-text-muted)",
            borderRadius: "0.375rem",
            padding: "0.25rem 0.5rem",
            width: "7rem",
          }}
        />
        <Button size="sm" variant="outline" disabled={code.length < 4} onClick={onPlay} data-testid="br-join-room">
          Join
        </Button>
        <Button size="sm" onClick={onPlay} data-testid="br-create-room">
          Create
        </Button>
      </div>
    </div>
  );
}
