import { useApp } from '../app/AppContext';
import { allergyReminder, CHECK_INGREDIENTS } from '../lib/familyPrefs';
import { cx, PageContainer } from './ds';

// The plain line shown wherever recipes are hidden for an allergy: what's hidden, and a
// reminder that the family should still read the ingredients themselves.

export function AllergyReminder({ className }: { className?: string }) {
  const { prefs } = useApp();
  const text = allergyReminder(prefs.allergies);
  return text ? <p className={cx('text-small text-ink-muted', className)}>{text}</p> : null;
}

/** A recipe opened on its own that the family's settings don't allow. */
export function HiddenRecipe({ blockedBy, onBack }: { blockedBy: string[]; onBack: () => void }) {
  return (
    <PageContainer title="This recipe is hidden" onBack={onBack}>
      <p className="text-body text-ink-muted">
        It doesn't fit your household's settings{blockedBy.length ? ` (${blockedBy.map(b => b.toLowerCase()).join(', ')})` : ''}. {CHECK_INGREDIENTS}
      </p>
    </PageContainer>
  );
}
