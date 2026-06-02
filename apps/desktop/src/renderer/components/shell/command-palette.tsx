import { useNavigate } from '@tanstack/react-router';
import type { MapId, PluginId, ProjectId } from '@tileborne/core';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandList,
  CommandSeparator,
  typography,
} from '@tileborne/ui';
import { FolderOpenIcon } from 'lucide-react';

import { PaletteCommandItem } from '@/components/shell/command-palette-item';
import {
  focusAdjacentCommandGroup,
  rankRecentCommands,
} from '@/lib/command-palette-utils';
import {
  pluginCommandId,
  recentProjectCommandId,
  SHELL_COMMANDS,
  SHELL_COMMAND_GROUP_LABELS,
  SHELL_COMMAND_GROUP_ORDER,
  shellCommandSearchValue,
  type ShellCommandDef,
  type ShellCommandGroupId,
} from '@/lib/shell-command-registry';
import {
  useInvokePluginEditorCommand,
  useStartBuild,
} from '@/hooks/mutations';
import { usePluginCommandContributions } from '@/hooks/use-plugin-command-contributions';
import { useProjectsList } from '@/hooks/queries';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import { notifyError, notifySuccess } from '@/stores/app-notifications-store';
import { useEditorUiStore, type EditorTool } from '@/stores/editor-ui-store';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | undefined;
  mapId?: string | undefined;
}

interface ResolvedCommand {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly group: ShellCommandGroupId | 'recent';
  readonly pluginSection?: string | undefined;
  readonly icon?: ShellCommandDef['icon'] | undefined;
  readonly shortcut?: readonly string[] | undefined;
  readonly disabled?: boolean | undefined;
  readonly run: () => void;
}

interface CommandPaletteModelParams {
  readonly projectId?: string | undefined;
  readonly mapId?: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly setSearch: (search: string) => void;
}

function useCommandPaletteModel({
  projectId,
  mapId,
  onOpenChange,
  setSearch,
}: CommandPaletteModelParams) {
  const navigate = useNavigate();
  const recentProjectIds = useEditorUiStore((s) => s.recentProjectIds);
  const recentCommandIds = useEditorUiStore((s) => s.recentCommandIds);
  const commandUseCounts = useEditorUiStore((s) => s.commandUseCounts);
  const recordCommandUsage = useEditorUiStore((s) => s.recordCommandUsage);
  const setGenerateMapDialogOpen = useEditorUiStore((s) => s.setGenerateMapDialogOpen);
  const setCreateProjectDialogOpen = useEditorUiStore((s) => s.setCreateProjectDialogOpen);
  const setPluginInstallDialogOpen = useEditorUiStore((s) => s.setPluginInstallDialogOpen);
  const setAssetImportDialogOpen = useEditorUiStore((s) => s.setAssetImportDialogOpen);
  const setSpriteEditorOpen = useEditorUiStore((s) => s.setSpriteEditorOpen);
  const selectTool = useEditorUiStore((s) => s.selectTool);
  const setShowGrid = useEditorUiStore((s) => s.setShowGrid);
  const setShowCollisionOverlay = useEditorUiStore((s) => s.setShowCollisionOverlay);
  const setBottomDrawerOpen = useEditorUiStore((s) => s.setBottomDrawerOpen);
  const showGrid = useEditorUiStore((s) => s.showGrid);
  const showCollisionOverlay = useEditorUiStore((s) => s.showCollisionOverlay);
  const bottomDrawerOpen = useEditorUiStore((s) => s.bottomDrawerOpen);
  const projectsQuery = useProjectsList();
  const pluginCommands = usePluginCommandContributions();
  const startBuild = useStartBuild();
  const invokePluginCommand = useInvokePluginEditorCommand();
  const { start: startPlaytest } = usePlaytestControls();

  const recentProjects = useMemo(() => {
    const all = projectsQuery.data?.projects ?? [];
    const byId = new Map(all.map((project) => [String(project.id), project]));
    const matchedProjects: Array<(typeof all)[number]> = [];
    for (const id of recentProjectIds) {
      const project = byId.get(id);
      if (project) {
        matchedProjects.push(project);
      }
    }
    return matchedProjects;
  }, [projectsQuery.data?.projects, recentProjectIds]);

  const runCommand = useCallback(
    (commandId: string, action: () => void) => {
      action();
      recordCommandUsage(commandId);
      onOpenChange(false);
      setSearch('');
    },
    [onOpenChange, recordCommandUsage],
  );

  const executeShellCommand = useCallback(
    (command: ShellCommandDef) => {
      switch (command.id) {
        case 'file.create-project':
          runCommand(command.id, () => {
            setCreateProjectDialogOpen(true);
          });
          return;
        case 'file.import-asset-pack':
          runCommand(command.id, () => {
            setAssetImportDialogOpen(true);
          });
          return;
        case 'file.open-sprite-studio':
          runCommand(command.id, () => {
            setSpriteEditorOpen(true);
          });
          return;
        case 'edit.undo':
          runCommand(command.id, () => {
            window.dispatchEvent(new CustomEvent('tileborne:editor-undo'));
          });
          return;
        case 'edit.redo':
          runCommand(command.id, () => {
            window.dispatchEvent(new CustomEvent('tileborne:editor-redo'));
          });
          return;
        case 'view.home':
          runCommand(command.id, () => {
            void navigate({ to: '/' });
          });
          return;
        case 'view.settings':
          runCommand(command.id, () => {
            if (projectId) {
              void navigate({ to: '/projects/$projectId/settings', params: { projectId } });
              return;
            }
            void navigate({ to: '/settings' });
          });
          return;
        case 'view.project-overview':
          if (!projectId) {
            return;
          }
          runCommand(command.id, () => {
            void navigate({ to: '/projects/$projectId', params: { projectId } });
          });
          return;
        case 'view.asset-library':
          if (!projectId) {
            return;
          }
          runCommand(command.id, () => {
            void navigate({ to: '/projects/$projectId/assets', params: { projectId } });
          });
          return;
        case 'view.plugin-manager':
          if (!projectId) {
            return;
          }
          runCommand(command.id, () => {
            void navigate({ to: '/projects/$projectId/plugins', params: { projectId } });
          });
          return;
        case 'view.toggle-grid':
          runCommand(command.id, () => {
            setShowGrid(!showGrid);
          });
          return;
        case 'view.toggle-collision-overlay':
          runCommand(command.id, () => {
            setShowCollisionOverlay(!showCollisionOverlay);
          });
          return;
        case 'view.toggle-bottom-drawer':
          runCommand(command.id, () => {
            setBottomDrawerOpen(!bottomDrawerOpen);
          });
          return;
        case 'map.generate':
          runCommand(command.id, () => {
            setGenerateMapDialogOpen(true);
          });
          return;
        case 'map.start-build':
          if (!projectId) {
            return;
          }
          runCommand(command.id, () => {
            void startBuild.mutateAsync({ projectId: projectId as ProjectId });
          });
          return;
        case 'map.start-playtest':
          if (!projectId || !mapId) {
            return;
          }
          runCommand(command.id, () => {
            void startPlaytest(projectId, mapId);
          });
          return;
        case 'plugins.install-battle-royale':
          runCommand(command.id, () => {
            setPluginInstallDialogOpen(true);
          });
          return;
        case 'help.command-palette':
          recordCommandUsage(command.id);
          return;
        default:
          if (command.id.startsWith('tool.')) {
            const tool = command.id.slice('tool.'.length) as EditorTool;
            runCommand(command.id, () => {
              selectTool(tool);
            });
          }
      }
    },
    [
      bottomDrawerOpen,
      mapId,
      navigate,
      projectId,
      runCommand,
      selectTool,
      setBottomDrawerOpen,
      setAssetImportDialogOpen,
      setSpriteEditorOpen,
      setCreateProjectDialogOpen,
      setGenerateMapDialogOpen,
      setPluginInstallDialogOpen,
      setShowCollisionOverlay,
      setShowGrid,
      showCollisionOverlay,
      showGrid,
      startBuild,
      startPlaytest,
    ],
  );

  const staticCommands = useMemo(() => {
    const commands = [];
    for (const command of SHELL_COMMANDS) {
      if (command.requiresProject && !projectId) {
        continue;
      }
      if (command.requiresMap && (!projectId || !mapId)) {
        continue;
      }
      commands.push({
        id: command.id,
        label: command.label,
        value: shellCommandSearchValue(command),
        group: command.group,
        icon: command.icon,
        shortcut: command.shortcut?.(),
        run: () => executeShellCommand(command),
      });
    }
    return commands;
  }, [executeShellCommand, mapId, projectId]);

  const recentProjectCommands = useMemo(
    () =>
      recentProjects.map((project) => {
        const id = recentProjectCommandId(project.id);
        return {
          id,
          label: project.name,
          value: `${project.name} recent project ${project.id}`,
          group: 'recent' as const,
          icon: FolderOpenIcon,
          run: () =>
            runCommand(id, () => {
              void navigate({
                to: '/projects/$projectId',
                params: { projectId: project.id },
              });
            }),
        } satisfies ResolvedCommand;
      }),
    [navigate, recentProjects, runCommand],
  );

  const pluginResolvedCommands = useMemo(
    () =>
      pluginCommands.map((command) => {
        const id = pluginCommandId(command.pluginId, command.contributionId);
        return {
          id,
          label: command.label,
          value: `${command.label} ${command.pluginName} plugin`,
          group: 'plugins' as const,
          pluginSection: command.pluginName,
          disabled: command.requiresMap && (!projectId || !mapId),
          run: () =>
            runCommand(id, () => {
              void invokePluginCommand
                .mutateAsync({
                  pluginId: command.pluginId as PluginId,
                  contributionId: command.contributionId,
                  ...(projectId !== undefined ? { projectId: projectId as ProjectId } : {}),
                  ...(mapId !== undefined ? { mapId: mapId as MapId } : {}),
                })
                .then((result) => {
                  if (result.ok) {
                    notifySuccess(result.message ?? `${command.label} completed.`);
                  } else {
                    notifyError(result.message ?? `${command.label} failed.`);
                  }
                })
                .catch((error) => {
                  notifyError(error instanceof Error ? error.message : String(error));
                });
            }),
        } satisfies ResolvedCommand;
      }),
    [invokePluginCommand, mapId, pluginCommands, projectId, runCommand],
  );

  const allCommands = useMemo(() => {
    return [...staticCommands, ...recentProjectCommands, ...pluginResolvedCommands];
  }, [pluginResolvedCommands, recentProjectCommands, staticCommands]);

  const recentCommandEntries = useMemo(() => {
    const byId = new Map(allCommands.map((command) => [command.id, command]));
    const rankedIds = rankRecentCommands(recentCommandIds, commandUseCounts);
    const seen = new Set<string>();
    const entries: ResolvedCommand[] = [];
    for (const id of rankedIds) {
      const command = byId.get(id);
      if (command && !seen.has(id)) {
        seen.add(id);
        entries.push(command);
      }
    }
    for (const projectCommand of recentProjectCommands) {
      if (!seen.has(projectCommand.id)) {
        seen.add(projectCommand.id);
        entries.push(projectCommand);
      }
    }
    return entries.slice(0, 8);
  }, [allCommands, commandUseCounts, recentCommandIds, recentProjectCommands]);

  const groupedCommands = useMemo(() => {
    const byGroup = new Map<string, ResolvedCommand[]>();
    for (const command of staticCommands) {
      const bucket = byGroup.get(command.group) ?? [];
      bucket.push(command);
      byGroup.set(command.group, bucket);
    }
    for (const command of pluginResolvedCommands) {
      const key = `plugins:${command.pluginSection ?? command.label}`;
      const bucket = byGroup.get(key) ?? [];
      bucket.push(command);
      byGroup.set(key, bucket);
    }
    return byGroup;
  }, [pluginResolvedCommands, staticCommands]);

  const visibleGroupIds = useMemo(() => {
    const groupIds: ShellCommandGroupId[] = [];
    for (const group of SHELL_COMMAND_GROUP_ORDER) {
      if (group !== 'recent') {
        groupIds.push(group);
      }
    }
    return groupIds;
  }, []);

  return {
    groupedCommands,
    recentCommandEntries,
    visibleGroupIds,
  };
}

export function CommandPalette({ open, onOpenChange, projectId, mapId }: CommandPaletteProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const { groupedCommands, recentCommandEntries, visibleGroupIds } =
    useCommandPaletteModel({
      projectId,
      mapId,
      onOpenChange,
      setSearch,
    });

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setSearch('');
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      focusAdjacentCommandGroup(listRef.current, event.shiftKey ? 'previous' : 'next');
    }
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <Command value={search} onValueChange={setSearch} onKeyDown={handleKeyDown}>
        <CommandInput placeholder="Search commands, maps, plugins…" />
        <div ref={listRef}>
          <CommandList>
          <CommandEmpty className={typography.bodyCompact}>
            No matching commands. Try a different search or clear the filter.
          </CommandEmpty>

          {recentCommandEntries.length > 0 ? (
            <>
              <CommandGroup heading={SHELL_COMMAND_GROUP_LABELS.recent}>
                {recentCommandEntries.map((command) => (
                  <PaletteCommandItem
                    key={`recent-${command.id}`}
                    value={command.value}
                    label={command.label}
                    query={search}
                    icon={command.icon}
                    shortcut={command.shortcut}
                    disabled={command.disabled}
                    recent
                    onSelect={command.run}
                  />
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          ) : null}

          {visibleGroupIds.map((groupId) => {
            if (groupId === 'plugins') {
              const generalPluginCommands = groupedCommands.get('plugins') ?? [];
              const namedPluginSections: Array<[string, ResolvedCommand[]]> = [];
              const sortedPluginSections = Array.from(groupedCommands.entries()).sort(
                ([left], [right]) => left.localeCompare(right),
              );
              for (const section of sortedPluginSections) {
                const [key] = section;
                if (key.startsWith('plugins:') && key !== 'plugins:') {
                  namedPluginSections.push(section);
                }
              }
              if (generalPluginCommands.length === 0 && namedPluginSections.length === 0) {
                return null;
              }
              return (
                <section key={groupId}>
                  <CommandSeparator />
                  {generalPluginCommands.length > 0 ? (
                    <CommandGroup heading={SHELL_COMMAND_GROUP_LABELS.plugins}>
                      {generalPluginCommands.map((command) => (
                        <PaletteCommandItem
                          key={command.id}
                          value={command.value}
                          label={command.label}
                          query={search}
                          icon={command.icon}
                          shortcut={command.shortcut}
                          disabled={command.disabled}
                          onSelect={command.run}
                        />
                      ))}
                    </CommandGroup>
                  ) : null}
                  {namedPluginSections.map(([sectionKey, commands]) => (
                    <CommandGroup
                      key={sectionKey}
                      heading={sectionKey.replace(/^plugins:/, '')}
                    >
                      {commands.map((command) => (
                        <PaletteCommandItem
                          key={command.id}
                          value={command.value}
                          label={command.label}
                          query={search}
                          icon={command.icon}
                          shortcut={command.shortcut}
                          disabled={command.disabled}
                          onSelect={command.run}
                        />
                      ))}
                    </CommandGroup>
                  ))}
                </section>
              );
            }

            const commands = groupedCommands.get(groupId);
            if (!commands || commands.length === 0) {
              return null;
            }
            return (
              <section key={groupId}>
                <CommandSeparator />
                <CommandGroup heading={SHELL_COMMAND_GROUP_LABELS[groupId]}>
                  {commands.map((command) => (
                    <PaletteCommandItem
                      key={command.id}
                      value={command.value}
                      label={command.label}
                      query={search}
                      icon={command.icon}
                      shortcut={command.shortcut}
                      disabled={command.disabled}
                      onSelect={command.run}
                    />
                  ))}
                </CommandGroup>
              </section>
            );
          })}
          </CommandList>
        </div>
      </Command>
    </CommandDialog>
  );
}
