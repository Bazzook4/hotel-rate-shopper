"use client";

import { useEffect, useRef } from "react";

/**
 * Escape closes the top layer only.
 *
 * Every modal used to listen for Escape on the window by itself, so one press
 * reached them all: Escape on a dialog shown over a booking closed the dialog
 * and the booking behind it, and Escape to hide the guest suggestions closed
 * the whole form. Layers now take turns: the one opened last answers, and the
 * ones below wait until it has gone.
 *
 * Anything inside a layer that handles Escape itself -- a suggestion list, a
 * dropdown, the command palette -- calls e.preventDefault(), and the layer
 * then leaves the key alone.
 *
 *   useEscape(onClose);            // while mounted
 *   useEscape(onClose, isOpen);    // only while isOpen
 */

const layers = [];
let listening = false;

function onKey(e) {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = layers[layers.length - 1];
  if (!top) return;
  e.preventDefault();
  top.current(e);
}

export function useEscape(handler, active = true) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });

  useEffect(() => {
    if (!active) return undefined;
    layers.push(ref);
    if (!listening) {
      window.addEventListener("keydown", onKey);
      listening = true;
    }
    return () => {
      const i = layers.lastIndexOf(ref);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active]);
}

/**
 * Props for a modal's backdrop that close it on a click outside -- but only a
 * click that also started outside. A drag that begins in a field (selecting
 * text) and is let go over the backdrop is not a click outside.
 */
export function useBackdropClose(onClose) {
  const down = useRef(false);
  return {
    onMouseDown: (e) => {
      down.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      if (down.current && e.target === e.currentTarget) onClose();
      down.current = false;
    },
  };
}
