import type { ReactNode } from 'react';
import { BrowserRouter, Link as RouterLink, Route, Routes } from 'react-router-dom';
import { Alert, Button, CssBaseline, ThemeProvider, Typography } from '@mui/material';
import { QueuePage } from '../features/tasks/QueuePage';
import { TaskPage } from '../features/annotation/TaskPage';
import { EvaluationPage } from '../features/evaluation/EvaluationPage';
import { AdminPage } from '../features/admin/AdminPage';
import { DatasetsPage } from '../features/datasets/DatasetsPage';
import { PlatformPage } from '../features/platform/PlatformPage';
import { LoginPage } from '../features/auth/LoginPage';
import { AuthProvider, useAuth } from '../shared/auth';
import { AppShell } from './AppShell';
import { theme } from './theme';

/** UI gate only: the server enforces the same rule (403) regardless of what the browser shows. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (isAdmin) return <>{children}</>;
  return (
    <Alert severity="error" role="alert" action={<Button component={RouterLink} to="/" color="inherit">Go to tasks</Button>}>
      You need the admin role to open this page.
    </Alert>
  );
}

/** UI gate only: the platform API answers 403 to everyone but the operator. */
function RequireOperator({ children }: { children: ReactNode }) {
  const { isOperator } = useAuth();
  if (isOperator) return <>{children}</>;
  return <Alert severity="error" role="alert">This page is for the platform operator.</Alert>;
}

function AuthenticatedApp() {
  const { user } = useAuth();
  // Unauthenticated visitors see the sign-in screen at whatever URL they opened; after signing in they land there.
  if (!user) return <LoginPage />;
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<QueuePage />} />
        <Route path="/tasks/:taskId" element={<TaskPage />} />
        <Route path="/evaluation" element={<EvaluationPage />} />
        <Route path="/admin" element={<RequireAdmin><AdminPage /></RequireAdmin>} />
        <Route path="/admin/datasets" element={<RequireAdmin><DatasetsPage /></RequireAdmin>} />
        <Route path="/platform" element={<RequireOperator><PlatformPage /></RequireOperator>} />
        <Route path="*" element={<Typography>Page not found.</Typography>} />
      </Routes>
    </AppShell>
  );
}

export function App() {
  return (
    <ThemeProvider theme={theme} defaultMode="system">
      <CssBaseline enableColorScheme />
      <BrowserRouter>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
