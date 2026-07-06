import { useEffect, useState } from 'react';

/** true quando viewport < md (768px) — alinhado ao breakpoint Tailwind md: */
export function useIsMobile() {
  const query = '(max-width: 767px)';
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return mobile;
}
