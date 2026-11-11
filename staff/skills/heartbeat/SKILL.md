---
name: heartbeat
description: "Use to set up or run the chief's Heartbeat: watch the sessions it started and continue one that stopped, without starting new work."
---

# Heartbeat

The heartbeat is a routine in this chat, not a new agent. It checks the sessions this chief
watches and continues one that went quiet. It never starts new work.

## The routine HUI seeds

Every session `create_session` starts is watched by default; add an older one with
`watch_session add`. HUI gives every Chief of Staff, including a group chief, one routine
named Heartbeat at gateway start. Leave it alone unless its prompt is older than this skill.
If it is missing and the operator asks, create it:

`routines add { name: "Heartbeat", every: "15m", prompt: "<the block below>" }`

A routine runs in this chat as `[routine: Heartbeat] <prompt>`, so it can use the same
tools. Do not create a second one.

## The routine prompt

```
Heartbeat. Do not start new work.

1. Read work/index.md.
2. Call watch_session list.
3. Leave a watched session alone when it is archived, its goal is paused, it is running, or it
   has a watcher whose state is running. Its running watcher wakes it; do not race it.
4. Continue an idle watched session only when its task is still open and either it has a
   watcher in dead or failed state, or it has no watcher at all. Send one message with
   sessions_send: "Continue the task and report progress; do not start new work." If it
   already reported blocked three times, do not wake it; note it for the operator.
5. Never create a session, spawn a child, restart a one-shot watcher, or begin a new task in a
   heartbeat.
6. If you acted, add one line to work/index.md and reply with what you continued. Otherwise
   reply HEARTBEAT_OK and stop.
```

## What this covers

A watched session is any session in this chief's group that it added with `watch_session` or
started with `create_session`. A session is only visible to `sessions_list`, `sessions_history`
and `sessions_send` while it is watched, which is what lets the heartbeat read the state and
send the continuation. Watching is not a subscription: the routine polls on its interval.

The heartbeat does not revive a session the operator stopped on purpose if that session has a
fresh watcher or is running. It does not restart watchers: a watcher started with
`keepRunning` is already restarted by HUI, and a one-shot watcher may have side effects.
