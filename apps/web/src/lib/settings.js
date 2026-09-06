/**
 * Settings that outlive a visit.
 *
 * Only two: the last-used options, so a second photo does not mean setting
 * everything again, and whether the install prompt has been dismissed.
 * Everything else is per-photo and belongs in component state.
 *
 * Storage can throw outright in private mode, so every access is guarded —
 * losing a preference is fine, a page that will not render is not.
 */

import { writable } from "svelte/store";
import { defaults } from "./options.js";

const KEY = "openpixels.options";

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    // Merged over the defaults, so a stored blob from an older version
    // that lacks a newer field still yields a complete object.
    return { ...defaults(), ...JSON.parse(raw) };
  } catch {
    return defaults();
  }
}

export const savedOptions = writable(load());

savedOptions.subscribe((value) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // The choice just will not survive a reload.
  }
});

export function dismissedInstall() {
  try {
    return localStorage.getItem("openpixels.install") === "off";
  } catch {
    return false;
  }
}

export function dismissInstall() {
  try {
    localStorage.setItem("openpixels.install", "off");
  } catch {
    // Nothing to do.
  }
}
