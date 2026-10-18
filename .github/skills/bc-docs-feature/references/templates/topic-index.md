---
module: <area>
topic: <topic-slug>
page-type: index
wiki-path: <prefix>/<area>/<topic-slug>        # optional - only if this page is mirrored to Wiki.js
wiki-title: <Topic title>
wiki-tags: ["bc", "<area>", "<topic-slug>", "index"]
related-work-items: ["<work-item-or-issue-id>"]
---

**<Topic name>:** **Overview** · [<Page A>](<page-a>.md) · [<Page B>](<page-b>.md)  
**Related:** [<Area>](../index.md)

---

# <Topic title>

<One paragraph: which subject this topic covers, for whom, and which question it answers.
No work-item reference, no project jargon — the page must be readable without prior knowledge.>

<Optional: table of the BC objects, reports or processes in scope.>

| Object | Name | Used for |
|--------|------|----------|
| <Type ID> | `<Name>` | <short description> |

## Scope boundaries

- **Covered:** <what this topic covers>
- **Not covered:** <what deliberately lives elsewhere> — see [<target area>](<path>)

## Pages

| Page | Kind | Content |
|------|------|---------|
| [<Page A>](<page-a>.md) | Reference | <content in one sentence> |
| [<Page B>](<page-b>.md) | How-to | <content in one sentence> |
| [<Page C>](<page-c>.md) | Decision | <content in one sentence> |

## Start by question

| Question | Page |
|----------|------|
| <typical reader question> | [<Page>](<page>.md) |

## Origin and related work

This topic is lasting functional documentation and grows independently of individual work items.
The current state was produced by the following work:

- Feature <ID> "<title>" — [specification](/specs/<path>/index.md)
- User story <ID> "<title>" — [specification](/specs/<path>/index.md)

Further work on this topic is added here without changing the folder structure.
