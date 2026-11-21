import { useEffect, useRef, useState } from 'react';
import { Camera, FileText, LogOut, Sparkle, Trash2 } from 'lucide-react';
import { openPortal, planLine, requestRefund } from '../lib/billing';
import { useApp } from '../app/AppContext';
import { signOutToWebsite, supabase } from '../lib/supabase';
import { saveProfile, type Preferences, type Profile } from '../lib/preferences';
import { callFunction } from '../lib/plan';
import { AllergyPicker, DietPicker, PlanningPicker, SkipList } from '../components/PrefControls';
import { FamilySettings } from '../components/FamilySettings';
import { BottomSheet, Button, Card, Input, ListGroup, ListRow, PageContainer, SaveStatus, Segmented, Stepper, Tag } from '../components/ds';

// One scrolling page of grouped cards: Household, Family, Allergies, Diet, Ingredients we skip,
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

/** A full refund of a payment from the last 14 days, no questions asked: one tap, then a confirm. */
function RefundRow({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'idle' | 'confirm' | 'busy'>('idle');
  const [note, setNote] = useState<{ text: string; problem?: boolean } | null>(null);
  const refund = async () => {
    setStep('busy'); setNote(null);
    try {
      const r = await requestRefund();
      if (r.status === 'refunded') {
        const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: r.currency.toUpperCase() }).format(r.amount / 100);
        setNote({ text: `Refunded ${amount}. It reaches your card in 5 to 10 days. Pro has ended, and everything you saved is still here.` });
        // Stripe tells the app the plan has ended a moment later.
        window.setTimeout(onDone, 4000);
      } else {
        setNote({ text: r.message });
      }
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "Couldn't request the refund. Try again in a minute.", problem: true });
    } finally {
      setStep('idle');
    }
  };
  return (
    <div className="mt-4 border-t border-line pt-4">
      {step === 'confirm' ? (
        <div>
          <p className="text-body text-ink">Refund your payment from the last 14 days in full? Pro ends now, and everything you saved stays.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Button variant="danger-ghost" onClick={() => void refund()}>Refund and end Pro</Button>
            <Button variant="secondary" onClick={() => setStep('idle')}>Keep Pro</Button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={step === 'busy'} onClick={() => { setNote(null); setStep('confirm'); }}
          className="min-h-11 cursor-pointer text-small font-semibold text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-60">
          {step === 'busy' ? 'Requesting your refund…' : 'Refund my last payment'}
        </button>
      )}
      <p className="mt-1 text-small text-ink-muted">Full refund within 14 days of any payment, no questions asked.</p>
      {note && <p role={note.problem ? 'alert' : 'status'} className={note.problem ? 'mt-2 text-small text-terracotta-deep' : 'mt-2 text-small text-ink'}>{note.text}</p>}
    </div>
  );
}

export function Settings() {
  // The saved household settings: each person's own allergies are edited under Family.
  const { session, userId, householdPrefs: prefs, updatePrefs, profile, setProfile, go, familyAvailable, billing } = useApp();
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const manage = async () => {
    setPortalBusy(true);
    setPortalError(null);
    try { await openPortal(); } catch (err) { setPortalError(err instanceof Error ? err.message : "Couldn't open your plan. Try again."); setPortalBusy(false); }
  };
  const plan = billing.status === 'loading' ? { title: 'Checking your plan', detail: 'One moment.' }
    : billing.status === 'failed' ? { title: "Couldn't load your plan", detail: 'Check your connection, then reload. Nothing about your plan has changed.' }
    : planLine(billing.view);
  const known = billing.status === 'ready';
  const founding = billing.view.kind === 'founding';
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
      {/* Before launch (the billing switch off) there's no plan to show. */}
      {billing.enabled && (
      <Section id="plan" title="Plan">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-heading font-semibold text-ink">{plan.title}</p>
            <p className={billing.view.kind === 'payment_failed' || (billing.view.kind === 'free' && billing.view.owed) ? 'mt-1 text-body text-terracotta-deep' : 'mt-1 text-body text-ink-muted'}>{plan.detail}</p>
          </div>
          {known && billing.view.kind === 'free' && (billing.view.owed
            ? <Button className="shrink-0" loading={portalBusy} onClick={manage}>Update card</Button>
            : <Button className="shrink-0" onClick={() => go({ name: 'pro' })}>See Pro</Button>)}
          {known && ['trialing', 'active', 'cancelled', 'payment_failed'].includes(billing.view.kind) && (
            <Button variant={billing.view.kind === 'payment_failed' ? 'primary' : 'secondary'} className="shrink-0" loading={portalBusy} onClick={manage}>
              {billing.view.kind === 'payment_failed' ? 'Update card' : billing.view.kind === 'cancelled' ? 'Renew or manage' : 'Manage plan'}
            </Button>
          )}
        </div>
        {known && ['trialing', 'active'].includes(billing.view.kind) && <p className="mt-3 text-small text-ink-muted">Change plan, update your card or cancel on Stripe's secure page.</p>}
        {portalError && <p role="alert" className="mt-3 text-small text-terracotta-deep">{portalError}</p>}
        {known && ['active', 'cancelled', 'payment_failed'].includes(billing.view.kind) && <RefundRow onDone={() => void billing.refresh()} />}
      </Section>
      )}

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

      {familyAvailable && (
        <Section id="family" title="Family" intro="Add each person and the plan learns what they eat. After dinner we ask who ate it.">
          <FamilySettings />
        </Section>
      )}

      <Section id="allergies" title="Household allergies" intro={`Recipes with these are never shown, anywhere in the app.${familyAvailable ? " Each person's own allergies are under Family." : ''}`}>
        <AllergyPicker value={prefs.allergies} onChange={allergies => savePrefs({ allergies })} />
      </Section>

      <Section id="diet" title="Diet">
        <DietPicker value={prefs.diet} onChange={diet => savePrefs({ diet })} />
      </Section>

      <Section id="skip" title="Ingredients we skip" intro="Recipes that use these are hidden. Tap Never show on an ingredient to change it to Avoid if possible, which keeps those recipes but shows them last.">
        <SkipList never={prefs.skip_ingredients} avoid={prefs.avoid_ingredients} onChange={(skip_ingredients, avoid_ingredients) => savePrefs({ skip_ingredients, avoid_ingredients })} />
      </Section>

      <Section id="planning" title="Planning" intro="Used when we plan your week.">
        <PlanningPicker value={prefs} onChange={savePrefs} pro={billing.plan === 'pro' || billing.status !== 'ready'} onPro={() => billing.upgrade('meals')} />
      </Section>

      <Section id="units" title="Units">
        <Segmented label="Units" value={prefs.units} onChange={units => savePrefs({ units })} className="w-full"
          options={[{ value: 'us', label: 'US (cups, °F)' }, { value: 'metric', label: 'Metric (g, °C)' }]} />
      </Section>

      <Section id="account" title="Account">
        <div className="grid gap-5">
          <div className="flex items-center gap-4">
            <Avatar url={avatar} name={draft.full_name || email} />
            {founding && billing.enabled && <Tag tone="green" icon={Sparkle}>Founding family</Tag>}
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
