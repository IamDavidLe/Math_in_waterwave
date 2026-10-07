import { useEffect, useRef, useState } from "react";

/**
 * The reveals the landing page draws on. Each section picks the one that suits
 * what it is saying — the section about translation slides, the one about rings
 * flattening settles downward — so the page is not one effect repeated.
 */
export type RevealVariant =
  "rise" | "left" | "right" | "scale" | "expand" | "slide" | "flatten" | "sharpen" | "settle";

/**
 * Plays a reveal the first time an element is scrolled into view, and never
 * again — these are an arrival, not a loop.
 *
 * Nothing is hidden until the effect has run on the client, so the markup the
 * server sends is readable on its own: without script, or without an
 * IntersectionObserver, every section simply stays visible. Anyone who has asked
 * their system for less motion is left alone too.
 */
export function useReveal<T extends Element = HTMLDivElement>(variant: RevealVariant = "rise") {
  const ref = useRef<T>(null);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setShown(true);
      return;
    }

    // Anything already on screen is armed and shown in the same pass, so it
    // animates in rather than blinking out and back.
    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      // Start a little before the section is fully in, and accept a sliver of it,
      // so a tall section does not wait until its bottom edge arrives.
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return {
    ref,
    variant,
    className: `reveal${armed && !shown ? " is-armed" : ""}${shown ? " is-in" : ""}`,
  };
}
