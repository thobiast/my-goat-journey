# My GOAT Journey — Product Specification

This is the authoritative product specification. [Interfaces](interfaces.md) defines
module and UI contracts, [Development](development.md) documents commands and test
prerequisites, and [PWA reliability](pwa-reliability.md) covers installation, updates
and device verification. Requirements are not claims of test execution.

## 1. Context

My GOAT Journey is a local-first habit tracker for anyone who wants to build consistent routines and track their progress. A person may begin a chosen activity enthusiastically, perform it a few times, and then find it difficult to sustain. The app supports choosing commitments and understanding progress without treating interruptions as personal failures.

The application should support activities outside the phone, help users understand their consistency, and recognize their return after interruptions. Its experience combines a lightweight personal adventure with goals, levels, visible streaks and progressively larger rewards at consistency milestones. Cosmetic/avatar personalization and an achievement catalog are future work.

The application ships with Mind, Body, Nutrition, and Hygiene as its default pillars. Users can create additional pillars and maintain multiple habits within any pillar.

Success is not defined as maximizing screen time. It means supporting the development and repeated performance of chosen habits without presenting activity records as measurements of intelligence, health, personal worth, or complete personal development.

### 1.1. Current requirements overview

| Area | Requirement |
|---|---|
| Individual use | Local-first habit tracking with supportive, non-punitive feedback. |
| Language | English-default interface with Portuguese support; English technical materials. |
| Organization | Four default pillars, custom pillars and multiple habits per pillar. |
| Setup | At least one explicitly configured habit in total; default pillars may be skipped. |
| Habits | One goal-text field and selected weekdays; full binary completion, without partial progress. |
| Calendar | Device-local dates, times and timezone; creation-day participation is optional. |
| History | Stable identities, dated definitions/membership, bounded corrections and retained archival history. |
| Progression | Habit milestone XP, replay-derived levels and habit/pillar/daily streaks. |
| Data | Transactional IndexedDB persistence; private export and confirmed replacement-only restore. |
| Offline | Production app-shell caching with integrity, coherent versions and guarded updates. |
| Execution | Rootless Podman locally, including production; shared native npm checks on exact-Node GitHub-hosted CI. |

The product narrative is a personal journey, not a competition. No trademark or
name-availability review is claimed.

## 2. Objective and boundaries

### Objective

Provide a local-first PWA that lets users choose and track habits across default and custom pillars, with a lightweight adventure recognizing completed commitments and consistency. Completion is self-reported. The app provides no clinical assessment or demonstrated therapeutic efficacy.

### Interpretation boundaries

- Completion is self-reported; the app does not verify that the activity actually happened.
- Representing the default pillars does not amount to a complete health or development assessment.
- The product does not promise habit formation within a fixed number of days.
- The XP table, levels, streak design and future unlocks are product parameters, not validated scientific protocols.
- The application does not prescribe exercise, nutrition, clinical hygiene, or psychological treatment.

## 3. Language and localization

### 3.1. User interface

- English is the first-run default, even when the device language is Portuguese.
- Users can select Brazilian Portuguese during onboarding or in Settings.
- Persist the selected interface language locally and support it offline.
- Localize navigation, settings, onboarding, system-provided pillar labels, streak explanations, errors, accessibility labels and other system-generated user-facing text. Future reminders and achievements require the same localization coverage.
- Switching language must not change schedules, local-day boundaries, completion records, pillar membership, streaks, or XP.
- User-entered goal text and custom pillar names remain as entered; do not automatically translate them. The habit's displayed title uses that same goal text, not a separately translated or generated name.
- Keep stable internal identifiers independent of translated labels.
- The brand name remains My GOAT Journey in both interface languages.

Available in English and Brazilian Portuguese.

### 3.2. Project materials

All project-authored mini-specs, source-code comments, identifiers, test descriptions, technical documentation, and development notes must be in English. Portuguese may appear inside the Portuguese localization resources or deliberately documented translation examples. User-authored content can naturally be in either language or another language chosen by the user.

### 3.3. Public landing page

The static landing supports English (`en`) and Brazilian Portuguese (`pt-BR`).
English is the first-visit default regardless of browser language. Adjacent native
EN/PT buttons, named English and Português with `aria-pressed`, save an explicit choice in the landing-only
`my-goat-journey.landing.language` localStorage key; invalid or inaccessible storage
falls back to English. This preference never reads or changes application settings
or diary records. Language changes update the document language, title, description,
copy and accessible names without resetting demonstration state or moving focus.

The landing also supports Light and Graphite Dark appearance with visible native
sun/moon buttons named Light theme / Dark theme (Tema claro / Tema escuro), 44px
targets and `aria-pressed` reflecting the resolved theme. Its synchronous local
head script resolves appearance before CSS. It shares only the existing browser-local
`my-goat-journey:appearance:<appBase>` presentation key with the corresponding app
base, including root and nested deployment prefixes. This is not a diary setting
or permission to read app language, IndexedDB, channels or worker state.
Absent, invalid or inaccessible storage follows live OS appearance without writing;
either button stores an explicit choice even if already resolved. Failed persistence
keeps the choice for the current page session. Relevant localStorage events
synchronize appearance; removal, clear or System selected in app Settings restores
OS following. Other keys/bases and sessionStorage events do not affect it.
The bilingual `licenses.html` remains light-only without appearance controls.

The landing shows four habit ideas and twelve more in a collapsed native disclosure.
They are illustrative choices, not preselected real habits. Selecting one changes
the isolated Today example. Checklist, completion counts and journey XP agree;
fictional interactions stay in memory and reset on reload. The Today and Journey
tour views share this example; Progress explicitly presents a separate fictional
reading history and is the initially selected tour view. The Today previews and all
habit ideas use the app’s canonical pillar icons. Completed rows retain the neutral
background and normal text, using the checked box as the indicator. The monthly
calendar distinguishes completed, missed,
before-tracking and future days. No real app is mounted for a preview.

The landing explains no-account use, device-local records, user-controlled backup
exports, confirmed replacement restore, local-data loss risks and production offline
preparation. All application actions use the deployment-aware relative `app/`
entry. The shared publication artifact and app-only worker boundary remain unchanged.
The header includes a secondary GitHub repository link beside the language controls,
with a localized accessible name and an icon-only treatment on narrow screens.
The footer links only to the bilingual `licenses.html` page; project/original-asset
licensing explanations live there, with exact official license/notices text and
direct links to the canonical distributed files. Navigation and explanatory labels
are localized; official legal texts remain in their original language. Each hero
and tour demonstration has one concise localized sample-data caption.

## 4. Audience, autonomy, and extensible pillars

The experience is individual: users choose habits and track their own progress,
without a dashboard for other people to monitor them. Accessibility, privacy and
user control are requirements.

### 4.1. Default pillars

| Stable default identifier | English label | Portuguese label | Product role | Illustrative example, not a prescription |
|---|---|---|---|---|
| `mind` | Mind | Mente | Learning, attention, and creativity. | Read ten pages on selected days. |
| `body` | Body | Corpo | Movement and physical activity. | Complete a planned gym workout on Monday, Wednesday, and Friday. |
| `nutrition` | Nutrition | Alimentação | Food-related practices compatible with the user's circumstances. | Include fruit in the routine on selected days. |
| `hygiene` | Hygiene | Higiene | Hygiene and personal-care routines. | Complete a chosen personal-hygiene routine. |

Onboarding introduces Mind, Body, Nutrition, and Hygiene in a guided four-pillar sequence. **At least one valid habit in total is required to finish onboarding; a habit in every pillar is not required.** Users can choose Continue to validate and configure the current habit, or Skip for now / Pular por enquanto to advance without a goal or selected weekdays. All four pillars remain available after setup, including skipped/empty pillars; users can add habits later through Pillars.

Draft input and the explicit configured/skipped decision are separate. Back/forward navigation and reload preserve goal text, weekdays, language, and review-edit context. Skipping must never submit a partially filled draft; revisiting preserves its text for editing, but it is included only after explicit Continue with valid input. Final review distinguishes configured habits from No habit added / Nenhum hábito adicionado, with Edit or Add habit actions. If every pillar is skipped, show a localized explanation and an accessible return path, and reject finalization without creating habits, occurrences, XP or streak credit. Final confirmation atomically creates only the configured valid habits and marks setup complete, with duplicate/retry protection.

This minimum applies only to finishing onboarding. Existing completed users are not sent through setup again, and established users can archive their last active habit. Empty default and custom pillars remain neutral, add no daily requirement and cause no missed day. Empty pillars do not alter first-day participation, scheduling, correction, lifecycle or progression rules.

Examples describe user-chosen goals, not universal exercise, nutrition or personal-care prescriptions.

### 4.2. Custom pillars and multiple habits

- Users can add a pillar by providing a name.
- Each custom pillar receives a stable identifier separate from its display name.
- Any pillar can contain multiple habits.
- Every habit belongs to one pillar and retains its own goal, frequency, completion records, and streak.
- Default and custom pillars follow the same scheduling and streak rules.
- Views, storage, streak calculations, and exports must not assume an exhaustive list of four pillars or one habit per pillar.
- An empty default or custom pillar creates no obligation, earns no streak credit, and causes no missed day. A pillar becomes eligible when at least one habit is required that day or an optional first-day occurrence is completed.
- Adding a pillar or habit must not retroactively impose new obligations on completed historical days. An explicitly permitted correction can still change derived historical results.

New-habit participation, target-pillar participation after a move, archival, and reactivation follow section 6. Preserve historical pillar membership rather than recalculating the past from today's membership alone. A completion already credited today remains assigned to its original pillar; the move applies at the next scheduled occurrence.

### 4.3. Pillar management

- Renaming preserves stable identifiers. Untouched built-in names localize;
  user overrides and custom names remain literal.
- Removal retains a tombstone and historical associations, never cascade deletion.
  Move or archive all prospective active, awaiting and future members first.
  Built-in pillars follow the same prerequisites without an additional prohibition.
- Historical and current credited participation survives removal. An archived habit
  whose source was removed can reactivate atomically into a valid active destination.
  Backup validation uses each stored removal date, not the importing device clock.

## 5. Product scope

### Current capabilities and future boundaries

- Reproducible Podman-based development, build, test, and production images with no additional host software requirements.
- English-default onboarding with a Portuguese language option.
- The four default pillars, custom pillar creation, and multiple habits per pillar.
- A single goal-text field per habit, also used as its display title.
- Per-habit weekday selection.
- A Today screen containing scheduled missions and clearly labeled optional creation-day opportunities, grouped by pillar.
- Binary completion recording.
- Check/uncheck corrections limited to today and the immediately preceding eligible occurrence before today, with derived XP and streak recalculation.
- Archival instead of hard deletion when pausing or removing a habit.
- Immediate exemption of an unfinished archival-day occurrence and scheduled reactivation with a new habit streak.
- Visible current and best streaks for each habit and pillar.
- An overall streak based on the daily agenda.
- Accumulated XP, a general level, and an adventure map.
- Consistency milestone rewards through 365 consecutive commitments.
- Repeatable XP bonuses after rebuilding a streak and permanent unique ownership persistence. Achievement definitions, a cosmetic catalog and automatic unlock mapping remain deferred; persistence is not a shipped catalog.
- History and separate progress views by pillar.
- Habit completion review and prospective goal adjustments; no clinical guidance or additional review program.
- Optional reminders are future work; no delivery API, subscriptions or notifications are shipped.
- Production offline core tracking after successful verified shell installation and worker-controlled reopening in a supported secure context; development/first load alone does not prove offline readiness.
- Local storage, export, validated replacement-only backup restoration, and a separate full-data deletion action.
- Accessibility and reduced-motion support.

### Out of scope

- Installing Node.js, npm, package-manager tools, browser-test dependencies, Compose providers, or any other project software on the local development host. The GitHub-hosted application-CI exception is limited to its disposable runner.
- Using a host-native development server or a development server as the production-serving process.
- Social networks, public leaderboards, competition, and group features.
- Third-party monitoring dashboards.
- Chatbots, virtual therapists, diagnoses, or clinical recommendations.
- Wearables, sensors, cameras, or photographic proof of completion.
- Advertising, purchases, monetary rewards, or random rewards.
- Calorie counting, weight tracking, weight-loss goals, or exercise as compensation for food.
- User accounts and cross-device synchronization.
- A complex RPG, battles, extensive inventory management, or extra in-app tasks designed to prolong sessions.

## 6. Habit definition and commitment

### 6.1. One goal field, not a name-and-goal pair

The user enters one goal, such as **Read 10 pages**. That same text is the habit's display title in cards, lists, and detail views. Do not ask for both a behavior name such as “Read” and a goal such as “Read 10 pages.”

There is no separate required or optional habit-name field, short-name field, or automatically generated habit name. Keep one editable source of user-facing text for the goal. The term “habit” still describes the tracked entity; removing a form field does not remove its identity or history.

### 6.2. Creation and editing form

| User-facing field | Example or behavior |
|---|---|
| Pillar | Mind; preselected if creation starts inside a pillar, and selectable when starting from a general entry point. |
| Goal | Read 10 pages; this is the only habit description/title input. |
| Frequency | Every day or selected weekdays. |

Creation prompt: **What do you want to do?**

Goal guidance should ask for a clear commitment that can be marked as done; onboarding and management may use contextual examples.

The Portuguese interface localizes the prompt and help text, but preserves the user's goal text exactly as entered. Do not require the user to re-enter or separately confirm a generated title.

A number is not mandatory. **Complete my gym workout** is also a valid kind of goal because it describes a commitment that the user can mark as fully done. Do not introduce mandatory quantity/unit inputs or a partial-progress tracker to support the single-field design.

### 6.3. Internal habit identity and data

Each habit contains:

1. A stable identifier.
2. A pillar identifier.
3. A single goal-text value, such as “Read 10 pages,” used for both the commitment and its display title.
4. Selected weekdays.
5. The device-local creation date, its optional initial opportunity, and the effective start of regular scheduled obligations.

The stable identifier, not the goal text, is the identity of the habit. Editing the goal must not create a replacement habit, erase its completion history, reset its current or best streak, or remove its accumulated rewards. Store effective goal versions so historical records retain the goal that applied to their scheduled dates.

The interface must offer all seven weekdays and an “Every day” shortcut. At least one weekday must be selected.

A commitment applies to the goal on each scheduled day, not to a mandatory time. The user may perform the activity in one session or across the day, but the application receives only the final confirmation that the whole goal was achieved.

There is no partial-quantity entry, partial goal-completion bar, or minimum-version alternative. XP bars and adventure progress remain allowed because they do not represent partial completion of a habit goal.

### 6.4. Changes

Goal and frequency changes take effect on the next device-local date and do not rewrite previous commitments. The current mission card uses the goal version applicable today; the editor can show a pending change and its effective date. Do not display a future goal as though it were already today's requirement. A later device-timezone change must not silently relabel that stored historical decision.

In the deferred reminder design, a reminder time is optional and does not become the activity's required execution time; the current editor has no reminder controls.

### 6.5. Optional first day and participation in a pillar

The creation date is an optional first opportunity, even when the habit is created close to midnight. The user may immediately mark it as Done if the goal has already been achieved.

- A creation-day completion counts toward the habit's streak, its normal XP, and participation in the pillar for that day.
- Leaving the creation-day opportunity unchecked does not count as a missed first commitment and does not break the pillar's streak.
- The overall streak uses the same eligibility rule, so an unchecked optional new habit cannot silently spoil an otherwise complete day.
- If there is no creation-day completion, regular obligations start at the next selected-weekday occurrence strictly after the creation date, not retroactively on the creation date.
- If there is a creation-day completion, the next selected-weekday occurrence continues that habit's sequence normally.
- Treat the creation-day opportunity as an explicit one-time eligible occurrence; this is the initial opt-in exception to the normal rule that extra, unscheduled activity earns no XP. Later days follow the selected weekdays.
- A pillar or overall day still receives at most one streak step, even if several newly added habits are completed that day.
- If a creation-day completion is unchecked within the allowed correction window, recalculate its XP and streak contribution and return that initial opportunity to optional, uncompleted status. Do not convert it into a newly missed obligation for the pillar.

For an addition or a move before today's completion, use this target-participation rule: participate in the destination on that local date if the eligible occurrence is completed, otherwise at the next scheduled occurrence. A move is not a new habit and must not reset its identity or individual streak, change its weekday schedule, or independently award another copy of its completion XP. Moving alone does not create an extra unscheduled completion.

If today's occurrence has already been completed and credited to a pillar, keep that occurrence assigned to the original pillar. Its completion, XP, and contribution to that pillar's day are preserved; the destination becomes effective at the next scheduled occurrence strictly after the move date. Show the effective date rather than presenting the already completed mission under the destination prematurely.

That current-day occurrence keeps its original pillar assignment even if its Done state is later corrected within the permitted window; recalculate its contribution in the original pillar, not both pillars. For a move before completion, the source no longer acquires a second obligation for an occurrence assigned to the destination. Past dates retain their recorded assignments. A habit/date occurrence must never be copied into two independently rewarded events.

A pre-credit scheduled move keeps the habit/daily obligation even when destination
pillar participation is conditional on completion. Definitions and memberships are
independent effective timelines; historical failures and dated assignments must
not be reconstructed from today's pillar.

### 6.6. Pause and removal mean archival

Both actions retain the habit as archived rather than permanently deleting it. Keep its stable identifier, goal and schedule history, occurrence records, historical pillar membership, and earned-reward history.

Archived habits do not generate new future scheduled obligations or reminders. Archival preserves earned XP, the level derived from that XP, badges, and all previously unlocked visual items. Do not revoke a reward merely because the habit that contributed to it was archived. Archival must not make historical failures disappear. Archived records remain available in history or an archived-habits view.

Archival takes effect immediately:

- If today's occurrence is unfinished, remove its requirement for the rest of today. Keep it not Done, grant no completion XP, and do not treat it as a missed habit commitment or a blocker for its pillar or the overall day.
- If today's occurrence was already completed, preserve that completion, its XP, and its existing pillar and overall-day contribution.
- Recalculate pillar and overall eligibility from the remaining required and completed eligible occurrences. If nothing eligible remains, the day is neutral rather than an automatically completed day.
- Do not rewrite missed or completed dates before the archival date. Archiving cannot erase earlier failures.
- A permitted correction to an archived historical occurrence still follows the normal correction window. It recalculates facts and XP but does not reactivate the habit or create future obligations.

### 6.7. Reactivation starts a new habit sequence

Reactivation preserves the habit identifier, historical records, best streak, XP, badges, and visual items. Its first new required occurrence is the next selected weekday strictly after the device-local reactivation date.

- Do not recreate an optional creation-day opportunity or require the goal on the reactivation date itself.
- Begin a new activation period with a new current habit streak. The first completed required occurrence in that period starts at 1; it does not continue the old active period's streak.
- Keep the previous best streak as the historical record. New periods can establish a higher best, and allowed factual corrections can still recalculate the history supporting a record.
- Ordinary milestone XP bonuses can be earned again within the new habit sequence, once per milestone in that sequence, without duplicating old occurrence rewards or cosmetic items.
- Do not reset a pillar or overall streak merely because a habit is reactivated. The habit participates again when its new required occurrence becomes due.
- Days while the habit is archived generate no missed obligations.

Full profile-data deletion remains a separate privacy action, not the meaning of archiving or reactivating a habit. Completion corrections remain different from archival: XP, levels, and streaks follow corrected records, but already unlocked cosmetic items remain owned under section 9.3.

### 6.8. Pending reactivation and date-sensitive safeguards

- Reactivation awaiting its first due date is an intent with a reserved period ID,
  not a future/inverted activation interval. Cancelling it before it becomes due
  creates no periods, occurrences, exemptions or rewards.
- At or after the due date, reconciliation materializes the new period even if the
  app opens late or the first occurrence is missed. Awaiting current streak is zero;
  its first completed required occurrence starts at one.
- Revisiting an earlier local date cannot edit away known records or activation
  boundaries, including a period with no occurrence rows.
- A restored habit whose creation lies in the device's future is readable but has
  no completion/edit/archive/reactivate controls or premature XP. An open editor
  that becomes inapplicable recovers to read-only history without a persisted write.

## 7. Device-local calendar and binary completion

### 7.1. Device time is authoritative for the current day

Use the device's current local date, time, and timezone, such as the date and time configured on the user's iPhone. There is no app-specific reference timezone, home timezone, or manual timezone selector.

- Determine Today and its weekday from the device-local calendar, not UTC midnight.
- Refresh the current local-day context when the app opens or resumes.
- Interpret a scheduled day's end at the device's local day boundary.
- Follow device daylight-saving and timezone changes rather than maintaining a separate fixed calendar.
- A language switch does not change the calendar or the selected weekdays.
- Do not assume that all local calendar days have identical elapsed durations.

The application does not need location permission to impose a geographic reference zone; no geographic reference zone is part of the design.

### 7.2. Historical records and repeated dates

A recorded commitment keeps its habit identity and the local date to which it was assigned. Device-timezone changes must not retroactively relabel completed records.

Stored `YYYY-MM-DD` values are Gregorian **civil dates**, not instants. Validate
and traverse historical dates independently of the device's current timezone,
including a date that was historically skipped in that zone (for example,
`2011-12-30` in Pacific/Apia). The supported stored year range is `0100`–`9999`;
invalid Gregorian dates reject rather than rolling into another month. Historical
weekday selection, arithmetic, replay, correction windows, calendar geometry and
localized labels retain that civil identity. Identical facts and the same explicit
civil Today produce the same derived results in every zone.

This does not make Today a UTC day: determine Today from the current device-local
clock first, then use that civil value for domain calculations. Actual timestamps,
including recording and backup export timestamps, remain instants. Neither travel
nor a language switch shifts stored dates, rewrites facts or requires a source-zone
field or data migration.

An event timestamp and the device offset or timezone observed when recording may be retained as historical metadata. That metadata is not an ongoing reference timezone governing future commitments.

Before creating an occurrence record, check whether one already exists for the pair **stable habit identifier + assigned device-local date**. This is the uniqueness boundary, not the goal text or the date alone: different habits may legitimately have occurrences on the same date.

If a record exists, reuse it. An allowed correction updates its Done state rather than inserting another occurrence. Repeating an already recorded state must not award additional XP. Apply the same uniqueness validation to restored backup contents.

Revisiting a recorded local date after changing the device clock does not create another rewarded commitment. Keep the device-local calendar policy and existing historical dates; do not introduce a fixed server/reference timezone as a workaround. This is duplicate prevention, not a claim that the application can detect or prevent all manual device-clock manipulation.

### 7.3. Completion rules

- On a scheduled day, an active habit appears as a required mission in Today. On its creation date, it can also appear as a clearly labeled optional first opportunity under section 6.5.
- Marking Done declares that the complete goal for that local day was achieved.
- An unchecked mission during the day is not yet a missed commitment.
- When a required scheduled local day ends without a completion record, the commitment is treated as missed for streak calculations. An unchecked optional creation-day opportunity or a current-day occurrence exempted by immediate archival is not a missed obligation.
- Unscheduled days are neutral for that habit.
- Activity on an extra, unscheduled day does not add a streak step or another mission reward, except for the explicit one-time creation-day opportunity in section 6.5.
- Exceeding the goal does not increase XP.

Self-report cannot distinguish an activity that was not performed from one that was performed but not recorded. Corrections follow the window below.

### 7.4. Correction window: today and the previous occurrence

The user may check or uncheck only:

1. Today's eligible occurrence, when the habit is scheduled today or has its documented optional creation-day opportunity.
2. The most recent eligible occurrence strictly before today's device-local date, according to the schedule and participation period that applied to that habit.

The previous occurrence is determined by the agenda, not by the last Done record. It remains eligible for correction whether it was completed or missed. Do not search backward for the most recent success or permit an arbitrary older day. An explicitly recorded optional first-day opportunity is part of the occurrence history, but its uncompleted state remains neutral rather than becoming a missed obligation.

Example: for a Monday/Wednesday/Friday habit, on Friday the user may edit **Friday and Wednesday**, regardless of either record's current Done state. Monday and earlier dates are outside the correction window.

On a day with no current occurrence, the previous occurrence can still be corrected; that does not authorize creating an extra completion for the unscheduled current day. Reject future-date edits and dates before the habit's creation or valid participation period.

Corrections must preserve the same habit/date identity and recalculate all affected derived results:

- Habit, pillar, and overall current streaks.
- Best streaks supported by the corrected history.
- Base XP and milestone bonuses affected by the correction.
- Total XP and the general level derived from it.

A correction can increase or decrease these derived values. This differs from an ordinary missed day: missing a new commitment does not revoke XP already earned for earlier valid completions, while undoing an earlier completion removes the XP and bonuses that no longer follow from the corrected facts.

Recompute from the applicable historical goals, schedules, and pillar membership. Do not treat a correction as a second rewarded action or blindly append another milestone award when a checkbox is toggled again. User-facing feedback should explain that the change updates points and streaks.

### 7.5. Reference example for recalculation

Assume these are the habit's first three scheduled opportunities, on Monday, Wednesday, and Friday, and all are completed. The reward rules award 10 base XP per completion and a 10-XP bonus at streak 3.

| State while today is Friday | Current streak | Best streak in this example | Total XP |
|---|---:|---:|---:|
| Monday, Wednesday, and Friday completed | 3 | 3 | 40 |
| Wednesday unchecked; Monday and Friday remain completed | 1 | 1 | 20 |
| Wednesday checked again | 3 | 3 | 40 |

The restored total is the recalculated total, not the previous total plus a duplicate bonus. Other habits and earlier valid records, if present, retain their independently earned contributions.

## 8. Streaks: habit, pillar, and overall

### 8.1. Habit streak

**A habit streak is the number of consecutive eligible commitments completed for one habit without missing a required scheduled opportunity in between.** Eligible commitments consist of the selected-weekday schedule plus the documented optional creation-day occurrence when completed.

It is not a count of elapsed calendar days and does not restart when the week changes.

Rules:

- The first completed eligible commitment of a new streak starts the count at 1.
- Each subsequent completed eligible commitment increases the count by 1.
- Unscheduled days preserve the current count.
- A missed required scheduled commitment breaks the current streak; an uncompleted optional first-day opportunity does not.
- The next scheduled completion after a break starts a new streak.
- Reactivation begins a separate habit sequence as specified in section 6.7; the archived period is not filled with missed days.
- A missed commitment does not remove the best streak, accumulated XP, levels, badges, or items.
- Explicit record corrections are different: current and best streaks, XP, and the resulting level must be recalculated under section 7.4.
- Repeating a completion action does not add a streak step.

#### Visible habit information

Each habit card must use the full goal text as its title and expose the pillar, selected weekdays, **current streak**, **best streak**, and next defined habit-reward milestone. Do not duplicate the title with a separate habit-name or goal-description row. Include the completion action when the habit has an eligible occurrence today, whether required or the optional first opportunity.

Today shows scheduled habits and distinguishes optional creation-day opportunities from required commitments. Progress provides access to all habits, including archived records and those not due that day, with correction controls restricted to the allowed dates.

Example content, not a final layout:

```text
Read 10 pages
Mind · Every day
Current streak: 4 scheduled commitments
Best streak: 7
Next milestone: 7
Action: mark as done
```

Explain “Streak” in both interface languages. Icons and colors are supplementary; the information must remain available as accessible text.

#### Habit example

Habit scheduled for Monday, Tuesday, and Wednesday:

| Occurrence | Result | Current habit streak |
|---|---|---:|
| Monday — week 1 | Done | 1 |
| Tuesday — week 1 | Done | 2 |
| Wednesday — week 1 | Done | 3 |
| Thursday through Sunday | Unscheduled | 3 |
| Monday — week 2 | Done | 4 |
| Tuesday — week 2 | Day closed without completion | 0 |
| Wednesday — week 2 | Done | 1 |

### 8.2. Pillar streak

**A pillar streak counts consecutive eligible local days on which every required habit in that pillar for that day is completed.** A completed optional creation-day occurrence may also contribute to that day's participation under section 6.5.

“All habits” means all required habits due in that pillar on the particular day. Habits assigned to other weekdays and unchecked optional new-habit opportunities are not required. This preserves flexible frequency and the no-penalty first-day rule.

Rules:

- A pillar is eligible on a local day when at least one habit is required or an optional first-day occurrence has been completed.
- On an eligible day, the pillar earns one streak step when every required habit in that pillar has been completed.
- Completing multiple habits in the pillar on the same day still earns only one pillar streak step.
- Completing only some required due habits does not earn a pillar streak step. Before the day ends, the pillar is still pending rather than missed.
- If a required due habit remains incomplete when the day ends, the pillar's current streak breaks.
- A day with no required habits and no completed optional first-day occurrences in the pillar is neutral.
- An empty default or custom pillar is neutral, including a default pillar skipped during onboarding.
- A pillar failure does not break the individual streaks of habits that were completed, or the streaks of other pillars that were completed.
- A missed day does not erase the pillar's best streak or previously earned rewards.
- A permitted correction recalculates the affected pillar days and streaks without retroactively imposing an unchecked creation-day obligation.
- An unfinished occurrence exempted by same-day archival is no longer required. A completed occurrence remains part of the pillar's day even when its habit is subsequently archived or scheduled to move.
- Reactivating one habit does not reset the pillar streak; it adds its next due obligation under the normal completeness rule.

Show **current pillar streak** and **best pillar streak** in pillar summaries, the pillar Streaks view (opened with **View pillar streaks** in Pillars), and Progress. List the habits scheduled for that pillar so the user can understand what remains to be completed.

The unit differs from a habit streak: a pillar counts completed eligible days, not the number of individual habit completions.

#### Pillar example

Body contains the goals **Complete my walk**, scheduled daily, and **Complete my gym workout**, scheduled on Monday, Wednesday, and Friday. These are the habit titles themselves, not separate name fields. Values below are evaluated after each local day closes.

| Day | Habits due in Body | Completed | Current Body streak |
|---|---|---|---:|
| Monday | Complete my walk; Complete my gym workout | Both goals | 1 |
| Tuesday | Complete my walk | Complete my walk | 2 |
| Wednesday | Complete my walk; Complete my gym workout | Complete my walk only | 0 |
| Thursday | Complete my walk | Complete my walk | 1 |
| Friday | Complete my walk; Complete my gym workout | Both goals | 2 |

The gym goal is not required on Tuesday or Thursday. Missing it on Wednesday breaks Body's streak but does not break the walking habit's individual streak if that goal was completed.

### 8.3. Overall adventure streak

The overall streak remains distinct from habit and pillar streaks.

- A day is complete when every required habit across all pillars for that local day is completed; optional creation-day occurrences only join the day's participation when completed.
- A day with no required habits and no completed optional first-day occurrences anywhere is neutral.
- A day ending with any required scheduled habit incomplete breaks the overall streak.
- An overall failure does not erase successful habit or pillar streaks.
- Custom pillars participate under the same due-habit rules as default pillars.
- An empty pillar or a pillar with no due habits adds no requirement to that day.
- An unchecked optional creation-day opportunity cannot break the overall streak. Permitted corrections recalculate the affected overall days and streaks.
- Use the same immediate-archival exemption and completed-record preservation rules as pillars. Reactivation alone does not reset the overall streak.

### 8.4. Reward scope

The XP milestone table in section 9 applies to **habit streaks**. Pillar and overall streaks are visible consistency indicators, but do not automatically grant another copy of those XP bonuses.

There are no separate pillar or overall XP reward tables.

## 9. Adventure, levels, and progressive rewards

### 9.1. Core experience

The implemented adventure is a lightweight mountain map, level and XP layer. Avatar/catalog personalization and automatic unlock mapping remain deferred. Actions completed outside the application drive the journey.

Core flow:

> Complete the real-world goal → record Done → update the relevant streaks → receive XP and any habit milestone bonus → briefly view progress → leave the app.

There is one general level. Default and custom pillars retain separate progress displays. Users choose which pillars contain habits; progress does not create an obligation to configure every default pillar.

### 9.2. Current milestone schedule through 365

Every valid habit completion for an eligible occurrence earns **10 base XP**, including a completed optional creation-day occurrence. Non-milestone completions receive that base reward only. At a milestone, its bonus is added to the base reward.

The implemented milestone table is below. Milestones through 365 are required; point amounts, intermediate milestones and the level threshold are product requirements, not scientific findings.

| Consecutive scheduled commitments | Base XP | Milestone bonus XP | Total XP for that completion |
|---:|---:|---:|---:|
| 3 | 10 | 10 | 20 |
| 7 | 10 | 30 | 40 |
| 14 | 10 | 60 | 70 |
| 30 | 10 | 100 | 110 |
| 45 | 10 | 150 | 160 |
| 60 | 10 | 200 | 210 |
| 70 | 10 | 250 | 260 |
| 80 | 10 | 300 | 310 |
| 90 | 10 | 350 | 360 |
| 100 | 10 | 400 | 410 |
| 125 | 10 | 500 | 510 |
| 150 | 10 | 600 | 610 |
| 175 | 10 | 700 | 710 |
| 200 | 10 | 800 | 810 |
| 250 | 10 | 1000 | 1010 |
| 300 | 10 | 1200 | 1210 |
| 365 | 10 | 1500 | 1510 |

The bonus increases at each successive defined milestone. The first and second commitments receive the normal reward; the third receives a larger reward; the fourth through sixth receive the normal reward; the seventh receives a larger milestone reward again.

These milestones count scheduled commitments, not elapsed time. A streak of 7 must not automatically be called “one week,” and a streak of 365 must not automatically be called “one year.”

Habit streak counters do not stop at 365. Beyond 365, base XP continues; additional bonuses beyond the published table remain undefined and must not be invented silently. There is no unbounded multiplier.

### 9.3. Repeated XP bonuses and permanent collectibles

Reward rules:

- Each valid eligible completion receives the base XP once, including the optional creation-day completion.
- Each milestone pays its bonus once within that habit's current streak.
- If the streak breaks and is rebuilt, the same milestone can pay its XP bonus again.
- Previously unlocked badges and visual items are not duplicated.
- Breaking a streak does not remove previously earned rewards.
- Toggling a completion, reloading, reopening, retrying a request, or importing a backup must not multiply rewards.

Deterministic replay distinguishes the scheduled occurrence, activation/streak sequence and awarded milestone bonuses. This is record consistency, not proof that the real-world activity occurred.

After an allowed correction, recompute which base rewards and milestone bonuses are supported by the corrected history and reconcile the total. The repeatable-bonus rule applies to genuine streaks in that history, including new activation periods, not to repeated checkbox operations.

**Cosmetic unlocks are permanent once granted.** A completion correction can lower XP, level, or streaks, but must not revoke an already unlocked badge, avatar accessory, or other visual item. Keep the unique-unlock record separate from recalculable XP and streak values. Earning its condition again does not create another copy or a duplicate XP payment.

Backup files must preserve these unique unlock records; do not reconstruct ownership solely from the currently corrected completion history. A user-authorized full dataset replacement or full-data deletion is a separate action and is not covered by the no-revocation rule for archival and corrections.

### 9.4. Levels

The implemented rule is level = 1 + floor(total XP / 100): start at level 1 and gain one level per 100 accumulated XP.

Because the level is derived from total XP, a valid record correction that lowers XP can also lower the level. Ordinary absence or archival does not itself remove previously earned XP.

Larger late milestones can consequently advance more than one level.

Levels do not measure intelligence, physical condition, hygiene quality, or health. Do not derive a “health percentage” from missions.

Future levels and achievements may unlock predictable avatar and map personalization. The cosmetic catalog and level-to-unlock mapping are not implemented.

### 9.5. Deferred achievement categories (not a shipped catalog)

- First completed mission.
- Completion across the four default pillars, without requiring the same day.
- Returning after an interruption.
- Habit consistency milestones from the published table.
- Adventure milestones.

Creating a custom pillar must not retroactively change the requirements of an already earned achievement. The default-pillar foundation achievement targets the four default identifiers; any custom-pillar achievements need their own explicit definitions.

Only the XP rules expressly listed in this specification contribute to XP. Other badges or visual recognition do not grant extra XP automatically.

### 9.6. Gamification boundaries

- No public leaderboards or comparisons between users.
- No random rewards, purchases, or monetary rewards.
- No points for screen time, opening the app, or exceeding a goal.
- No avatar suffering or item loss because of absence.
- Celebrations are brief and respect reduced-motion preferences.
- Return messages avoid humiliation or moral judgment.

## 10. Screens and responsibilities

| Screen | Responsibility |
|---|---|
| Onboarding | Present My GOAT Journey, offer language selection, guide four skippable default-pillar steps, and atomically establish at least one explicitly configured valid habit using one goal-text field per habit. |
| Today | Group due habits by pillar in a checklist, distinguish optional first-day opportunities, use each goal as its title, and show binary check/uncheck actions plus habit and pillar streaks. |
| Pillars | Manage pillars and habits in independently collapsible List by pillar groups, initially closed on fresh entry. Add pillars and contextual habits; edit habits directly or use Move/Review/Archive. Pillar actions are Rename/Streaks/Remove; removal preserves history and requires moving or archiving prospective members first. Dedicated Archived and management subviews support reactivation and preserve return context; there is no separate general Pillar details screen. |
| Journey | Display general level, XP, mountain map and daily/overall streak. Avatar/catalog unlock presentation remains deferred. |
| Progress | Show consistency calendars, habit/pillar history, schedules and streaks, with filters and dated review/correction controls. Review supports existing edit/lifecycle actions and effective-date feedback. Calendars show history through yesterday; streaks include today. The achievement/cosmetic catalog remains deferred. |
| Habit editor | Create or edit one goal-text field, pillar and selected weekdays/Every day; never request a separate habit name. Explain prospective goal/schedule and move effective dates. No reminder setting is implemented. |
| Settings | Language/motion preferences, device-only System/Light/Dark appearance, backup export/validated replacement-only restore, separate confirmed full-data deletion and optional update check. Reminders and reference-timezone settings remain deferred. |

The current presentation uses the Field Notes style, supplied branding and five-destination navigation; the supplied logos and derived icons are included in the project’s Apache-2.0 licensing scope to the extent of available rights (see [branding provenance](branding-pwa.md)). Use clear, accessible language suitable for a broad audience, without assuming a school setting or a particular age. Examples should reflect varied everyday routines and remain non-prescriptive. Feedback must be supportive and non-punitive.

### 10.1. Onboarding, drafts and preferences

Only explicitly configured valid slots become habits. Draft text/weekdays and
inclusion are independent: editing clears inclusion until valid Continue, and
navigation never includes skipped drafts. Review-edit return intent persists
across reload. All-skipped finalization performs no habit/occurrence/reward write.
Completed profiles do not repeat setup and may archive the last active habit.

Progress uses **7d** or the last valid explicitly selected interval from
7d/1m/3m/12m/24m. Missing/invalid choices fall back to 7d before rendering. Only the
interval persists, not tabs, filters, offsets or statistics. Explicit selection
commits before changing the view and resets the latest window, even for the same
value. Failure retains the committed state with Retry. Restore retains valid
choices, normalizes invalid present values to 7d and leaves an absent preference
absent; full reset clears it.

### 10.2. Checklist and Progress presentation

- The interface is a checklist with check/uncheck controls; `Done` is the binary
  saved fact, not a required button design. Today counts required habits only;
  neutral/empty scopes never become 0/0 successes.
- Native goal/date-named checkboxes save before showing completion and replayed
  progression. Success announcements are visually hidden, polite and atomic after
  commit; errors and Retry remain visible.
- Today uses a compact title/localized-date header, committed total-XP badge and
  day motto. Its light progress card pairs the required-only count with a small
  supplementary completion circle; no-required days keep their context without a
  percentage or 0/0 success. The completed state promotes the localized all-habits
  message and replaces the circle with a decorative medal. This adds no stored
  reward, unlock or XP. Overall recognition may include a valid optional-only
  eligible day; informational pillar Completed today badges require a nonempty
  complete required scope.
- Warm paper, near-white cards and restrained borders/shadows refine Today only.
  Compact solid pillar-group headers use existing muted identity colors (purple,
  burgundy, warm brown, blue and stable custom neutral), with high-contrast light
  text/icons. Icon/name stays left and completion information right on the same
  row when space permits, wrapping naturally at narrow/enlarged layouts. Pending
  groups show **0/2 completed / 0/2 concluídos** rather than In progress; complete
  groups show a decorative check and **2/2 completed today / 2/2 concluídos hoje**.
  Header status is always count-first, with singular Portuguese wording for a
  required total of one; summary cards retain their separate Completed today badge. No rule separates the
  colored header from its habits. Neutral summary cards retain colored icons in
  matching families, their count/streaks/badge and no-scheduled context, without
  progress bars or increased height. Informational two-column summaries adapt to
  long names/enlarged text. Full wrapping goals stay beside a stable native
  checkbox target of at least 44 × 44px. Current/best streaks share a secondary
  row; upcoming bonus XP and remaining consecutive completions have their own
  localized singular/plural line, never extrapolated beyond the milestone table.
  Both pending and completed habits use the same light neutral background, with
  the native green checked control retained. Titles stay readable without
  strikethrough or strong opacity changes. Compact goal-to-streak and next-bonus
  spacing preserves the checkbox target and separators only between habits.
- After a successful user-initiated Today check, a decorative `+XX XP` near the
  checkbox shows the actual committed base plus applicable milestone bonus for
  about 700ms. It gently rises, or stays stationary with OS/app reduced motion,
  without reflow or blocking controls. XP joins the existing accessible success
  announcement once. Failed saves, initial render/reload/import/external updates,
  unchecks and historical corrections never create this feedback; action identity
  and cleanup prevent replay. Feedback changes no persisted fact or reward rule.
- Progress places a compact unframed global XP block below its title/intro and
  before Habits/Pillars. Show the current level with secondary total accumulated
  XP / next-level total threshold, the next level with a decorative native rocket,
  a thin current-level progress bar, and an explicit remaining-XP/destination-level
  sentence. Reuse committed progression selectors: 420 / 500 XP at level 5 is
  20% within its level, not 84%. Filters, tabs and historical periods never scope
  global XP; committed corrections and backup replacement refresh it. All text is
  localized, the bar explains its value accessibly, and the block adds no action.
  Keep filters collapsed with applied context, one shared legend, soft identity
  icon tints, full wrapping goals and compact aligned metrics on light cards.
  Use modest gaps before the first calendar without shrinking fonts or touch
  targets. Habit headers omit Tracking since; the existing habit detail keeps a
  localized read-only tracking-start date in its secondary disclosure. This does
  not change original tracking boundaries, creation/activation semantics or
  Before tracking treatment. Final content must scroll above measured fixed
  navigation, including safe-area padding.
- Progress calendars show history through yesterday; full-history streaks include
  today. Seven-day views contain seven consecutive local dates. Months own their
  dates, Monday-first axes and inert padding; 1m/3m show numbered months and 12m/24m
  compact months. Before-tracking hatches and lifecycle gaps are not failures or
  denominator credit. Aggregate partial days earn no fractional complete-day credit;
  zero eligibility is an explanatory em dash.
- Native date buttons retain keyboard reachability through disconnected history,
  with no manual date input. Day details and nested Back restore originating context.

### 10.3. Focus, forms and Journey

- Route headings receive programmatic announcement focus outside normal Tab order.
  Initial/pointer/touch entry has no static-title ring; keyboard entry has a scoped
  visible outline. Interactive/modal/return focus is preserved without global
  outline suppression.
- Unsaved navigation retains literal drafts, focus, selection and scroll. Keep
  editing/Escape preserves them; explicit Discard accepts the original destination
  without a data write. A clean unchanged Save leaves without rebasing stored
  future definitions or memberships.
- Journey uses five-sign stretches with shared boundary levels, native curve
  arc-length position from replay-derived level progress, and informational browsing
  with no reward write. Pillar, habit and daily streak indicators grant no extra XP.
- Full goals and localized labels wrap at narrow/enlarged layouts. Controls retain
  accessible names, visible focus and touch targets; color/icons supplement text.

See [Interfaces](interfaces.md) for exact module, form and return-context contracts.

## 11. Evidence limits

Completion is self-reported, not independently verified. The app does not provide
clinical assessment, diagnosis, treatment or demonstrated therapeutic efficacy.
Software correctness and usability do not establish behavior-change effectiveness.

## 12. Technical and execution contract

| Component | Maintained contract |
|---|---|
| Interface | React/TypeScript/Vite; English source strings and Portuguese catalog, local system fonts and bundled runtime dependencies. |
| Facts | IndexedDB dataset schema 2, database version 1, database `my-goat-journey`, store `dataset`, key `current`. |
| Domain | Pure calendar, agenda, lifecycle and deterministic progression replay. Historical definitions, memberships and activation periods govern each dated occurrence. |
| Persistence | Serialized committed read-modify-write transactions, monotonic local revision and stale-write rejection; no optimistic reward counter. |
| Installation | Relative manifest start/scope/icons, derived identity (explicit `id` omitted), production-only base-scoped worker; verified coherent shell and guarded quiet updates. |
| Backup | Validated complete-file export and confirmed atomic replacement, never merge or XP addition. |
| Toolchain | Existing rootless Podman and plain shell wrapper for local development and production operation; Node/npm/Vite/TypeScript/Vitest/Playwright and browser libraries stay in containers there. GitHub-hosted application CI uses the exact development-image Node version and shared npm commands directly on its disposable runner. |
| Build/hosting | One shared production artifact: landing at site root and PWA at `app/`; local non-root nginx image and static GitHub Pages hosting. |
| Reminders | Deferred optional separate container/API; no backend or diary upload is shipped. |

### 12.1. Responsibility boundaries

- Pillars/habits own stable identities, effective definitions/memberships, optional first-day participation, archival exemptions and new reactivation periods.
- Localization resolves system text only; user text and stable IDs remain literal.
- Calendar derives commitments from the current device-local date, not a reference timezone or server clock.
- Occurrences keep unique habit/date identity and applicable goal/pillar/eligibility snapshots; corrections update the same fact.
- Consistency/rewards replay historical facts, reconcile current/best streaks, repeatable bonuses, total XP and level, never blindly add a reward on each checkbox event.
- Permanent ownership is unique and separate from replay-derived XP; corrections/archival cannot revoke it.
- Repository validates identities, transactions, revisions and replacement/reset; failed writes preserve the committed dataset.
- Worker/cache/update code operates on app-shell files, never diary facts. Landing code must not access IndexedDB diary or the app BroadcastChannel.

### 12.2. Deferred reminders and limits

Future reminder requirements: reminders are voluntary and generic at a user-selected device-local time; declining permission does not block tracking. Lock-screen messages must not reveal goal text. The service receives minimal subscription/delivery/installation/language/timezone metadata, not the habit diary or custom pillar names. A subscription endpoint is a capability URL, not anonymous data. Home Screen, permission/user-action and real-device delivery behavior must be verified before any claim of support.

A service without completion data cannot promise completion-based reminder suppression. Latest-observed timezone is delivery metadata, not a new habit calendar; changes while the app stays closed may leave a remote scheduler stale. Connection, permissions and device conditions prevent exact-minute guarantees. Device-bound permissions/subscriptions are not blindly restored from another device's backup. A future remote subscription deletion must be confirmed; network failure must not be reported as completed deletion.

### 12.3. Execution and shared artifact

Local dependency installation, development, checks, browser libraries, builds and
production operation use rootless Podman. Application tools do not run natively
on the development host; dependencies and caches live in images or managed volumes.
Use the existing Podman CLI without a required Compose provider, privileged mode,
host package installation or global cleanup. Keep resources, mounts and ports
project-scoped and preserve source ownership.

GitHub-hosted application CI directly runs `npm ci`, `npm run typecheck`,
`npm run test` and `npm run build` on its disposable runner with the exact Node
version pinned in the development stage of `Containerfile` and its bundled npm.
It consumes the committed lock, checks its byte integrity and uses the same
artifact assembly. Mocked orchestration units are part of the ordinary suite;
real container/nginx/browser integration is separate.

`SITE_PREFIX` resolves the shared landing prefix and app base (`prefix + app/`).
The default entries are `/my-goat-journey/` and `/my-goat-journey/app/`; `dist/`
contains the landing and `dist/app/` the compiled PWA. Assembly preserves final
PWA bytes after hashing and rejects stale/unexpected output. Landing-only changes
do not change the app version when app inputs and base are identical. Local
production is non-root nginx without source/dependency mounts or Vite; GitHub
Pages consumes the same artifact. See [Development](development.md) for commands,
network exposure and fixtures, and the [README](../README.md#hosting-and-ci) for
the repository and hosted entry points.

### 12.4. Installation and reliable updates

- The relative manifest start/scope/icons resolve under the app path. Explicit
  manifest `id` is omitted; installed identity derives from the resolved start URL.
- Only production registers the app-scoped worker. The landing is outside its scope,
  is not promised offline and must not access the diary or app BroadcastChannel.
  Paths do not isolate storage or trusted scripts on the same origin.
- Final-byte integrity/version hashes, base-scoped caches and durable per-document
  version assignments prevent mixed shells. A shared worker Web Lock covers
  retained-cache installation/publication and cleanup. Without locks, installation
  fails before mutation and existing verified caches are retained.
- Quiet adoption is limited to pristine new-document entry or genuine clean
  hidden-to-visible resume, not merely finishing a save. First installation does
  not claim/reload the editing document; trusted interaction closes eligibility.
- Dirty/failed drafts, queued persistence and backup/confirmation leases block
  automatic and manual adoption. Synchronously establish inert locking, then drain
  persistence and strictly recheck before exact-worker acknowledgement and
  sole-window activation. Unknown, uncontrolled
  or suspended peers defer activation. No automatic discard, routine banner,
  unconditional claim or controllerchange reload is permitted.
- Exact acknowledgement/activation gates one reload; timeouts release locks without
  tight retry loops. Optional localized Settings checks use the same guards.
- Native activation is irreversible. Essential predecessor assignments are prepared
  first; optional metadata failure retains verified files and fences destructive
  cleanup. Under sustained quota an assignment may be volatile for a worker lifetime;
  after restart unknown assets fail closed, while fresh navigation can recover a
  verified shell. Subsequent replacement can remain deferred. Cache code never
  clears or replaces diary facts.

[PWA reliability](pwa-reliability.md) owns detailed acceptance, troubleshooting and
device checks. Development/HMR is not offline verification; compiled output and a
supported secure context are required.

## 13. Data, privacy, and safety

### Authoritative local data

- Default and custom pillar identities and labels.
- Stable habit identities, a single goal-text value per habit, pillar membership, and selected weekdays; no separate habit-name attribute is required.
- Effective history of goal-text, schedule, and membership changes.
- Habit archival state, archival-date exemptions, scheduled reactivation, activation periods, and retained historical records.
- Unique occurrence records by habit and assigned device-local date, with their Done state and optional/required participation classification.
- The history needed to recompute streaks, milestone eligibility, XP, and levels after permitted corrections.
- Historical event timestamps and device-time metadata when necessary for consistent records, not a fixed reference calendar.
- Habit, pillar and overall streaks, milestone rewards, total XP and level are recomputed from saved historical facts, not additive stored counters.
- Separately persisted permanent-unlock IDs and first-granted timestamps. Achievement definitions, the cosmetic catalog and automatic unlock mapping remain deferred.
- Current preferences: interface language, reduced-motion choice and optional Progress interval (7d/1m/3m/12m/24m). No reminder settings are currently stored or exposed.

### Minimum deferred reminder-service data

The following applies only to a future reminder implementation; no reminder preferences, subscriptions or service are currently implemented.

- Push subscription and technical delivery details.
- A technical installation identifier.
- Reminder schedule and latest observed device-timezone metadata needed for delivery.
- Interface-language preference if needed to localize a generic notification.

Do not describe subscriptions or identifiers as anonymous. The [Push API documentation](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) identifies the subscription endpoint as a capability URL that requires careful handling.

Do not send custom pillar names, habit goal text, or the full history merely to deliver a generic reminder. Do not include advertising, third-party tracking, or automatic diary collection.

Without synchronization, clearing local data or switching devices can result in history loss. Explain the limitation and offer backup.

Removing or pausing an individual habit archives it; it is not the same action as deleting the whole profile's data. Full-data deletion currently covers the local dataset. If a reminder service is implemented later, deletion must also cover its stored subscription; communicate network failures rather than claiming remote deletion succeeded.

### 13.1. Transactional persistence and current formats

- Dataset schema is **2**; IndexedDB database version is **1**, database
  `my-goat-journey`, store `dataset`, key `current`.
- Mutations resolve after commit. Semantic repeats do not write or advance local
  revision. Confirmed replacement/reset performs one atomic put and advances
  revision even for identical facts; stale revisions reject before mutation.
- External replacement/reset invalidates obsolete drafts, retries and navigation
  identities instead of resurrecting replaced facts.
- The backup envelope is `my-goat-journey-backup`, **formatVersion 1**. It contains
  portable facts, permanent ownership and preferences, not local revision, imported
  XP counters or device permissions. Reject unsupported or invalid files before
  replacement; validation does not imply support for an arbitrary input format.
- Export and restore share an inclusive **20 MiB complete UTF-8 file** limit measured
  from actual Blob/file bytes; normalized imports must also fit. Oversized export
  produces no partial file or truncation. Record growth does not silently delete or
  cap history; archiving is not backup-size cleanup.
- Data belongs to an exact browser profile and origin. Changing device, hostname,
  port or protocol requires private export and validated, confirmed replacement on
  the destination. Preserve backups before clearing data or removing an installation.

### 13.2. Backup restoration replaces the dataset

The restore policy is **replace, not merge**.

- Validate the file, supported format, stable identifiers, references, and occurrence uniqueness before changing the current data.
- Explain that the current local dataset will be replaced and require confirmation. Offer an export of the current dataset before replacement.
- Validation precedes separate revision-bound confirmation and is repeated inside the transaction. Replace with one atomic put, never clear-then-import, merge or union unlocks. Invalid, oversized, aborted, failed, quota or stale replacements preserve the prior dataset.
- Do not append imported pillars or habits to the current dataset, add imported XP to existing XP, or replay old completions as new rewards.
- Recalculate or verify derived streaks, XP, and level against the restored occurrence history and reward rules.
- Preserve archived habits, activation periods, historical schedule and membership versions, and permanent cosmetic-unlock records contained in the backup.
- Do not blindly restore another device's notification permission or push subscription. Device-bound reminder registration must be reviewed or reconciled separately after the local restore succeeds.

## 14. Stable acceptance criteria

These are requirements, not test-pass claims. AC31–32 and AC56 describe future
reminders; catalog-specific parts of AC26/49 are future scope while unique
ownership persistence is implemented. Offline acceptance requires successful
production installation and controlled reopening, not just an online load.
Device limits and detailed reliability acceptance are in [PWA reliability](pwa-reliability.md);
container and browser prerequisites are in [Development](development.md).

- **AC01 — Default language:** first use starts in English, independently of the device language.
- **AC02 — Portuguese interface:** users can switch to Portuguese, the preference persists offline, and all system-generated interface text is covered.
- **AC03 — Language isolation:** switching language does not change user-entered text, identities, schedules, dates, streaks, or rewards.
- **AC04 — English project materials:** specifications, source comments, identifiers, and technical project documentation are in English, except intentional localization content.
- **AC05 — Defaults and onboarding minimum:** Mind, Body, Nutrition, and Hygiene are introduced and remain available, including skipped pillars. One valid configured habit in total is sufficient to finish setup; every pillar is not required. All-skipped confirmation is rejected accessibly without any habit, occurrence or reward write.
- **AC06 — Extensible pillars:** a user can add a custom pillar, which participates in the same views, scheduling rules, and streak calculations.
- **AC07 — Multiple habits:** multiple habits can be added to the same pillar, each with its own goal, frequency, and streak.
- **AC08 — Weekday selection:** a habit supports selected weekdays or Every day; an empty frequency is rejected.
- **AC09 — Agenda:** Today groups required scheduled habits and clearly identified optional first-day opportunities by pillar; an optional first-day opportunity is not presented as overdue when left unchecked.
- **AC10 — Binary completion:** no minimum version or partial goal progress is available.
- **AC11 — Visible habit streaks:** current and best streaks are visible on applicable habit cards and in Progress.
- **AC12 — Habit neutral days:** the example in section 8.1 crosses unscheduled days and the week boundary without resetting the streak.
- **AC13 — Day closure:** an unchecked scheduled commitment does not break a streak before the local day ends.
- **AC14 — Visible pillar streaks:** each default or custom pillar exposes its current and best streaks.
- **AC15 — Pillar completeness:** a pillar earns at most one step per eligible local day, only when all required due habits are complete; a completed first-day opportunity can participate without adding another step.
- **AC16 — Pillar neutrality:** skipped/empty default and custom pillars, unscheduled habits and unchecked optional first-day opportunities add no requirement, missed day or streak/XP credit; a day without required habits or completed optional opportunities is neutral.
- **AC17 — Independent streaks:** a pillar or overall failure does not erase successful individual habit or other pillar streaks; the example in section 8.2 holds.
- **AC18 — Overall streak:** only required due habits are demanded; unchecked optional first-day opportunities do not spoil a complete day, while completed ones can participate under the shared eligibility rules.
- **AC19 — Record preservation:** a missed commitment preserves best streaks and already earned levels, XP, badges, and items.
- **AC20 — Device-local time:** Today and day boundaries follow the device's current local calendar without a separate reference-timezone setting.
- **AC21 — Historical identity:** every occurrence creation checks stable habit ID plus local date; device-time changes cannot create or reward that occurrence twice, and an allowed correction updates the existing record.
- **AC22 — Base XP:** a valid eligible completion receives base XP once, including an optional creation-day completion; other extra unscheduled activity or exceeding a goal earns no extra mission XP.
- **AC23 — Progressive milestones:** all published habit milestones through 365 use the configured bonuses; bonuses strictly increase between successive defined milestones and totals include base XP correctly.
- **AC24 — Continued tracking:** the streak can exceed 365 and base XP continues without an invented bonus table.
- **AC25 — Rebuilt sequences:** a genuine new streak after a break can award the same milestone XP bonuses again.
- **AC26 — Unique collectibles:** repeating a milestone does not duplicate unlocked badges or visual items; corrections and archival do not revoke them, even when recalculated XP or level decreases.
- **AC27 — Idempotency:** repeated actions, reloads, retries, and imports cannot multiply commitments or rewards.
- **AC28 — Reward scope:** pillar and overall indicators do not silently duplicate habit milestone bonuses.
- **AC29 — Effective changes:** goal and frequency edits apply on the next device-local date without rewriting historical commitments; historical pillar membership is preserved.
- **AC30 — Persistence and backup:** core tracking survives reopening and offline use after successful production shell installation and worker-controlled reopening; restoration validates and replaces the dataset rather than merging it, with no duplicated XP or partial overwrite on failure.
- **AC31 — Reminders (future):** activation is voluntary, refusal does not block use, disabling is respected, and the flow is verified on intended physical devices; device-time refresh limitations are documented.
- **AC32 — Minimization (future):** the reminder service does not receive the habit diary or custom pillar content, and identifiers are not described as anonymous.
- **AC33 — Accessibility:** controls, focus, contrast, screen readers, localization labels, and reduced motion are covered; streaks are not conveyed only by color or icon.
- **AC34 — Honest framing:** levels and rewards are not presented as clinical measures, intelligence scores, or measures of personal worth.
- **AC35 — Single goal field:** creation and editing use one goal-text input; no separate habit-name, optional nickname, or generated-title confirmation is required. The applicable goal text is the habit's title in cards, lists, and detail views.
- **AC36 — Contextual pillar:** starting habit creation from a pillar preselects that pillar rather than asking the user to enter the same context again.
- **AC37 — Identity on goal edits:** editing the goal preserves the habit identifier, completion history, current and best streaks, and earned rewards; the new goal applies on the next device-local date, while past records retain the goal version that applied to them.
- **AC38 — Qualitative goals:** a clear, fully checkable goal without a numeric target is supported without adding quantity/unit fields, a separate habit name, or partial-progress tracking.
- **AC39 — Optional creation day:** a completion on the creation date counts immediately for the habit and pillar; leaving that first opportunity unchecked creates no missed obligation, even near midnight.
- **AC40 — Participation start:** without a first-day completion, normal obligations begin at the next scheduled occurrence; adding an unchecked habit does not retroactively invalidate a completed pillar day.
- **AC41 — Correction window:** a Monday/Wednesday/Friday habit viewed on Friday allows checking or unchecking Friday and Wednesday regardless of their prior state; Monday and arbitrary older dates are not editable.
- **AC42 — No fabricated occurrence:** a correction on an unscheduled day can target the previous eligible occurrence but cannot create an extra current-day completion outside the documented first-day exception.
- **AC43 — Derived recalculation:** allowed corrections recalculate affected habit, pillar, and overall streaks, best streaks, XP, bonuses, and the level; section 7.5 returns 40 XP, then 20 XP, then 40 XP without duplication.
- **AC44 — Archival:** pause/remove archives immediately and preserves history, earned XP, its derived level, badges, and visual items. Today's unfinished occurrence becomes exempt without being marked Done or generating XP; today's completed occurrence stays credited. Earlier failures remain unchanged.
- **AC45 — Replacement restore:** the user is warned and confirms before replacement; invalid or failed restoration leaves the current dataset intact, and imported XP is never added on top of existing XP.
- **AC46 — Move identity:** a pillar move preserves the habit identifier and prior records and cannot duplicate a habit/date reward. An already completed occurrence stays in its original pillar; destination membership starts at the next scheduled occurrence. A later allowed correction still affects the original dated assignment.
- **AC47 — Scheduled reactivation:** reactivation retains the habit identity, best streak, XP, and items, resumes strictly at the next selected weekday after the reactivation date, and starts a new current habit streak without inventing a new creation-day reward.
- **AC48 — Aggregate lifecycle consistency:** same-day archival removes only unfinished current obligations; completed ones remain eligible. An empty remaining day is neutral. Habit reactivation alone does not reset pillar or overall streaks.
- **AC49 — Permanent unlock persistence:** corrections can change XP, level, and streaks without revoking owned cosmetics; export/restore preserves the unlock records, and earning a previously granted item does not duplicate it.
- **AC50 — No host installation:** the development workflow requires no host installation of Node/npm, test browsers, Compose providers, or other app dependencies, and does not use a host-native app toolchain as a fallback.
- **AC51 — Containerized development:** the existing rootless Podman can bootstrap and run the development environment with source edits visible in the app; dependencies and caches remain in images or managed volumes rather than host project dependency directories.
- **AC52 — Containerized checks:** local type checking, unit/integration tests, production builds and Playwright run in containers with recorded real results; browser packages and system libraries are installed only inside the test image. GitHub-hosted application CI is the exception: the disposable runner directly runs the same shared validation/build commands with the exact project Node version and committed lockfile; local container results do not prove hosted execution.
- **AC53 — Production container:** a clean multi-stage build produces a non-root runtime image serving the compiled frontend; a local smoke test succeeds without source bind mounts or the development dependency volume.
- **AC54 — Container boundaries:** project-scoped ports, networks, mounts, and cleanup do not require privileged mode, expose unrelated host files, or remove unrelated containers/volumes; secrets are excluded from image layers.
- **AC55 — Provider-independent orchestration:** documented entry points work through the existing Podman CLI without installing a Compose provider; any optional Quadlet deployment is separately authorized and uses existing host capabilities.
- **AC56 — Containerized reminder service (future):** when reminders are implemented, the API runs in its own production container with scoped persistence, while the browser habit diary remains client-side.
- **AC57 — Explicit onboarding inclusion:** Continue validates the current habit; Skip advances without validation and excludes its input. Back/revisit/review Edit/Add habit and reload preserve all drafts and decisions; only explicit valid Continue includes a revisited skipped habit. Navigation/autosave creates no active habits or occurrences.
- **AC58 — Onboarding field errors:** missing goal and empty weekdays produce only their applicable localized field-associated errors; failed Continue retains input, announces errors and focuses the first invalid field. Skipping does not validate as creation. Existing visible focus indicators remain.
- **AC59 — Onboarding schedules and language:** Every day reflects the actual all-seven selection; deselection clears its selected state. Summaries use Every day or fixed localized weekday order, independent of click order. EN/PT switching preserves literal goals and draft state. Equal readable weekday targets adapt to narrow/enlarged layouts.
- **AC60 — Setup isolation and first day:** completed profiles and saved records remain intact and can archive the last active habit. Finalization is atomic/idempotent and creates only selected valid habits. The applicable review note describes the existing optional creation day without extra XP or a new reward; setup does not alter the other domain rules.

## 15. Current limitations and future work

Deferred features require separate explicit approval; documenting their requirements
does not authorize implementation.

- Browser installation and storage considerations are maintained in
  [device coverage and limitations](pwa-reliability.md#device-coverage-and-limitations).
- Cosmetic/avatar personalization, achievement definitions and automatic unlock
  mapping are future work; persistence support is not a shipped catalog.
- Reminders/notifications and a separate delivery API are future work. Hosting,
  TLS, endpoint protection, delivery scheduling and timezone refresh need design and
  operational verification; exact-minute or completion-based suppression is not promised.
- Accounts, synchronization and analytics are not implemented. App Settings supports
  System, Light and Graphite Dark as a device presentation preference; the landing
  shares only this preference through Light/Dark controls, not diary facts or backups.
  See [Interfaces](interfaces.md#device-appearance).
- The name has no claimed availability/trademark review. Project-owned code,
  documentation and original assets (including supplied logos and derived icons)
  use [Apache-2.0](../LICENSE), to the extent of available rights. Preserve
  [third-party terms](../public/third-party-notices.txt); attribution/provenance
  limitations are in [Branding](branding-pwa.md).
