import "@testing-library/jest-dom";

// jsdom doesn't ship IntersectionObserver or ResizeObserver, but several
// components in this app (anchor scroll-spy, Radix popovers/dialogs) rely
// on them. Provide minimal no-op stubs so tests can render the components.
class NoopIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.IntersectionObserver === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).IntersectionObserver = NoopIntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = NoopResizeObserver;
}
// Radix uses these for popover/dialog focus + pointer handling under jsdom.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!Element.prototype.releasePointerCapture) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).releasePointerCapture = () => {};
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(Element.prototype as any).scrollIntoView) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).scrollIntoView = () => {};
  }
}
