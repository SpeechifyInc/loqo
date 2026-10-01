import { useMutation } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import { type Dispatch, type SetStateAction, useState } from 'react';
import type { GuardInput } from '../../../core/guards/definition';
import type { GuardRow } from '../../../db/schema';
import { CodeEditor } from '../../components/code-editor';
import { ErrorNote } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Input, Label, Textarea } from '../../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { api } from '../../lib/api';
import { QuickFields } from './guard-quick';

const STARTER = `// Return null to accept the translation, a reason to reject it, or { fix, reason } to rewrite it.
export default (candidate: string, source: string, ctx: { locale: string; key: string; tags: string[]; meta: Record<string, unknown> }): string | { fix: string; reason?: string } | null => {
  return null;
};
`;

export type GuardDraft = { name: string; description: string; brief: string; code: string; repairPrompt: string; repairAttempts: string };

export const draftOf = (guard?: GuardRow): GuardDraft => ({
  name: guard?.name ?? '',
  description: guard?.description ?? '',
  brief: guard?.brief ?? '',
  code: guard?.code ?? STARTER,
  repairPrompt: guard?.repair?.prompt ?? '',
  repairAttempts: guard?.repair?.attempts ? String(guard.repair.attempts) : '',
});

export const inputOf = (draft: GuardDraft): GuardInput => ({
  name: draft.name,
  description: draft.description.trim() || null,
  brief: draft.brief.trim() || null,
  code: draft.code,
  repair: draft.repairPrompt.trim() ? { prompt: draft.repairPrompt, ...(draft.repairAttempts ? { attempts: Number(draft.repairAttempts) } : {}) } : null,
});

const parseMeta = (text: string): Record<string, unknown> => {
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('meta must be a JSON object');
  return parsed as Record<string, unknown>;
};

/** Runs the code as it stands, unsaved, in the server's sandbox; every answer is shown as plain text. */
const TestRun = ({ slug, code }: { slug: string; code: string }) => {
  const [sample, setSample] = useState({ source: '', candidate: '', locale: '', meta: '' });
  const run = useMutation({
    mutationFn: () =>
      api.guards.test(slug, { code, source: sample.source, candidate: sample.candidate, meta: parseMeta(sample.meta), ...(sample.locale ? { locale: sample.locale } : {}) }),
  });
  const outcome = run.data;
  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="Source" placeholder="Source" value={sample.source} onChange={(e) => setSample({ ...sample, source: e.target.value })} />
        <Input aria-label="Translation" placeholder="Translation" value={sample.candidate} onChange={(e) => setSample({ ...sample, candidate: e.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input aria-label="Locale" placeholder="Locale (de)" value={sample.locale} onChange={(e) => setSample({ ...sample, locale: e.target.value })} />
        <Input aria-label="Meta" className="col-span-2 font-mono text-xs" placeholder='Meta JSON, e.g. {"maxLength": 20}' value={sample.meta} onChange={(e) => setSample({ ...sample, meta: e.target.value })} />
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play /> Test
        </Button>
        {outcome ? (
          <p className="min-w-0 text-xs wrap-anywhere">
            {outcome.error !== undefined ? (
              <span className="text-destructive">Guard failed: {outcome.error}</span>
            ) : outcome.fix !== undefined ? (
              <span className="text-info">
                Fixes → {JSON.stringify(outcome.fix)}
                {outcome.reason ? ` (${outcome.reason})` : ''}
              </span>
            ) : outcome.reason ? (
              <span className="text-warning">Rejects: {outcome.reason}</span>
            ) : (
              <span className="text-success">Passes</span>
            )}{' '}
            <span className="text-muted-foreground">· {outcome.ms} ms</span>
          </p>
        ) : null}
      </div>
      <ErrorNote error={run.error} />
    </div>
  );
};

type Props = { slug: string; scenarioId: string; draft: GuardDraft; onChange: Dispatch<SetStateAction<GuardDraft>>; disabled?: boolean };

/** Nothing written yet, or written from a brief: the brief is where to start. */
const startsQuick = (draft: GuardDraft): boolean => draft.brief.trim() !== '' || draft.code === STARTER;

const AdvancedFields = ({ slug, draft, onChange, disabled }: Omit<Props, 'scenarioId'>) => (
  <>
    <div className="grid gap-1.5">
      <Label>Code</Label>
      <CodeEditor label="Guard code" value={draft.code} onChange={(code) => onChange({ ...draft, code })} readOnly={disabled} />
      <p className="text-xs text-muted-foreground">
        JavaScript or TypeScript (types are stripped, not checked). Return <code>{'{ fix }'}</code> to rewrite a value in code. Runs in an isolated sandbox: no network, files, imports or
        timers; 50 ms and 8 MB per value. A guard that throws or times out rejects the value.
      </p>
    </div>
    {disabled ? null : <TestRun slug={slug} code={draft.code} />}
    <div className="grid gap-1.5">
      <Label htmlFor="guard-repair">Repair prompt</Label>
      <Textarea
        id="guard-repair"
        className="font-mono text-xs"
        rows={4}
        value={draft.repairPrompt}
        onChange={(e) => onChange({ ...draft, repairPrompt: e.target.value })}
        placeholder="Empty: a rejection is final"
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground">
        System prompt for a model to fix a rejected value. Variables: {'{{reason}}'}, {'{{locale}}'}, {'{{sourceLocale}}'}, {'{{key}}'}, {'{{source}}'}, {'{{meta.*}}'}.
      </p>
    </div>
    {draft.repairPrompt.trim() ? (
      <div className="grid w-40 gap-1.5">
        <Label htmlFor="guard-attempts">Repair attempts</Label>
        <Input
          id="guard-attempts"
          type="number"
          min={1}
          max={5}
          value={draft.repairAttempts}
          placeholder="1"
          onChange={(e) => onChange({ ...draft, repairAttempts: e.target.value })}
          disabled={disabled}
        />
      </div>
    ) : null}
  </>
);

export const GuardFields = ({ slug, scenarioId, draft, onChange, disabled }: Props) => (
  <div className="grid gap-3">
    <div className="grid grid-cols-3 gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="guard-name">Name</Label>
        <Input id="guard-name" value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} placeholder="placeholders" pattern="[a-z0-9-]+" required disabled={disabled} />
      </div>
      <div className="col-span-2 grid gap-1.5">
        <Label htmlFor="guard-description">Description</Label>
        <Input id="guard-description" value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} disabled={disabled} />
      </div>
    </div>
    <Tabs defaultValue={startsQuick(draft) ? 'quick' : 'advanced'}>
      <TabsList>
        <TabsTrigger value="quick">Quick</TabsTrigger>
        <TabsTrigger value="advanced">Advanced</TabsTrigger>
      </TabsList>
      {/* Both stay mounted, so a generated result survives a look at the code. */}
      <TabsContent value="quick" forceMount className="data-[state=inactive]:hidden">
        <QuickFields slug={slug} scenarioId={scenarioId} draft={draft} onChange={onChange} disabled={disabled} />
      </TabsContent>
      <TabsContent value="advanced" forceMount className="data-[state=inactive]:hidden">
        <AdvancedFields slug={slug} draft={draft} onChange={onChange} disabled={disabled} />
      </TabsContent>
    </Tabs>
  </div>
);
