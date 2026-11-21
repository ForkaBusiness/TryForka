import type { UpgradeReason } from '../app/AppContext';
import { BottomSheet, Button } from './ds';

// The one upgrade prompt: shown only when the household hits a Free limit or taps a Pro
// feature (never on its own, never on a timer). It says what happened, that nothing they
// have is touched, and what Pro adds. Founding families and Pro households never see it.

const COPY: Record<UpgradeReason, { title: string; body: string }> = {
  saved_recipes: {
    title: "You have 20 recipes of your own",
    body: 'Free keeps 20 recipes you typed in or imported, and every one stays here and works as before. Hearting and collecting recipes from Forka is never limited. To add a new one of your own, remove one, or go Pro for as many as you like.',
  },
  smart_imports: {
    title: "You've used your 20 imports",
    body: 'Free includes 20 recipe imports, and every recipe you imported stays yours. You can still write a recipe in by hand. Pro imports as many as you like.',
  },
  shopping_lists: {
    title: "You've saved 2 lists",
    body: 'Free keeps 2 saved lists, and the ones you have stay as they are. Pro keeps as many as you need.',
  },
  variations: {
    title: 'Make it different is part of Pro',
    body: 'Pro suggests a few ways to change tonight\'s recipe, using what your family likes and has on hand. Swaps for a missing ingredient still work on Free.',
  },
  cooking_help: {
    title: "That's today's cooking help",
    body: 'Free answers a few ingredient questions a day, and the common swaps (buttermilk, eggs, butter, sour cream, wine, herbs) always work. Pro answers as many as you need.',
  },
  meals: {
    title: 'Every meal is part of Pro',
    body: 'Pro plans breakfasts, lunches and snacks around your family too, with packable school lunches for each child, all on one grocery list.',
  },
  goals: {
    title: 'Goals for each person are part of Pro',
    body: 'Pro keeps meals shared and sizes each person\'s portion toward their own goal, like more protein or lighter, with estimated daily totals.',
  },
  meal_prep: {
    title: 'Meal prep is part of Pro',
    body: 'Pro turns your week into one prep session of about an hour, in the right order, with timers and storage notes.',
  },
  leftovers: {
    title: 'Cook once, eat twice is part of Pro',
    body: 'Pro plans a double batch of dishes that keep well and puts the second meal later in the week, with the grocery list adjusted.',
  },
};

export function UpgradeSheet({ reason, onClose, onSeePro }: { reason: UpgradeReason | null; onClose: () => void; onSeePro: () => void }) {
  const copy = reason ? COPY[reason] : null;
  return (
    <BottomSheet open={!!copy} onClose={onClose} title={copy?.title ?? ''} side="bottom"
      footer={
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button size="lg" variant="secondary" onClick={onClose}>Not now</Button>
          <Button size="lg" onClick={onSeePro}>See what Pro adds</Button>
        </div>
      }
    >
      {copy && (
        <>
          <p className="text-body text-ink">{copy.body}</p>
          <p className="mt-4 text-small text-ink-muted">Free plans your family's dinners. Pro plans your family's whole week.</p>
        </>
      )}
    </BottomSheet>
  );
}
