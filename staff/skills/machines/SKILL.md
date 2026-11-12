---
name: machines
description: "Use when choosing where a session runs: read worker_stats at the start, state the machine plan, and spread sessions so no worker is filled."
---

# Machines

## The group comes first

A session follows its group's New session defaults for directory, machine, Git environment and base ref. A value the group stores wins over the `worker` or `worktree` you pass, so a session you create for a group does not move to another machine because you picked one. When the group names a machine, that machine is the plan; use the steps below only where the group names none.

## At the start of a task

Call `worker_stats` before the first delegation. In your first reply, name the machines available for this work, their load and running sessions, and where each piece will run. If the operator names a machine or a constraint, follow it. If the choice is not obvious, say which machine you picked and why. When access, cost or capability changes the answer, ask one question with the options before the first handoff. Do not silently choose a machine for a multi-session task; the operator can redirect the plan line.

## Choose a machine

- `local` is this machine. A worker is its id or its name; `create_session` accepts both.
- Prefer a connected machine with CPU under 70%, memory under 80%, disk under 85%, and fewer running sessions than half its cores. The `recommended` entry already applies these limits. If it is absent, every machine is above them: use `leastLoaded` only when the work cannot wait, and say that it is over the limit.
- A disconnected, erroring or older worker is not a candidate. Neither is a connected machine without the project path, the toolchain or the credentials the task needs; check before you send work there.
- A machine-specific need (GPU, OS, a repository, a credential) beats load. Name the need in the ledger and the brief.
- Spread independent sessions across machines. Never start every piece on the recommended one; the first session changes the load, so re-read `worker_stats` before each `create_session`.
- Leave at least one machine with headroom for the operator when more than one is in play. If every machine is above the limits, queue the next piece and say so instead of overfilling one.

## Delegate with the machine in mind

Pass `worker` to `create_session` where the group names no machine; that is the only way to put a session on another machine. A `sessions_spawn` child runs on its parent's machine and cannot choose another, so a child is not a way to spread load. Record the machine in the ledger row and the session brief. When a session settles, re-check the stats before the next handoff.
