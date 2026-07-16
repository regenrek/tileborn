import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  typography,
} from '@tileborne/ui';
import { CopyIcon, ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';

import type { LocalMultiplayerRoomReady } from '@/lib/playtest-room-url';

interface PlaytestHostDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly room: LocalMultiplayerRoomReady | null;
  readonly isStarting: boolean;
  readonly onCopy: (label: string, value: string) => void | Promise<void>;
  readonly onOpenSecondClient: () => void | Promise<void>;
  readonly onJoinAsHost: () => void | Promise<void>;
  readonly onStopHosting: () => void | Promise<void>;
}

export function PlaytestHostDialog({
  open,
  onOpenChange,
  room,
  isStarting,
  onCopy,
  onOpenSecondClient,
  onJoinAsHost,
  onStopHosting,
}: PlaytestHostDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="playtest-host-dialog">
        <DialogHeader>
          <DialogTitle>Host local match</DialogTitle>
          <DialogDescription>
            Share the room URL or open a second client to join this miniflare-hosted match.
          </DialogDescription>
        </DialogHeader>

        {isStarting ? <p className={typography.bodyCompact}>Starting local game host…</p> : null}

        {room ? (
          <div className="space-y-3">
            {room.joinCode ? (
              <div className="block space-y-1">
                <Label htmlFor="playtest-host-join-code" className={typography.sectionLabelAccent}>
                  Join code
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="playtest-host-join-code"
                    readOnly
                    value={room.joinCode}
                    data-testid="playtest-host-join-code"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    aria-label="Copy join code"
                    onClick={() => void onCopy('Join code', room.joinCode ?? '')}
                  >
                    <CopyIcon />
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="block space-y-1">
              <Label htmlFor="playtest-host-room-url" className={typography.sectionLabelAccent}>
                Room URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="playtest-host-room-url"
                  readOnly
                  value={room.roomUrl}
                  data-testid="playtest-host-room-url"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Copy room URL"
                  onClick={() => void onCopy('Room URL', room.roomUrl)}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>

            <div className="block space-y-1">
              <Label htmlFor="playtest-host-ws-url" className={typography.sectionLabelAccent}>
                WebSocket URL
              </Label>
              <div className="flex gap-2">
                <Input
                  id="playtest-host-ws-url"
                  readOnly
                  value={room.wsUrl}
                  data-testid="playtest-host-ws-url"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Copy WebSocket URL"
                  onClick={() => void onCopy('WebSocket URL', room.wsUrl)}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>

            <div className="block space-y-1">
              <Label htmlFor="playtest-host-deeplink" className={typography.sectionLabelAccent}>
                Deep link
              </Label>
              <div className="flex gap-2">
                <Input
                  id="playtest-host-deeplink"
                  readOnly
                  value={room.deeplink}
                  data-testid="playtest-host-deeplink"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="Copy deep link"
                  onClick={() => void onCopy('Deep link', room.deeplink)}
                >
                  <CopyIcon />
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <Button type="button" variant="outline" onClick={() => void onStopHosting()}>
            Stop hosting
          </Button>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!room}
              onClick={() => void onOpenSecondClient()}
              data-testid="playtest-host-open-second-client"
            >
              <ExternalLinkIcon />
              Open second client
            </Button>
            <Button type="button" disabled={!room} onClick={() => void onJoinAsHost()}>
              Join as host
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PlaytestJoinDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fallbackBaseUrl?: string | undefined;
  readonly onJoin: (input: string) => void | Promise<void>;
}

export function PlaytestJoinDialog({
  open,
  onOpenChange,
  fallbackBaseUrl,
  onJoin,
}: PlaytestJoinDialogProps) {
  const [input, setInput] = useState('');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="playtest-join-dialog">
        <DialogHeader>
          <DialogTitle>Join local match</DialogTitle>
          <DialogDescription>
            Paste a room URL or `tileborne://playtest/&lt;roomId&gt;` deep link from the host.
            {fallbackBaseUrl ? ` Local host: ${fallbackBaseUrl}` : null}
          </DialogDescription>
        </DialogHeader>

        <Label htmlFor="playtest-join-input" className="sr-only">
          Room URL or deep link
        </Label>
        <Input
          id="playtest-join-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="http://127.0.0.1:8787/rooms/… or tileborne://playtest/…"
          data-testid="playtest-join-input"
        />

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={input.trim().length === 0}
            onClick={() => void onJoin(input)}
            data-testid="playtest-join-submit"
          >
            Join
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
