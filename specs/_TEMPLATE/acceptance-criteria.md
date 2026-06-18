# Acceptance Criteria — [Feature Title]

> Testable criteria that define when this feature is complete.
> The customer tests against these criteria before approving PROD deployment.

---

## Feature Summary

> One paragraph describing what this feature does, from the user's perspective.

---

## Acceptance Criteria

> Format: Given/When/Then (BDD-style).
> Number each criterion: AC-01, AC-02, etc.
> Each criterion must be specific enough to test — avoid "should work correctly".

---

### AC-01: [Short title of this criterion]

**Given** <!-- precondition / starting state -->  
**When** <!-- user action or system event -->  
**Then** <!-- expected outcome -->  
**And** <!-- additional expected outcome (optional) -->

---

### AC-02: [Short title of this criterion]

**Given** <!-- precondition -->  
**When** <!-- action -->  
**Then** <!-- outcome -->

---

### AC-03: [Add as many as needed]

**Given**  
**When**  
**Then**

---

## Edge Cases

> Boundary conditions and unusual scenarios that must be handled correctly.

| Scenario | Expected Behaviour |
|---|---|
| <!-- e.g. Amount = 0 --> | <!-- e.g. No tolerance entry created, no error --> |
| <!-- e.g. Tolerance % = 100 --> | <!-- e.g. Full amount written off, warning shown --> |
| <!-- e.g. No setup record exists --> | <!-- e.g. Error: "Payment setup not configured" --> |

---

## Error Scenarios

> What error messages should appear for invalid inputs or missing configuration?

| Scenario | Error Message |
|---|---|
| <!-- e.g. Tolerance % is blank --> | <!-- e.g. "Payment tolerance percentage must be greater than zero." --> |
| <!-- e.g. Customer has no setup --> | <!-- e.g. "No payment tolerance setup found for customer group %1." --> |

---

## Testing Notes

> Any setup steps, prerequisite data, or test environment configuration needed to test these criteria.

- <!-- e.g. Create a customer with Customer Group = "Standard" -->
- <!-- e.g. Configure Payment Tolerance Setup with 1% for group "Standard" -->
- <!-- e.g. Create an open invoice of 1000.00 for the test customer -->

---

## Customer Sign-off

> To be completed by the customer or their designated proxy after testing in TEST environment.

| Field | Value |
|---|---|
| **Tested by** | <!-- Name --> |
| **Role** | <!-- e.g. Finance Manager --> |
| **Test date** | <!-- YYYY-MM-DD --> |
| **Environment** | <!-- TEST environment name --> |
| **Result** | <!-- Approved / Approved with conditions / Rejected --> |
| **Conditions / Notes** | <!-- Any conditions or notes from testing --> |
| **Signature** | <!-- Digital approval or reference to ADO approval record --> |

---

*Spec version: 1.0 — see [change-log.md](change-log.md) for history*
