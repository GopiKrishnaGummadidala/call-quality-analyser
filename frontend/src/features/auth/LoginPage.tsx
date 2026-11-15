import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Alert, Avatar, Box, Button, ButtonBase, Card, Chip, CircularProgress, IconButton, InputAdornment, Stack, TextField,
  Typography,
} from '@mui/material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import ShieldIcon from '@mui/icons-material/ShieldOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOverOutlined';
import FactCheckIcon from '@mui/icons-material/FactCheckOutlined';
import LoginIcon from '@mui/icons-material/Login';
import { ApiError } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { avatarColor, initials } from '../../shared/format';

/** Seeded demo accounts (see DemoDataSeeder). Shown on the sign-in screen for the local demo only. */
const DEMO_ACCOUNTS = [
  { username: 'alice', name: 'Alice Becker', role: 'Annotator', note: 'Transcribes loan calls · reviews mortgage calls' },
  { username: 'bob', name: 'Bob Novak', role: 'Reviewer', note: 'Reviews loan calls' },
  { username: 'erik', name: 'Erik Hansen', role: 'Annotator', note: 'Loan and mortgage calls' },
  { username: 'carol', name: 'Carol Diaz', role: 'Annotator', note: 'Other Bank (separate tenant)' },
  { username: 'admin', name: 'Dana Fischer', role: 'Admin', note: 'Users, access log, training data' },
  { username: 'ops', name: 'Platform Ops', role: 'Operator', note: 'Tenants & demo reset (no customer data)' },
];
const DEMO_PASSWORD = 'Test123';

const FEATURES = [
  { icon: <RecordVoiceOverIcon />, title: 'Agent and customer transcripts', text: 'A speech model drafts, people correct: waveform, speaker lanes, keyboard-first.' },
  { icon: <FactCheckIcon />, title: 'QA scorecards with review', text: 'Conduct checks per call, four-eyes review and a full audit trail.' },
  { icon: <ShieldIcon />, title: 'Role-based access', text: 'Annotator, reviewer and admin permissions, checked on the server.' },
];

function BrandPanel() {
  return (
    <Box sx={{
      position: 'relative', overflow: 'hidden', color: '#e6eaf3', p: { md: 6, lg: 8 },
      display: { xs: 'none', md: 'flex' }, flexDirection: 'column', justifyContent: 'space-between',
      background: 'radial-gradient(circle at 20% 15%, rgba(99,102,241,.35), transparent 45%), radial-gradient(circle at 85% 80%, rgba(45,212,191,.25), transparent 45%), linear-gradient(160deg, #0b1324 0%, #121c34 100%)',
    }}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <Box sx={{ width: 40, height: 40, borderRadius: 3, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #6366f1, #2dd4bf)' }}>
          <GraphicEqIcon sx={{ color: '#fff' }} />
        </Box>
        <Typography sx={{ fontWeight: 800, letterSpacing: '0.03em' }}>CALL QUALITY ANALYSER</Typography>
      </Stack>

      <Box>
        <Typography sx={{ fontSize: { md: 34, lg: 42 }, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em', maxWidth: 520 }}>
          Transcribe bank calls.{' '}
          <Box component="span" sx={{ background: 'linear-gradient(90deg, #a5b4fc, #5eead4)', WebkitBackgroundClip: 'text', color: 'transparent' }}>
            Score their quality. Measure models.
          </Box>
        </Typography>

        {/* decorative animated waveform */}
        <Stack direction="row" alignItems="center" spacing="5px" aria-hidden sx={{ height: 90, my: 5 }}>
          {Array.from({ length: 46 }, (_, i) => {
            const h = 18 + Math.abs(Math.sin(i * 0.55) * 52) + (i % 3) * 6;
            return (
              <Box key={i} sx={{
                width: 5, height: h, borderRadius: 3,
                background: i < 24 ? 'linear-gradient(180deg,#818cf8,#6366f1)' : 'linear-gradient(180deg,#5eead4,#14b8a6)',
                opacity: 0.9, transformOrigin: 'center',
                animation: `pulse 1.6s ease-in-out ${(i % 12) * 0.08}s infinite alternate`,
                '@keyframes pulse': { from: { transform: 'scaleY(0.55)' }, to: { transform: 'scaleY(1)' } },
                '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
              }} />
            );
          })}
        </Stack>

        <Stack spacing={2.5}>
          {FEATURES.map((f) => (
            <Stack key={f.title} direction="row" spacing={2} alignItems="flex-start">
              <Box sx={{ width: 38, height: 38, borderRadius: 2.5, flexShrink: 0, display: 'grid', placeItems: 'center', bgcolor: 'rgba(148,163,184,.12)', color: '#5eead4' }}>
                {f.icon}
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 650 }}>{f.title}</Typography>
                <Typography sx={{ fontSize: 14, color: '#94a0b8' }}>{f.text}</Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </Box>

      <Typography sx={{ fontSize: 12, color: '#7f8aa3' }}>Synthetic demo data only · not for real customer data</Typography>
    </Box>
  );
}

export function LoginPage() {
  const { login, expired } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Which fields to mark red: empty on submit, or both after rejected credentials. */
  const [invalid, setInvalid] = useState({ username: false, password: false });
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setInvalid({ username: !username.trim(), password: !password });
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
    } catch (err) {
      const rejected = err instanceof ApiError && err.status === 401;
      setInvalid({ username: rejected, password: rejected });
      setError(rejected ? 'Invalid username or password.' : 'Could not reach the server. Is the API running?');
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  function pickDemo(account: string) {
    setUsername(account);
    setPassword(DEMO_PASSWORD);
    setError(null);
    setInvalid({ username: false, password: false });
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' }, bgcolor: 'background.default' }}>
      <BrandPanel />

      <Stack component="main" alignItems="center" justifyContent="center" sx={{ p: { xs: 2, sm: 4 } }}>
        <Box sx={{ width: '100%', maxWidth: 420 }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mb: 3, display: { xs: 'flex', md: 'none' } }}>
            <Box sx={{ width: 34, height: 34, borderRadius: 2.5, display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, #6366f1, #2dd4bf)' }}>
              <GraphicEqIcon sx={{ color: '#fff', fontSize: 20 }} />
            </Box>
            <Typography sx={{ fontWeight: 800 }}>CALL QUALITY ANALYSER</Typography>
          </Stack>

          <Typography variant="h1" sx={{ fontSize: 28 }}>Sign in</Typography>
          <Typography sx={{ color: 'text.secondary', mt: 0.5, mb: 3 }}>Welcome back. Use your Call Quality Analyser account.</Typography>

          {expired && <Alert severity="info" role="note" sx={{ mb: 2 }}>Your session ended. Please sign in again.</Alert>}
          {error && <Alert severity="error" role="alert" sx={{ mb: 2 }}>{error}</Alert>}

          <Box component="form" onSubmit={(e) => { void submit(e); }} noValidate>
            <Stack spacing={2}>
              <TextField label="Username" value={username} error={invalid.username}
                onChange={(e) => { setUsername(e.target.value); setInvalid((v) => ({ ...v, username: false })); }}
                autoComplete="username" autoFocus fullWidth inputProps={{ autoCapitalize: 'none', spellCheck: false }} />
              <TextField label="Password" type={show ? 'text' : 'password'} value={password} inputRef={passwordRef} error={invalid.password}
                onChange={(e) => { setPassword(e.target.value); setInvalid((v) => ({ ...v, password: false })); }} autoComplete="current-password" fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((v) => !v)} edge="end">
                        {show ? <VisibilityOffIcon /> : <VisibilityIcon />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }} />
              <Button type="submit" variant="contained" size="large" disabled={busy}
                startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <LoginIcon />}
                sx={{ py: 1.25, borderRadius: 2.5, background: 'linear-gradient(135deg, var(--mui-palette-primary-main), #6d5ef6)' }}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </Box>

          <Card sx={{ mt: 4, p: 2, bgcolor: 'action.hover', borderStyle: 'dashed' }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <LockIcon sx={{ fontSize: 18, color: 'secondary.main' }} />
              <Typography sx={{ fontWeight: 650, fontSize: 14 }}>Demo accounts</Typography>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                Password for all: <Box component="code" sx={{ fontWeight: 700, color: 'text.primary' }}>{DEMO_PASSWORD}</Box>
              </Typography>
            </Stack>
            <Stack spacing={0.5}>
              {DEMO_ACCOUNTS.map((a) => (
                <ButtonBase key={a.username} onClick={() => pickDemo(a.username)} aria-label={`Use demo account ${a.username} (${a.role})`}
                  sx={{
                    justifyContent: 'flex-start', gap: 1.5, px: 1, py: 0.75, borderRadius: 2, textAlign: 'left',
                    bgcolor: username === a.username ? 'background.paper' : 'transparent',
                    '&:hover': { bgcolor: 'background.paper' },
                  }}>
                  <Avatar sx={{ width: 30, height: 30, fontSize: 12, bgcolor: avatarColor(a.name) }}>{initials(a.name)}</Avatar>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
                      {a.name} <Box component="span" sx={{ color: 'text.secondary', fontFamily: 'ui-monospace, monospace', fontWeight: 400 }}>@{a.username}</Box>
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }} noWrap>{a.note}</Typography>
                  </Box>
                  <Chip size="small" label={a.role} variant="outlined"
                    color={a.role === 'Admin' ? 'error' : a.role === 'Reviewer' ? 'primary' : a.role === 'Operator' ? 'default' : 'secondary'} sx={{ fontWeight: 650 }} />
                </ButtonBase>
              ))}
            </Stack>
          </Card>
        </Box>
      </Stack>
    </Box>
  );
}
