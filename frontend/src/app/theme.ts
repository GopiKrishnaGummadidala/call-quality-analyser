import { createTheme } from '@mui/material';

/**
 * Light + dark schemes exposed as CSS variables (`--mui-palette-*`), so styles.css can follow the active
 * scheme too. The `dark` / `light` class on <html> is toggled by MUI (system preference by default).
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#4f5bd5' },
        secondary: { main: '#0fa5a0' },
        background: { default: '#f3f5fa', paper: '#ffffff' },
        divider: 'rgba(15, 23, 42, 0.09)',
        text: { primary: '#141a2e', secondary: '#5d6880' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#8b95ff' },
        secondary: { main: '#2dd4bf' },
        background: { default: '#0c1222', paper: '#141c30' },
        divider: 'rgba(148, 163, 184, 0.14)',
        text: { primary: '#e6eaf3', secondary: '#94a0b8' },
      },
    },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    h1: { fontSize: '1.65rem', fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.05rem', fontWeight: 650 },
    button: { textTransform: 'none', fontWeight: 600 },
    overline: { fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiPaper: { defaultProps: { elevation: 0 } },
    MuiCard: {
      defaultProps: { variant: 'outlined' },
      styleOverrides: { root: { borderRadius: 14 } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: ({ theme: t }) => ({
          fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          color: t.vars?.palette.text.secondary,
        }),
      },
    },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});

/** Speaker / label colours shared by the waveform, segment cards and transcript. */
export const SPEAKER_COLOR = { AGENT: '#3b82f6', CUSTOMER: '#10b981', OTHER: '#f59e0b' } as const;
export const SPEAKER_NAME = { AGENT: 'Agent', CUSTOMER: 'Customer', OTHER: 'Other' } as const;
export const LABEL_COLOR = { CLEAR: '#10b981', UNCLEAR: '#f59e0b', CROSSTALK: '#ec4899' } as const;
