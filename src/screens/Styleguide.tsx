import { useState } from 'react';
import { ArrowLeft, Clock, Copy, Eye, Heart, Plus, Search, Trash2 } from 'lucide-react';
import {
  BottomSheet, Button, Card, Checkbox, EmptyState, GlassIconButton, GlassPill, IconButton, Input, ListGroup, ListRow, ListSkeleton,
  PageContainer, Photo, Progress, RecipeCard as RecipeCardView, RecipeGrid, RecipeGridSkeleton, RemovableTag, SaveStatus, SectionHeading,
  Segmented, Stepper, Tag, Textarea, ToggleChip,
} from '../components/ds';
import { photo, type RecipeCard } from '../lib/catalog';
import { Auth, NewPassword } from './Auth';

// Dev-only reference of the design system (open /app/styleguide while running `npm run dev`).
// The auth screens aren't reachable in the app (the website handles them), so they can be
// previewed here: /app/styleguide?preview=login, signup or password.

const COLORS: Array<[string, string]> = [
  ['cream', 'App background'],
  ['surface', 'Cards, sheets, inputs'],
  ['ink', 'Primary text'],
  ['ink-muted', 'Secondary text'],
  ['line', 'Borders and dividers'],
  ['green', 'Primary accent'],
  ['green-light', 'Glaze, top'],
  ['green-deep', 'Glaze, bottom'],
  ['green-soft', 'Selected and active'],
  ['terracotta', 'Warnings and allergens (not text)'],
  ['terracotta-deep', 'Warning text, destructive'],
  ['terracotta-soft', 'Warning background'],
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
  const [fav, setFav] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup'>(() => (new URLSearchParams(window.location.search).get('preview') === 'signup' ? 'signup' : 'login'));

  const preview = new URLSearchParams(window.location.search).get('preview');
  if (preview === 'login' || preview === 'signup') return <Auth mode={mode} onSwitch={setMode} onTerms={() => {}} />;
  if (preview === 'password') return <NewPassword onDone={() => {}} />;

  return (
    <PageContainer wide title="Style guide" intro="Glazed Pantry: every token and component in one place. Dev only.">
      <section className="mb-12">
        <SectionHeading>Color</SectionHeading>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {COLORS.map(([name, use]) => (
            <Card key={name} className="flex items-center gap-3 p-3">
              <span className="size-10 shrink-0 rounded-full border border-line" style={{ background: `var(--color-${name})` }} />
              <span className="min-w-0">
                <span className="block text-small font-semibold">{name}</span>
                <span className="block text-caption text-ink-muted">{use}</span>
              </span>
            </Card>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Type</SectionHeading>
        <div className="space-y-3">
          <p className="display text-display">Display 34/38, Fraunces. Tonight's sorted.</p>
          <p className="display text-title">Title 26/30, Fraunces</p>
          <p className="text-heading font-semibold">Heading 20/26, Figtree</p>
          <p className="text-body">Body 16/24, Figtree. The smallest size for anything you read.</p>
          <p className="text-small text-ink-muted">Small 14/20, secondary text</p>
          <p className="text-caption text-ink-muted">Caption 12/16</p>
          <p className="label">Label above a group</p>
          <p className="text-step font-medium">Cooking step, 26/36</p>
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Materials</SectionHeading>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <p className="label mb-3">Glaze: primary buttons, checked boxes</p>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg">Start cooking</Button>
              <Checkbox checked={checked} onChange={setChecked} label="Sour cream" />
            </div>
          </Card>
          <div className="relative overflow-hidden rounded-card">
            <Photo src={photo(SAMPLE.thumb_url, 'medium')} className="aspect-4/3 w-full" />
            <div className="absolute inset-x-3 top-3 flex justify-between">
              <GlassIconButton icon={ArrowLeft} label="Back" />
              <GlassIconButton icon={Heart} label="Favorite" pressed={fav} onClick={() => setFav(f => !f)} />
            </div>
            <div className="absolute inset-x-3 bottom-3 flex gap-2">
              <GlassPill icon={Clock}>25 min</GlassPill><GlassPill>Spanish</GlassPill>
            </div>
          </div>
          <Card className="p-5">
            <p className="label mb-3">Matte: everything else</p>
            <p className="text-body text-ink-muted">Cards, sheets, lists and inputs have no glass and no gloss.</p>
          </Card>
        </div>
      </section>

      <section className="mb-12">
        <SectionHeading>Buttons</SectionHeading>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Start cooking</Button>
          <Button variant="secondary">Mark as cooked</Button>
          <Button variant="ghost">Undo</Button>
          <Button variant="danger" icon={Trash2}>Delete account</Button>
          <Button variant="danger-ghost">Remove</Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm" variant="secondary" icon={Copy}>Copy list</Button>
          <IconButton icon={Search} label="Search" variant="outlined" />
          <IconButton icon={Plus} label="Add" />
        </div>
        <div className="mt-4 max-w-form"><Button size="lg" block>Save rating</Button></div>
      </section>

      <section className="mb-12 max-w-form space-y-5">
        <SectionHeading>Inputs</SectionHeading>
        <Input label="Email" placeholder="you@example.com" />
        <Input label="Password" type="password" placeholder="At least 8 characters" trailing={<IconButton icon={Eye} label="Show password" size="sm" className="mr-1" />} />
        <Input label="With an error" defaultValue="not-an-email" error="Enter a valid email, like name@example.com." />
        <Input label="Search recipes" hideLabel placeholder="Search recipes" leading={<Search size={20} strokeWidth={1.75} aria-hidden />} />
        <Textarea label="Notes" placeholder="What worked, what to change next time" />
        <Stepper label="People" value={count} onChange={setCount} unit={n => (n === 1 ? 'person' : 'people')} />
        <Segmented label="Recipe section" value={seg} onChange={setSeg} options={[{ value: 'ingredients', label: 'Ingredients' }, { value: 'steps', label: 'Steps' }]} />
      </section>

      <section className="mb-12">
        <SectionHeading>Tags and chips</SectionHeading>
        <div className="flex flex-wrap gap-2">
          <Tag icon={Clock}>About 45 min</Tag><Tag>Spanish</Tag><Tag tone="green">Vegetarian</Tag><Tag tone="alert">Contains peanut</Tag><Tag size="sm">Small</Tag>
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

      <section className="mb-12 max-w-column">
        <SectionHeading>List rows and progress</SectionHeading>
        <ListGroup label="This week">
          <ListRow title="Breakfast" subtitle="Bread omelette" chevron onClick={() => {}} />
          <ListRow title="Weeknight" subtitle="3 recipes" chevron onClick={() => {}} />
          <ListRow title="Delete account" destructive onClick={() => {}} />
        </ListGroup>
        <div className="mt-6"><Progress value={0.4} label="Steps done" /></div>
        <div className="mt-4"><SaveStatus state="saved" /></div>
      </section>

      <section className="mb-12">
        <SectionHeading>Recipe card and skeletons</SectionHeading>
        <RecipeGrid>
          <li><RecipeCardView recipe={SAMPLE} onOpen={() => {}} added={added} onAdd={() => setAdded(a => !a)} favorite={fav} onFavorite={() => setFav(f => !f)} /></li>
        </RecipeGrid>
        <div className="mt-4"><RecipeGridSkeleton count={4} /></div>
        <div className="mt-4 max-w-column"><ListSkeleton rows={2} leading /></div>
      </section>

      <section className="mb-12 max-w-column">
        <SectionHeading>Sheet and empty state</SectionHeading>
        <Button variant="secondary" onClick={() => setSheet(true)}>Open sheet</Button>
        <BottomSheet open={sheet} onClose={() => setSheet(false)} title="Suggestions" footer={<Button block size="lg" onClick={() => setSheet(false)}>Done</Button>}>
          <p className="text-body text-ink-muted">Sheets slide up on phones and in from the right on desktop.</p>
        </BottomSheet>
        <div className="mt-6">
          <EmptyState icon={Heart} title="No favorites yet" action={<Button size="lg">Browse recipes</Button>}>Recipes you heart show up here.</EmptyState>
        </div>
      </section>
    </PageContainer>
  );
}
