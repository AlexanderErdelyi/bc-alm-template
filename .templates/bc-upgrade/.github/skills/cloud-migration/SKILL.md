---
name: cloud-migration
description: "Plans the move of your-organization to BC29 online with the cloud migration tool (Cloud migration: BC29 (AL) → BC29 online). Use when: cloud migration, migrate to SaaS, data replication, Cloud Migration Management, integration runtime, migration companies, cutover plan, go-live checklist, online environment setup."
---

# Cloud migration

Hop: **Cloud migration: BC29 (AL) → BC29 online** – Cloud migration needs Business Central 25.0 or later on premises; migrate from the same version as the online environment or the previous release.

Re-verify the requirements on Microsoft Learn before each phase; they change with every release.

- [Cloud migration prerequisites for Business Central](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/cloud-migration-prerequisites)
- [Migrate on-premises data to Business Central online](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/migrate-data)
- [Business Central on-premises to online migration overview](https://learn.microsoft.com/dynamics365/business-central/dev-itpro/administration/migrate-business-central-on-premises)

## Procedure

1. **Confirm the route** from `docs/decisions/`. If missing, ask the user and record it.
2. **Prerequisites** (status in `docs/runbooks/cloud-migration-plan.md`):
   - SQL Server 2016+ and compatibility level 130 or higher.
   - On-premises version BC29 is supported for migration to BC29 online.
   - Online environment (sandbox first) on BC29, same localization, the same extensions installed with identical IDs and versions; add-ons replaced as decided.
   - Admin rights and a Business Central license for the migration user; self-hosted integration runtime host.
   - Data cleanup done (Microsoft Learn: clean data, align SQL table definitions).
3. **Company batches.** Group companies by size; large databases need several replication runs. Record database size and record counts per company.
4. **Rehearsal plan.** Sandbox: setup → replication → data upgrade → validation → measured duration.
5. **Cutover plan** (customer copy in `docs/de/cutover-plan.md`, German): freeze, last replication, data upgrade, completion of the migration, user enablement, reconnecting integrations (web services → OAuth and APIs), job queues, rollback criteria.
6. **Post-migration**: users and permissions, report layouts, document sending profiles, email accounts, telemetry (Application Insights).

## Outputs

- `docs/runbooks/cloud-migration-plan.md` – technical plan with checklist and timings.
- `docs/de/cutover-plan.md` – for the customer: process, time windows, responsibilities, acceptance.

## Rules

- Never start replication or complete the migration in a production environment without explicit confirmation.
- Use a sandbox for every rehearsal.
