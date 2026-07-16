import {
  createContext,
  use,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useEditorUiStore, type ThemePreference } from '@/stores/editor-ui-store';

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useEditorUiStore((state) => state.theme);
  const setThemePreference = useEditorUiStore((state) => state.setTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  const applyTheme = useCallback((next: ThemePreference) => {
    const resolved = resolveTheme(next);
    setResolvedTheme(resolved);
    document.documentElement.classList.toggle('dark', resolved === 'dark');
  }, []);
  const applySystemTheme = useEffectEvent(() => applyTheme('system'));

  useEffect(() => {
    applyTheme(theme);
  }, [applyTheme, theme]);

  useEffect(() => {
    if (theme !== 'system') {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => applySystemTheme();
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme: setThemePreference,
    }),
    [resolvedTheme, setThemePreference, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = use(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
