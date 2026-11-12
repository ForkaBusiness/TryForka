import { cx } from './cx';

// Every recipe photo goes through this: cover crop, a quiet placeholder while it loads,
// and the warm wash from the `.photo` class. The caller picks the shape for its context:
//   hero and recipe detail  aspect-4/3 (16/9 on desktop)
//   recipe cards            aspect-4/3
//   thumbnails in rows      square, rounded-photo

export function Photo({ src, alt = '', className, eager }: { src?: string | null; alt?: string; className?: string; eager?: boolean }) {
  return (
    <span className={cx('photo', className)}>
      {src && <img src={src} alt={alt} loading={eager ? 'eager' : 'lazy'} draggable={false} />}
    </span>
  );
}
