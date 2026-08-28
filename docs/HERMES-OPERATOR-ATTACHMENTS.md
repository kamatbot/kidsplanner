# Operator Case Attachments (M2)

Attachments make family documents first-class artifacts on a durable Hermes Operator case without turning document content into authority.

## Storage and integrity

- Raw files are limited to 8 MiB and an explicit MIME allowlist.
- PDF, PNG and JPEG uploads are checked against file magic before persistence.
- The server assigns the storage filename; user filenames are encrypted metadata only.
- Raw bytes are base64-wrapped and encrypted with FamETC `DATA_ENCRYPTION_KEY` before being written under the persistent FamETC data directory.
- SHA-256 is recorded for evidence/integrity and verified when a parent retrieves raw content.
- Attachment metadata and extraction references live in transactional `operator.sqlite`.

## Trust boundary

Every model-facing text extraction passes through `operator-trust.externalContent()` and therefore carries:

- `trust: untrusted-external`;
- source reference and observation time;
- SHA-256 content hash;
- `instructionsAuthoritative: false`;
- `mayIdentifyActor: false`;
- `mayGrantApproval: false`;
- `mayGrantExecution: false`;
- `mayWidenToolScope: false`.

Embedded prompts, tool-call JSON, statements that a parent approved something, and copied capability tokens remain data only.

## Extraction

M2 extracts only bounded text-like formats (`text/plain`, CSV, JSON, EML) up to 64 KiB. PDF and image artifacts are accepted and encrypted but intentionally return `not_extracted` until a separately bounded document/image extraction pipeline is connected. FamETC does not guess text using an implicit OCR fallback.

## Malware hook

The attachment service has an injectable byte-scanning hook. The baseline implementation includes an EICAR regression guard so unsafe-content handling is testable. Production deployments can replace this hook with a dedicated scanning service without changing attachment authority semantics.

## Product and MCP surfaces

Parent session APIs:

- `GET /api/operator/cases/:caseId/attachments`
- `POST /api/operator/cases/:caseId/attachments`
- `GET /api/operator/cases/:caseId/attachments/:attachmentId`
- `GET /api/operator/cases/:caseId/attachments/:attachmentId/content`
- `DELETE /api/operator/cases/:caseId/attachments/:attachmentId`

Parent upload/review page: `/operator-attachments.html?caseId=case_...`

Hermes MCP is deliberately read-only for files:

- `fametc_attachments_list`
- `fametc_attachments_get_text`

Hermes receives no raw bytes and cannot upload or delete attachments through MCP.

## Delete/revoke

Deletion removes the encrypted blob, clears the stored extraction and storage reference, and removes the artifact from normal listings. The attachment id/content hash remain only in the Operator audit trail so a family can see that an artifact existed and was deleted without retaining its contents.
