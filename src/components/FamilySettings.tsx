import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { memberSummary, type FamilyMember, type MemberDraft, type MemberKind } from '../lib/family';
import { dislikeOptions, exactOption, type IngredientOption } from '../lib/ingredientSearch';
import { AllergyPicker, ProOption } from './PrefControls';
import { useIngredientIndex } from '../lib/useIngredientIndex';
import { IngredientInput } from './IngredientInput';
import { BottomSheet, Button, Checkbox, Input, Segmented, ToggleChip } from './ds';
import { ESTIMATE_NOTE, GOALS_FOR, LIMITS, validateGoal, type GoalKind } from '../lib/portions';

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

const GOAL_LABEL: Record<GoalKind, string> = {
  none: 'No goal', lighter: 'Lighter', more_protein: 'More protein', calories: 'Calorie target', protein: 'Protein target', growing_kid: 'Growing well',
};
/** The goals offered: children only ever get general goals. */
const GOAL_OPTIONS: Record<MemberKind, GoalKind[]> = {
  adult: GOALS_FOR.adult.filter(g => g !== 'growing_kid'),
  kid: GOALS_FOR.kid,
};
const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v));

/** A person's goal (Pro): general goals, or a daily calorie or protein target for adults. */
function GoalPicker({ draft, set, error }: { draft: MemberDraft; set: (u: Partial<MemberDraft>) => void; error: string | null }) {
  const goal = draft.goal ?? 'none';
  return (
    <fieldset>
      <legend className="mb-1 text-small font-semibold text-ink">Goal</legend>
      <p className="mb-3 text-small text-ink-muted">Meals stay the same for everyone. Forka sizes {draft.name.trim() || 'their'}{draft.name.trim() ? "'s" : ''} portion toward this.</p>
      <div role="radiogroup" aria-label="Goal" className="flex flex-wrap gap-2">
        {GOAL_OPTIONS[draft.kind].map(g => (
          <ToggleChip key={g} role="radio" selected={goal === g} onToggle={() => set({ goal: g })}>{GOAL_LABEL[g]}</ToggleChip>
        ))}
      </div>
      {goal === 'calories' && (
        <Input className="mt-4 max-w-56" label="Calories a day" inputMode="numeric" type="number" min={LIMITS.adultMinCalories} max={LIMITS.adultMaxCalories} step={50}
          placeholder="2000" hint="1,200 to 4,000 kcal" error={error ?? undefined} value={draft.goal_calories ?? ''} onChange={e => set({ goal_calories: numberOrNull(e.target.value) })} />
      )}
      {goal === 'protein' && (
        <Input className="mt-4 max-w-56" label="Protein a day, in grams" inputMode="numeric" type="number" min={LIMITS.minProtein} max={LIMITS.maxProtein} step={5}
          placeholder="100" hint="20 to 250 g" error={error ?? undefined} value={draft.goal_protein ?? ''} onChange={e => set({ goal_protein: numberOrNull(e.target.value) })} />
      )}
      {error && goal !== 'calories' && goal !== 'protein' && <p role="alert" className="mt-3 text-small text-terracotta-deep">{error}</p>}
      {goal !== 'none' && <p className="mt-3 text-small text-ink-muted">{ESTIMATE_NOTE}</p>}
    </fieldset>
  );
}

function MemberSheet({ member, onClose }: { member: FamilyMember | 'new' | null; onClose: () => void }) {
  const { saveFamilyMember, removeFamilyMember, billing } = useApp();
  const pro = billing.plan === 'pro';
  const [draft, setDraft] = useState<MemberDraft>(BLANK);
  const [busy, setBusy] = useState<'save' | 'remove' | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goalError, setGoalError] = useState<string | null>(null);
  const index = useIngredientIndex();
  const options = useMemo(() => index && dislikeOptions(index), [index]);
  const existing = member && member !== 'new' ? member : null;

  useEffect(() => {
    if (!member) return;
    setDraft(member === 'new' ? BLANK : { ...member });
    setConfirmRemove(false); setError(null); setGoalError(null); setBusy(null);
  }, [member]);

  const set = (updates: Partial<MemberDraft>) => { setDraft(d => ({ ...d, ...updates })); setGoalError(null); };
  const save = async () => {
    if (!draft.name.trim()) { setError('Add a name first.'); return; }
    // Goals are checked before saving: safe ranges, and general goals only for children.
    let toSave = draft;
    if (pro) {
      const checked = validateGoal({ id: draft.id ?? '', name: draft.name, kind: draft.kind, goal: draft.goal ?? 'none', calories: draft.goal_calories, protein: draft.goal_protein });
      if (!checked.ok) { setGoalError(checked.message); return; }
      toSave = { ...draft, goal: checked.goal.goal, goal_calories: checked.goal.calories ?? null, goal_protein: checked.goal.protein ?? null };
    }
    setBusy('save'); setError(null);
    try { await saveFamilyMember(toSave); onClose(); } catch { setError("Couldn't save. Check your connection and try again."); setBusy(null); }
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
        <Segmented label="Adult or kid" options={KINDS} value={draft.kind}
          // Children only have general goals: a number target or "lighter" doesn't carry over.
          onChange={kind => set({ kind, ...(GOAL_OPTIONS[kind].includes(draft.goal ?? 'none') ? {} : { goal: 'none', goal_calories: null, goal_protein: null }) })} className="w-full" />
        {draft.kind === 'kid' && (
          pro
            ? <Checkbox checked={!!draft.school_lunch} onChange={school_lunch => set({ school_lunch })} label="Packed school lunch on weekdays" />
            : <ProOption label="Packed school lunch on weekdays" onPro={() => { onClose(); billing.upgrade('meals'); }} />
        )}
        {pro ? <GoalPicker draft={draft} set={set} error={goalError} /> : <ProOption label="Set a goal" onPro={() => { onClose(); billing.upgrade('goals'); }} />}
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
