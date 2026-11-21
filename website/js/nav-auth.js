// When someone is signed in, the nav's "Log in" buttons (desktop and mobile menu)
// become "Open app". Included on every page.
import { getSession, APP_PATH } from './forka-auth.js';

const session = await getSession();
if (session) {
  document.querySelectorAll('.nav-actions a[href="login.html"], .mobile-menu-btns a[href="login.html"], .header-actions a[href="login.html"]').forEach(a => {
    a.textContent = 'Open app';
    a.setAttribute('href', APP_PATH);
  });
}
