import type { LucideIcon } from 'lucide-react';
import {
  BlocksIcon,
  BotIcon,
  EqualIcon,
  PackageOpenIcon,
  PlayIcon,
  RefreshCwIcon,
  Repeat2Icon,
  SkullIcon,
  SwordsIcon,
  TimerIcon,
  TimerOffIcon,
  TimerResetIcon,
  TrophyIcon,
  UsersRoundIcon,
  VariableIcon,
} from 'lucide-react';

const icons: Readonly<Record<string, LucideIcon>> = {
  bot: BotIcon,
  equal: EqualIcon,
  'package-open': PackageOpenIcon,
  play: PlayIcon,
  'refresh-cw': RefreshCwIcon,
  'repeat-2': Repeat2Icon,
  skull: SkullIcon,
  swords: SwordsIcon,
  timer: TimerIcon,
  'timer-off': TimerOffIcon,
  'timer-reset': TimerResetIcon,
  trophy: TrophyIcon,
  'users-round': UsersRoundIcon,
  variable: VariableIcon,
};

export function BehaviorBlockIcon({
  name,
  className = 'size-4',
}: {
  readonly name?: string | undefined;
  readonly className?: string | undefined;
}) {
  const Icon = name === undefined ? BlocksIcon : (icons[name] ?? BlocksIcon);
  return <Icon className={className} aria-hidden />;
}
