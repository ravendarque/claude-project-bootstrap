# Board template

Every bootstrapped project gets its board by copying a private project
titled exactly `Project template` on the owner's account. This page covers
what that project holds, how to change it, and how to check a copy.

## What it holds

The template has no items. Copies get its fields, views and workflows, but
never its Auto-add workflow, which the bootstrap's `core:3` step turns on
for each new repository.

### Fields

| Field | Type | Options |
|---|---|---|
| Status | Single select | Backlog, Ready, In progress, In review, Done |
| Priority | Single select | P0, P1, P2 |
| Size | Single select | XS, S, M, L, XL |
| Estimate | Number | |

The bootstrap looks up the In progress and In review options by name. It
then stores their ids for the board sync workflow, and fails if the Status
options aren't exactly these five.

### Views

| View | Layout | Filter | Sort |
|---|---|---|---|
| Board | Board, columns by Status | (none) | Priority ascending |
| Epics | Table | `title:[EPIC]* AND is:open` | Status ascending |
| No parent epic | Table | `no:parent-issue AND -title:[EPIC]* AND is:open` | (none) |
| Bugs & Chores | Table | `(title:[BUG]* OR title:[CHORE]*) AND is:open` | (none) |

- **Board** shows Title, Assignees, Status, Linked pull requests,
  Sub-issues progress, Priority, Size and Estimate.
- **The three tables** show Title, Assignees, Status, Linked pull requests
  and Sub-issues progress.

### Workflows

All of these are enabled:

- Auto-add sub-issues to project
- Auto-archive items, filter `is:closed updated:<@today-2w`
- Auto-close issue
- Item added to project
- Item closed
- Pull request linked to issue
- Pull request merged

## Creating it

If the owner's account has no `Project template`, create one:

1. Copy a board that's already set up like this one (for a personal
   account, the organisation template), with GraphQL's
   `copyProjectV2` (`includeDraftIssues: false`), and title the copy
   `Project template`.
2. Check that it's private and has no items.
3. Make the fields, views and workflows match the tables above. Views and
   workflow settings can only be changed in the UI.

## Changing it

Change the template on purpose and in the UI, then update this page in the
same PR as any bootstrap change that depends on the new shape. Projects
copied earlier keep the shape they were copied with.

## Checking a copy

The API reports which workflows are enabled, but not their settings.

1. Copy the template to a throwaway project, `zz-template-copy-check`.
2. List its enabled workflows:
   `gh api graphql -f query='query($n:Int!){ user(login:"<owner>"){ projectV2(number:$n){ workflows(first:20){ nodes{ name enabled } } } } }' -F n=<number>`.
   Expect every workflow above. Copies don't include Auto-add.
3. Check the workflow settings and the view sorts by eye in the UI.
4. Delete the throwaway project once its title and its 0 items are
   confirmed.

## Where the templates are

- **`oneloneraven` (organisation), project 1:** the template for
  organisation-owned projects. It was copied from the personal template on
  2026-11-11, and the copy matched every field, view, sort and enabled
  workflow.

Only the organisation template exists. The personal account's
`Project template` (project 9) was deleted on 2026-11-12, after the
migration to the organisation (#75). A personal-owner bootstrap needs one
created first, by following "Creating it": copy the organisation template
to the personal account with `copyProjectV2` (`includeDraftIssues: false`,
the organisation template's id as `projectId`, the personal account's id as
`ownerId`), title the copy `Project template`, and make it private.
Without one, the bootstrap offers the "Without the template" fallback at
the plan.

Last checked on 2026-11-08: a copy kept every field, view, sort and
workflow, including Auto-archive. It had no Auto-add, and listed Epics
before No parent epic.
