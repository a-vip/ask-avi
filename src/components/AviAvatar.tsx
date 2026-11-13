import { useState } from 'react';
import { AVI_AVATAR_URL } from '../data/persona';

interface AviAvatarProps {
  size?: number;
  className?: string;
}

export function AviAvatar({ size = 32, className = '' }: AviAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <span
      className={`avi-avatar ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {!imgFailed ? (
        <img
          src={AVI_AVATAR_URL}
          alt="Avi Perera"
          width={size}
          height={size}
          loading="eager"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <svg viewBox="0 0 64 64" width={size} height={size} fill="none">
          <rect width="64" height="64" rx="16" fill="currentColor" fillOpacity="0.12" />
          <path
            d="M32 14L48 50H41.5L38 41.5H26L22.5 50H16L32 14ZM28.3 36H35.7L32 26.8L28.3 36Z"
            fill="currentColor"
          />
          <circle cx="49" cy="16" r="4" fill="#38bdf8" />
        </svg>
      )}
    </span>
  );
}
