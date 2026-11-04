import { useEffect, useRef, useState } from 'react';
import { Camera, LogOut, Trash2 } from 'lucide-react';
import { useApp } from '../app/AppContext';
import { signOutToWebsite, supabase } from '../lib/supabase';
import { saveProfile, type Preferences, type Profile } from '../lib/preferences';
import { callFunction } from '../lib/plan';
import { AllergyPicker, DietPicker, PlanningPicker, SkipList } from '../components/PrefControls';
import { Button, Input, PageContainer, SaveStatus, Segmented, Sheet, Stepper } from '../components/ds';

// One scrolling page: Household, Allergies, Diet, Ingredients we skip, Planning, Units,
// Account, About. Every change saves on its own with a quiet "Saved".

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-line py-8">
      <h2 id={id} className="text-xl text-ink">{title}</h2>
      {intro && <p className="mt-1 max-w-[60ch] text-base text-ink-muted">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Avatar({ url, name }: { url?: string; name: string }) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  return url
    ? <img src={url} alt="" className="size-16 rounded-full bg-line object-cover" />
    : <span aria-hidden className="flex size-16 items-center justify-center rounded-full bg-basil-soft font-display text-xl font-semibold text-basil">{initials}</span>;
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
        <div className="grid max-w-xl gap-5">
          <Input label="Household name" placeholder="The Millers" value={draft.household_name} onChange={e => editProfile({ household_name: e.target.value })} />
          <div>
            <p className="mb-2 text-sm font-semibold text-ink">People</p>
            <Stepper label="People" value={draft.household_size} min={1} max={12} unit={n => (n === 1 ? 'person' : 'people')}
              onChange={n => editProfile({ household_size: n }, 400)} />
          </div>
        </div>
      </Section>

      <Section id="allergies" title="Allergies" intro="Recipes with these are never shown, anywhere in the app.">
        <AllergyPicker value={prefs.allergies} onChange={allergies => savePrefs({ allergies })} />
      </Section>

      <Section id="diet" title="Diet">
        <div className="max-w-xl"><DietPicker value={prefs.diet} onChange={diet => savePrefs({ diet })} /></div>
      </Section>

      <Section id="skip" title="Ingredients we skip" intro="Recipes that use these are hidden. Tap Never show on an ingredient to change it to Avoid if possible, which keeps those recipes but shows them last.">
        <SkipList never={prefs.skip_ingredients} avoid={prefs.avoid_ingredients} onChange={(skip_ingredients, avoid_ingredients) => savePrefs({ skip_ingredients, avoid_ingredients })} />
      </Section>

      <Section id="planning" title="Planning" intro="Used when we plan your week.">
        <PlanningPicker value={prefs} onChange={savePrefs} />
      </Section>

      <Section id="units" title="Units">
        <Segmented label="Units" value={prefs.units} onChange={units => savePrefs({ units })}
          options={[{ value: 'us', label: 'US (cups, °F)' }, { value: 'metric', label: 'Metric (g, °C)' }]} />
      </Section>

      <Section id="account" title="Account">
        <div className="grid max-w-xl gap-5">
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
          <div>
            <p className="text-sm font-semibold text-ink">Plan</p>
            <p className="mt-1 text-base text-ink">Free plan</p>
          </div>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="secondary" icon={LogOut} onClick={() => void signOutToWebsite()}>Sign out</Button>
            <Button variant="danger-quiet" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete account</Button>
          </div>
        </div>
      </Section>

      <Section id="about" title="About">
        <p className="max-w-[60ch] text-base text-ink">
          Recipes and photos from{' '}
          <a href="https://www.themealdb.com" target="_blank" rel="noreferrer" className="font-semibold text-basil hover:underline">TheMealDB</a>
          , converted for US kitchens.
        </p>
        <button type="button" onClick={() => go({ name: 'terms' })} className="mt-3 cursor-pointer text-base font-semibold text-basil hover:underline">Terms of use</button>
      </Section>

      <Sheet
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
        <p className="text-base text-ink">This permanently deletes your account, settings, week plans, grocery lists, favorites, collections, notes and ratings. It can't be undone.</p>
        {deleteError && <p role="alert" className="mt-3 text-sm text-alert">{deleteError}</p>}
      </Sheet>
    </PageContainer>
  );
}
