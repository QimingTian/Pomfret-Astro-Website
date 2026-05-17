# Pomfret Astro — Remote Imaging Guide

This document explains how to use the **Remote** dashboard to request telescope time, read the night schedule, and follow your session from submission through completion. It is written for observers and students, not as a developer manual.

**Live site:** [pomfretastro.org](https://www.pomfretastro.org) → sign in → **Dashboard → Remote**

---

## What you are using

The observatory runs automatically once your session reaches the front of the queue and weather allows. You do **not** operate the telescope from this page. You:

1. **Submit** what you want to image (target, filters, exposure plan, contact email).
2. **Wait** while the system places you on tonight’s schedule and in the fair queue.
3. **Monitor** progress, preview images, and download data when ready.

Two imaging modes are available on Remote:

| Mode | Best for |
|------|----------|
| **Deep Sky Object (DSO)** | Galaxies, nebulae, clusters — one or more filters (L, R, G, B, Ha, O, etc.) |
| **Variable Star** | Time-series photometry — system uses **G** filter for consistency |

DSO also offers **Project Mode** for targets that need **many frames across multiple nights** (see below).

---

## Page layout

The Remote page has four main areas:

1. **New imaging session (top left)** — form to submit or edit a request.
2. **Tonight’s schedule (right)** — vertical timeline from evening through dawn: twilight, weather, and your session blocks.
3. **Current sessions (bottom left)** — everything in the queue or already running/completed tonight.
4. **Telescope status (bottom right)** — whether the observatory is accepting work and where it is pointed.

The schedule and session list refresh automatically while you keep the page open.

---

## Observatory status

Before submitting, check **Telescope status**:

| Display | Meaning |
|---------|---------|
| **Ready** | Observatory can accept new work (subject to weather and schedule). |
| **Busy — In Use** | A sequence is running; new work waits. |
| **Closed — Daytime** | Sun is up (nautical dawn to nautical dusk); no imaging. |
| **Closed — Weather Not Permitted** | Current conditions fail safety rules. |
| **Closed — Observatory Maintenance** | Staff maintenance; no imaging. |

If the dome is **not Ready** when you submit, you may see an option to **queue until ready** (session is stored but not scheduled until conditions improve) or the submit may be rejected — follow the message on screen.

---

## Tonight’s schedule — how to read it

The timeline uses **America/New_York** and runs roughly **4:00 PM → 8:00 AM** across the imaging night.

You will see labeled bands such as:

- **Sunset / Civil / Nautical / Astronomical** dusk and dawn — when the sky becomes dark enough for deep sky work.
- **Weather Permitted** — forecast hours that pass cloud, wind, and precipitation checks.
- **Weather Not Permitted (cloud)** — hours blocked for scheduling (and often a reason like cloud).
- **Colored blocks** — scheduled sessions (yours or others), including **Target — Session N** for Project Mode.

Grey or blocked regions mean the scheduler will not place new imaging there. Your session block’s **start time and length** reflect when the system expects imaging to begin and how long it needs (exposure time × frame count, plus a small setup overhead).

---

## Creating a standard DSO session

### 1. Choose session type

Select **Deep Sky Object** (not Variable Star unless you need that workflow).

Leave **Project Mode** **Off** if you intend to finish in **one continuous run** on a single night (subject to schedule and weather).

### 2. Target and coordinates

- Search the **catalog** by name, or enter **RA** and **Dec** manually.
- Coordinates must be valid; the target must be **high enough in the sky** during your slot (see scheduling below).

### 3. Filter plan

Add one or more rows: filter name, exposure length (seconds), frame count.

**Output type:**

- **Raw ZIP** — individual frames packaged for you.
- **Stacked Master** — requires **600 s** exposures (system enforces this).
- **None** — data handled per observatory policy.

### 4. Session password

Required. You need this password later for **Check progress** and **Download file**. The observatory staff password does not replace yours unless documented separately.

### 5. Contact email

Required. Used for notifications (see [Emails](#emails)).

### 6. Start Session

If accepted, you will see confirmation and a new row under **Current sessions**.

**Save Session** stores your form locally in the browser (name + fields) so you can reload a template later — it does **not** submit to the queue.

---

## Project Mode — multi-night imaging

Use **Project Mode → On** when your target needs **more frames than one clear night can hold** — for example a faint galaxy needing dozens of 5-minute subs across many filters over multiple evenings.

### What Project Mode does conceptually

Think of one **big project** split into many **small sessions** (Session 1, Session 2, …):

- Each small session behaves like a normal imaging run: schedule, start, progress log, failure handling.
- The **project** stays active until **all** requested frames across **all filters** are done — possibly over many calendar nights.
- Each **clear weather window** on a given night can become one or more sessions, so clouds do not waste the whole night.

### What you see in the UI

| Level | Status | Meaning |
|-------|--------|---------|
| **Project row** | **PENDING** | Submitted; no sub-session scheduled tonight yet. |
| | **IN PROGRESS** | At least one sub-session is scheduled or underway; remains until **all frames** are complete. |
| | **COMPLETED** | Total frame budget finished. |
| **Sub-session** (via Check progress) | **scheduled** | Planned for a specific window tonight (or a future night). |
| | **in progress** | Currently imaging. |
| | **completed** | That chunk finished; frames counted toward the project total. |

The project line is labeled **· Project Mode**. On the schedule strip you may see **Target — Session 1**, **Session 2**, etc., instead of one long bar.

### Check progress (Project Mode)

1. Click **Check progress** on the project row.
2. Enter the **project session password** (same as at submission).
3. Choose **Session 1**, **Session 2**, … to open that segment’s terminal and preview.

You authenticate once per project, then pick which segment to view.

### Submit rules (different from a single night)

- You may submit a **large total frame count** even if **one night could never finish it** — the system does not reject the project for “too long for tonight.”
- **Single-night** limits (must finish before dawn, must fit altitude all night) apply to **normal** sessions, not to Project Mode totals.

### Fair queue — same as everyone else

Project Mode does **not** jump the line.

1. Your project waits behind any sessions **already ahead** in the queue when it is your turn.
2. If your project is **pending** and someone else submits a normal session later, they do **not** automatically overtake you — ordering is by **planned start time** and queue rules, not “who submitted last.”
3. While a project is **in progress**, the hours when **its target is above 30°** are **reserved** for that project (scheduling and telescope handoff). Other people’s sessions are placed in the remaining time — typically when the project target is **below 30°** (early evening or late morning).
4. At the telescope: if the project is actively imaging and its target is **still above 30°**, normal sessions wait; when the project target **drops below 30°**, other scheduled sessions may run until the target rises again.
5. Only **one project** runs at a time. Two projects cannot both command the telescope.

After the project completes (all frames), the queue continues normally.

### How Project Mode uses the night

On each night the system:

1. Looks at **weather-permitted** time (see scheduling).
2. Merges **back-to-back** clear hours into **continuous windows** (so one long clear spell becomes **one** session, not three artificial one-hour slices).
3. If a **cloud gap** appears in the forecast, a window can **split** into two sessions (e.g. before cloud and after cloud).
4. Fills each window with as many frames as fit (respecting remaining totals per filter).
5. **Recomputes** when you refresh or on a schedule — **scheduled** sub-sessions can move or split/merge; **in progress** and **completed** segments for that night are **locked** and not rewritten.

### End of night

The observatory runs an **end-of-night** sequence after the **last** scheduled or active work for that calendar night — including the last Project sub-session. It does not end the night early just because the project still has frames left for **future** nights.

### Emails (Project Mode)

| Event | Email |
|-------|--------|
| Each sub-session **starts** (sequence sent to telescope) | **Session started** (per segment). |
| **Entire project** all frames done | **One completion** email for the project. |

There is no completion email after every single sub-session — only when the full project finishes.

---

## Variable Star sessions

1. Choose **Variable Star Imaging**.
2. Use the variable-star lookup tools to pick a star and duration.
3. The system schedules and executes with **G** filter.
4. Workflow for progress/download is the same as DSO, but without Project Mode.

---

## How scheduling works

Scheduling is **automatic**. You do not pick a start time manually. The system decides whether you are **scheduled**, **unscheduled**, or (for projects) which **sub-sessions** exist.

### The imaging night

“Tonight” means from **nautical dusk** to **nautical dawn** at the observatory (Pomfret, CT). Placement must fit inside that window.

### Weather

For each hour of the night, the forecast is checked:

- Cloud cover **&lt; 10%**
- Precipitation probability **&lt; 10%**
- Wind **≤ 10 m/s** (with a limit on how many windy hours are allowed)

**Global block:** If the night fails certain whole-night rules (for example no 2-hour consecutive very-clear period, or too much wind/precipitation risk), **new** scheduling may be blocked until the forecast improves.

On the timeline, **Weather Permitted** / **Weather Not Permitted** shows what the scheduler uses. A permitted band on the chart does not guarantee your target is schedulable — **altitude** and **queue** still matter.

### Target altitude

The target must be at least about **30° above the horizon** during the proposed imaging interval. Low targets may be unscheduled even when weather looks good.

### Queue and fairness

All pending sessions are ordered by **submission time**. The scheduler places them one by one into free time:

- Already **scheduled** sessions occupy time first.
- The next session gets the **earliest** valid start that fits weather, altitude, and remaining gap.
- **Planned start time** on the queue row is what determines **who goes first** when the telescope is ready — not a separate “priority” flag.

Sessions already **in progress** or **completed** tonight keep their timeline bars; the system does not erase them when weather updates.

### Re-scheduling (reconcile)

The schedule is **recomputed regularly** (when you load Current sessions and on a background schedule). That means:

- If weather **opens up**, you might gain a slot or an extra Project sub-session.
- If weather **closes**, a **scheduled** session may become **unscheduled** or split into smaller pieces (Project Mode).
- If you are already **imaging**, that run is not torn down by a refresh — only future **scheduled** plans change.

### Single-night vs Project

| | Single DSO session | Project Mode |
|--|-------------------|--------------|
| Must finish tonight? | Should fit in one night (system checks) | No — totals can span many nights |
| Queue entries | One row | One row for the project |
| Timeline bars | One block | One block per sub-session |
| Split when weather changes? | Time may change; **one** row | **Scheduled** subs can split/merge |

---

## Current sessions — actions

| Action | When available | What it does |
|--------|----------------|--------------|
| **Check progress** | Most states | Password → live log (and preview when available). Project: password → pick Session. |
| **Download file** | When data is ready | Password → download link for finished data. |
| **Edit session** | Pending / scheduled (not while imaging) | Change target, filters, etc.; schedule recalculated. |
| **Delete session** | Usually always | Remove from queue; password required. |

### Session statuses (normal / project row)

| Status | Meaning |
|--------|---------|
| **PENDING** | In queue; not yet placed on tonight’s schedule (or project has no plan yet). |
| **SCHEDULED** | Has a planned start time tonight (normal session). |
| **IN PROGRESS** | Observatory is running (or project is active with at least one planned segment). |
| **COMPLETED** | Finished successfully. |
| **FAILED** | Stopped with error; contact support if needed. |

---

## Emails

If you provide a valid email:

- **Session started** — when the observatory begins your sequence (each Project sub-session sends its own start notice).
- **Session completed** — when a **normal** session finishes, or when a **Project** finishes **all** remaining frames.
- **Session failed** — if the run aborts in a way that triggers failure notification.

Emails require mail to be configured on the server; if mail is disabled, the session still runs.

---

## Tips for a successful request

1. **Choose targets that are up at night** — check altitude and whether the object is observable in the evening/morning hours shown.
2. **Be realistic on frame count** for a single normal session — if it cannot fit before dawn, shorten the plan or use Project Mode.
3. **Keep your session password** — without it you cannot open progress or download.
4. **Watch the schedule strip** after submitting — if you stay “pending” or “unscheduled,” read audit/scheduling reasons in logs (staff) or wait for weather to improve.
5. **Project Mode:** expect multiple nights; do not assume Session 1 tonight finishes the whole project.
6. **Do not share passwords** on public computers; Save Session stores plans in **your browser only**.

---

## Common questions

**Why was I rejected for “too long for one night”?**  
You used a normal DSO session. Shorten exposures/count or turn on **Project Mode**.

**Why does my project say PENDING but the schedule shows weather permitted?**  
Placement also needs altitude, free queue time, and a long enough continuous window for at least one sub-session. Weather alone is not enough.

**Someone submitted after me — will they cut in front?**  
Not automatically. Order is by fair queue placement and planned start times. A project does not get special “first” rights.

**Why did my one Project block become Session 1 and Session 2?**  
A cloud gap appeared in the forecast, or reconcile found two clear windows. Scheduled pieces update; completed pieces do not.

**Can two projects run together?**
No. Only one project at a time. Other sessions may still run in parts of the night when that project’s target is below 30°.

**Why did someone else’s session run while my project is in progress?**
If your target was below 30° at that time, those hours are open for the rest of the queue. Above 30° is reserved for your project.

**Can I edit after scheduling?**  
Yes while still **pending** or **scheduled**. Not during **in progress**.

---

## For staff and developers

Minimal technical notes only:

```bash
npm install
npm run dev      # local dashboard at http://localhost:3000
npm run build
npm run deploy   # production deploy (Vercel)
```

Secrets, API routes, the observatory agent, and storage backends are operational concerns — configure via deployment environment, not in this guide.

---

## Summary

| Goal | What to do |
|------|------------|
| One night, one target | DSO, Project Mode **Off**, submit plan that fits one night |
| Many nights, many frames | DSO, Project Mode **On**, submit full filter totals |
| See tonight’s plan | Tonight’s schedule + Current sessions |
| Watch a run | Check progress (+ password) |
| Get data | Download file when completed |

The platform’s job is to **schedule fairly**, **use clear weather efficiently**, and **carry multi-night projects forward** until every requested frame is collected. Your job is to submit a clear plan, keep your password, and monitor Current sessions until the row shows **COMPLETED**.
