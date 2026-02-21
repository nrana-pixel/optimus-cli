import React, { createContext, useContext, useMemo } from 'react';

export type ThemeName = 'dark' | 'light' | 'high-contrast';

export interface Theme {
  name: ThemeName;
  accent: string;
  dim: string;
  user: string;
  assistant: string;
  error: string;
  warn: string;
  success: string;
}

const THEMES: Record<ThemeName, Theme> = {
  dark: {
    name: 'dark',
    accent: 'magenta',
    dim: 'gray',
    user: 'cyan',
    assistant: 'yellow',
    error: 'red',
    warn: 'yellow',
    success: 'green',
  },
  light: {
    name: 'light',
    accent: 'blue',
    dim: 'gray',
    user: 'blue',
    assistant: 'magenta',
    error: 'red',
    warn: 'yellow',
    success: 'green',
  },
  'high-contrast': {
    name: 'high-contrast',
    accent: 'white',
    dim: 'white',
    user: 'white',
    assistant: 'white',
    error: 'red',
    warn: 'yellow',
    success: 'green',
  },
};

const ThemeContext = createContext<Theme>(THEMES.dark);

export function ThemeProvider(props: { theme: ThemeName; children: React.ReactNode }) {
  const value = useMemo(() => THEMES[props.theme] ?? THEMES.dark, [props.theme]);
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
