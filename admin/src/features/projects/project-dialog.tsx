import { useId, useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Loader2Icon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { projectsQuery, useDeleteProject, useSaveProject } from '@/lib/queries';
import type { Project } from '@/lib/types';
import { closeOverlay, openOverlay } from '@/lib/ui-store';
import { OriginsInput, type OriginsHandle } from './origins-input';

/** Create (no projectId) or edit a project. Mounted open by the overlay host. */
export function ProjectDialog({ projectId }: { projectId?: string }) {
  const projects = useQuery(projectsQuery);
  const project = projectId ? projects.data?.find((candidate) => candidate.id === projectId) : undefined;
  // Editing waits for the project; the form below seeds its state once.
  const waiting = Boolean(projectId) && !project;
  return (
    <Dialog open onOpenChange={(open) => !open && closeOverlay()}>
      <DialogContent className="sm:max-w-xl">
        {waiting ? (
          <>
            <DialogHeader>
              <DialogTitle>Modifier le projet</DialogTitle>
              <DialogDescription>Chargement…</DialogDescription>
            </DialogHeader>
            <Loader2Icon className="mx-auto size-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </>
        ) : (
          <ProjectForm project={project} clients={[...new Set((projects.data ?? []).map((candidate) => candidate.clientLabel))].sort()} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({ project, clients }: { project?: Project; clients: string[] }) {
  const uid = useId();
  const navigate = useNavigate();
  const save = useSaveProject();
  const remove = useDeleteProject();
  const [name, setName] = useState(project?.name ?? '');
  const [client, setClient] = useState(project?.clientLabel ?? '');
  const [origins, setOrigins] = useState<string[]>(project?.origins ?? []);
  const [originError, setOriginError] = useState('');
  const [webhook, setWebhook] = useState(project?.webhookUrl ?? '');
  const [message, setMessage] = useState('');
  const originsHandle = useRef<OriginsHandle | null>(null);
  const editing = Boolean(project);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage('');
    // An address typed but not yet turned into a chip still counts.
    const finalOrigins = originsHandle.current ? originsHandle.current.commit() : origins;
    if (!finalOrigins) return;
    if (!finalOrigins.length) {
      setOriginError('Ajoutez au moins une adresse où le widget sera installé.');
      document.getElementById(`${uid}-origin`)?.focus();
      return;
    }
    try {
      const saved = await save.mutateAsync({
        id: project?.id,
        input: { name, clientLabel: client, origins: finalOrigins, webhookUrl: webhook.trim() },
      });
      closeOverlay();
      void navigate({ to: '/p/$projectId', params: { projectId: saved.id } });
      if (editing) toast.success('Projet mis à jour.');
      else
        toast.success(`Projet « ${saved.name} » créé !`, {
          description: 'Voulez-vous configurer l’installation du widget sur votre site dès maintenant ?',
          duration: 16_000,
          action: { label: 'Installer le widget →', onClick: () => openOverlay({ kind: 'install', projectId: saved.id }) },
          cancel: { label: 'Plus tard', onClick: () => undefined },
        });
    } catch {
      setMessage('Vérifiez le nom, le client, les origines (http(s), une par ligne) et le webhook (https public).');
    }
  }

  async function confirmDelete() {
    if (!project) return;
    try {
      await remove.mutateAsync(project.id);
      closeOverlay();
      toast.success(`Projet « ${project.name} » supprimé.`);
      void navigate({ to: '/projets' });
    } catch {
      toast.error('Échec de la suppression du projet.');
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? 'Modifier le projet' : 'Nouveau projet'}</DialogTitle>
        <DialogDescription>
          {editing
            ? 'Le nom, le client et les adresses où le widget est installé.'
            : 'Un site à faire relire par votre client. Trois informations suffisent.'}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-name`}>Nom du site</Label>
        <Input
          id={`${uid}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Site vitrine, boutique, application…"
          autoComplete="off"
          required
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-client`}>Client</Label>
        <Input
          id={`${uid}-client`}
          value={client}
          onChange={(event) => setClient(event.target.value)}
          placeholder="Nom de votre client"
          autoComplete="off"
          list={`${uid}-clients`}
          required
        />
        <datalist id={`${uid}-clients`}>
          {clients.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">Les projets d’un même client sont regroupés dans la colonne de gauche.</p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-origin`}>Adresses où le widget sera installé</Label>
        <OriginsInput
          id={`${uid}-origin`}
          origins={origins}
          onChange={setOrigins}
          error={originError}
          onError={setOriginError}
          handleRef={originsHandle}
        />
      </div>

      <details className="group rounded-lg border border-border px-3.5 py-2.5" open={Boolean(project?.webhookUrl)}>
        <summary className="cursor-pointer text-[13.5px] font-medium select-none">Options avancées</summary>
        <div className="mt-3 grid gap-1.5">
          <Label htmlFor={`${uid}-webhook`}>Notification sortante</Label>
          <Input
            id={`${uid}-webhook`}
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
            placeholder="https://hooks.slack.com/services/…"
            inputMode="url"
          />
          <p className="text-xs text-muted-foreground">
            Optionnel. Un POST JSON à chaque nouveau retour (Slack, Make, n8n…). HTTPS public uniquement.
          </p>
        </div>
      </details>

      <output role="alert" className="block text-[13px] text-destructive empty:hidden">
        {message}
      </output>

      {editing && (
        <div className="border-t border-border pt-4">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" className="text-destructive hover:bg-destructive-soft hover:text-destructive">
                Supprimer ce projet…
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Êtes-vous sûr ?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tous les retours, captures et liens de ce projet seront définitivement supprimés.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annuler</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
                  Confirmer la suppression
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeOverlay}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" aria-hidden="true" />}
          {editing ? 'Mettre à jour' : 'Créer'}
        </Button>
      </DialogFooter>
    </form>
  );
}
