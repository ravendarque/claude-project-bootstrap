# Threat model

What claude-project-bootstrap protects, from whom, and how. Update it in the same PR as any
change that adds or moves a trust boundary ([coding standards](coding-standards.md#security)).

## The system

Describe the components, where each runs, and how data flows between them.

## Trust boundaries

| Boundary | Between | What crosses it | Controls |
|---|---|---|---|
| | | | |

## Assets

| Asset | Why it matters |
|---|---|
| | |

## Actors

| Actor | Capability | Motivation |
|---|---|---|
| Anonymous internet user | Any public request | Abuse, data access |
| Signed-in user | Their own account | Access to others' data |
| Compromised dependency | Code execution at install or runtime | Credential theft |
| Maintainer account takeover | Repository and platform access | Anything |

## Threats (STRIDE)

| Threat | Category | Mitigation | Status |
|---|---|---|---|
| | Spoofing | | |
| | Tampering | | |
| | Repudiation | | |
| | Information disclosure | | |
| | Denial of service | | |
| | Elevation of privilege | | |

## Known gaps

None recorded yet.
