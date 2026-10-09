import { useMutation } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ErrorNote } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '../../components/ui/dialog';
import { Input, Label, Select, Textarea } from '../../components/ui/input';
import { api } from '../../lib/api';
import { REASONING_EFFORTS } from '../../../core/layers/service';
import type { LayerExplain } from '../../../core/layers/resolve';
import type { Scenario } from '../../../db/schema';
import { draftOf, GuardFields, inputOf } from './guard-form';

type FormDialogProps = {
  trigger: ReactNode;
  title: string;
  description?: ReactNode;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  wide?: boolean;
  children: ReactNode;
};

const FormDialog = ({ trigger, title, description, submitLabel, pending, error, onSubmit, open, onOpenChange, wide, children }: FormDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogTrigger asChild>{trigger}</DialogTrigger>
    <DialogContent className={wide ? 'max-h-[90vh] max-w-2xl overflow-y-auto' : undefined}>
      <DialogTitle>{title}</DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        {children}
        <ErrorNote error={error} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
);

const splitTags = (value: string): string[] => value.split(/[\s,]+/).filter(Boolean);

type ScenarioDialogProps = { slug: string; scenario?: Scenario; trigger: ReactNode; onSaved: (scenario: Scenario) => void };

export const ScenarioDialog = ({ slug, scenario, trigger, onSaved }: ScenarioDialogProps) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: scenario?.name ?? '', tags: scenario?.tags.join(', ') ?? '' });
  const save = useMutation({
    mutationFn: () => (scenario ? api.scenarios.update(slug, scenario.id, { name: form.name, tags: splitTags(form.tags) }) : api.scenarios.create(slug, { name: form.name, tags: splitTags(form.tags) })),
    onSuccess: (saved) => {
      setOpen(false);
      onSaved(saved);
    },
  });
  return (
    <FormDialog
      trigger={trigger}
      title={scenario ? 'Edit scenario' : 'New scenario'}
      description="A scenario selects resources by tags: a resource matches when it carries every tag. No tags means the whole project."
      submitLabel={scenario ? 'Save' : 'Create'}
      pending={save.isPending}
      error={save.error}
      onSubmit={() => save.mutate()}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="grid gap-1.5">
        <Label htmlFor="scenario-name">Name</Label>
        <Input id="scenario-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="iOS release notes" required />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="scenario-tags">Tags</Label>
        <Input id="scenario-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="ios, ios-releases" />
      </div>
    </FormDialog>
  );
};

type ScopedProps = { slug: string; scenarioId: string; onSaved: () => void };

export const AddLayerDialog = ({ slug, scenarioId, onSaved, layers }: ScopedProps & { layers: LayerExplain[] }) => {
  const [open, setOpen] = useState(false);
  const lastPosition = Math.max(0, ...layers.map((layer) => layer.layer.position));
  const [form, setForm] = useState({ name: '', position: String(lastPosition + 10), model: 'openai:gpt-4.1', reasoningEffort: '', description: '' });
  const create = useMutation({
    mutationFn: () =>
      api.scenarios.addLayer(slug, scenarioId, {
        name: form.name,
        position: Number(form.position),
        model: form.model,
        reasoningEffort: form.reasoningEffort || null,
        description: form.description || null,
      }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Plus /> Layer
        </Button>
      }
      title="New layer"
      description="One model call in the pipeline, only for this scenario. Position orders it among the built-in layers (translate is 10, enhance is 20). It runs once it has at least one prompt."
      submitLabel="Create"
      pending={create.isPending}
      error={create.error}
      onSubmit={() => create.mutate()}
      open={open}
      onOpenChange={setOpen}
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 grid gap-1.5">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="polish" pattern="[a-z0-9-]+" required />
        </div>
        <div className="grid gap-1.5">
          <Label>Position</Label>
          <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} required />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 grid gap-1.5">
          <Label>Model (provider:model)</Label>
          <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
        </div>
        <div className="grid gap-1.5">
          <Label>Reasoning</Label>
          <Select value={form.reasoningEffort} onChange={(e) => setForm({ ...form, reasoningEffort: e.target.value })}>
            <option value="">default</option>
            {REASONING_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Description</Label>
        <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </div>
    </FormDialog>
  );
};

export const AddPromptDialog = ({ slug, scenarioId, onSaved, layers }: ScopedProps & { layers: LayerExplain[] }) => {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', layerId: layers[0]?.layer.id ?? '', position: '100', body: '' });
  const create = useMutation({
    mutationFn: () => api.scenarios.addPrompt(slug, scenarioId, { name: form.name, layerId: form.layerId || null, position: Number(form.position), body: form.body }),
    onSuccess: () => {
      setOpen(false);
      onSaved();
    },
  });
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Plus /> Prompt
        </Button>
      }
      title="New prompt fragment"
      description={
        <>
          Fragments add up in position order. Variables: {'{{locale}}'}, {'{{localeName}}'}, {'{{key}}'}, {'{{source}}'}, {'{{meta.*}}'}, {'{{glossaryTable}}'},{' '}
          {'{{lengthBudget}}'}, {'{{nativeExamples}}'}; blocks: {'{{#if x}}…{{/if}}'}, {'{{#each xs}}…{{/each}}'}.
        </>
      }
      submitLabel="Create"
      pending={create.isPending}
      error={create.error}
      onSubmit={() => create.mutate()}
      open={open}
      onOpenChange={setOpen}
      wide
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="grid gap-1.5">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="tone" required />
        </div>
        <div className="grid gap-1.5">
          <Label>Layer</Label>
          <Select value={form.layerId} onChange={(e) => setForm({ ...form, layerId: e.target.value })}>
            <option value="">every layer</option>
            {layers.map((layer) => (
              <option key={layer.layer.id} value={layer.layer.id}>
                {layer.layer.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label>Position</Label>
          <Input type="number" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Body</Label>
        <Textarea className="font-mono text-xs" rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} required />
      </div>
    </FormDialog>
  );
};

export const NewGuardDialog = ({ slug, scenarioId, onSaved }: ScopedProps) => {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(draftOf);
  const create = useMutation({
    mutationFn: () => api.scenarios.addGuard(slug, scenarioId, inputOf(draft)),
    onSuccess: () => {
      setOpen(false);
      setDraft(draftOf());
      onSaved();
    },
  });
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm">
          <Plus /> Guard
        </Button>
      }
      title="New guard"
      description="A function every translation of this scenario must pass. It runs for every matching target, whatever its tags."
      submitLabel="Create"
      pending={create.isPending}
      error={create.error}
      onSubmit={() => create.mutate()}
      open={open}
      onOpenChange={setOpen}
      wide
    >
      <GuardFields slug={slug} scenarioId={scenarioId} draft={draft} onChange={setDraft} />
    </FormDialog>
  );
};
