# Checkoff Move-to-Bought Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an item is checked off, it smoothly slides down into the "Куплено" section (and back up when unchecked) instead of jumping instantly.

**Architecture:** Add framer-motion. Make each `ItemRow` a `motion.div` with `layout` so framer-motion runs a FLIP animation when the row changes position between the unchecked and checked sections. Wrap the rendered list in `AnimatePresence` and animate the "Куплено (N)" divider. Honor `prefers-reduced-motion`.

**Tech Stack:** Next.js 14, React 18, framer-motion, Tailwind, React Query.

## Global Constraints

- Single client component: [`app/(app)/lists/[id]/page.tsx`](../../../app/(app)/lists/[id]/page.tsx) (already `'use client'`).
- Do NOT change mutation logic (toggle/add/delete), API routes, or the swipe-to-delete touch handlers.
- The swipe `transform: translateX(...)` must stay on the inner row `<div>`; the framer-motion `layout` transform goes on a new outer `motion.div` — keep them on separate layers so they don't overwrite each other.
- Spring transition: `{ type: 'spring', stiffness: 500, damping: 40 }`.
- This is a purely visual change. Primary verification = `npm run build` + `npm test` stay green (no regressions) + manual browser checklist. There is no existing UI test for this page and an animation is not meaningfully unit-testable; do not fabricate one.

---

### Task 1: Add framer-motion and reduced-motion config

**Files:**
- Modify: `package.json` (dependency added by npm)
- Modify: `app/(app)/lists/[id]/page.tsx` (import + `MotionConfig` wrapper)

**Interfaces:**
- Consumes: nothing.
- Produces: `framer-motion` available; the page's root JSX wrapped in `<MotionConfig reducedMotion="user">` so all descendant motion components auto-disable animation when the OS requests reduced motion. Task 2 relies on `motion`, `AnimatePresence` being importable from `framer-motion`.

- [ ] **Step 1: Install dependency**

```bash
npm install framer-motion@^11
```

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require.resolve('framer-motion'); console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Add imports to the page**

In [`app/(app)/lists/[id]/page.tsx`](../../../app/(app)/lists/[id]/page.tsx), add below the existing React import (line 5):

```tsx
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
```

- [ ] **Step 4: Wrap the page root in MotionConfig**

In `ListDetailPage`'s `return`, wrap the outermost `<div className="flex flex-col h-screen bg-bg">` with `MotionConfig`. Change:

```tsx
  return (
    <div className="flex flex-col h-screen bg-bg">
```

to:

```tsx
  return (
    <MotionConfig reducedMotion="user">
    <div className="flex flex-col h-screen bg-bg">
```

and change the matching closing `</div>` at the end of the component's return (the one immediately before the final `)` of `ListDetailPage`, currently around line 676) to:

```tsx
    </div>
    </MotionConfig>
  )
```

- [ ] **Step 5: Verify build passes**

Run: `npm run build`
Expected: build completes with no type errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json "app/(app)/lists/[id]/page.tsx"
git commit -m "feat: add framer-motion and reduced-motion config"
```

---

### Task 2: Animate row movement and the "Куплено" divider

**Files:**
- Modify: `app/(app)/lists/[id]/page.tsx` (`ItemRow` root element + list render block)

**Interfaces:**
- Consumes: `motion`, `AnimatePresence`, `MotionConfig` from Task 1.
- Produces: animated checkoff. No new exported API.

- [ ] **Step 1: Convert `ItemRow`'s root element to a `motion.div` with layout**

In `ItemRow` (currently returns `<div className="relative overflow-hidden rounded-2xl">`), change the outer wrapper to a `motion.div`. Replace:

```tsx
  return (
    <div className="relative overflow-hidden rounded-2xl">
```

with:

```tsx
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0, paddingBottom: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className="relative overflow-hidden rounded-2xl"
    >
```

and change `ItemRow`'s matching closing `</div>` (the last line of its return, currently line 275) to `</motion.div>`.

Leave the inner row `<div>` with its swipe `transform`/`onTouch*` handlers exactly as-is — the swipe transform stays on the inner layer, the layout transform is on the new outer `motion.div`.

- [ ] **Step 2: Wrap the items render block in `AnimatePresence` and animate the divider**

In `ListDetailPage`'s render, the block guarded by `{!isLoading && !isError && items !== undefined && (` currently renders a `<>...</>` fragment containing the two `.map()` calls, the divider `<p>`, and the empty state. Replace that fragment with an `AnimatePresence` and turn the divider into a `motion.p`.

Replace:

```tsx
        {!isLoading && !isError && items !== undefined && (
          <>
            {/* Unchecked items */}
            {unchecked.map((item) => (
```

with:

```tsx
        {!isLoading && !isError && items !== undefined && (
          <AnimatePresence initial={false}>
            {/* Unchecked items */}
            {unchecked.map((item) => (
```

Replace the divider:

```tsx
            {checked.length > 0 && (
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 py-2">
                Куплено ({checked.length})
              </p>
            )}
```

with:

```tsx
            {checked.length > 0 && (
              <motion.p
                key="checked-divider"
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                className="text-[11px] font-semibold text-muted uppercase tracking-wide px-1 py-2"
              >
                Куплено ({checked.length})
              </motion.p>
            )}
```

Then change the fragment's closing `</>` (the one right before the closing `)}` of this block, currently around line 561) to `</AnimatePresence>`.

Leave both `unchecked.map(...)` and `checked.map(...)` and the empty-state `<p>` unchanged — `ItemRow` already carries `key={item.id}`, which lets framer-motion track each row as it moves between the two maps.

- [ ] **Step 3: Verify build and lint pass**

Run: `npm run build && npm run lint`
Expected: no type or lint errors.

- [ ] **Step 4: Verify existing tests stay green**

Run: `npm test`
Expected: same pass count as before the change (no regressions).

- [ ] **Step 5: Manual browser verification**

Run `npm run dev`, open a list, and confirm:
- Checking an item: the row slides smoothly down into "Куплено" (no instant jump).
- Unchecking: the row slides back up into the active list.
- First check: the "Куплено (N)" divider fades/slides in without a hard layout jump.
- Swipe-to-delete still works and removes the row.
- With OS "reduce motion" enabled, transitions are instant (no sliding).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/lists/[id]/page.tsx"
git commit -m "feat: animate item moving into Куплено section on checkoff"
```

---

## Self-Review

**Spec coverage:**
- framer-motion dependency → Task 1. ✓
- `ItemRow` → `motion.div layout` → Task 2 Step 1. ✓
- `AnimatePresence` wrapper → Task 2 Step 2. ✓
- Animated "Куплено (N)" divider → Task 2 Step 2. ✓
- Symmetric (uncheck moves back up) → layout animation is bidirectional; covered by Task 2 Step 1 + browser check Step 5. ✓
- Spring timing → both tasks use `stiffness: 500, damping: 40`. ✓
- `prefers-reduced-motion` → Task 1 `MotionConfig reducedMotion="user"` + browser check. ✓
- Don't change mutations/swipe/API → Global Constraints + explicit "leave as-is" notes. ✓
- transform conflict risk → Global Constraints + Task 2 Step 1 note (swipe on inner, layout on outer). ✓
- Testing approach → Global Constraints + Task 2 Steps 3–5. ✓

**Placeholder scan:** No TBD/TODO; all code shown. ✓

**Type consistency:** Imports `motion`, `AnimatePresence`, `MotionConfig` defined in Task 1 and used in Task 2. Transition object identical in both places. ✓
