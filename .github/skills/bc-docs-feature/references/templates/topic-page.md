---
module: <area>
topic: <topic-slug>
page-type: reference
wiki-path: <prefix>/<area>/<topic-slug>/<page-slug>   # optional - only if this page is mirrored to Wiki.js
wiki-title: <Page title without work-item ID>
wiki-tags: ["bc", "<area>", "<topic-slug>", "<page-type>"]
related-work-items: ["<work-item-or-issue-id>"]
---

**<Topic name>:** [Overview](index.md) · **<This page>** · [<Neighbour page>](<neighbour>.md)  
**Related:** [<Area>](../index.md)

---

# <Page title>

**<Focus/scope>:** <what this page is limited to>  
**As of:** <YYYY-MM-DD>

## Purpose

<One paragraph: which question this page answers and for whom. No work-item reference — the page
must make sense on its own.>

## <Content sections>

<The actual content. One Diátaxis mode per page: either reference (look up) or how-to (carry out)
or decision guide (weigh options) — never mixed.>

## Sources

- `app/src/<module>/<Object>.al`
- <further verified sources>

## Origin and related work

This page is lasting functional documentation and readable independently of any single work item.
It was produced by the following work:

- Feature <ID> "<title>" — [specification](/specs/<path>/index.md)
- User story <ID> "<title>" — [specification](/specs/<path>/index.md)

**Related pages**

- [<Topic> — Overview](index.md)
- [<Neighbour page>](<neighbour>.md)
