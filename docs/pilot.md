# Plot & Kin pilot materials

These are preparation materials. **No recruitment message has been sent, no participant has enrolled through this document, and no pilot outcome has been measured.**

## Recruitment brief — DRAFT ONLY, DO NOT SEND

We are developing Plot & Kin, an open-source research tool for the histories of places and the people connected to them. Its first focus is Washington, DC property research. We are looking for professional researchers who repeatedly produce property-history work and can help evaluate whether a reviewable evidence dossier saves time after checking and correction.

Each participant would contribute one permitted completed case and one unresolved case, describe their current workflow, and evaluate the tool using accessible sources. We will preserve uncertain and contradictory interpretations and retain source citations. You will review conclusions before they are treated as accepted.

The prototype runs through Codex or Claude Desktop with a researcher-owned Astra database and local original-files library. Optional document processing uses the researcher's OpenAI or Anthropic key. We would agree the cases, permissions, time commitment, costs, and permitted use of feedback before participation.

This is a draft invitation for review. Replace the recruitment contact and participation terms with agreed details before any authorized outreach. Do not imply endorsements, paid participation, or a functioning hosted service.

## Materials and permissions checklist

- [ ] Record the source owner or custodian and the participant's authority to provide each case.
- [ ] Agree which files may be held locally, placed in Astra, processed by the chosen provider, and included in backups or reports.
- [ ] Record source attribution, retention/deletion expectations, reuse restrictions, and any sensitive material exclusions.
- [ ] Decide whether reviewer feedback and de-identified timings may be published.
- [ ] Agree who owns the researcher accounts, model charges, and resulting dossier.
- [ ] Keep the completed case's answer key separate from the researcher/agent view during an evaluation.

## Paired and counterbalanced protocol

Recruit **five professional researchers**, each contributing **one completed case and one unresolved case**, while prototype development continues. Record recruitment shortfalls instead of treating the target count as enrollment.

Evaluate three conditions: the researcher's existing workflow, a general-purpose AI tool without Plot & Kin, and Plot & Kin. Match tasks by difficulty, source types, and research scope, with comparable access to the same permitted source material. Record the AI client/model and tools available in each condition.

Preassign a different condition order to each of the five researchers, using five of the six possible orderings. Assign different matched cases to each condition and avoid assigning a researcher their own familiar completed case wherever possible. Cases may recur across researchers, so retain case IDs and report that dependence. Record unavoidable familiarity, case difficulty, and deviations. Keep completed-case answer keys hidden during research and use unresolved cases to assess the real workflow.

Measure total effort through the final checked deliverable: **case-attributable setup + source discovery + extraction/transcription + organization/drafting + verification + corrections + export/restoration work**. Include failed attempts and setup performed before opening the case. Allocate shared case preparation consistently before measurement. Report general product onboarding separately as well as its effect on overall pilot effort. Do not stop the clock at the first narrative.

For each valid matched comparison, compute `(baseline_total_effort_minutes - plot_kin_total_effort_minutes) / baseline_total_effort_minutes × 100`. Calculate and report comparisons against the existing workflow and general-purpose AI separately. The target is **at least 25% median paired reduction against each baseline**, with **zero critical evidence errors in final reviewed Plot & Kin dossiers**. Report counts, result spread, exclusions with reasons, and unresolved cases. This is an initial feasibility signal, not proof of universal performance.

Use an independent qualified reviewer where possible. Give reviewers the cited evidence and final dossiers from all three conditions without identifying their production method. Record initial extraction errors separately from initial critical evidence errors, final dossier errors, and correction time.

## Critical evidence error rubric

| Category | Critical example |
| --- | --- |
| Fabricated source | A source or passage is cited but does not exist in the retained evidence. |
| Unsupported consequential claim | A conclusion about a building, person, event, ownership, or occupancy is not supported by its cited evidence. |
| Incorrect identity | Separate people, parcels, addresses, or organizations are treated as the same without adequate support. |
| Misstated source meaning | Ownership becomes occupancy, first surviving evidence becomes construction date, or a failed/empty search becomes proof of absence. |
| Hidden contradictory evidence | Material opposing evidence is omitted or represented as resolved without recorded justification. |
| False approval | A proposed or invalidated conclusion appears as accepted without an applicable recorded human review. |

Minor typographic errors are not automatically critical. Record them and their correction time. Reviewers must explain the consequence of each error and retain the relevant source and claim IDs.

## Measurement sheet

Copy `docs/pilot-measurements.csv` for actual observations. Do not fill it with invented performance data.

Use one row per researcher, case, and condition. Populate the two reduction columns only for the Plot & Kin row after matching valid comparator rows. Record case permissions, client version, model/provider configuration, price date, assessment notes, omitted work, and exclusion reasons alongside the sheet. Report server processing costs separately from client subscription and Astra costs.

Follow up separately on a requested or completed second project, willingness to pay and payment terms, and actual repeat payment. None of these is interchangeable with satisfaction, initial task performance, or one another.

## Expansion gate

Keep the pilot in one locality until the time and final-evidence targets are met on the documented case set and researchers return with another real case. Also require a restoration usability check: a researcher restores a real permitted case into a fresh destination, locates its originals and citations, inspects approvals and unresolved alternatives, and resumes work without reconstructing the case from chat. Record time, assistance, failures, and the researcher's usability assessment. An automated round trip alone does not satisfy this gate.

Report willingness to pay and actual payment separately. A second free project is not repeat payment, and a compelling demo is not a validated business.
