import { useEffect, type RefObject } from 'react';
import { gsap } from 'gsap';

// Content is visible in CSS. Animate only elements already on screen; never reserve
// scroll space or hide a below-fold section while waiting for a trigger.
export function usePageMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      const ctx = gsap.context(() => {
        gsap.from('.hero [data-enter]', { y: 16, duration: 0.65, stagger: 0.09, ease: 'power2.out', clearProps: 'transform' });
        const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          gsap.fromTo(entry.target, { y: 12 }, { y: 0, duration: 0.6, ease: 'power2.out', clearProps: 'transform' });
          // Process emphasis: the numbered steps arrive in order, so the sequence reads as a sequence.
          const steps = entry.target.querySelectorAll('.workflow li');
          if (steps.length) gsap.fromTo(steps, { y: 14 }, { y: 0, duration: 0.5, stagger: 0.14, delay: 0.1, ease: 'power2.out', clearProps: 'transform' });
          observer.unobserve(entry.target);
        }), { threshold: 0.05 });
        root.current?.querySelectorAll('[data-reveal]').forEach((el) => observer.observe(el));
        return () => observer.disconnect();
      }, root);
      return () => ctx.revert();
    });
    return () => media.revert();
  }, [root]);
}
