import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { memberSummary, type FamilyMember, type MemberDraft, type MemberKind } from '../lib/family';
import { dislikeOptions, exactOption, type IngredientOption } from '../lib/ingredientSearch';
import { AllergyPicker, ProOption } from './PrefControls';
import { useIngredientIndex } from '../lib/useIngredientIndex';
import { IngredientInput } from './IngredientInput';
import { BottomSheet, Button, Checkbox, Input, Segmented } from './ds';

// The people at the table, in Settings: a row per person, and a sheet to add or edit one.
// A person's allergies hide recipes for the whole household, like the household's own.
// Likes and dislikes only lean the plan.

const KINDS: Array<{ value: MemberKind; label: string }> = [{ value: 'adult', label: 'Adult' }, { value: 'kid', label: 'Kid' }];
const BLANK: MemberDraft = { name: '', kind: 'adult', likes: [], dislikes: [], allergies: [] };

export function Initial({ name }: { name: string }) {
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-green-soft text-body font-bold text-green">
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

function TasteInput({ label, placeholder, value, onChange, options }: {
  label: string; placeholder: string; value: string[]; onChange: (v: string[]) => void; options: IngredientOption[] | null;
}) {
  const chips = value.map(v => {
    const known = options && exactOption(options, v);
    return { value: v, label: known ? known.label : v, custom: !!options && !known };
  });
  return <IngredientInput label={label} placeholder={placeholder} options={options} chips={chips} onAdd={v => onChange([...value, v])} onRemove={v => onChange(value.filter(x => x !== v))} />;
}

function MemberSheet({ member, onClose }: { member: FamilyMember | 'new' | null; onClose: () => void }) {
  const { saveFamilyMember, removeFamilyMember, billing } = useApp();
  const pro = billing.plan === 'pro';
  const [draft, setDraft] = useState<MemberDraft>(BLANK);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = useIngredientIndex();
  const options = useMemo(() => index && dislikeOptions(index), [index]);
  const existing = member && member !== 'new' ? member : null;

  useEffect(() => {
    if (!member) return;
    setDraft(member === 'new' ? BLANK : { ...member });
    setConfirmRemove(false); setError(null); setBusy(null);
  }, [member]);

  const set = (updates: Partial<MemberDraft>) => setDraft(d => ({ ...d, ...updates }));
  const save = async () => {
    if (!draft.name.trim()) { setError('Add a name first.'); return; }
    setBusy('save'); setError(null);
    try { await saveFamilyMember(draft); onClose(); } catch { setError("Couldn't save. Check your connection and try again."); setBusy(null); }
  };
  const remove = async () => {
    if (!existing) return;
    if (!confirmRemove) { setConfirmRemove(true); return; }
    setBusy('remove'); setError(null);
    try { await removeFamilyMember(existing.id); onClose(); } catch { setError("Couldn't remove them. Check your connection and try again."); setBusy(null); }
  };

  return (
    <BottomSheet
      open={!!member}
      onClose={onClose}
      title={existing ? existing.name : 'Add a person'}
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {existing && (
            <Button size="lg" variant="danger-ghost" loading={busy === 'remove'} disabled={busy === 'save'} onClick={remove}>
              {confirmRemove ? 'Tap again to remove' : 'Remove'}
            </Button>
          )}
          <Button size="lg" loading={busy === 'save'} disabled={busy === 'remove'} onClick={save}>Save</Button>
        </div>
      }
    >
      <div className="grid gap-6 pt-1">
        <Input label="Name" autoComplete="off" maxLength={40} placeholder="Mia" value={draft.name} onChange={e => set({ name: e.target.value })} data-autofocus={existing ? undefined : true} />
        <Segmented label="Adult or kid" options={KINDS} value={draft.kind} onChange={kind => set({ kind })} className="w-full" />
        {draft.kind === 'kid' && (
          pro
            ? <Checkbox checked={!!draft.school_lunch} onChange={school_lunch => set({ school_lunch })} label="Packed school lunch on weekdays" />
            : <ProOption label="Packed school lunch on weekdays" onPro={() => { onClose(); billing.upgrade('meals'); }} />
        )}
        <div>
          <p className="mb-3 text-small text-ink-muted">Recipes with these are never shown or planned, for the whole household.</p>
          <AllergyPicker value={draft.allergies} onChange={allergies => set({ allergies })} />
        </div>
        <div className="grid gap-5">
          <p className="text-small text-ink-muted">Likes and dislikes lean the plan. They don't hide recipes.</p>
          <TasteInput label="Likes" placeholder="Rice, chicken" value={draft.likes} onChange={likes => set({ likes })} options={options} />
          <TasteInput label="Doesn't like" placeholder="Mushroom, olive" value={draft.dislikes} onChange={dislikes => set({ dislikes })} options={options} />
        </div>
        {confirmRemove && existing && <p role="status" className="text-small text-ink-muted">This removes {existing.name} and what they said about past dinners.</p>}
        {error && <p role="alert" className="text-small text-terracotta-deep">{error}</p>}
      </div>
    </BottomSheet>
  );
}

export function FamilySettings() {
  const { members } = useApp();
  const [editing, setEditing] = useState<FamilyMember | 'new' | null>(null);
  return (
    <>
      {members.length > 0 && (
        <ul className="mb-4 divide-y divide-line border-y border-line">
          {members.map(m => (
            <li key={m.id}>
              <button type="button" onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`}
                className="flex min-h-14 w-full cursor-pointer items-center gap-3 py-3 text-left transition-colors duration-150 hover:bg-cream/70">
                <Initial name={m.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{m.name}</span>
                  <span className="line-clamp-2 text-small text-ink-muted">{memberSummary(m)}</span>
                </span>
                <span className="shrink-0 text-small font-semibold text-green">Edit</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="secondary" icon={Plus} onClick={() => setEditing('new')}>Add a person</Button>
      <MemberSheet member={editing} onClose={() => setEditing(null)} />
    </>
  );
}
