import { useMutation } from '@tanstack/react-query';
import { Check, Sparkles, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { AuthoredGuard, SeedOutcome, SeedResult } from '../../../core/guards/definition';
import { CodeEditor } from '../../components/code-editor';
import { ErrorNote } from '../../components/layout';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Label, Textarea } from '../../components/ui/input';
import { api } from '../../lib/api';
import type { GuardDraft } from './guard-form';

const outcomeText = (outcome: SeedOutcome): string => {
  if (outcome.kind === 'pass') return 'Passes';
  if (outcome.kind === 'reject') return `Rejects: ${outcome.reason}`;
  if (outcome.kind === 'fix') return `Fixes → ${JSON.stringify(outcome.value)}${outcome.reason ? ` (${outcome.reason})` : ''}`;
  return `Guard failed: ${outcome.error}`;
};

const expectText = (seed: SeedResult): string => (seed.expect === 'fix' && seed.fixed !== null ? `fix → ${JSON.stringify(seed.fixed)}` : seed.expect);

const SeedLine = ({ seed }: { seed: SeedResult }) => (
  <li className="grid gap-1 rounded-md border p-2 text-xs">
    <div className="flex items-center gap-2">
      {seed.ok ? <Check className="size-3.5 shrink-0 text-success" aria-label="as expected" /> : <X className="size-3.5 shrink-0 text-destructive" aria-label="not as expected" />}
      <span className="min-w-0 font-medium wrap-anywhere">{seed.note}</span>
      <span className="ml-auto shrink-0 text-muted-foreground">
        {seed.locale} · expects {expectText(seed)}
      </span>
    </div>
    <p className="font-mono wrap-anywhere">
      <span className="text-muted-foreground">{seed.source}</span> → {seed.candidate}
    </p>
    <p className={seed.ok ? 'text-muted-foreground wrap-anywhere' : 'text-destructive wrap-anywhere'}>{outcomeText(seed.actual)}</p>
  </li>
);

const Generated = ({ authored, draft }: { authored: AuthoredGuard; draft: GuardDraft }) => {
  const passed = authored.seeds.filter((seed) => seed.ok).length;
  const fixes = authored.seeds.some((seed) => seed.actual.kind === 'fix');
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant={passed === authored.seeds.length ? 'success' : 'warning'}>
          {passed}/{authored.seeds.length} seeds as expected
        </Badge>
        {fixes ? <Badge variant="info">fixes in code</Badge> : null}
        {authored.repair ? <Badge variant="warning">repairs with a model</Badge> : null}
        <span>
          {authored.model} · {authored.attempts} {authored.attempts === 1 ? 'attempt' : 'attempts'}
        </span>
      </div>
      <ul className="grid gap-2">
        {authored.seeds.map((seed, index) => (
          <SeedLine key={`${index}:${seed.note}`} seed={seed} />
        ))}
      </ul>
      {draft.code !== authored.code ? <p className="text-xs text-warning">The code was edited in Advanced after it was generated; these seeds ran on the generated version.</p> : null}
      <div className="grid gap-1.5">
        <Label>Code</Label>
        <CodeEditor label="Generated guard code" value={draft.code} onChange={() => undefined} readOnly />
      </div>
      {draft.repairPrompt.trim() ? (
        <div className="grid gap-1.5">
          <Label>Repair prompt</Label>
          <p className="rounded-md border p-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere">{draft.repairPrompt}</p>
        </div>
      ) : null}
    </div>
  );
};

type Props = { slug: string; scenarioId: string; draft: GuardDraft; onChange: Dispatch<SetStateAction<GuardDraft>>; disabled?: boolean };

/** Describe the rule in words; a model writes the code and repair prompt, and they are run on seeds it writes too. */
export const QuickFields = ({ slug, scenarioId, draft, onChange, disabled }: Props) => {
  const generate = useMutation({
    mutationFn: () => api.scenarios.authorGuard(slug, scenarioId, { brief: draft.brief, name: draft.name || null, description: draft.description || null }),
    onSuccess: (authored) =>
      onChange((current) => ({
        ...current,
        code: authored.code,
        repairPrompt: authored.repair?.prompt ?? '',
        repairAttempts: authored.repair?.attempts ? String(authored.repair.attempts) : '',
      })),
  });
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="guard-brief">What is broken, and what good values look like</Label>
        <Textarea
          id="guard-brief"
          rows={5}
          value={draft.brief}
          onChange={(e) => onChange({ ...draft, brief: e.target.value })}
          placeholder="Labels that end with a colon in English lose it in German. The translation must end with a colon too; add it back when it is missing."
          disabled={disabled}
        />
      </div>
      {disabled ? null : (
        <div className="flex items-center gap-3">
          <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending || !draft.brief.trim()}>
            <Sparkles /> {generate.data ? 'Regenerate' : 'Generate'}
          </Button>
          {generate.isPending ? <p className="text-xs text-muted-foreground">Writing the guard and checking it on its seeds; this can take a minute.</p> : null}
        </div>
      )}
      <ErrorNote error={generate.error} />
      {generate.data ? <Generated authored={generate.data} draft={draft} /> : null}
    </div>
  );
};
