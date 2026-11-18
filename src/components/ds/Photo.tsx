import { usePhotoSrc } from '../../lib/recipePhotos';
import { cx } from './cx';

// Every recipe photo goes through this: cover crop, a quiet placeholder while it loads,
// and the warm wash from the `.photo` class. The caller picks the shape for its context:
//   hero and recipe detail  aspect-4/3 (16/9 on desktop)
//   recipe cards            aspect-4/3
//   thumbnails in rows      square, rounded-photo
// A household's private photo (a storage reference) is shown through a signed URL; a
// photo from a recipe website is loaded without a referrer, as many sites ask.

export function Photo({ src, alt = '', className, eager }: { src?: string | null; alt?: string; className?: string; eager?: boolean }) {
  const url = usePhotoSrc(src);
  return (
    <span className={cx('photo', className)}>
      {url && <img src={url} alt={alt} loading={eager ? 'eager' : 'lazy'} draggable={false} referrerPolicy="no-referrer" />}
    </span>
  );
}
