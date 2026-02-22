import React, { createContext, useContext, useMemo } from 'react';

export type ThemeName = 'sun' | 'moon' | 'universe';

export interface Theme {
  name: ThemeName;
  bg?: string;
  text: string;
  accent: string;
  dim: string;
  user: string;
  assistant: string;
  error: string;
  warn: string;
  success: string;
  glass: string;
}

const THEMES: Record<ThemeName, Theme> = {
  sun: {
    name: 'sun',
    bg: '#f8f8f8',
    text: '#202020',
    accent: '#0055ff',
    dim: '#888888',
    user: '#111111',
    assistant: '#222222',
    error: '#cc0000',
    warn: '#ccaa00',
    success: '#008800',
    glass: '#eeeeee',
  },
  moon: {
    name: 'moon',
    text: 'white',
    accent: 'white',
    dim: 'gray',
    user: 'white',
    assistant: 'white',
    error: 'red',
    warn: 'yellow',
    success: 'green',
    glass: '#1a1a1a',
  },
  universe: {
    name: 'universe',
    text: 'white',
    accent: 'cyanBright',
    dim: 'magentaBright',
    user: 'greenBright',
    assistant: 'yellowBright',
    error: 'redBright',
    warn: 'yellowBright',
    success: 'blueBright',
    glass: '#0d1b2a',
  },
};

const ThemeContext = createContext<Theme>(THEMES.moon);

export function ThemeProvider(props: { theme: ThemeName; children: React.ReactNode }) {
  const value = useMemo(() => THEMES[props.theme] ?? THEMES.moon, [props.theme]);
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
