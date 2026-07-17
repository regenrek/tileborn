import type { ComponentDefinition } from './components.js';
import type { World } from './world.js';

export interface SystemContext {
  readonly tick: number;
  readonly input?: unknown;
}

export interface System {
  readonly name: string;
  readonly query: readonly ComponentDefinition<object>[];
  readonly dependsOn?: readonly string[];
  readonly update: (world: World, dt: number, context: SystemContext) => void;
}

export class SystemScheduler {
  private readonly systems: System[] = [];

  add(system: System): void {
    if (this.systems.some((existing) => existing.name === system.name)) {
      throw new Error(`system ${system.name} is already registered`);
    }
    this.systems.push(system);
  }

  ordered(): readonly System[] {
    const byName = new Map(this.systems.map((system, index) => [system.name, { system, index }]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const ordered: System[] = [];

    const visit = (system: System): void => {
      if (visited.has(system.name)) {
        return;
      }
      if (visiting.has(system.name)) {
        throw new Error(`system dependency cycle at ${system.name}`);
      }
      visiting.add(system.name);
      for (const dependency of system.dependsOn ?? []) {
        const entry = byName.get(dependency);
        if (!entry) {
          throw new Error(`system ${system.name} depends on missing system ${dependency}`);
        }
        visit(entry.system);
      }
      visiting.delete(system.name);
      visited.add(system.name);
      ordered.push(system);
    };

    for (const { system } of [...byName.values()].sort((left, right) => left.index - right.index)) {
      visit(system);
    }
    return ordered;
  }

  update(world: World, dt: number, context: SystemContext): void {
    for (const system of this.ordered()) {
      system.update(world, dt, context);
    }
  }
}
