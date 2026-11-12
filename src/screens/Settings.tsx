import { useEffect, useRef, useState } from 'react';
import { Camera, FileText, LogOut, Trash2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { signOutToWebsite, supabase } from '../lib/supabase';
import { saveProfile, type Preferences, type Profile } from '../lib/preferences';
import { callFunction } from '../lib/plan';
import { AllergyPicker, DietPicker, PlanningPicker, SkipList } from '../components/PrefControls';
import { BottomSheet, Button, Card, Input, ListGroup, ListRow, PageContainer, SaveStatus, Segmented, Stepper } from '../components/ds';

// One scrolling page of grouped cards: Household, Allergies, Diet, Ingredients we skip,
// Planning, Units, Account, About. Every change saves on its own with a quiet "Saved".

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mb-6">
      <h2 id={id} className="label mb-2 px-1">{title}</h2>
      <Card className="p-5">
        {intro && <p className="mb-4 text-small text-ink-muted">{intro}</p>}
        {children}
      </Card>
    </section>
  );
}

function Avatar({ url, name }: { url?: string; name: string }) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return url
    ? <img src={url} alt="" className="size-14 rounded-full bg-line object-cover" />
    : <span aria-hidden className="flex size-14 items-center justify-center rounded-full bg-green-soft text-heading font-bold text-green">{initials}</span>;
}

export function Settings() {
  const { session, userId, prefs, updatePrefs, profile, setProfile, go } = useApp();
  const [state, setState] = useState<SaveState>('idle');
  const [draft, setDraft] = useState<Profile>(profile);
  const [avatar, setAvatar] = useState<string | undefined>(session.user.user_metadata?.avatar_url);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const email = session.user.email ?? '';

  useEffect(() => setDraft(profile), [profile]);

  const run = async (fn: () => Promise<void>) => {
    setState('saving');
    try { await fn(); setState('saved'); } catch { setState('error'); }
  };
  const savePrefs = (updates: Partial<Preferences>) => run(() => updatePrefs(updates));

  /** Text fields save after a short pause. */
  const editProfile = (updates: Partial<Profile>, delay = 700) => {
    const next = { ...draft, ...updates };
    setDraft(next);
    setState('idle');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => run(async () => { await saveProfile(userId, email, updates); setProfile(next); }), delay);
  };

  const uploadPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) { setState('error'); return; }
    setUploading(true);
    await run(async () => {
      const path = `${userId}/avatar-${Date.now()}.${(file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`;
      const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
      const { error: authErr } = await supabase.auth.updateUser({ data: { avatar_url: url } });
      if (authErr) throw authErr;
      setAvatar(url);
    });
    setUploading(false);
  };

  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await callFunction('delete-account', { confirm: 'DELETE' });
      await signOutToWebsite();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete your account. Try again.");
      setDeleting(false);
    }
  };

  return (
    <PageContainer title="Settings" actions={<SaveStatus state={state} />}>
      <Section id="household" title="Household">
        <div className="grid gap-5">
          <Input label="Household name" placeholder="The Millers" value={draft.household_name} onChange={e => editProfile({ household_name: e.target.value })} />
          <div>
            <p className="mb-2 text-small font-semibold text-ink">People</p>
            <Stepper label="People" value={draft.household_size} min={1} max={12} unit={n => (n === 1 ? 'person' : 'people')}
              onChange={n => editProfile({ household_size: n }, 400)} />
          </div>
        </div>
      </Section>

      <Section id="allergies" title="Allergies" intro="Recipes with these are never shown, anywhere in the app.">
        <AllergyPicker value={prefs.allergies} onChange={allergies => savePrefs({ allergies })} />
      </Section>

      <Section id="diet" title="Diet">
        <DietPicker value={prefs.diet} onChange={diet => savePrefs({ diet })} />
      </Section>

      <Section id="skip" title="Ingredients we skip" intro="Recipes that use these are hidden. Tap Never show on an ingredient to change it to Avoid if possible, which keeps those recipes but shows them last.">
        <SkipList never={prefs.skip_ingredients} avoid={prefs.avoid_ingredients} onChange={(skip_ingredients, avoid_ingredients) => savePrefs({ skip_ingredients, avoid_ingredients })} />
      </Section>

      <Section id="planning" title="Planning" intro="Used when we plan your week.">
        <PlanningPicker value={prefs} onChange={savePrefs} />
      </Section>

      <Section id="units" title="Units">
        <Segmented label="Units" value={prefs.units} onChange={units => savePrefs({ units })} className="w-full"
          options={[{ value: 'us', label: 'US (cups, °F)' }, { value: 'metric', label: 'Metric (g, °C)' }]} />
      </Section>

      <Section id="account" title="Account">
        <div className="grid gap-5">
          <div className="flex items-center gap-4">
            <Avatar url={avatar} name={draft.full_name || email} />
            <input ref={fileInput} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadPhoto(f); e.target.value = ''; }} />
            <Button variant="secondary" size="sm" icon={Camera} loading={uploading} onClick={() => fileInput.current?.click()}>
              {avatar ? 'Change photo' : 'Add photo'}
            </Button>
          </div>
          <Input label="Name" autoComplete="name" value={draft.full_name} onChange={e => editProfile({ full_name: e.target.value })} />
          <Input label="Email" value={email} readOnly disabled hint="Your email can't be changed here." />
        </div>
      </Section>

      <ListGroup className="mb-6">
        <ListRow title="Plan" trailing={<span className="text-body text-ink-muted">Free plan</span>} />
        <ListRow leading={<LogOut size={20} strokeWidth={1.75} aria-hidden className="text-ink-muted" />} title="Sign out" onClick={() => void signOutToWebsite()} />
        <ListRow leading={<Trash2 size={20} strokeWidth={1.75} aria-hidden className="text-terracotta" />} title="Delete account" destructive onClick={() => setConfirmDelete(true)} />
      </ListGroup>

      <ListGroup label="About" labelId="about">
        <ListRow leading={<FileText size={20} strokeWidth={1.75} aria-hidden className="text-ink-muted" />} title="Terms of use" chevron onClick={() => go({ name: 'terms' })} />
        <div className="px-4 py-3 text-small text-ink-muted">
          Recipes and photos from{' '}
          <a href="https://www.themealdb.com" target="_blank" rel="noreferrer" className="font-semibold text-green hover:underline">TheMealDB</a>
          , converted for US kitchens.
        </div>
      </ListGroup>

      <BottomSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete your account?"
        side="bottom"
        role="alertdialog"
        footer={
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button size="lg" variant="secondary" onClick={() => setConfirmDelete(false)}>Keep my account</Button>
            <Button size="lg" variant="danger" icon={Trash2} loading={deleting} onClick={deleteAccount}>Delete account</Button>
          </div>
        }
      >
        <p className="text-body text-ink">This permanently deletes your account, settings, week plans, grocery lists, favorites, collections, notes and ratings. It can't be undone.</p>
        {deleteError && <p role="alert" className="mt-3 text-small text-terracotta-deep">{deleteError}</p>}
      </BottomSheet>
    </PageContainer>
  );
}
