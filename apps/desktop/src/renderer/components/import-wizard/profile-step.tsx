import type { TiledImportProfile, TiledImportRecommendation } from '@tileborne/ipc-contracts';
import { Badge, Field, FieldDescription, FieldGroup, FieldLabel, cn } from '@tileborne/ui';
import { CheckIcon, ShieldCheckIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';

type BuiltInProfileValue = 'standard' | 'standard-plus-hints' | 'assistive-infer';

type ProfileOption = {
  readonly value: BuiltInProfileValue;
  readonly title: string;
  readonly tagline: string;
  readonly description: string;
  readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly tags: readonly {
    readonly label: string;
    readonly tone: 'positive' | 'neutral' | 'caution';
  }[];
};

const profiles: readonly ProfileOption[] = [
  {
    value: 'standard',
    title: 'Standard',
    tagline: 'Deterministic Tiled mapping',
    description:
      'Import maps exactly as authored in Tiled. Ignores any tileborne.* properties. Best when the source is clean Tiled content you do not control.',
    icon: ShieldCheckIcon,
    tags: [
      { label: 'Predictable', tone: 'positive' },
      { label: 'No inference', tone: 'neutral' },
      { label: 'Lossless', tone: 'positive' },
    ],
  },
  {
    value: 'standard-plus-hints',
    title: 'Standard + Hints',
    tagline: 'Respect tileborne.* properties',
    description:
      'Like Standard, but reads explicit tileborne.* hints from tilesets, tiles, and objects (anchors, categories, paintability). Best when the author tagged the source for Tileborne.',
    icon: SparklesIcon,
    tags: [
      { label: 'Author-driven', tone: 'positive' },
      { label: 'Predictable', tone: 'positive' },
    ],
  },
  {
    value: 'assistive-infer',
    title: 'Assistive Infer',
    tagline: 'Confidence-based proposals',
    description:
      'Adds heuristic suggestions on top of Standard + Hints — proposed placeables, categories and autotiles. You review and accept each suggestion before it is applied.',
    icon: WandSparklesIcon,
    tags: [
      { label: 'Suggestions', tone: 'neutral' },
      { label: 'Requires review', tone: 'caution' },
    ],
  },
];

const toneVariant: Record<'positive' | 'neutral' | 'caution', 'default' | 'secondary' | 'outline'> =
  {
    positive: 'default',
    neutral: 'secondary',
    caution: 'outline',
  };

export function ProfileStep({
  profile,
  recommendation,
  onProfileChange,
}: {
  readonly profile: TiledImportProfile;
  readonly recommendation?: TiledImportRecommendation | undefined;
  readonly onProfileChange: (profile: TiledImportProfile) => void;
}) {
  const activeProfile: BuiltInProfileValue =
    profile === 'standard' || profile === 'standard-plus-hints' || profile === 'assistive-infer'
      ? profile
      : 'standard';
  const recommendedProfile =
    recommendation?.recommendedProfile === 'standard' ||
    recommendation?.recommendedProfile === 'standard-plus-hints' ||
    recommendation?.recommendedProfile === 'assistive-infer'
      ? recommendation.recommendedProfile
      : undefined;
  const overrideActive = recommendedProfile !== undefined && activeProfile !== recommendedProfile;

  return (
    <FieldGroup>
      <Field>
        <FieldLabel>Import profile</FieldLabel>
        <FieldDescription>
          {recommendation?.rationale ??
            'How aggressively should Tileborne interpret the source? You can change this later by re-importing.'}
        </FieldDescription>
        {recommendedProfile !== undefined ? (
          <div
            className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
            data-testid="import-profile-recommendation"
          >
            <span className="font-medium">
              Auto-detected recommendation:{' '}
              {profiles.find((option) => option.value === recommendedProfile)?.title}
            </span>
            {overrideActive ? (
              <span className="ml-2 text-muted-foreground">Expert override active.</span>
            ) : null}
          </div>
        ) : null}
        <div role="radiogroup" aria-label="Import profile" className="grid gap-2">
          {profiles.map((option) => {
            const Icon = option.icon;
            const selected = activeProfile === option.value;
            const recommended = recommendedProfile === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-label={option.title}
                aria-checked={selected}
                onClick={() => onProfileChange(option.value)}
                data-state={selected ? 'checked' : 'unchecked'}
                className={cn(
                  'group relative flex w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition',
                  'hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  selected ? 'border-primary ring-2 ring-primary/40' : 'border-border',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-md border',
                    selected
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground',
                  )}
                  aria-hidden
                >
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{option.title}</span>
                    {recommended ? (
                      <Badge
                        variant="default"
                        className="px-1.5 py-0 text-[10px] uppercase tracking-wide"
                      >
                        Auto-detected
                      </Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{option.tagline}</span>
                  </span>
                  <span className="text-sm text-muted-foreground">{option.description}</span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {option.tags.map((tag) => (
                      <Badge
                        key={tag.label}
                        variant={toneVariant[tag.tone]}
                        className="text-[10px]"
                      >
                        {tag.label}
                      </Badge>
                    ))}
                  </span>
                </span>
                <span
                  className={cn(
                    'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border transition',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-transparent',
                  )}
                  aria-hidden
                >
                  <CheckIcon className="size-3" />
                </span>
              </button>
            );
          })}
        </div>
      </Field>
    </FieldGroup>
  );
}
