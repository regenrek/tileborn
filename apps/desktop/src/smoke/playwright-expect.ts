import { expect as playwrightExpect } from '@playwright/test';

export const expect = playwrightExpect.configure({ timeout: 15_000 });
