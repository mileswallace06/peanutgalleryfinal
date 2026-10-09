// Navigation diagnostics are captured locally; this fixture permits no writes.
export function logNavEvent(value) { (window.fixtureNavigation ||= []).push(value); }
