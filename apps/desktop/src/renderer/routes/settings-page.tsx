import { Link, useParams } from '@tanstack/react-router';
import type { ProjectId } from '@tileborne/core';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Kbd,
  KbdGroup,
  Label,
  Separator,
  Switch,
  ToggleGroup,
  ToggleGroupItem,
  cn,
  typography,
} from '@tileborne/ui';
import { MonitorIcon, MoonIcon, PackageIcon, PuzzleIcon, SunIcon } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { CloseableWorkspacePage } from '@/components/shell/closeable-workspace-page';
import { DesktopUpdatesPanel } from '@/components/desktop-updates-panel';
import { useTheme } from '@/components/theme-provider';
import { useHomePaths, useSystemVersion } from '@/hooks/queries';
import { appVersion, gitCommit } from '@/lib/build-info';
import { collectSettingsShortcuts } from '@/lib/settings-shortcuts';
import { useEditorUiStore } from '@/stores/editor-ui-store';

function ShortcutKeys({ keys }: { readonly keys: readonly string[] }) {
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function SettingsPage() {
  const { projectId: routeProjectId } = useParams({ strict: false });
  const homePathsQuery = useHomePaths();
  const versionQuery = useSystemVersion();
  const telemetryEnabled = useEditorUiStore((s) => s.telemetryEnabled);
  const setTelemetryEnabled = useEditorUiStore((s) => s.setTelemetryEnabled);
  const recentProjectIds = useEditorUiStore((s) => s.recentProjectIds);
  const { theme, setTheme } = useTheme();
  const shortcuts = useMemo(() => collectSettingsShortcuts(), []);

  useEffect(() => {
    document.title = 'Settings · Tileborne';
  }, []);

  const paths = homePathsQuery.data?.paths;
  const version = versionQuery.data;
  const recentProjectId = recentProjectIds[0] as ProjectId | undefined;
  const returnProjectId = (routeProjectId ?? recentProjectId) as ProjectId | undefined;

  return (
    <CloseableWorkspacePage
      title="Settings"
      description="Global Tileborne preferences. Telemetry is off by default."
      maxWidthClassName="max-w-2xl"
    >
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose light, dark, or match your system theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <Label className="sr-only" htmlFor="theme-picker">
            Theme
          </Label>
          <ToggleGroup
            id="theme-picker"
            value={[theme]}
            onValueChange={(value) => {
              const next = value.at(-1);
              if (next === 'light' || next === 'dark' || next === 'system') {
                setTheme(next);
              }
            }}
            variant="outline"
            className="w-full max-w-md"
            aria-label="Theme preference"
          >
            <ToggleGroupItem value="light" className="flex-1 gap-1.5">
              <SunIcon className="size-3.5" aria-hidden />
              Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className="flex-1 gap-1.5">
              <MoonIcon className="size-3.5" aria-hidden />
              Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system" className="flex-1 gap-1.5">
              <MonitorIcon className="size-3.5" aria-hidden />
              System
            </ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Keyboard shortcuts</CardTitle>
          <CardDescription>Global commands and editor tools.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {shortcuts.map((entry) => (
              <li
                key={entry.label}
                className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
              >
                <span className={cn(typography.caption, 'text-foreground')}>{entry.label}</span>
                <ShortcutKeys keys={entry.keys} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace links</CardTitle>
          <CardDescription>Jump to project-scoped tools when a project is open.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {returnProjectId ? (
            <>
              <Link
                to="/projects/$projectId/assets"
                params={{ projectId: returnProjectId }}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <PackageIcon className="size-4 text-muted-foreground" aria-hidden />
                Asset library
              </Link>
              <Link
                to="/projects/$projectId/plugins"
                params={{ projectId: returnProjectId }}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/50"
              >
                <PuzzleIcon className="size-4 text-muted-foreground" aria-hidden />
                Plugin manager
              </Link>
            </>
          ) : (
            <p className={typography.bodyCompact}>
              Open a project from Home to access the asset library and plugin manager.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Home directory</CardTitle>
          <CardDescription>Tileborne stores projects, plugins, and logs here.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="space-y-2">
            <div className="flex justify-between gap-4">
              <dt className={typography.bodyMicro}>Root</dt>
              <dd className={cn(typography.bodyMicro, 'truncate font-mono text-foreground')}>
                {paths?.root ?? '…'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className={typography.bodyMicro}>Projects</dt>
              <dd className={cn(typography.bodyMicro, 'truncate font-mono text-foreground')}>
                {paths?.projects ?? '…'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className={typography.bodyMicro}>Plugins</dt>
              <dd className={cn(typography.bodyMicro, 'truncate font-mono text-foreground')}>
                {paths?.plugins ?? '…'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className={typography.bodyMicro}>Logs</dt>
              <dd className={cn(typography.bodyMicro, 'truncate font-mono text-foreground')}>
                {paths?.logs ?? '…'}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-4">
          <div>
            <Label htmlFor="telemetry">Telemetry</Label>
            <p className={typography.bodyCompact}>Send anonymous usage diagnostics. Default off.</p>
          </div>
          <Switch id="telemetry" checked={telemetryEnabled} onCheckedChange={setTelemetryEnabled} />
        </CardContent>
      </Card>

      <DesktopUpdatesPanel />

      <Separator />

      <section className="space-y-1">
        <h2 className={typography.sectionLabel}>About</h2>
        <p className={typography.bodyCompact}>
          Tileborne {version?.appVersion ?? appVersion}
          {version ? (
            <>
              {' '}
              · Electron {version.electronVersion} · Node {version.nodeVersion}
            </>
          ) : null}
        </p>
        <p className={typography.bodyMicro}>Build {gitCommit}</p>
      </section>
    </CloseableWorkspacePage>
  );
}
