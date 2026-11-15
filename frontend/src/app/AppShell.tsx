import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link as RouterLink, matchPath, useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, Box, Breadcrumbs, Button, Chip, Divider, Drawer, IconButton, Link, ListItemIcon, ListItemText,
  Menu, MenuItem, Stack, Toolbar, Tooltip, Typography, useColorScheme, useMediaQuery,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import DatasetIcon from '@mui/icons-material/DatasetOutlined';
import DnsIcon from '@mui/icons-material/DnsOutlined';
import type { Theme } from '@mui/material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import DashboardIcon from '@mui/icons-material/SpaceDashboard';
import ListAltIcon from '@mui/icons-material/ListAlt';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import InsightsIcon from '@mui/icons-material/Insights';
import FolderIcon from '@mui/icons-material/FolderOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import KeyboardIcon from '@mui/icons-material/KeyboardAltOutlined';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { api } from '../shared/api';
import { useAuth } from '../shared/auth';
import { useActiveProject } from '../shared/useActiveProject';
import { avatarColor, initials } from '../shared/format';

const SIDEBAR_WIDTH = 256;

/* Sidebar is always dark (both schemes), like a classic console nav. */
const nav = {
  bg: 'linear-gradient(180deg, #0b1324 0%, #101a30 100%)',
  fg: '#c3cbdc',
  muted: '#7f8aa3',
  line: 'rgba(148,163,184,0.14)',
  activeBg: 'rgba(45,212,191,0.13)',
  activeFg: '#5eead4',
};

function NavItem({ to, icon, label, active, badge }: {
  to: string; icon: ReactNode; label: string; active: boolean; badge?: ReactNode;
}) {
  return (
    <Box component={RouterLink} to={to} aria-current={active ? 'page' : undefined}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1, mx: 1, borderRadius: 2,
        color: active ? nav.activeFg : nav.fg, bgcolor: active ? nav.activeBg : 'transparent',
        textDecoration: 'none', fontSize: 14, fontWeight: active ? 650 : 500, position: 'relative',
        transition: 'background-color .15s, color .15s',
        '&:hover': { bgcolor: active ? nav.activeBg : 'rgba(148,163,184,0.08)', color: '#fff' },
        '&::before': active ? {
          content: '""', position: 'absolute', left: -8, top: 8, bottom: 8, width: 3, borderRadius: 3, bgcolor: nav.activeFg,
        } : undefined,
        '&:focus-visible': { outline: `2px solid ${nav.activeFg}`, outlineOffset: 1 },
      }}>
      <Box sx={{ display: 'grid', '& svg': { fontSize: 20 } }}>{icon}</Box>
      <Box sx={{ flex: 1 }}>{label}</Box>
      {badge}
    </Box>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" sx={{ display: 'block', px: 2.5, pt: 2.5, pb: 0.75, fontSize: 10.5, color: nav.muted }}>
      {children}
    </Typography>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname, search } = useLocation();
  const { projects, active } = useActiveProject();
  const { isAdmin, isOperator } = useAuth();
  // An administrator on no project has no queue: the home page is the organisation overview.
  const adminOnly = isAdmin && !isOperator && !projects.isLoading && !active;
  const params = new URLSearchParams(search);
  const status = params.get('status');
  const projectQs = active ? `project=${active.id}` : '';
  const onQueue = pathname === '/' || pathname.startsWith('/tasks/');

  return (
    <Box onClick={onNavigate} sx={{
      width: SIDEBAR_WIDTH, height: '100%', background: nav.bg, color: nav.fg,
      display: 'flex', flexDirection: 'column', borderRight: `1px solid ${nav.line}`,
    }}>
      <Stack direction="row" alignItems="center" spacing={1.5} component={RouterLink} to="/"
        sx={{ px: 2.5, height: 64, color: '#fff', textDecoration: 'none', flexShrink: 0 }}>
        <Box sx={{
          width: 34, height: 34, borderRadius: 2.5, display: 'grid', placeItems: 'center',
          background: 'linear-gradient(135deg, #6366f1 0%, #2dd4bf 100%)', boxShadow: '0 6px 18px rgba(45,212,191,.25)',
        }}>
          <GraphicEqIcon sx={{ fontSize: 20, color: '#fff' }} />
        </Box>
        <Box>
          <Typography sx={{ fontWeight: 800, letterSpacing: '0.02em', fontSize: 15.5, lineHeight: 1.1 }}>CALL QUALITY ANALYSER</Typography>
          <Typography sx={{ fontSize: 11, color: nav.muted }}>Bank call QA · demo</Typography>
        </Box>
      </Stack>
      <Divider sx={{ borderColor: nav.line }} />

      <Box sx={{ flex: 1, overflowY: 'auto', pb: 2 }}>
        <SectionLabel>Workspace</SectionLabel>
        <Stack spacing={0.5}>
          {adminOnly ? (
            <NavItem to="/" icon={<DashboardIcon />} label="Overview" active={onQueue} />
          ) : (
            <>
              <NavItem to={`/?${projectQs}`} icon={<ListAltIcon />} label="Task queue"
                active={onQueue && status !== 'SUBMITTED'} />
              <NavItem to={`/?${projectQs}&status=SUBMITTED`} icon={<FactCheckIcon />} label="Review queue"
                active={pathname === '/' && status === 'SUBMITTED'}
                badge={active?.role === 'REVIEWER'
                  ? <Chip label="Reviewer" size="small" sx={{ height: 18, fontSize: 10, bgcolor: 'rgba(99,102,241,.25)', color: '#c7d2fe' }} />
                  : undefined} />
            </>
          )}
          <NavItem to={`/evaluation?${projectQs}`} icon={<InsightsIcon />} label="Model evaluation"
            active={pathname.startsWith('/evaluation')} />
        </Stack>

        <SectionLabel>Projects</SectionLabel>
        <Stack spacing={0.5}>
          {projects.data?.map((p) => (
            <NavItem key={p.id} to={`${pathname.startsWith('/evaluation') ? '/evaluation' : '/'}?project=${p.id}`}
              icon={<FolderIcon />} label={p.name} active={false}
              badge={<Box component="span" sx={{
                width: 8, height: 8, borderRadius: '50%', bgcolor: p.id === active?.id ? nav.activeFg : 'transparent',
                border: `1px solid ${p.id === active?.id ? nav.activeFg : nav.muted}`,
              }} />} />
          ))}
          {projects.data?.length === 0 && (
            <Typography sx={{ px: 2.5, fontSize: 13, color: nav.muted }}>No project memberships</Typography>
          )}
        </Stack>

        {isOperator && (
          <>
            <SectionLabel>Platform</SectionLabel>
            <NavItem to="/platform" icon={<DnsIcon />} label="Tenants & demo" active={pathname.startsWith('/platform')} />
          </>
        )}

        {isAdmin && (
          <>
            <SectionLabel>Administration</SectionLabel>
            <NavItem to="/admin" icon={<AdminPanelSettingsIcon />} label="Users & roles" active={pathname === '/admin'} />
            <NavItem to="/admin/datasets" icon={<DatasetIcon />} label="Training data" active={pathname.startsWith('/admin/datasets')} />
          </>
        )}
      </Box>

      <Box sx={{ m: 2, p: 2, borderRadius: 3, border: `1px solid ${nav.line}`, bgcolor: 'rgba(148,163,184,0.06)' }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: '#fff' }}>
          <KeyboardIcon sx={{ fontSize: 18, color: nav.activeFg }} />
          <Typography sx={{ fontSize: 13, fontWeight: 650 }}>Keyboard first</Typography>
        </Stack>
        {[['K', 'Play / pause'], ['N', 'New segment'], ['Ctrl ↵', 'Submit task'], ['?', 'All shortcuts']].map(([k, v]) => (
          <Stack key={k} direction="row" justifyContent="space-between" sx={{ fontSize: 12, color: nav.muted, py: 0.25 }}>
            <span>{v}</span>
            <Box component="kbd" sx={{
              fontFamily: 'inherit', fontSize: 11, px: 0.75, borderRadius: 1, color: nav.fg,
              border: `1px solid ${nav.line}`, bgcolor: 'rgba(0,0,0,.25)',
            }}>{k}</Box>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}

function ThemeToggle() {
  const { mode, setMode } = useColorScheme();
  const next = mode === 'system' ? 'light' : mode === 'light' ? 'dark' : 'system';
  const icon = mode === 'light' ? <LightModeIcon /> : mode === 'dark' ? <DarkModeIcon /> : <BrightnessAutoIcon />;
  return (
    <Tooltip title={`Theme: ${mode ?? 'system'} (switch to ${next})`}>
      <IconButton aria-label={`Switch to ${next} theme`} onClick={() => setMode(next)}>{icon}</IconButton>
    </Tooltip>
  );
}

function UserMenu() {
  const navigate = useNavigate();
  const { user, isAdmin, isOperator, logout } = useAuth();
  const { active } = useActiveProject();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (!user) return null;

  const name = user.displayName;
  const roleLine = isOperator ? 'platform operator' : isAdmin ? 'admin' : active ? `${active.role.toLowerCase()} · ${active.name}` : user.tenantName;
  return (
    <>
      <Button color="inherit" onClick={(e) => setAnchor(e.currentTarget)} endIcon={<ExpandMoreIcon />}
        aria-label={`Account menu for ${name}`} aria-haspopup="menu"
        sx={{ borderRadius: 99, pl: 0.75, pr: 1.25, py: 0.5, gap: 0.5 }}>
        <Avatar sx={{ width: 32, height: 32, fontSize: 13, fontWeight: 700, bgcolor: avatarColor(name) }}>{initials(name)}</Avatar>
        <Box sx={{ textAlign: 'left', display: { xs: 'none', sm: 'block' }, lineHeight: 1.2 }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 650, lineHeight: 1.2 }}>{name.replace(/\s*\(.*\)/, '')}</Typography>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.2 }}>{roleLine}</Typography>
        </Box>
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { mt: 1, minWidth: 270, borderRadius: 3, border: 1, borderColor: 'divider' } } }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, pt: 1, pb: 1.5 }}>
          <Avatar sx={{ width: 40, height: 40, fontWeight: 700, bgcolor: avatarColor(name) }}>{initials(name)}</Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 700 }} noWrap>{name}</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', fontFamily: 'ui-monospace, monospace' }}>@{user.username}</Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 0.5 }}>
              <Chip size="small" label={user.tenantName} sx={{ height: 20, fontSize: 11 }} />
              {isAdmin && <Chip size="small" color="error" label="admin" sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />}
            </Stack>
          </Box>
        </Stack>
        <Divider />
        {isAdmin && (
          <MenuItem onClick={() => { setAnchor(null); navigate('/admin'); }}>
            <ListItemIcon><AdminPanelSettingsIcon fontSize="small" /></ListItemIcon>
            <ListItemText>Users &amp; roles</ListItemText>
          </MenuItem>
        )}
        <MenuItem onClick={() => { setAnchor(null); logout(); navigate('/'); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          <ListItemText>Sign out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  );
}

function Crumbs() {
  const { pathname } = useLocation();
  const { projects, active } = useActiveProject();
  const { isAdmin, isOperator } = useAuth();
  const taskId = matchPath('/tasks/:taskId', pathname)?.params.taskId;
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.getTask(taskId!), enabled: !!taskId });
  const qs = active ? `?project=${active.id}` : '';
  const wide = useMediaQuery((t: Theme) => t.breakpoints.up('lg'));

  if (pathname === '/' && isAdmin && !isOperator && !projects.isLoading && !active) {
    return <Typography sx={{ fontSize: 14, fontWeight: 650 }}>Overview</Typography>;
  }
  const items: { label: string; to?: string }[] = [{ label: 'All projects', to: `/${qs}` }];
  if (active) items.push({ label: active.name, to: `/${qs}` });
  if (pathname.startsWith('/platform')) return <Typography sx={{ fontSize: 14, fontWeight: 650 }}>Platform</Typography>;
  if (pathname.startsWith('/admin')) return (
    <Typography sx={{ fontSize: 14, fontWeight: 650 }}>{pathname.startsWith('/admin/datasets') ? 'Training data' : 'Administration'}</Typography>
  );
  if (pathname.startsWith('/evaluation')) items.push({ label: 'Model evaluation' });
  else if (taskId) items.push({ label: 'Task queue', to: `/${qs}` }, { label: task.data?.title ?? 'Task' });
  else items.push({ label: 'Task queue' });

  return (
    <Breadcrumbs separator={<NavigateNextIcon sx={{ fontSize: 18 }} />} aria-label="Breadcrumb"
      maxItems={wide ? 8 : 3} itemsBeforeCollapse={wide ? 1 : 0} itemsAfterCollapse={2}
      sx={{
        fontSize: 14,
        '& ol': { flexWrap: 'nowrap', overflow: 'hidden' },
        '& li': { whiteSpace: 'nowrap', flexShrink: 0 },
        '& li:last-of-type': { flexShrink: 1, minWidth: 0, overflow: 'hidden' },
      }}>
      {items.map((it, i) => (it.to && i < items.length - 1
        ? <Link key={it.label} component={RouterLink} to={it.to} underline="hover" color="secondary.main" sx={{ fontWeight: 550 }}>{it.label}</Link>
        : <Typography key={it.label} sx={{ fontSize: 14, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis' }} color="text.primary">{it.label}</Typography>))}
    </Breadcrumbs>
  );
}

function TopBar({ onMenu, showMenu }: { onMenu: () => void; showMenu: boolean }) {
  return (
    <AppBar position="sticky" color="inherit" elevation={0}
      sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'color-mix(in srgb, var(--mui-palette-background-paper) 82%, transparent)', backdropFilter: 'blur(10px)' }}>
      <Toolbar sx={{ gap: 1.5, minHeight: { xs: 60, md: 64 } }}>
        {showMenu && <IconButton edge="start" aria-label="Open navigation" onClick={onMenu}><MenuIcon /></IconButton>}
        <Box sx={{ flex: 1, minWidth: 0, overflow: 'hidden', display: { xs: 'none', sm: 'block' } }}><Crumbs /></Box>
        <Box sx={{ flex: 1, display: { xs: 'block', sm: 'none' } }} />
        <ThemeToggle />
        <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 1.5, display: { xs: 'none', md: 'block' } }} />
        <UserMenu />
      </Toolbar>
    </AppBar>
  );
}

function Footer() {
  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: 'divider', px: { xs: 2, md: 4 }, py: 1.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between"
        sx={{ fontSize: 12, color: 'text.secondary' }}>
        <span>© {new Date().getFullYear()} Call Quality Analyser · interview demo</span>
        <span>Synthetic data only · speech generated by text-to-speech · drafts by Whisper · evaluation fixtures are hand-written samples</span>
      </Stack>
    </Box>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const desktop = useMediaQuery((t: Theme) => t.breakpoints.up('md'));
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {desktop ? (
        <Box component="nav" aria-label="Main navigation"
          sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
          <Sidebar />
        </Box>
      ) : (
        <Drawer open={open} onClose={() => setOpen(false)} PaperProps={{ sx: { border: 0 } }}>
          <Box component="nav" aria-label="Main navigation" sx={{ height: '100%' }}>
            <Sidebar onNavigate={() => setOpen(false)} />
          </Box>
        </Drawer>
      )}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <TopBar showMenu={!desktop} onMenu={() => setOpen(true)} />
        <Box component="main" sx={{ flex: 1, width: '100%', maxWidth: 1440, mx: 'auto', px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3.5 } }}>
          {children}
        </Box>
        <Footer />
      </Box>
    </Box>
  );
}
