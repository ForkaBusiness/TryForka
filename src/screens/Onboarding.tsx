import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { DEFAULT_PREFERENCES, savePreferences, type Preferences } from '../lib/preferences';
import { AllergyPicker, DietPicker, PlanningPicker, SkipList } from '../components/PrefControls';
import { Button, IconButton, Progress } from '../components/ds';
import { ArrowRight } from 'lucide-react';
import { WelcomePanel } from '../components/WelcomePanel';

// First-run setup. Writes the same fields as Settings, so a new user's allergies are
// in place before their first plan is generated. One question per step, the primary
// action anchored to the bottom; on desktop the form sits beside a green panel.

const STEPS = [
  { title: 'How does your household eat?', intro: 'We only suggest recipes that fit.' },
  { title: 'Any allergies?', intro: 'Recipes with these never show up. You can change this any time in Settings.' },
  { title: 'Ingredients you skip', intro: "Add anything you'd rather not cook with. Recipes that use them stay hidden." },
  { title: 'What should we plan?', intro: 'Dinner is a good place to start.' },
] as const;

export function Onboarding({ userId, initial, onDone, onSignOut }: {
  userId: string;
  initial: Preferences | null;
  onDone: (prefs: Preferences) => void;
  onSignOut: () => void;
}) {
  const [step, setStep] = useState(0);
  const [prefs, setPrefs] = useState<Preferences>(initial ?? DEFAULT_PREFERENCES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (p: Partial<Preferences>) => setPrefs(prev => ({ ...prev, ...p }));

  const next = async () => {
    setError(null);
    setSaving(true);
    try {
      const last = step === STEPS.length - 1;
      const fields: Partial<Preferences> = step === 0 ? { diet: prefs.diet }
        : step === 1 ? { allergies: prefs.allergies }
        : step === 2 ? { skip_ingredients: prefs.skip_ingredients, avoid_ingredients: prefs.avoid_ingredients }
        : { plan_breakfast: prefs.plan_breakfast, plan_lunch: prefs.plan_lunch, plan_dinner: prefs.plan_dinner, max_weeknight_minutes: prefs.max_weeknight_minutes };
      const onboarded_at = last ? new Date().toISOString() : prefs.onboarded_at;
      await savePreferences(userId, { ...fields, ...(last ? { onboarded_at } : {}) });
      if (last) onDone({ ...prefs, onboarded_at });
      else setStep(step + 1);
    } catch {
      setError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  const { title, intro } = STEPS[step];
  return (
    <div className="flex h-dvh bg-cream">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-column flex-1 px-gutter pt-(--screen-top) pb-6 md:px-12 md:pt-12">
          <div className="mb-8 flex items-center gap-4">
            <IconButton icon={ArrowLeft} label={step === 0 ? 'Sign out' : 'Back'} variant="outlined" onClick={() => (step === 0 ? onSignOut() : setStep(step - 1))} />
            <div className="flex-1"><Progress value={(step + 1) / STEPS.length} label={`Step ${step + 1} of ${STEPS.length}`} /></div>
            <p className="tabular shrink-0 text-small font-semibold text-ink-muted">{step + 1} of {STEPS.length}</p>
          </div>
          <h1 className="display text-display text-ink">{title}</h1>
          <p className="mt-2 mb-8 text-body text-ink-muted">{intro}</p>
          {step === 0 && <DietPicker value={prefs.diet} onChange={diet => update({ diet })} />}
          {step === 1 && <AllergyPicker value={prefs.allergies} onChange={allergies => update({ allergies })} />}
          {step === 2 && <SkipList never={prefs.skip_ingredients} avoid={prefs.avoid_ingredients} onChange={(skip_ingredients, avoid_ingredients) => update({ skip_ingredients, avoid_ingredients })} />}
          {step === 3 && <PlanningPicker value={prefs} onChange={update} />}
          {error && <p role="alert" className="mt-6 text-small text-terracotta-deep">{error}</p>}
        </div>
        <div className="sticky bottom-0 bg-linear-to-t from-cream from-75% to-cream/0">
          <div className="mx-auto w-full max-w-column px-gutter pt-5 pb-(--bottombar-pad) md:px-12">
            <Button size="lg" className="w-full sm:w-auto sm:min-w-56" iconEnd={ArrowRight} loading={saving} onClick={next}>
              {step === STEPS.length - 1 ? 'Finish' : step === 1 && !prefs.allergies.length ? 'No allergies' : step === 2 && !prefs.skip_ingredients.length && !prefs.avoid_ingredients.length ? 'Skip for now' : 'Continue'}
            </Button>
          </div>
        </div>
      </div>
      <WelcomePanel line="Tell us once. Every dinner after that fits." />
    </div>
  );
}
