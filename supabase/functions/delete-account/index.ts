import { AppError, serve, serviceClient } from '../_shared/http.ts';
import { stripe, StripeError } from '../_shared/billing/stripe.ts';

// Deletes the signed-in user. Every user table references auth.users with
// ON DELETE CASCADE, so removing the auth user removes their rows too (their own recipes
// included); their files are removed first because storage objects don't cascade: the
// avatar, and every recipe photo (dish photos, imported pages and screenshots, covers).
// A Forka Pro subscription is cancelled first, and the Stripe customer removed, so a
// deleted account is never charged again.

/** Every file under a folder, at any depth (storage lists one level at a time). */
async function listAll(admin: ReturnType<typeof serviceClient>, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = `${folder}/${item.name}`;
      // Folders have no id; files do.
      if (item.id) out.push(path); else out.push(...await listAll(admin, bucket, path));
    }
    if ((data ?? []).length < 100) return out;
  }
}

serve(async (body, req) => {
  if (body.confirm !== 'DELETE') throw new AppError('Confirm to delete your account.', 400);
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = serviceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new AppError('Sign in again to continue.', 401);
  const userId = data.user.id;

  // Billing first: if Stripe can't be reached, the account stays, so nobody is charged for an account that's gone.
  const { data: plan } = await admin.from('user_plans').select('stripe_customer_id').eq('user_id', userId).maybeSingle();
  if (plan?.stripe_customer_id) {
    try {
      // Deleting the customer cancels its subscriptions at once, with no further invoices.
      await stripe('DELETE', `/customers/${plan.stripe_customer_id}`);
    } catch (err) {
      // Already gone (an earlier attempt that stopped later on, or removed in Stripe): nothing left to cancel.
      if (!(err instanceof StripeError && err.missing)) {
        console.error('[delete-account] Stripe customer not removed for', userId, err);
        throw new AppError("Couldn't cancel your Pro plan. Try again in a minute.", 502);
      }
    }
    // Forget it now, so a retry after a later step fails doesn't ask Stripe again.
    await admin.from('user_plans').update({ stripe_customer_id: null, stripe_subscription_id: null }).eq('user_id', userId);
  }

  const { data: files } = await admin.storage.from('avatars').list(userId);
  if (files?.length) await admin.storage.from('avatars').remove(files.map(f => `${userId}/${f.name}`));
  // The family's private photos go first. If they can't be removed, the account stays, so
  // deleting again can finish the job: nothing is left behind that no one can reach.
  try {
    const photos = await listAll(admin, 'recipe-photos', userId);
    for (let i = 0; i < photos.length; i += 100) {
      const { error } = await admin.storage.from('recipe-photos').remove(photos.slice(i, i + 100));
      if (error) throw error;
    }
  } catch (err) {
    console.error('[delete-account] recipe photos not removed for', userId, err);
    throw new AppError("Couldn't delete your photos. Try again in a minute.", 500);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error('[delete-account] failed:', delErr);
    throw new AppError("Couldn't delete your account. Try again.", 500);
  }
  console.log('[delete-account] deleted', userId);
  return { deleted: true };
});
