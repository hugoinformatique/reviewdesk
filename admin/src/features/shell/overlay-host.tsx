/** Renders the one open overlay. Each overlay mounts open and closes itself. */
import { useOverlay } from '@/lib/ui-store';
import { Guide } from '@/features/guide/guide';
import { ProjectDialog } from '@/features/projects/project-dialog';
import { InstallDialog } from '@/features/install/install-dialog';
import { AgentsDialog } from '@/features/agents/agents-dialog';
import { BrandingWizard } from '@/features/branding/branding-wizard';
import { FixDialog } from '@/features/fix/fix-dialog';
import { ExportDialog } from '@/features/export/export-dialog';
import { CommandPalette } from '@/features/palette/command-palette';

export function OverlayHost() {
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
