/* Generated from capabilities.registry.json. Do not edit. */
export const capabilityInventory = {
  schemaVersion: 1,
  capabilities: [
    {
      id: 'lifecycle.core',
      label: 'Behavior lifecycle',
      description: 'Deterministic behavior start, stop, reload, and error lifecycle hooks.',
      events: ['lifecycle.started', 'lifecycle.stopped', 'lifecycle.reloaded'],
    },
    {
      id: 'state.core',
      label: 'Behavior state',
      description: "Read and update the behavior's typed, serializable local state.",
      actions: ['state.set'],
    },
    {
      id: 'time.deterministic',
      label: 'Deterministic time',
      description:
        'Simulation ticks, seeded random values, and tick-based timers without wall-clock APIs.',
      events: ['runtime.tick', 'timer.fired'],
      actions: ['timer.after', 'timer.every', 'timer.cancel'],
    },
  ],
} as const;

export type BuiltInCapabilityId = (typeof capabilityInventory.capabilities)[number]['id'];

export const builtInCapabilityIds = capabilityInventory.capabilities.map(
  (entry) => entry.id,
) as ReadonlyArray<BuiltInCapabilityId>;
