import { Plus, Trash2, X } from 'lucide-react';
import { LocaleSelect } from '../../components/locale-select';
import { Button } from '../../components/ui/button';
import { Input, Textarea } from '../../components/ui/input';
import type { GlossaryEntry } from '../../../db/schema';

type TranslationDraft = { locale: string; value: string };
export type GlossaryDraft = { term: string; translations: TranslationDraft[] };
export type InstructionDraft = { locale: string; text: string };

export const glossaryDraft = (glossary: GlossaryEntry[]): GlossaryDraft[] =>
  glossary.map(({ term, translations }) => ({ term, translations: Object.entries(translations).map(([locale, value]) => ({ locale, value })) }));

/** Blank terms and translations are dropped rather than rejected. */
export const glossaryOf = (drafts: GlossaryDraft[]): GlossaryEntry[] =>
  drafts
    .filter((entry) => entry.term.trim())
    .map((entry) => ({
      term: entry.term.trim(),
      translations: Object.fromEntries(entry.translations.filter((translation) => translation.value.trim()).map((translation) => [translation.locale, translation.value.trim()])),
    }));

export const instructionsDraft = (instructions: Record<string, string>): InstructionDraft[] => Object.entries(instructions).map(([locale, text]) => ({ locale, text }));

export const instructionsOf = (drafts: InstructionDraft[]): Record<string, string> =>
  Object.fromEntries(drafts.filter((draft) => draft.text.trim()).map((draft) => [draft.locale, draft.text]));

const replaceAt = <T,>(items: T[], index: number, item: T): T[] => items.map((current, at) => (at === index ? item : current));
const removeAt = <T,>(items: T[], index: number): T[] => items.filter((_, at) => at !== index);
const firstFree = (locales: string[], taken: string[]): string | undefined => locales.find((locale) => !taken.includes(locale));

type EditorProps<T> = { value: T[]; locales: string[]; onChange: (value: T[]) => void };

export const GlossaryEditor = ({ value, locales, onChange }: EditorProps<GlossaryDraft>) => (
  <div className="grid gap-2">
    {value.map((entry, index) => {
      const taken = entry.translations.map((translation) => translation.locale);
      const free = firstFree(locales, taken);
      const setEntry = (patch: Partial<GlossaryDraft>) => onChange(replaceAt(value, index, { ...entry, ...patch }));
      return (
        <div key={index} className="grid gap-2 rounded-md border p-3">
          <div className="flex gap-2">
            <Input aria-label="Term" placeholder="Term" value={entry.term} onChange={(e) => setEntry({ term: e.target.value })} />
            <Button type="button" variant="ghost" size="icon" title="Remove term" onClick={() => onChange(removeAt(value, index))}>
              <Trash2 />
            </Button>
          </div>
          {entry.translations.map((translation, at) => (
            <div key={at} className="flex gap-2 pl-4">
              <LocaleSelect
                value={translation.locale}
                locales={locales}
                taken={taken}
                onChange={(locale) => setEntry({ translations: replaceAt(entry.translations, at, { ...translation, locale }) })}
              />
              <Input
                aria-label="Preferred translation"
                placeholder="Preferred translation"
                value={translation.value}
                onChange={(e) => setEntry({ translations: replaceAt(entry.translations, at, { ...translation, value: e.target.value }) })}
              />
              <Button type="button" variant="ghost" size="icon" title="Remove translation" onClick={() => setEntry({ translations: removeAt(entry.translations, at) })}>
                <X />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="justify-self-start"
            disabled={!free}
            onClick={() => free && setEntry({ translations: [...entry.translations, { locale: free, value: '' }] })}
          >
            <Plus /> Translation
          </Button>
        </div>
      );
    })}
    <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => onChange([...value, { term: '', translations: [] }])}>
      <Plus /> Term
    </Button>
  </div>
);

export const InstructionsEditor = ({ value, locales, onChange }: EditorProps<InstructionDraft>) => {
  const taken = value.map((draft) => draft.locale);
  const free = firstFree(locales, taken);
  return (
    <div className="grid gap-2">
      {value.map((draft, index) => (
        <div key={index} className="flex items-start gap-2">
          <LocaleSelect value={draft.locale} locales={locales} taken={taken} onChange={(locale) => onChange(replaceAt(value, index, { ...draft, locale }))} />
          <Textarea aria-label="Instructions" rows={2} value={draft.text} onChange={(e) => onChange(replaceAt(value, index, { ...draft, text: e.target.value }))} />
          <Button type="button" variant="ghost" size="icon" title="Remove instructions" onClick={() => onChange(removeAt(value, index))}>
            <X />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="justify-self-start"
        disabled={!free}
        onClick={() => free && onChange([...value, { locale: free, text: '' }])}
      >
        <Plus /> Instructions
      </Button>
    </div>
  );
};
