import { XIcon } from 'lucide-react';
import { useEffect } from 'react';
import {
  Button,
  Kbd,
  KbdGroup,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
  typography,
} from '@tileborne/ui';

import {
  BOTTOM_DRAWER_TABS,
  DEFAULT_BOTTOM_DRAWER_TAB,
  isBottomDrawerTabValue,
  type BottomDrawerTabValue,
} from '@/components/bottom-drawer/constants';
import { JobsTab } from '@/components/bottom-drawer/jobs-tab';
import { LogsTab } from '@/components/bottom-drawer/logs-tab';
import { PlaytestTab } from '@/components/bottom-drawer/playtest-tab';
import { ProblemsTab } from '@/components/bottom-drawer/problems-tab';
import { RuntimeTab } from '@/components/bottom-drawer/runtime-tab';
import { PluginSlot } from '@/components/plugins/plugin-slot';
import { modKeyLabel } from '@/lib/keyboard-shortcuts';
import { PLUGIN_SLOTS } from '@/lib/plugin-slots';
import { useEditorUiStore } from '@/stores/editor-ui-store';

function BottomDrawerTabTrigger({
  label,
  shortcut,
  value,
}: {
  readonly label: string;
  readonly shortcut: string;
  readonly value: BottomDrawerTabValue;
}) {
  return (
    <TabsTrigger value={value} className="gap-1.5">
      <span>{label}</span>
      <KbdGroup aria-hidden className="hidden sm:inline-flex">
        <Kbd>{modKeyLabel()}</Kbd>
        <Kbd>{shortcut}</Kbd>
      </KbdGroup>
    </TabsTrigger>
  );
}

export function BottomDrawer() {
  const activeTab = useEditorUiStore((s) => s.bottomDrawerTab ?? DEFAULT_BOTTOM_DRAWER_TAB);
  const setActiveTab = useEditorUiStore((s) => s.setBottomDrawerTab);
  const setBottomDrawerOpen = useEditorUiStore((s) => s.setBottomDrawerOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) {
        return;
      }
      const shortcut = event.key;
      const matched = BOTTOM_DRAWER_TABS.find((tab) => tab.shortcut === shortcut);
      if (!matched) {
        return;
      }
      event.preventDefault();
      setActiveTab(matched.value);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <TooltipProvider>
      <section
        aria-label="Bottom panel"
        className="flex h-full min-h-0 flex-col border-t border-border bg-sidebar"
      >
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (isBottomDrawerTabValue(value)) {
              setActiveTab(value);
            }
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="flex items-center justify-between gap-2 px-2 pt-2">
            <TabsList className="w-auto" variant="line">
              {BOTTOM_DRAWER_TABS.map((tab) => (
                <BottomDrawerTabTrigger
                  key={tab.value}
                  value={tab.value}
                  label={tab.label}
                  shortcut={tab.shortcut}
                />
              ))}
            </TabsList>
            <div className="flex shrink-0 items-center gap-2">
              <div
                className={cn(typography.inlineHint, 'hidden items-center gap-1 lg:inline-flex')}
              >
                <span>Switch tabs</span>
                <KbdGroup>
                  <Kbd>{modKeyLabel()}</Kbd>
                  <Kbd>1</Kbd>
                </KbdGroup>
                <span aria-hidden>–</span>
                <KbdGroup>
                  <Kbd>{modKeyLabel()}</Kbd>
                  <Kbd>5</Kbd>
                </KbdGroup>
              </div>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label="Close bottom panel"
                      onClick={() => setBottomDrawerOpen(false)}
                      data-testid="bottom-drawer-close"
                    >
                      <XIcon aria-hidden className="size-3.5" />
                    </Button>
                  }
                />
                <TooltipContent side="top" align="end">
                  <span>Close panel</span>
                  <KbdGroup className="ml-2">
                    <Kbd>{modKeyLabel()}</Kbd>
                    <Kbd>J</Kbd>
                  </KbdGroup>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <TabsContent value="jobs" className="min-h-0 flex-1 px-2 pb-2">
            <JobsTab />
          </TabsContent>

          <TabsContent value="logs" className="min-h-0 flex-1 px-2 pb-2">
            <LogsTab />
          </TabsContent>

          <TabsContent value="problems" className="min-h-0 flex-1 px-2 pb-2">
            <ProblemsTab />
          </TabsContent>

          <TabsContent value="playtest" className="min-h-0 flex-1 px-2 pb-2">
            <PlaytestTab />
          </TabsContent>

          <TabsContent value="runtime" className="min-h-0 flex-1 px-2 pb-2">
            <RuntimeTab />
          </TabsContent>
        </Tabs>

        <div className="border-t border-border p-2">
          <PluginSlot id={PLUGIN_SLOTS.bottomDrawer} />
        </div>
      </section>
    </TooltipProvider>
  );
}
