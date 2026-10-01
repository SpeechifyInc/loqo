import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Empty, ErrorNote, PageHeader } from '../../components/layout';
import { PageSkeleton } from '../../components/skeletons';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { LocaleMultiSelect } from '../../components/locale-select';
import { Input, Label } from '../../components/ui/input';
import { api } from '../../lib/api';
import { ME_KEY, useCan } from '../../lib/auth';
import { ApiKeysSection } from './keys';
import { MembersSection } from './members';
import { GlossaryEditor, glossaryDraft, glossaryOf, InstructionsEditor, instructionsDraft, instructionsOf } from './prompt-context';
import type { ProjectWithCounts } from '../../../core/projects/service';

const GeneralSection = ({ project }: { project: ProjectWithCounts }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: project.name,
    targetLocales: project.targetLocales,
    debounceSeconds: String(project.debounceSeconds),
    glossary: glossaryDraft(project.glossary),
    extraInstructions: instructionsDraft(project.extraInstructions),
  });
  const save = useMutation({
    mutationFn: () =>
      api.projects.update(project.slug, {
        name: form.name,
        targetLocales: form.targetLocales,
        debounceSeconds: Number(form.debounceSeconds),
        glossary: glossaryOf(form.glossary),
        extraInstructions: instructionsOf(form.extraInstructions),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', project.slug] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const update = (patch: Partial<typeof form>) => {
    save.reset();
    setForm({ ...form, ...patch });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>General</CardTitle>
        <CardDescription>Glossary and extra instructions are per locale and reach the translate layer as prompt context.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={(e) => update({ name: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="debounce">Debounce (s)</Label>
              <Input id="debounce" type="number" min={0} value={form.debounceSeconds} onChange={(e) => update({ debounceSeconds: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="targets">Target locales</Label>
            <LocaleMultiSelect id="targets" value={form.targetLocales} onChange={(targetLocales) => update({ targetLocales })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Glossary</Label>
            <GlossaryEditor value={form.glossary} locales={form.targetLocales} onChange={(glossary) => update({ glossary })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Extra instructions</Label>
            <InstructionsEditor value={form.extraInstructions} locales={form.targetLocales} onChange={(extraInstructions) => update({ extraInstructions })} />
          </div>
          <ErrorNote error={save.error} />
          <div className="flex items-center justify-end gap-3">
            {save.isSuccess ? <span className="text-sm text-muted-foreground">Saved</span> : null}
            <Button type="submit" disabled={save.isPending}>
              Save
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};

/** Deleting takes every resource, translation, key and membership with it, so the slug has to be typed back. */
const DangerSection = ({ project }: { project: ProjectWithCounts }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmation, setConfirmation] = useState('');
  const remove = useMutation({
    mutationFn: () => api.projects.remove(project.slug),
    // The index redirect reads the project list, so it must be fresh before landing there.
    onSuccess: async () => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ME_KEY })]);
      void navigate('/', { replace: true });
    },
  });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>Danger zone</CardTitle>
        <CardDescription>
          Deleting removes the project with its {project.counts.resources} resources, all translations, API keys and members. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog onOpenChange={(open) => !open && setConfirmation('')}>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 /> Delete project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Delete {project.name}?</DialogTitle>
            <DialogDescription>
              Type <code className="font-mono">{project.slug}</code> to confirm.
            </DialogDescription>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                remove.mutate();
              }}
            >
              <div className="grid gap-1.5">
                <Label htmlFor="confirm-slug">Project slug</Label>
                <Input id="confirm-slug" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
              </div>
              <ErrorNote error={remove.error} />
              <div className="flex justify-end">
                <Button type="submit" variant="destructive" disabled={confirmation !== project.slug || remove.isPending}>
                  Delete project
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};

export const ProjectSettingsPage = () => {
  const { slug = '' } = useParams();
  const project = useQuery({ queryKey: ['project', slug], queryFn: () => api.projects.get(slug) });
  const canAdmin = useCan(slug, 'admin');

  if (project.isPending) return <PageSkeleton />;
  if (!project.data) return <ErrorNote error={project.error} />;

  return (
    <>
      <PageHeader title="Settings" description={`${project.data.name} · ${slug}`} />
      {canAdmin ? (
        <div className="grid gap-6">
          <GeneralSection project={project.data} />
          <ApiKeysSection slug={slug} />
          <MembersSection slug={slug} />
          <DangerSection project={project.data} />
        </div>
      ) : (
        <Empty>Only project admins can change settings.</Empty>
      )}
    </>
  );
};
