# Application interface contract

The [Product specification](product-specification.md) governs product behavior.
This document describes the current module, data, persistence and UI contracts.
See [Development](development.md) for execution policy and verification commands,
and [PWA reliability](pwa-reliability.md) for offline-shell and update safety limits.

## Domain records and local calendar

`src/domain/types.ts` defines the current `Dataset` (`schemaVersion: 2`) and its
local `revision`. Persisted facts, historical projections and presentation state
have separate responsibilities:

- **Pillars** retain stable IDs. The four defaults use `defaultKey` values `mind`,
  `body`, `nutrition` and `hygiene`. Untouched default labels localize; built-in
  renames use literal `nameOverride`, and custom names remain literal `name` values.
- **Habit definitions** store effective-dated goal text and weekday masks.
  **Memberships** form a separate effective-dated pillar timeline. Historical
  assignments must not be reconstructed from only the current pillar.
- **Activation periods** have stable IDs, inclusive start/end dates, and optional
  archival/reactivation dates. `pendingReactivation` reserves a period ID and
  request date as an intent, not an inverted or future actual interval.
- **Pending moves** retain their request date and target pillar so a not-yet-due
  membership boundary can follow prospective schedule edits. Once due, the dated
  membership is retained and reconciliation clears the pending intent.
- **Occurrences** are unique by stable habit ID plus assigned `YYYY-MM-DD`.
  They retain goal, pillar, assigned date, kind, activation link, binary `done`,
  observed timestamp, timezone and offset, together with participation, completion
  provenance, assignment lock and optional exemption facts.
- Occurrence `kind` distinguishes a required habit/daily commitment from the
  genuine creation-day optional opportunity. `pillarParticipation` independently
  distinguishes `required` from `on-completion`; conditional pillar participation
  never excuses a scheduled habit/daily commitment.
- A credited occurrence's source assignment remains locked through uncheck/recheck.
  Archive-day exemption excuses unfinished participation only; retained completed
  credit still counts. A lock alone must not be treated as a completion.

`src/domain/calendar.ts` separates instant and civil-calendar operations:

- `deviceClock` supplies actual instants; `localDate(instant)` reads the device's
  local date for Today and command request dates. Today refreshes at local midnight,
  open, resume and focus; it is not derived from UTC midnight.
- `parseLocalDate` strictly validates a Gregorian `YYYY-MM-DD` in `0100`–`9999`
  and returns a **UTC-backed civil-calendar carrier**, not a device-local instant.
  Use UTC getters/setters for that carrier and `civilDate(carrier)` to read its
  civil identity. Never pass it through `localDate` or local getters.
- `weekday`, `nextScheduledDate`, historical iteration and day/month arithmetic
  use the civil calendar independently of the current zone. A zone's historical
  skipped day is still a valid stored date; invalid Gregorian dates reject.
- Format carriers with explicit `timeZone: 'UTC'` and the selected language so
  labels retain the intended day and weekday. Actual timestamp displays, recording
  metadata and export timestamps keep their existing instant semantics.

Stored strings and schemas do not change. No date shifts, source-zone fields,
history repair or migration are needed. Production exposes no clock or
injected-failure settings.

### Pillar removal and retained history

- `removedOn` is a retained management tombstone, not cascade deletion. Removed
  pillars leave active management and destination selection, but remain available
  to historical resolvers, retained Today credit and progress replay.
- Removal requires all prospective active, awaiting and future members to be
  moved or archived. Built-in pillars have no additional removal prohibition;
  their stable `defaultKey` retains historical identity and achievement scope.
- An archived habit whose source pillar was removed may reactivate atomically
  into a valid active destination without losing identity or history.
- Backup validation checks prospective ownership at each stored removal date,
  not at the importing device's current date.

## Agenda, history and lifecycle transitions

### Projections

`src/domain/agenda.ts` exports `definitionAt`, `membershipAt`,
`nextHabitScheduledDate`, `pendingReactivationDate`, `activationAt`, `agenda` and
`summarize`.

- `summarize(items)` uses habit/daily requirements for Today and global counts.
- `summarize(filteredItems, 'pillar')` uses that pillar's independent required
  set. An unchecked pre-credit move's conditional destination participation does
  not block that pillar, but still blocks the daily agenda.
- Empty scopes are neutral, not automatic successes. Summary fields are
  `required`, `requiredDone`, `optional`, `optionalDone` and `status`
  (`pending`, `complete` or `neutral`).
- `src/domain/history.ts` exports `editableOccurrences`, newest-first
  `habitHistory`, and `pillarHistory` (newest-first dates, original habit order
  within each date). They include implicit missed scheduled rows without
  persisting them merely because someone viewed history. Pillar grouping uses
  each row's historical assignment, not the habit's current pillar.
- `createAgendaProjection(input)` owns a read-only operation's habit/date
  occurrence index and first-required-date lookups. Replay and histories create
  one context per call; discard it before mutating facts. It is not a dataset
  cache: neither object identity nor local revision authorizes reuse across
  mutations or replacement. Indexes are never persisted or exported.
- Corrections are limited to eligible Today and the immediately previous eligible
  date, not the last successful date. Older rows are read-only.
- `src/domain/completion.ts` exports `updateCompletion`; it updates the same
  habit/date record and preserves dated snapshots and credited source locks
  through uncheck/recheck.

### Edits, moves, archival and reactivation

`src/domain/lifecycle.ts` provides pure transactional-fact transitions rather than
UI counter changes. `habitState` returns `active`, `archived` or `awaiting`, with
optional `resumesOn`. `previewHabitEdit` supplies definition `effectiveFrom` and
separate move date, mode, source and target.

- Goal/weekday edits begin on the next local date. Creation-day first-required
  feedback resolves the effective edited schedule while preserving today's
  original goal and optional kind.
- Moves preserve habit identity and individual sequence. Already credited dates
  remain assigned to their dated source pillar. Pre-credit Today may contribute
  in the destination only on completion, with one habit/date reward and no new
  optional creation-day opportunity. Move boundaries and definition boundaries
  are resolved independently.
- Cancelling an earlier uncredited conditional move on a later date retains that
  management decision as an explicit membership boundary, even when it repeats
  the source pillar. First historical credit may anticipate its own move but
  cannot erase a subsequent cancellation or redirect later commitments.
- Archival is immediate: it retains earlier failures/completions, removes
  unfinished Today participation without XP, and preserves completed counts.
- Reactivation reserves a new period ID and starts on the first scheduled date
  strictly after the request. Before first due, cancellation removes the intent
  without inventing periods, occurrences, exemptions or rewards.
- At or after due, reconciliation materializes the actual new period even when
  the app is first opened late or the first commitment was missed. Awaiting
  current streak is zero; the first completion in the new activation is one.

### Revisited dates and future-created habits

- Guarded proposals reject edits, archival or reactivation that would rewrite
  known history when the device revisits an earlier local date. Known history
  includes activation-period boundaries even without occurrence rows.
- Rejected proposals leave caller and persisted facts intact. The UI provides
  review guidance rather than a blind Retry for a historical commitment conflict.
- Display-only `beforeCreation`, `displayDefinition`, `displayMembership` and
  `stateAt` helpers keep future-created identities readable with localized
  waiting/start-date guidance; they do not change agenda/history eligibility.
- Before creation, completion/edit/archive/reactivate controls are unavailable,
  and later saved completions grant no early XP.
- Before creation, the App guards an open editor before rendering its preview. It
  recovers to read-only detail and discards only unsaved form/Retry state without
  a Repository write.
- A post-creation revisit into an archived gap suspends the open editor before
  preview validation. It shows read-only history and retains the literal draft
  in memory while the editor stays open; returning to an applicable date restores
  editing. Cancel/navigation still uses the explicit dirty-draft guard. Neither
  suspension nor recovery saves a definition or reactivates a habit.

## Replay-derived progression

`src/domain/progress.ts` exports
`calculateProgress(input: CompatibleDataset, today)`. It is pure deterministic
replay, not an additive stored reward ledger. Every screen uses the committed
progress snapshot.

| Snapshot value | Contract |
|---|---|
| `habits[id]` | `{current, best, xp, nextBonus}` |
| `nextBonus` | `{threshold, bonusXp, remaining}` or `null` |
| `pillars[id]`, `overall` | `{current, best}` |
| `totalXp`, `level` | `level = 1 + floor(totalXp / 100)` |
| `levelProgress` | `{earnedXp, requiredXp: 100, remainingXp, nextLevel}` |
| `awards` | Deterministic habit/date/activation/sequence/streak/base/bonus identities |

- `BASE_XP = 10`. The exact 17 `MILESTONES` run through 365; base rewards continue
  afterward without invented later bonuses.
- `overall` is labeled **Daily streak / Sequência diária**. Pillar and overall
  streaks grant no extra XP, including default/custom pillar indicators.
- Corrections reconcile XP, current/best streaks, bonuses and level. Ordinary
  later misses preserve valid earned XP. Permanent ownership is independent.
- Feedback is text-accessible and locale-formatted. Required-only completed/total
  counts never include optional commitments in the denominator.
- Compact next-bonus text includes bonus XP and remaining eligible commitments.
  At the last milestone it does not imply another bonus.
- Full goals, counts, streak units and labels wrap at enlarged/narrow layouts;
  they are not silently clipped or shrunk. Decorative icons do not replace labels
  or announce extra rewards.

## Classified dataset failures

`src/domain/errors.ts` exports `DatasetError extends Error` with readonly code
`'stale-revision' | 'historical-conflict'` and an optional diagnostic message.
Consumers narrow caught `unknown` values with `instanceof DatasetError` before
checking `code`; diagnostic wording is not a control-flow identifier.

- Repository revision guards and App's obsolete queued-operation guard raise
  `stale-revision` (default diagnostic: `Stale dataset revision`). The UI disables
  blind Retry and offers localized reload/review guidance. Only this coded failure
  permits a guarded refresh to fall back to an unguarded load.
- Domain edit/activation history guards raise `historical-conflict` (default
  diagnostic: `Historical commitment conflict`). The UI retains review guidance
  without blind Retry; rejected proposals preserve caller and persisted facts.
- Unexpected failures retain their original identity and existing generic failure
  path, even when their message or arbitrary `code` resembles a known conflict.
  Transaction aborts still propagate the original failure and preserve prior data.

`BackupError` remains the separate backup validation/size contract described below.

## Repository and transactional persistence

`src/data/database.ts` exports
`new Repository(name = 'my-goat-journey', optionalInjectedFailure)`.
Repository results are committed schema-2 datasets. IndexedDB uses database
version **1**, object store `dataset`, key `current`.

- Mutations use serialized read-modify-write and resolve only after transaction
  completion. Errors and aborts preserve prior facts.
- Ordinary semantic repeats do not write or advance revision. Each confirmed
  replacement/reset performs one atomic put and advances the local revision,
  even for identical facts.
- Stale expected revisions reject before mutation. UI callers always supply the
  revision, serialize their own draft saves, and invalidate obsolete forms,
  retries and confirmations on external changes.
- BroadcastChannel and focus refresh cannot resurrect old identities or drafts
  after replacement/reset.
- App refresh uses a revision-guarded load to distinguish local lifecycle
  reconciliation from external changes. Its own due transition preserves
  unrelated drafts, dirty state and Retry; a stale read falls back to the normal
  external invalidation path, even for replacement with otherwise identical facts.
  Explicit form Save/Retry uses the latest locally adopted snapshot revision, while
  restore/deletion confirmations remain bound to their reviewed revision.
- A fresh export load stays serialized and may reconcile due lifecycle facts, but
  does not adopt its snapshot or revision as mutation authority. Mutations must
  not gain a newer expected revision while their input still comes from an older,
  unreconciled interface snapshot. A subsequent stale Save retains literal input,
  rejects without writing or blind Retry, and requires explicit reload/review;
  export alone does not discard drafts or reapply them to newer facts.

The optional `revision?` arguments below are expected local revisions; replacement
and reset require `expectedRevision`.

| API | Contract |
|---|---|
| `load(now?, revision?)` | Read or initialize; ordinary initialized loads are readonly; materialize due pending lifecycle facts atomically; an optional expected revision guards both the read snapshot and reconciliation transaction |
| `saveDraft(draft, revision?)` | Structurally validated resumable drafts; incomplete inputs remain drafts |
| `finalize(today, revision?)` | Atomic/idempotent creation of at least one explicitly configured valid habit, retaining all four default pillars |
| `createHabit(input, today, revision?)` | Stable identity, active destination only, no fabricated score |
| `createPillar(name, revision?)` | Stable custom pillar identity, no fabricated score |
| `renamePillar(id, name, revision?)` | Stable identity; literal built-in `nameOverride` or custom `name`; untouched defaults localize |
| `removePillar(id, now, revision?)` | Set `removedOn` only after prospective active/awaiting/future members are moved/archived; retain dated eligibility and records |
| `reactivateHabitInPillar(id, pillarId, now, revision?)` | Atomic valid-active destination membership and strictly-later reactivation; same identity/history, no creation-day opportunity |
| `setDone(habitId, date, done, now, revision?)` | Today/previous eligibility and the same record checked inside the latest transaction |
| `editHabit(habitId, input, now, revision?)` | Prospective definitions and dated membership independently |
| `archiveHabit(habitId, now, revision?)` | Immediate archival or cancellation of a not-yet-due reactivation |
| `reactivateHabit(habitId, now, revision?)` | Cancellable strictly-later new sequence |
| `setSettings(patch, revision?)` | Validated preference patch |
| `grantPermanentUnlock(id, now, revision?)` | Unique exact-ID ownership and first timestamp, no XP |
| `replaceDataset(candidate, expectedRevision, now?)` | Validate before and inside one transaction; exact replacement with local revision; no clear/merge/unlock union |
| `resetDataset(expectedRevision, now?)` | Fresh English defaults; no personal records, draft or ownership; separate confirmed privacy action |
| `close()` | Await and release connection |

## Onboarding drafts and inclusion

`OnboardingGoal extends GoalInput` adds optional `configured?: boolean`;
`OnboardingDraft` adds optional `editingReview?: boolean`.
`src/domain/onboarding.ts` provides:

- `emptyOnboardingDraft()`: four blank all-weekday default-pillar slots with
  explicit false inclusion.
- `normalizeOnboardingDraft(draft | null)`: canonical default-pillar order,
  preserving exact text/masks and review-return intent without mutating input.
- `configuredOnboardingGoals(draft)`: selected `GoalInput` records only; draft
  metadata does not leak into created habits.

### Draft actions and finalization

- Inclusion is explicit and separate from text/weekday validity. Editing goal or
  weekdays retains input but clears inclusion until valid Continue; text alone
  does not include a slot.
- Continue atomically saves current-slot inclusion and the next step. Skip saves
  false inclusion without requiring valid goal/day input. Ordinary Back preserves
  existing decisions; navigation cannot include a skipped draft.
- Review Edit/Add habit persists return intent so reload still returns to review
  after Continue or Back.
- Finalization validates each selected input through `makeHabit`, requires at
  least one, and resolves only after commit. It creates no placeholder,
  occurrence or reward.
- All-skipped UI explains the minimum and focuses Add habit without calling
  `finalize`. Completed datasets have no minimum active-habit requirement;
  archiving the last active habit is allowed.

### Onboarding presentation

- Use the full mountain logo, pillar icons and shared title tokens.
  `GoalFields` accepts optional `errors` and `helpText`; ordinary management forms
  use its default behavior.
- Errors associate with goal/weekday fields and focus the first invalid control.
- Weekday selection order is fixed in the UI; review summaries sort a copy.
  Display does not rewrite literal stored input.
- The first-day note appears only with configured new habits and explains
  optional participation, not extra XP.

## Preferences and Progress view state

`Settings` contains `language` (`en` or `pt`), `reducedMotion` and optional
`progressInterval`. Fresh/reset defaults are English, reduced motion false and
no stored interval preference. There are no reminder or theme settings.

- `Repository.setSettings` preserves omitted fields but rejects explicitly present
  invalid values, including `language: undefined` and `reducedMotion: undefined`.
  `false` is a valid motion choice; rejection preserves all facts and revision.
- Progress defaults to **7d** or the last valid explicitly selected interval:
  `7d`, `1m`, `3m`, `12m`, `24m`.
- `progressIntervalOrDefault` resolves missing/invalid values to `7d`.
  `initialProgressViewFor(settings)` restores the selection before Progress is
  visible.
- Explicit selection commits through `Repository.setSettings` before the view
  changes and resets to the latest window, including a same-value selection.
  Failure retains committed state with Retry and guarded keyboard-focus
  restoration.
- Tabs, filters, arrows, day-detail navigation, dates, window offsets, statistics
  and derived calendar data remain in memory; only `Settings.progressInterval`
  persists as the interval preference.
- Backup parsing retains valid choices, normalizes an invalid present interval
  to `7d`, and leaves an absent preference absent. Replacement restores the
  candidate's preference; full reset clears it.

## Backup and replacement restore

`src/data/backup.ts` exports `MAX_BACKUP_BYTES`, `BackupError` (code `invalid` or
`size`), `validateDataset`, `serializeBackup` and asynchronous `parseBackup`.

### Portable format and validation

- Envelope: `format: 'my-goat-journey-backup'`, `formatVersion: 1`, `exportedAt`
  and portable `dataset`. Current dataset schema is **2**; local revision is
  excluded from exports.
- Strict typed reconstruction validates format/schema versions, dates, stable
  identities/references, historical definitions, memberships, activation periods,
  participation, provenance, exemptions, pending intents, settings, drafts and
  unique ownership. Imported objects are not simply cast to domain types.
- Current and supported legacy dates share strict civil-calendar validation and
  timezone-independent replay. Export, parsing and replacement preserve the dated
  facts even when the current device zone historically skipped one of those days.
  `exportedAt` remains an actual timestamp, not a civil-calendar carrier.
- Incomplete drafts normalize to four ordered default slots, preserving supplied
  text/masks and filling missing blank goals with the standard all-seven-day
  default. Inclusion remains separate from draft content.
- Incomplete profiles with finalized history and completed profiles with drafts
  reject before replacement. No imported score ledger or device notification
  permissions are accepted.

Validation is strict for supported dataset and backup formats. Invalid snapshots
are rejected on export and restore. Stored facts are not silently repaired:
validation never clears tombstones, redistributes history, bypasses checks or
automatically resets data. Restore requires explicit confirmation and atomic
replacement, with validation repeated inside the transaction.

### Complete-file byte policy and safety

- Export and restore share an inclusive **20 MiB** limit for a complete UTF-8 JSON
  file. Export produces a JSON Blob without BOM through one serializer.
- Restore checks the original file size before reading bytes, then decodes strict
  UTF-8. Invalid byte sequences reject as `BackupError('invalid')` rather than
  silently replacing text. An initial UTF-8 BOM is accepted; valid literal Unicode,
  including U+FFFD, is preserved. This does not detect every possible file change.
- Measure actual Blob/file bytes, not text length. The normalized current-schema
  candidate must also fit the same byte policy.
- Oversized exports produce no download, truncation or partial backup. Growth
  beyond the limit does not silently cap/delete records; archival retains history
  and is not backup-size cleanup.
- Restore validates before a separate, revision-bound confirmation. Offering a
  current export does not trigger replacement.
- Confirmed restore revalidates inside one transaction and replaces exactly;
  it never clears then imports, merges diaries or unions unlocks.
- Invalid, oversized, aborted, quota-failed or stale replacement leaves current
  data intact. Full reset is a separate explicitly confirmed deletion action.

## Navigation and shared presentation

### Shared module owners

- Import the English-catalog-derived `Copy` type directly from `src/i18n/copy.ts`
  with a type-only import, not through a form component. Runtime catalogs and
  language selection remain separate.
- `src/features/pillars/pillarName.ts` owns localized default labels and literal
  user names; import it directly rather than through ProgressPage.
- `src/features/habits/habitPresentation.ts` owns `beforeCreation`,
  `displayDefinition`, `displayMembership` and `stateAt`. These read-only identity
  selectors support management and historical UI; they are not domain applicability
  rules and must not authorize commitments or writes.
- `src/presentation/civilDate.ts` owns `displayDate(date, language, short?)` for
  shared full/compact civil-date labels, with explicit UTC carrier formatting.
  Do not use it for actual event timestamps or to derive device-local Today.
- `src/features/habits/formPolicy.ts` owns shared weekday selection/labels,
  literal draft comparison and the existing lightweight `validGoal` form check.
  It does not replace authoritative domain validation. GoalFields owns field
  rendering and interaction, not these shared contracts.

### Destinations and paths

| Destination | Portuguese label | Responsibility |
|---|---|---|
| Today | Hoje | Complete due habits |
| Pillars | Pilares | Manage pillars and habits |
| Journey | Jornada | Present replay-derived adventure progress |
| Progress | Progresso | Explain consistency and history |
| Settings | Ajustes | Preferences, backup/restore and data management; heading Configurações |

- All five bottom destinations are functional. App navigation is state-based,
  not URL deep linking.
- `src/app/routes.ts` defines the `screen`-discriminated `Route` union shared by
  navigation, pending departures and stored return/origin references. Habit
  creation requires its initial pillar; habit review/editing and lifecycle actions
  require a habit ID, with lifecycle actions also requiring `action`. Pillar history
  and removal require a pillar ID. Day details require their date, calendar scope
  and period window. Unrelated screen parameters are excluded.
- The pillar form intentionally omits `pillarId` for creation; editor `move` and
  habit-review `review` remain optional presentation intents. Typed identities do
  not guarantee an entity survives replacement, so runtime entity/date guards and
  obsolete-destination recovery remain necessary.
- The shared site mounts the landing at resolved `prefix` and the app at derived
  `appBase`. Relative manifest and worker scope resolve under the app only.
- The landing never opens the diary or BroadcastChannel. Same-origin paths are
  not storage or security boundaries.
- Fixed bottom navigation uses its measured height to maintain content clearance.
  Subordinate management/history screens have contextual Back controls; the
  Settings main page has no Back control or brand/green banner.

### Headings, layout and focus

- `src/app/page-heading.css` owns primary title/intro typography and spacing for
  Today, Pillars, Your Journey, Progress and Settings. `main-page-header`,
  `page-title` and `page-intro` are presentation markers, not behavior.
- Headings provide focus announcements; dates, earned XP and navigation are
  available in their screen contexts. Today title/date and right-aligned XP wrap
  at enlarged/narrow widths. Journey has bounded content and trail geometry.
  Progress uses compact, responsive calendar/month cards with readable labels;
  colors, date ownership, statistics and date interactions follow the calendar
  contracts below.
- `usePageHeadingFocus.ts` gives route headings announcement focus with
  `tabIndex={-1}`, outside ordinary Tab navigation. Capture listeners distinguish
  actual keyboard entry from initial programmatic, pointer or touch entry.
- Only the focused route heading receives `data-route-heading`;
  `data-keyboard-focus` marks keyboard entry and is removed by pointer/touch.
  Scoped CSS suppresses the static-title ring only for non-keyboard entry and
  shows the brown **3px** outline for keyboard entry.
- Interactive controls have visible focus, modals contain focus and return paths
  restore origin focus. Do not globally remove outlines, blur headings or use
  timing workarounds.

## Today checklist and feedback

- Native goal/date-named checkboxes communicate binary completion, not partial
  progress. Save commits before completion feedback or replayed progression is
  shown. Errors and Retry remain visible.
- Success announcements are visually clipped, polite and atomic, only after
  committed checklist changes. Successful Today checks append their actual
  locale-formatted base-plus-milestone XP to this existing single announcement;
  the daily recognition card and floating visual are not additional live regions.
- A successful user-initiated Today check creates an ephemeral action ID with its
  habit/date and reward from `calculateProgress(committedState, today).awards`.
  `committedCompletionXp` rejects an already-completed before-state or a date
  other than the current local day. It never increments XP or uses an unrelated
  total-XP change as the completion reward.
- `XpFeedback` shows decorative `+XX XP` near that checkbox, out of layout flow
  and pointer-inert, for approximately 700ms with an 8px upward fade. OS or app
  reduced motion leaves it stationary until removal. Action identity, timer
  cleanup and the synchronous explicit-commit guard prevent replay/duplicate writes.
  Background refresh reads do not take this guard: enabled checks and Retry queue
  behind them through the existing repository queue rather than being dropped.
  No feedback is created by initial load, rerender, reload, external/imported
  changes, uncheck or historical correction. Failed saves retain prior facts and
  visible Retry, with no reward feedback; a successful retry may show it once.
- Informational pillar **Completed today** badges require at least one required
  habit and a complete pillar summary; optional-only/empty pillars get no badge.
- Reserved wrapping space prevents layout movement without placing hidden status
  text in the accessibility tree.
- `TodayHeader` keeps localized title/date and committed total XP in a compact
  right-aligned badge, with the localized day motto below. A separate compact
  progress card shows **Your progress today / Seu progresso de hoje**, readable
  required-only completed/total count, and a supplementary decorative circle.
  The circle uses only `requiredDone / required`, and is omitted when there are
  no required habits (retain explicit no-required context, never a 0/0 success).
- Global completed-day recognition derives solely from the App-supplied daily
  `AgendaSummary.status === 'complete'`. The same card replaces the circle with
  the decorative shared Lucide medal, promotes **Good job! All habits completed
  today. / Muito bem! Todos os hábitos de hoje concluídos.**, and keeps the
  required-only count less prominent. It adds no extra motivational line to an
  incomplete day.
- A completed optional-only eligible day may receive global recognition with
  secondary no-required-goals context. Neutral/incomplete states use the count
  presentation. Corrections and local-day refresh recalculate recognition without
  storage, rewards, unlocks, dialogs or animations.
- Today alone consumes the shared `--field-*` paper/card/text/border/action tokens.
  Existing pillar identity accents remain unchanged: muted purple (Mind), burgundy
  (Body), warm brown (Nutrition), muted blue (Hygiene), and the stable custom
  neutral. Shared `--pillar-icon-background` / `--pillar-icon-color` tokens give
  Today summaries, Progress habit/pillar headers and Pillars management headers
  soft identity-colored rounded squares with contrasting darker icons. Custom
  surfaces derive from the existing neutral accent without changing saved facts.
  Containers are 36px (Today/management) or 40px (Progress), with 21px/22px
  decorative glyphs and 11px corners, independent of completion state.
  Colored Today group headers retain their solid identity backgrounds and light
  text; their icons use a lighter translucent square, not the neutral-surface pair.
  Names/counts wrap when needed, and enlarged narrow management names occupy a
  full-width row below the icon/controls. Neutral habit/card surfaces, completion
  badges, typography and other destinations' non-icon styling remain unchanged.
- Informational summaries use two columns where space permits, with long names
  spanning the grid and enlarged narrow layouts using one column. Icon/name and
  required-only count share the top row; current/best streaks follow, then the
  completion badge or no-scheduled/optional/conditional context. No redundant
  progress bars, navigation affordances or 0/0 badges are added.
- Compact solid-color checklist group headers pair icon/name on the left with
  right-aligned completion information on the same row where space permits:
  **0/2 completed / 0/2 concluídos**, or a decorative check and **2/2 completed
  today / 2/2 concluídos hoje**. Always put the count first; use singular
  **0/1 concluído / 1/1 concluído hoje** when the required total is one. Omit the redundant In progress label. Light text/icons
  maintain contrast on the actual header background; long names, narrow layouts
  and enlarged text wrap naturally. There is no rule below the colored header.
- Full wrapping 1rem goal titles and a stable 44px native-checkbox column remain side by side,
  including enlarged text. The full goal names the control and the localized
  assigned date is its accessible description. Streaks use a compact secondary
  row; the actual next-table bonus has a separate singular/plural localized line
  (**Next bonus: +30 XP in 3 more consecutive completions.**, for example).
  Pending and completed habits share the same light neutral surface; completion
  remains visible in the native green checked control, without title strikethrough
  or opacity reduction. The 44px target extends into the whitespace beside the
  first metadata line, with reserved text clearance, so it does not inflate the
  goal-to-streak gap. Next-bonus copy follows immediately below with readable
  spacing. Separators occur only between habits, not between goal/details.
  Existing optional-first-day and other eligibility context remains explicit.

## Pillars management and historical review

### List by pillar

- Stable-ID groups expand independently and start collapsed on fresh entry.
  Child returns preserve session expansion and scroll.
- Save/Create reveals the changed row in an expanded destination or the closed
  destination header without expanding it. New pillars remain collapsed.
- Direct Edit, contextual `+ Add habit` and localized record-identifying
  three-dot action controls are available. Separate up/down-chevron expansion
  does not change when action controls are clicked.
- Habit actions are **Move / Review / Archive**. Pillar actions are
  **Rename / Streaks / Remove**; contextual Add habit belongs only in the card
  footer.
- Saving a Rename form with its exact initial text finishes without persistence
  and restores origin focus, including after editing and reverting. Default pillars
  without `nameOverride` keep localizing; existing overrides and custom names stay
  literal. Only blank-name validation trims whitespace; stored names are unchanged.
- The Streaks action is labeled **View pillar streaks** and opens the pillar's
  streak/history view with its pillar name as the heading.
- The history header retains pillar identity and real current/best streaks but
  omits daily status/counts; each historical day retains its own status/counts.

### Action surfaces and child routes

- Native top-layer anchored desktop popovers and narrow modal sheets preserve
  underlying geometry. Only one action surface opens globally.
- Close, outside click and Escape restore trigger focus; command selection keeps
  destination focus. Visual-viewport and bottom-navigation-aware positioning
  handles enlarged/short layouts.
- Native sheet cancel/close uses the same idempotent dismissal, synchronizing
  expanded state and restoring prior document scroll-lock styles. Queued close
  events from cleanup cannot dismiss a reopened surface.
- Mobile action panels include a full wrapping goal/pillar context heading.
- Dedicated Archived, lifecycle confirmations, pillar forms/removal and direct
  editors retain Pillars navigation, session expansion and independent
  scroll/focus origins. Pending definition/membership dates stay explicit.
- Removed-source reactivation offers valid active destinations from both
  Archived and historical review.
- Quiet localized contextual Back appears above management-child titles and
  preserves the actual origin and unsaved-change confirmation.

### Review completions

- Use a compact title with full-goal context, dated correction/history rows and
  secondary streak, XP and change disclosures.
- Dedicated management-origin review avoids duplicate commands. Progress-origin
  review exposes edit/lifecycle controls in a secondary disclosure.
- Native goal/date-named checkboxes are limited to eligible correction dates;
  older rows remain read-only.
- Back preserves the originating view, filter, scroll and focus.

## Progress calendars and day details

Progress is **History through yesterday. Streaks include today.** It defaults to
active habits, with scoped expandable Filters and a summary.

### Global XP and visual hierarchy

- Directly below the primary heading/intro, `GlobalXpProgress` renders the App's
  committed `ProgressSnapshot`, before Habits/Pillars and interval/navigation.
  It never projects XP from filtered habits or the selected historical window.
- Current level and secondary **total XP / next-level total threshold XP** align
  left; the next level and decorative native 28px rocket align right. The next
  total threshold is `totalXp + levelProgress.remainingXp`, not a separate rule.
- The thin neutral-track/solid-green native progress bar uses `earnedXp` over
  `requiredXp` from `levelProgress`. Thus 420 / 500 XP displays 20%, not 84%.
  Its localized name/value text explains current-level progress and remaining XP;
  the visible sentence explicitly names the remaining XP and destination level.
- The compact, unframed block wraps naturally and has no navigation action.
  Committed completion/correction/replacement refreshes it with the App snapshot;
  tabs, filters, interval choices and historical arrows do not change its scope.
- Collapsed filters share a wrapping row with the applied summary. A single
  shared calendar legend precedes near-white cards; tinted pillar icons retain
  identity without coloring entire habit cards. Compact metric grids align period
  counts/current/best streaks and stack at narrow enlarged-text widths.
- Keep modest 4px legend/scope-note margins and an 8px first-card gap. Wrapped
  legends/filter summaries retain their font sizes and native control targets.
  XP and interval-button styling are independent of these spacing refinements.
- Habit-card headers contain the icon, full interactive goal and secondary
  pillar/schedule context, without a tracking-date line. The existing habit
  detail's secondary disclosure retains a localized read-only **Tracking start**
  date. Use `trackingStart(data, {kind:'habit', id})`: currently the original
  `createdOn`, not the first required occurrence, current activation or first
  success. Pillar/aggregate tracking labels and all calendar boundaries stay
  unchanged. Bottom clearance still uses the measured fixed-navigation height,
  including its safe-area padding.

### Calendar ownership and states

`calendarCards(data, scopes, window)` projects each date once for all requested
cards, sharing dated grouping only within that call; `calendarDays` is its
single-scope wrapper. ProgressPage creates the range projection per render and
passes days to ConsistencyCard rather than retaining per-card dataset caches.
History views also rebuild their operation contexts per render. App's existing
progress-snapshot memo belongs to committed Repository results (fresh readback
objects) and the current local day; no index is retained in that memo.

- Shared intervals are `7d` / `1m` / `3m` / `12m` / `24m`. `7d` has seven
  consecutive local dates and seven-day steps. Monthly groups use non-overlapping
  calendar-month boundaries.
- Each month owns its Monday-first weekday axis, week rows and inert alignment
  padding, never neighboring-month dates. `1m`/`3m` show day numbers;
  `12m`/`24m` use compact separate months.
- Today and future cells are blank and noninteractive. Before-tracking dates use
  a gray hatch and exact stored tracking-start context. Pillar/all-pillar starts
  use earliest historical participation, not today's newest member.
- Pre-tracking dates and archive gaps create neither failures nor denominator
  credit. Habit states are complete/incomplete/unscheduled; aggregate states add
  partial, without fractional complete-day percentage credit.
- Zero eligibility is an explanatory em dash, not 0/0 success.

### Date interaction and return context

- Native date buttons support pointer, Enter/Space, roving arrows/Home/End,
  date/state announcements and visible focus. Traversal skips inactive gaps while
  keeping disconnected history blocks reachable. There is no manual date input.
- Day details use historical goals, memberships and lifecycle state. Corrections
  use the same eligible Repository operation; older rows stay read-only.
- Day arrows stay before Today and within the selected period.
- Back restores the exact tab, interval/window, filter, scroll and origin focus.
  Expired focus announcements clear.

## Habit forms and unsaved navigation

### Draft comparison and saves

- Creation/editing compares exact goal text and pillar identity plus weekday sets
  against initially loaded values. Whitespace remains literal domain content.
- Reverting every value clears dirtiness. A saved pending definition is the clean
  editing baseline, not an unsaved change.
- Failed validation/persistence retains the draft. Successful commit clears it
  through accepted navigation. Saving identical values leaves without a write
  and cannot rebase retained future facts.
- The App guard captures the first requested destination and fresh-entry/return
  intent, blocks repeated requests while pending, and defers Settings-origin
  changes until acceptance.

### Fields and effective-date guidance

- Equal weekday controls use readable seven-column or centered **4+3** layouts,
  at least **44px** targets and chronological localized labels.
- Every day's pressed state derives from all seven selected weekdays. Clicking
  it when selected is a no-op; manual all-seven selection restores that state.
  Draft edits do not alter the saved current schedule.
- Editing is ordered as contextual Back/title, one **Habit / Hábito** goal field,
  pillar, weekdays, useful note and actions. Creation uses its prompt/order.
  There is no unconditional Today summary.
- Only actual goal/schedule differences show next-date edit guidance. Conditional
  draft notes use `previewHabitEdit.effectiveFrom`; saved pending notes without
  draft changes use the actual stored version date.
- Only affected current goal/schedule values follow **Until then**. If a pillar-only
  draft on a revisited date advances a saved future definition, wording uses the
  command preview date rather than promising its former stored date.
- Edit validation associates specific localized errors with the goal and weekday
  controls and focuses the first invalid field in form order. Invalid submission
  does not write; corrections update field errors without changing Every day semantics.
- Conditional and credited-source move explanations use their separate
  domain-derived dates, not the definition boundary.
- Goal and pillar-name interpolation treats user text literally, including dollar
  replacement patterns, in visible text and accessible names; stored values and
  React text escaping are unchanged.

### DiscardDialog

- `DiscardDialog` portals a native modal to the top layer, with localized
  announced title/description, initial **Keep editing** focus and trapped keyboard
  focus.
- Its opaque Field Notes surface, dimmed backdrop and scroll lock preserve the
  underlying form geometry; background destinations are inert.
- Keep editing, Escape, backdrop and native close preserve the draft and restore
  editing focus, text selection and scroll.
- Discard closes the dialog and accepts the captured destination without a
  Repository write.
- Visual-viewport bounds/events and internal focused-entry reveal support
  constrained layouts. React StrictMode's queued cleanup close cannot dismiss
  a reopened dialog.

## Journey presentation and ownership

- Journey uses presentation-only five-sign stretches sharing boundaries:
  **1–5, 5–9, 9–13, onward**, with no final level cap.
- Browsing, selecting signs and **My position** never write records or rewards.
  Reached/current/upcoming signs and localized informational details expose
  thresholds and exact help without changing XP.
- The true position follows native SVG arc length on the applicable Bézier
  segment. The actual current stretch owns a partial segment, so browsing the
  previous shared boundary does not place the marker falsely at its endpoint.
- Replay-derived domain XP/level changes drive the map. Catalog/avatar mapping
  and automatic unlock mapping remain deferred; reminders are also deferred.
  Browsing does not grant permanent ownership.

## Settings and update-controller boundary

Settings groups actions into flat **Preferences**, **Backup & restore** and
**Data management** sections. It provides native downloads/file input and explicit
replacement/deletion confirmations with Cancel and focus restoration. Portable
private backups, revision-bound atomic replacement, rollback on invalid/stale/
failed operations and separately confirmed reset follow the contracts above.
After successful replacement with a completed profile, Settings' stable heading
receives focus once after the form remount, without scrolling. Recovery is bound
to that operation/route, not ordinary renders, language changes or refreshes.
Cancellation and invalid-file feedback retain their existing focus behavior.

Feedback retains semantic message identifiers, translated with the current
language during rendering. Language changes retain and translate existing
alerts/statuses, including operations that finish after the change, without
remounting Settings. Backup replacement remains subject to the existing revision
checks.

`src/pwa/update.ts` exports `createUpdateController(UpdateOptions)` and
`UpdateSnapshot` (`available`, `applying`, `checking`, `supported`, `failed`,
optional `checkStatus`). The controller exposes `start`, `check(manual?)`,
`accept`, `enter`, `interaction`, `resume`, `dispose` and a snapshot getter.

- Production registration uses the configured app base/scope and
  `updateViaCache: none`. Development never registers a production worker.
- Online discovery/download is quiet. Adoption is restricted to pristine new
  documents or genuine clean resumed sessions, excluding first installation.
  Merely finishing a save does not reopen eligibility.
- `canEnter` may tolerate only tagged lifecycle refresh reads. `canAccept` remains
  strict after synchronous inert locking and queue drain. New interaction or
  unsafe resume closes eligibility.
- Exact-worker `ACTIVATE_WHEN_ALONE` conservatively requires the requesting source
  to be the sole in-scope window, including uncontrolled clients.
- There is no routine Update/Later UI, unconditional claim or `controllerchange`
  reload. Settings checking/pending fallback is localized. Automatic transitions
  never invoke `DiscardDialog`.
- `beginOperation` keeps backup leases alive through disposal; `blockUpdate`
  protects visible confirmations.
- Per-file integrity, per-document shell assignments and a shared app/base-scoped
  Web Lock guard installation/publication and cleanup. Metadata failure retains
  verified files with fail-closed/reopen limits defined in
  [PWA reliability](pwa-reliability.md).
- Worker installation has one 12,000 ms total transfer budget, including headers,
  body consumption and awaited shell writes, independent of the controller's
  15,000 ms feedback timeout. The worker aborts transfers, awaits in-flight work
  and owned-cache cleanup under the lifecycle lock, then rejects without candidate
  publication. A retained rollback shell is not deleted or overwritten. Navigation
  may wait for cancellation/cleanup; uncancellable storage and scheduling are not
  universally time-bounded. Ordinary later checks can retry; no tight retry loop
  is introduced. See [atomic installation](pwa-reliability.md#atomic-verified-installation).
- Newly owned shell installation durably writes an app/base-scoped
  `installing/<version>` ownership marker before shell creation/mutation, under
  the shared lifecycle Web Lock. Retained same-version rollback shells never
  receive scratch ownership. Before new creation of an absent shell, remove stale
  retirement evidence; an absent shell still named active/installed denies
  recreation, rather than certifying new incomplete bytes with stale pointers.
  Locked installation and active-worker cleanup retry
  recovery without terminated-worker memory or leases. Only exact ownership
  evidence plus readable active/installed/client metadata and no reachable or
  previously completed version authorize deletion; all durable/pending assignments
  and unknown clients remain conservative. Delete cache before marker. Publish
  `installed` before best-effort marker removal, with predecessor retirement before
  pointer replacement, so successful waiting/rollback shells cannot become scratch.
  An unresolved same-version marker denies reuse. Fail required ownership writes
  before shell mutation and retain retry evidence after deletion failure.
- A clean first-install namespace records `X-App-Shell-Phase: initial` on its
  ownership marker only with exact registration scope, no active/waiting worker,
  empty app/base metadata, no other app/base caches and successful client enumeration.
  Restart recovery requires that positive tag and the same exclusive namespace,
  both pointers absent and no assignments/retirement or ambiguous clients/state.
  The tag proves a new never-published incarnation, not controller-null for every
  window; assignments and namespace evidence still block this exception.
  After complete verified transfer, a required atomic marker replacement to phase
  `verified` precedes publication, permanently revoking initial deletion authority.
  Same-version retry deletes incomplete initial bytes before rebuilding, or retains
  a durably verified shell and repeats all integrity downloads before publication.
  Missing pointers alone, untagged older orphans and metadata/quota fences remain
  conservative. See [interrupted recovery](pwa-reliability.md#interrupted-installation-recovery).
- This subsystem never stores, clears or replaces domain facts.

Injected clocks, failure hooks and native abort/quota interceptions are isolated
verification mechanisms, not user settings. See the maintained
[device coverage and limitations](pwa-reliability.md#device-coverage-and-limitations)
for browser installation requirements, storage limitations and physical-device
regression procedures.
