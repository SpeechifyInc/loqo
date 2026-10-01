import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
import { ME_KEY } from '../lib/auth';
import { ErrorNote } from './layout';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input, Label } from './ui/input';

export const CREATE_PROJECT_DESCRIPTION = 'A project is one content store. Its repo imports resources and applies translations with a project API key.';

/** Creates a project and opens its vault. */
export const CreateProjectForm = ({ onCreated }: { onCreated?: () => void }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({ slug: '', name: '', sourceLocale: 'en', targetLocales: '' });
  const create = useMutation({
    mutationFn: () =>
      api.projects.create({
        slug: form.slug,
        name: form.name,
        sourceLocale: form.sourceLocale,
        targetLocales: form.targetLocales.split(/[\s,]+/).filter(Boolean),
      }),
    onSuccess: async (project) => {
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ME_KEY })]);
      onCreated?.();
      void navigate(`/projects/${project.slug}`);
    },
  });

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="slug">Slug</Label>
        <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="ios" required pattern="[a-z0-9-]+" />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Mobile app" required />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="source">Source</Label>
          <Input id="source" value={form.sourceLocale} onChange={(e) => setForm({ ...form, sourceLocale: e.target.value })} required />
        </div>
        <div className="col-span-2 grid gap-1.5">
          <Label htmlFor="targets">Target locales</Label>
          <Input id="targets" value={form.targetLocales} onChange={(e) => setForm({ ...form, targetLocales: e.target.value })} placeholder="de, fr, pl" />
        </div>
      </div>
      <ErrorNote error={create.error} />
      <div className="flex justify-end">
        <Button type="submit" disabled={create.isPending}>
          Create
        </Button>
      </div>
    </form>
  );
};

export const CreateProjectDialog = ({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogTitle>New project</DialogTitle>
      <DialogDescription>{CREATE_PROJECT_DESCRIPTION}</DialogDescription>
      {open ? <CreateProjectForm onCreated={() => onOpenChange(false)} /> : null}
    </DialogContent>
  </Dialog>
);
