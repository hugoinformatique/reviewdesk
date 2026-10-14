/** Renders the one open overlay (code-split: each loads on first use). Each overlay mounts open and closes itself. */
import { lazy, Suspense } from 'react';
import { useOverlay } from '@/lib/ui-store';

const Guide = lazy(() => import('@/features/guide/guide').then((m) => ({ default: m.Guide })));
const ProjectDialog = lazy(() => import('@/features/projects/project-dialog').then((m) => ({ default: m.ProjectDialog })));
const InstallDialog = lazy(() => import('@/features/install/install-dialog').then((m) => ({ default: m.InstallDialog })));
const AgentsDialog = lazy(() => import('@/features/agents/agents-dialog').then((m) => ({ default: m.AgentsDialog })));
const BrandingWizard = lazy(() => import('@/features/branding/branding-wizard').then((m) => ({ default: m.BrandingWizard })));
const FixDialog = lazy(() => import('@/features/fix/fix-dialog').then((m) => ({ default: m.FixDialog })));
const ExportDialog = lazy(() => import('@/features/export/export-dialog').then((m) => ({ default: m.ExportDialog })));
const CommandPalette = lazy(() => import('@/features/palette/command-palette').then((m) => ({ default: m.CommandPalette })));

function Current() {
  const overlay = useOverlay();
  if (!overlay) return null;
  switch (overlay.kind) {
    case 'guide':
      return <Guide />;
    case 'project':
      return <ProjectDialog projectId={overlay.projectId} />;
    case 'install':
      return <InstallDialog projectId={overlay.projectId} />;
    case 'agents':
      return <AgentsDialog projectId={overlay.projectId} />;
    case 'branding':
      return <BrandingWizard />;
    case 'fix':
      return <FixDialog ticketId={overlay.ticketId} />;
    case 'export':
      return <ExportDialog filters={overlay.filters} />;
    case 'palette':
      return <CommandPalette />;
  }
}

export function OverlayHost() {
  return (
    <Suspense fallback={null}>
      <Current />
    </Suspense>
  );
}
