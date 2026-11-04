import { useState } from 'react';
import { Copy, Eye, Plus, Search, Share2, ShoppingBasket, Trash2 } from 'lucide-react';
import {
  Button, Checkbox, EmptyState, IconButton, Input, ListRow, PageContainer, Progress, RecipeTile, RemovableTag,
  SaveStatus, SectionHeading, Segmented, Sheet, Skeleton, Stepper, Tag, Textarea, ToggleChip,
} from '../components/ds';
import type { RecipeCard } from '../lib/catalog';

// Dev-only reference of the design system (open /styleguide while running `npm run dev`).

const COLORS: Array<[string, string, string]> = [
  ['ink', '#18211C', 'Primary text'],
  ['ink-muted', '#5D6A62', 'Secondary text'],
  ['line', '#DCE2DD', 'Borders and dividers'],
  ['canvas', '#F4F6F3', 'App background'],
  ['surface', '#FFFFFF', 'Sheets, inputs, rows'],
  ['basil', '#2F6B4C', 'Brand and primary actions'],
  ['basil-soft', '#E3EEE7', 'Selected and active'],
  ['yolk', '#F2B93B', 'Timers and tonight only'],
  ['alert', '#B3452F', 'Allergens and destructive only'],
];

const SAMPLE: RecipeCard = {
  id: 52777, name: 'Air fryer patatas bravas', display_name: 'Air fryer patatas bravas', subtitle: 'Crispy potatoes with smoky tomato sauce',
  category: 'Vegetarian', area: 'Spanish', thumb_url: 'https://www.themealdb.com/images/media/meals/58oia61564916529.jpg',
  total_minutes: 75, meal_role: 'main', allergens: [], ingredient_names: [], diets: ['vegetarian', 'vegan', 'pescatarian'],
};

export function Styleguide() {
  const [checked, setChecked] = useState(true);
  const [count, setCount] = useState(4);
  const [seg, setSeg] = useState<'ingredients' | 'steps'>('ingredients');
  const [chips, setChips] = useState<string[]>(['Peanut']);
  const [added, setAdded] = useState(false);
  const [sheet, setSheet] = useState(false);

  return (
    <PageContainer title="Style guide" intro="Every token and component in one place. Dev only.">
      <section className="mb-12">
        <SectionHeading>Color</SectionHeading>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {COLORS.map(([name, hex, use]) => (
            <div key={name} className="flex items-center gap-3 border-b border-line pb-3">
              <span className="size-10 shrink-0 rounded-control border border-line" style={{ background: hex }} />
              <span>
                <span className="block text-base font-semibold">{name}</span>
                <span className="block text-sm text-ink-muted">{hex}, {use}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Type</SectionHeading>
        <div className="space-y-3">
          <p className="font-display text-4xl font-semibold tracking-[-0.01em]">Page title, 32px desktop</p>
          <p className="font-display text-2xl font-semibold tracking-[-0.01em]">Page title, 26px mobile</p>
          <p className="font-display text-xl font-semibold tracking-[-0.01em]">Section, 24px</p>
          <p className="font-display text-md font-semibold tracking-[-0.01em]">Recipe name in lists, 17px</p>
          <p className="text-base">Body and UI text, Figtree 15px with 1.5 line height.</p>
          <p className="text-sm text-ink-muted">Secondary text, 13px</p>
          <p className="tabular font-display text-4xl font-semibold text-ink">12:05</p>
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Buttons</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Start cooking</Button>
          <Button variant="secondary">Mark as cooked</Button>
          <Button variant="quiet" icon={ShoppingBasket}>Grocery list</Button>
          <Button variant="danger" icon={Trash2}>Delete account</Button>
          <Button variant="danger-quiet">Sign out</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary" icon={Copy}>Copy list</Button>
          <Button size="sm" variant="secondary" icon={Share2}>Share</Button>
          <IconButton icon={Search} label="Search" variant="outlined" />
          <IconButton icon={Plus} label="Add" />
        </div>
        <div className="mt-4 max-w-sm"><Button size="lg" block>Save rating</Button></div>
      </section>

      <section className="mb-12 max-w-md space-y-5">
        <SectionHeading>Inputs</SectionHeading>
        <Input label="Email" placeholder="you@example.com" />
        <Input label="Password" type="password" placeholder="At least 8 characters" trailing={<IconButton icon={Eye} label="Show password" size={40} />} />
        <Input label="With an error" defaultValue="not-an-email" error="Enter a valid email, like name@example.com." />
        <Textarea label="Notes" placeholder="What worked, what to change next time" />
        <Checkbox checked={checked} onChange={setChecked} label="Sour cream" />
        <Stepper label="People" value={count} onChange={setCount} unit={n => (n === 1 ? 'person' : 'people')} />
        <Segmented label="Recipe section" value={seg} onChange={setSeg} options={[{ value: 'ingredients', label: 'Ingredients' }, { value: 'steps', label: 'Steps' }]} />
      </section>

      <section className="mb-12">
        <SectionHeading>Tags and chips</SectionHeading>
        <div className="flex flex-wrap gap-2">
          <Tag>Spanish</Tag><Tag>About 45 min</Tag><Tag tone="basil">Vegetarian</Tag><Tag tone="alert">Contains peanut</Tag>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['Dairy', 'Egg', 'Peanut', 'Sesame'].map(c => (
            <ToggleChip key={c} selected={chips.includes(c)} onToggle={() => setChips(s => (s.includes(c) ? s.filter(x => x !== c) : [...s, c]))}>{c}</ToggleChip>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <RemovableTag onRemove={() => {}} removeLabel="Remove mushrooms">mushrooms</RemovableTag>
          <RemovableTag onRemove={() => {}} removeLabel="Remove olives">olives</RemovableTag>
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>List rows and progress</SectionHeading>
        <div className="max-w-xl border-t border-line">
          <ListRow title="Breakfast" subtitle="Bread omelette" chevron onClick={() => {}} />
          <ListRow title="Weeknight" subtitle="3 recipes" chevron onClick={() => {}} />
          <ListRow leading={<Checkbox checked={false} onChange={() => {}} ariaLabel="Garlic" />} title="Garlic" subtitle="for 4 meals" trailing={<span className="tabular text-base">12 cloves</span>} />
        </div>
        <div className="mt-6 max-w-xl"><Progress value={0.4} label="Items checked" /></div>
        <div className="mt-4"><SaveStatus state="saved" /></div>
      </section>

      <section className="mb-12">
        <SectionHeading>Recipe tile</SectionHeading>
        <div className="grid max-w-xl grid-cols-2 gap-4 md:grid-cols-3">
          <RecipeTile recipe={SAMPLE} onOpen={() => {}} added={added} onAdd={() => setAdded(a => !a)} />
          <div><Skeleton className="aspect-square" /><Skeleton className="mt-2 h-4 w-3/4" /></div>
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Sheet and empty state</SectionHeading>
        <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <Sheet open={sheet} onClose={() => setSheet(false)} title="Suggestions" footer={<Button block size="lg" onClick={() => setSheet(false)}>Done</Button>}>
          <p className="text-base text-ink-muted">Sheets slide up on phones and in from the right on desktop. They're one of the two places with a shadow.</p>
        </Sheet>
        <div className="mt-6 max-w-xl">
          <EmptyState title="No favorites yet" action={<Button variant="secondary">Browse recipes</Button>}>Recipes you heart show up here.</EmptyState>
        </div>
      </section>
    </PageContainer>
  );
}
