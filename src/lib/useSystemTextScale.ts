import { useEffect, useState } from 'react';
import { systemTextScale } from './cookText';

const isIos = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * The device's text size as a multiplier. iOS doesn't apply Dynamic Type to web pages,
 * so it's read from the size iOS gives its body text style. Elsewhere the browser's text
 * size already scales the app's rem-based type, so this stays 1.
 */
export function useSystemTextScale(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (!isIos() || !CSS.supports?.('font', '-apple-system-body')) return;
    const measure = () => {
      const el = document.createElement('span');
      el.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;font:-apple-system-body';
      el.textContent = 'A';
      document.body.appendChild(el);
      const px = parseFloat(getComputedStyle(el).fontSize);
      el.remove();
      setScale(systemTextScale(px));
    };
    measure();
    // The setting can change while the app is in the background.
    const onVisible = () => { if (document.visibilityState === 'visible') measure(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return scale;
}
