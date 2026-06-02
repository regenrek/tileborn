import { useReducer } from "react";

import {
  initialMenuState,
  menuReducer,
  type MenuEvent,
  type MenuState,
} from "./menu-machine.js";

export interface MenuMachine {
  readonly state: MenuState;
  readonly dispatch: (event: MenuEvent) => void;
}

/** React binding around the pure {@link menuReducer}. */
export const useMenuMachine = (initial: MenuState = initialMenuState): MenuMachine => {
  const [state, dispatch] = useReducer(menuReducer, initial);
  return { state, dispatch };
};
