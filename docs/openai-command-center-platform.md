# OpenAI Command Center Platform Standard

## Decision

OpenAI will be a governed platform layer shared by every Command Center, not a generic chat window and not a replacement for each company's source records.

The normal site-wide search remains deterministic and permission-filtered. The internal assistant is a separate, controlled experience for questions, drafting, analysis, calculations, and guided task assistance.

## Permanent boundaries

- Every request carries `companyId`, authenticated user identity, role, project access, and the active Command Center context.
- Company data, file indexes, conversations, tool permissions, and audit records are isolated by company.
- The model receives only records and file passages the signed-in user may open without AI.
- Search and assistant answers link back to the source record and controlled file version.
- The assistant may read, explain, calculate, compare, draft, prefill, and guide. It cannot submit, route, approve, reject, sign, publish, release, pay, post, transmit, file, change permissions, or make another business commitment.
- The assistant never receives a business-record write tool. A user must take the assistant's draft or guidance into the normal Command Center screen and complete the established workflow there.
- Human confirmation inside chat never substitutes for the normal approval channel.
- Payroll remains report-only. The assistant may explain or prepare a payroll-company report, but it can never execute payroll.

## Platform layers

1. **Identity and tenant boundary** — Command Center authentication resolves the company, employee, role, designations, accessible projects, and permission locks.
2. **Operational search** — Direct search of accessible sections, projects, records, and current controlled files. This works without a model.
3. **Embedded assistant** — A branded internal assistant interface, implemented with ChatKit or a custom UI, opens with the user's existing Command Center identity.
4. **OpenAI orchestration** — The server uses the Responses API. API credentials stay server-side and are never sent to the browser.
5. **Company knowledge** — Current approved files are indexed for semantic and keyword retrieval. Superseded versions remain in Command Center history but are excluded from current-policy answers unless the user explicitly asks for history.
6. **Read-only tools** — Search records, open sources, summarize a project, explain a workflow, prepare a report, check a draft, and return structured content to the user. The assistant does not mutate business records or initiate workflows.
7. **Audit and evaluation** — Store the user, company, conversation, retrieved source IDs, generated drafts, results, latency, and cost. Maintain scenario tests for permissions, cross-company isolation, hallucination, and prohibited actions.

## Knowledge isolation

Use a separate vector store per company by default. Within a company, every indexed item includes metadata for project, department, document type, controlled version, publication status, and access group. The application filters retrieval using the authenticated user's access before the answer is generated.

The OpenAI file-search tool can search an uploaded knowledge base using semantic and keyword retrieval. Command Center remains responsible for deciding which approved files enter each company knowledge base and which users may retrieve them. See the official [OpenAI file search guide](https://developers.openai.com/api/docs/guides/tools-file-search).

## Assistant assistance levels

| Level | Capability | System boundary |
|---|---|---|
| 0 | Explain navigation and answer from approved files | No write access |
| 1 | Draft reports, emails, checklists, meeting notes, and record updates | User reviews the draft |
| 2 | Validate user-prepared work and identify missing information | Returns guidance only |
| 3 | Walk the user through the correct existing Command Center workflow | User operates the normal screen |
| Blocked | Creating or changing business records; submitting or routing approvals; approval or rejection; publishing; signatures; payments; payroll execution; tax filing; bank changes; permission changes | Never delegated to the assistant |

## Approval-channel separation

The permanent sequence is:

1. The assistant helps the employee understand, draft, calculate, compare, or prepare.
2. The assistant returns the work product to the employee without changing a business record.
3. The employee opens the normal Command Center workflow and enters or attaches the prepared work.
4. Existing validation, routing, separation-of-duties, and approval gates operate exactly as designed.
5. The normal workflow—not the assistant—records submission, approval, rejection, signature, publication, or execution.

This boundary applies even when the signed-in user is a Company Owner or Administrator.

## Rollout

### Phase 1 — Read-only company copilot

- Provision one OpenAI API project and server-side service identity for the platform.
- Add company-specific vector stores and an indexing job for current approved controlled files.
- Embed the assistant and require a unique authenticated user identifier for every session.
- Return citations linking to the exact Command Center record or file version.
- Add complete request, retrieval, and cost auditing.

ChatKit provides an embeddable chat interface and a server-created client session; its documentation requires the application to supply a unique user identifier. See the official [OpenAI ChatKit guide](https://developers.openai.com/api/docs/guides/chatkit).

### Phase 2 — Drafting and task guidance

- Give the assistant read-only tools for projects, accounting reports, onboarding status, and controlled forms.
- Add structured draft outputs for report packets, correspondence, meeting agendas, and checklists.
- Keep every result editable and require the user to use the normal Command Center workflow for every save, submission, routing, or approval-controlled action.

### Phase 3 — Deeper guided assistance without workflow execution

- Add richer calculations, comparisons, checklists, and source-linked drafting.
- Let the assistant explain the next normal workflow step but never invoke it.
- Test cross-company isolation, role denial, prompt injection, and attempts to bypass established approval channels.

## Required setup before the assistant is visible

- OpenAI API project and approved billing/spend limits.
- Server-side API credential or workload identity stored in deployment secrets.
- Company retention, sensitive-data, and acceptable-use policy.
- Tenant and role claims available to every API request.
- Initial approved knowledge collections and document owners.
- Written list of allowed read tools, draft capabilities, prohibited actions, and every approval-controlled workflow the assistant must never invoke.
- Evaluation set covering normal tasks, permission boundaries, adversarial requests, and source-citation accuracy.

Until these controls are connected and tested, Command Center should show no assistant page or fake AI controls.

## Implemented foundation

- The authenticated `/api/assistant` endpoint uses the OpenAI Responses API from the server only and sends no write tools or workflow functions.
- The assistant context is filtered by the signed-in employee's Command Center role, designations, onboarding lock, current section, and active project before it leaves the application.
- Every completed or failed request is written to the durable `assistant_audits` register with actor, company, conversation, screen, project, cited source IDs, model, token usage, duration, status, and OpenAI request ID.
- The site-wide launcher is capability-gated. It is completely absent until `OPENAI_API_KEY` exists in the production secret store; therefore the deployed application never presents a fake assistant.
- `OPENAI_ASSISTANT_MODEL` may override the default `gpt-5.4-mini` model without changing application source.
- The first implementation uses controlled project, record, and file-metadata sources already stored in Command Center. File-body semantic retrieval remains disabled until a company-specific approved knowledge index is provisioned.
