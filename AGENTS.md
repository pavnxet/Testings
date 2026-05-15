# AGENTS.md

## You Have Superpowers

This project includes the **[pavnxet/superpowers](https://github.com/pavnxet/superpowers)** template
in the `Superpowers/` directory. Before writing any code, you must read and follow the instructions
inside it.

---

## Step 0 — Bootstrap (do this first, every time)

Read these files before doing anything else:

```
Superpowers/Superpower folder 1/agents/code-reviewer.md
Superpowers/Superpower folder 2/skills/using-superpowers/SKILL.md
```

Then read the `SKILL.md` for each superpower you plan to use (paths listed below).

Do not skip this step. The skills contain non-obvious instructions that will prevent mistakes.

---

## Default Workflow

Unless the task is a trivial one-liner, always follow this sequence:

| Step | Action | Command / Skill |
|------|--------|-----------------|
| 1 | Understand the task, clarify if needed | — |
| 2 | Write a structured plan | `Superpower folder 1/commands/write-plan.md` |
| 3 | Brainstorm complex or ambiguous parts | `Superpower folder 1/commands/brainstorm.md` |
| 4 | Execute the plan | `Superpower folder 1/commands/execute-plan.md` |
| 5 | Review code quality | `Superpower folder 2/skills/requesting-code-review/SKILL.md` |
| 6 | Verify before declaring done | `Superpower folder 2/skills/verification-before-completion/SKILL.md` |
| 7 | Clean up and prepare for merge | `Superpower folder 2/skills/finishing-a-development-branch/SKILL.md` |

---

## Skill Reference

Read the `SKILL.md` for the skill that matches your situation.

| Situation | SKILL.md path |
|-----------|--------------|
| Planning a task | `Superpower folder 2/skills/writing-plans/SKILL.md` |
| Brainstorming design or architecture | `Superpower folder 2/skills/brainstorming/SKILL.md` |
| Executing a plan step by step | `Superpower folder 2/skills/executing-plans/SKILL.md` |
| Task has independent parts → use sub-agents | `Superpower folder 2/skills/subagent-driven-development/SKILL.md` |
| Running multiple agents in parallel | `Superpower folder 2/skills/dispatching-parallel-agents/SKILL.md` |
| Something is broken, root cause unknown | `Superpower folder 2/skills/systematic-debugging/SKILL.md` |
| Writing or reviewing tests | `Superpower folder 2/skills/test-driven-development/SKILL.md` |
| Working across branches | `Superpower folder 2/skills/using-git-worktrees/SKILL.md` |
| Requesting a code review | `Superpower folder 2/skills/requesting-code-review/SKILL.md` |
| Applying review feedback | `Superpower folder 2/skills/receiving-code-review/SKILL.md` |
| Final checks before marking complete | `Superpower folder 2/skills/verification-before-completion/SKILL.md` |
| Merging / closing a branch | `Superpower folder 2/skills/finishing-a-development-branch/SKILL.md` |

---

## Sub-agent Prompts

When using `subagent-driven-development`, load these prompts for each sub-agent role:

```
Superpower folder 2/skills/subagent-driven-development/implementer-prompt.md
Superpower folder 2/skills/subagent-driven-development/spec-reviewer-prompt.md
Superpower folder 2/skills/subagent-driven-development/code-quality-reviewer-prompt.md
```

For brainstorming document review:
```
Superpower folder 2/skills/brainstorming/spec-document-reviewer-prompt.md
```

For plan document review:
```
Superpower folder 2/skills/writing-plans/plan-document-reviewer-prompt.md
```

For code review:
```
Superpower folder 2/skills/requesting-code-review/code-reviewer.md
Superpower folder 1/agents/code-reviewer.md
```

---

## Debugging Tools

When debugging, read these in order:

```
Superpower folder 2/skills/systematic-debugging/SKILL.md
Superpower folder 2/skills/systematic-debugging/root-cause-tracing.md
Superpower folder 2/skills/systematic-debugging/defense-in-depth.md
Superpower folder 2/skills/systematic-debugging/condition-based-waiting.md
```

To find a test polluter:
```
Superpower folder 2/skills/systematic-debugging/find-polluter.sh
```

---

## Testing Anti-patterns

Before writing any tests, read:
```
Superpower folder 2/skills/test-driven-development/testing-anti-patterns.md
```

---

## Tool-specific References

If you are running inside a specific agent environment, read the matching reference:

```
Superpower folder 2/skills/using-superpowers/references/codex-tools.md   <- for Codex
Superpower folder 2/skills/using-superpowers/references/gemini-tools.md  <- for Gemini
```

If you are a Gemini agent, also read:
```
Superpower folder 3/GEMINI.md
Superpower folder 3/gemini-extension.json
```

---

## Tests — How Skills Are Expected to Behave

`Superpower folder 3/tests/` contains the ground truth for how skills should be triggered and
what correct agent behavior looks like. **Read the relevant test prompts before using a skill**
to understand exactly what is expected.

### Skill triggering prompts (what phrases activate each skill)
```
Superpower folder 3/tests/skill-triggering/prompts/writing-plans.txt
Superpower folder 3/tests/skill-triggering/prompts/executing-plans.txt
Superpower folder 3/tests/skill-triggering/prompts/systematic-debugging.txt
Superpower folder 3/tests/skill-triggering/prompts/requesting-code-review.txt
Superpower folder 3/tests/skill-triggering/prompts/dispatching-parallel-agents.txt
Superpower folder 3/tests/skill-triggering/prompts/test-driven-development.txt
```

### Explicit skill request examples
```
Superpower folder 3/tests/explicit-skill-requests/prompts/
```
Read these to understand how users phrase requests and how you should respond.

### Subagent-driven development integration tests
```
Superpower folder 3/tests/subagent-driven-dev/go-fractals/design.md
Superpower folder 3/tests/subagent-driven-dev/go-fractals/plan.md
Superpower folder 3/tests/subagent-driven-dev/svelte-todo/design.md
Superpower folder 3/tests/subagent-driven-dev/svelte-todo/plan.md
```
These are worked examples — use them as reference when structuring your own plans and designs.

### Changelog & release notes
```
Superpower folder 3/CHANGELOG.md
Superpower folder 3/RELEASE-NOTES.md
```
Check these to understand what has changed recently in the superpowers system.

---

## Project History & Docs

Check these before starting work on anything architectural:

```
Superpower folder 1/docs/plans/               <- past plans
Superpower folder 1/docs/superpowers/specs/   <- design specs
Superpower folder 1/docs/superpowers/plans/   <- superpower-specific plans
```

---

## Rules

- **Always plan before coding** unless the change is a trivial one-liner.
- **Read the SKILL.md** of any superpower before invoking it — do not guess at its behavior.
- **Use sub-agents** whenever a task has parts that can be reviewed or implemented independently.
- **Document your reasoning** in plans and comments, not just in code.
- **Run verification** before saying a task is complete.
- **Never rush** into code without understanding the full scope.

---

## Activating Skills

Name the skill explicitly in your reasoning so it is clear which superpower is active:

- *"Using `writing-plans` to structure this task..."*
- *"This warrants `systematic-debugging` — finding root cause first."*
- *"Dispatching sub-agents: spec-reviewer, implementer, code-quality-reviewer."*
- *"Running `verification-before-completion` before wrapping up."*

---

**Superpowers are available. Read them. Use them.**
