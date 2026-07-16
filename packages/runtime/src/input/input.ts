import { Schema } from 'effect';

export const Button = {
  Up: 1 << 0,
  Down: 1 << 1,
  Left: 1 << 2,
  Right: 1 << 3,
  Fire: 1 << 4,
  Reload: 1 << 5,
  Ability: 1 << 6,
  Drop: 1 << 7,
  Interact: 1 << 8,
} as const;

export type ButtonMask = number;

export class MousePosition extends Schema.Class<MousePosition>('MousePosition')({
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class GamepadAxis extends Schema.Class<GamepadAxis>('GamepadAxis')({
  gamepadId: Schema.String,
  axis: Schema.Int,
  value: Schema.Number,
}) {}

export class KeyInputEvent extends Schema.TaggedClass<KeyInputEvent>()('key', {
  tick: Schema.Int,
  code: Schema.String,
  pressed: Schema.Boolean,
}) {}

export class MouseMoveInputEvent extends Schema.TaggedClass<MouseMoveInputEvent>()('mouseMove', {
  tick: Schema.Int,
  x: Schema.Number,
  y: Schema.Number,
}) {}

export class MouseButtonInputEvent extends Schema.TaggedClass<MouseButtonInputEvent>()(
  'mouseButton',
  {
    tick: Schema.Int,
    button: Schema.Int,
    pressed: Schema.Boolean,
  },
) {}

export class GamepadAxisInputEvent extends Schema.TaggedClass<GamepadAxisInputEvent>()(
  'gamepadAxis',
  {
    tick: Schema.Int,
    gamepadId: Schema.String,
    axis: Schema.Int,
    value: Schema.Number,
  },
) {}

export const InputEvent = Schema.Union([
  KeyInputEvent,
  MouseMoveInputEvent,
  MouseButtonInputEvent,
  GamepadAxisInputEvent,
]);

export type InputEvent = Schema.Schema.Type<typeof InputEvent>;

export class InputCommand extends Schema.Class<InputCommand>('InputCommand')({
  tick: Schema.Int,
  buttons: Schema.Int,
  moveX: Schema.Number,
  moveY: Schema.Number,
  aimX: Schema.Number,
  aimY: Schema.Number,
}) {}

export class InputState {
  readonly pressedKeys = new Set<string>();
  readonly pressedMouseButtons = new Set<number>();
  readonly gamepadAxes = new Map<string, number>();
  mouse = new MousePosition({ x: 0, y: 0 });

  apply(event: InputEvent): void {
    switch (event._tag) {
      case 'key':
        if (event.pressed) {
          this.pressedKeys.add(event.code);
        } else {
          this.pressedKeys.delete(event.code);
        }
        break;
      case 'mouseMove':
        this.mouse = new MousePosition({ x: event.x, y: event.y });
        break;
      case 'mouseButton':
        if (event.pressed) {
          this.pressedMouseButtons.add(event.button);
        } else {
          this.pressedMouseButtons.delete(event.button);
        }
        break;
      case 'gamepadAxis':
        this.gamepadAxes.set(`${event.gamepadId}:${event.axis}`, event.value);
        break;
    }
  }

  snapshot(tick: number): InputCommand {
    const left = this.pressedKeys.has('KeyA') || this.pressedKeys.has('ArrowLeft');
    const right = this.pressedKeys.has('KeyD') || this.pressedKeys.has('ArrowRight');
    const up = this.pressedKeys.has('KeyW') || this.pressedKeys.has('ArrowUp');
    const down = this.pressedKeys.has('KeyS') || this.pressedKeys.has('ArrowDown');
    const moveX = clampAxis((right ? 1 : 0) - (left ? 1 : 0) + (this.gamepadAxes.get('0:0') ?? 0));
    const moveY = clampAxis((down ? 1 : 0) - (up ? 1 : 0) + (this.gamepadAxes.get('0:1') ?? 0));
    let buttons = 0;
    if (up) buttons |= Button.Up;
    if (down) buttons |= Button.Down;
    if (left) buttons |= Button.Left;
    if (right) buttons |= Button.Right;
    if (this.pressedMouseButtons.has(0)) buttons |= Button.Fire;
    if (this.pressedKeys.has('KeyR')) buttons |= Button.Reload;
    if (this.pressedKeys.has('KeyE')) buttons |= Button.Interact;
    if (this.pressedKeys.has('KeyQ')) buttons |= Button.Drop;
    if (this.pressedKeys.has('Space')) buttons |= Button.Ability;
    return new InputCommand({
      tick,
      buttons,
      moveX,
      moveY,
      aimX: this.mouse.x,
      aimY: this.mouse.y,
    });
  }
}

export class InputBuffer {
  private readonly state = new InputState();
  private readonly events: InputEvent[] = [];
  private readonly commands: InputCommand[] = [];

  record(event: InputEvent): void {
    const decoded = Schema.decodeUnknownSync(InputEvent)(event);
    this.state.apply(decoded);
    this.events.push(decoded);
  }

  consumeEvents(): readonly InputEvent[] {
    const consumed = [...this.events];
    this.events.length = 0;
    return consumed;
  }

  commandForTick(tick: number): InputCommand {
    const command = this.state.snapshot(tick);
    this.commands.push(command);
    return command;
  }

  consumeCommands(): readonly InputCommand[] {
    const consumed = [...this.commands];
    this.commands.length = 0;
    return consumed;
  }

  get current(): InputState {
    return this.state;
  }
}

const clampAxis = (value: number): number =>
  Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
