'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ApiError,
  OPERATIONS,
  OPERATION_BLURBS,
  OPERATION_LABELS,
  SCHEMA_FIELD_TYPES,
  type Operation,
  type SchemaFieldType,
} from '@shade/shared';
import {
  projects as projectsApi,
  type ExtractInput,
  type ParseInput,
  type SplitInput,
} from '@/lib/endpoints';
import { useResource } from '@/lib/hooks/use-resource';
import { uploadAndProcess, type UploadProgress } from '@/lib/upload';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { IndeterminateBar, Progress } from '@/components/ui/progress';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { UploadDropzone } from '@/components/workspace/upload-dropzone';

/**
 * Start a document.
 *
 * One dialog rather than three pages, because the thing that differs between
 * Parse, Extract and Split is a handful of options — not the flow. All three
 * take one PDF, run one job, and land on one document. Three separate upload
 * screens would be three places to fix the same upload bug.
 *
 * The options are genuinely different shapes, though, and that is the reason
 * the operation selector comes first: Extract asks for a schema field by field,
 * Split asks for a question, Parse asks for two booleans. Rendering all of it at
 * once would be a form nobody finishes. Picking the operation first means the
 * user only ever sees the questions that operation actually has.
 */

export function NewDocumentDialog({
  open,
  onClose,
  /** Pre-selects a project — used from within a project's own page. */
  projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string | null;
}) {
  const router = useRouter();
  const [operation, setOperation] = useState<Operation>('PARSE');
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Per-operation options ──────────────────────────────────────────────── */

  const [parseInput, setParseInput] = useState<ParseInput>({
    extractImages: true,
    keepFurniture: false,
  });
  const [schemaName, setSchemaName] = useState('Invoice');
  const [fields, setFields] = useState<SchemaFieldDraft[]>(DEFAULT_FIELDS);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const [target, setTarget] = useState<string>(projectId ?? '');

  const projectList = useResource('projects:select', () => projectsApi.list({ limit: 100 }));

  const inputs = useMemo(() => {
    if (operation === 'PARSE') return { parseInput };
    if (operation === 'EXTRACT') {
      const extractInput: ExtractInput = {
        schemaName: schemaName.trim() || 'Untitled schema',
        fields: fields
          .filter((field) => field.name.trim() !== '')
          .map((field) => ({
            name: field.name.trim(),
            type: field.type,
            ...(field.description.trim() ? { description: field.description.trim() } : {}),
            required: field.required,
          })),
      };
      return { extractInput };
    }
    const splitInput: SplitInput = { query: query.trim(), limit };
    return { splitInput };
  }, [operation, parseInput, schemaName, fields, query, limit]);

  /** Client-side guard, mirroring the API's own validation. */
  const problem = useMemo(() => {
    if (operation === 'EXTRACT') {
      if (fields.filter((field) => field.name.trim() !== '').length === 0) {
        return 'Add at least one field for Extract to look for.';
      }
    }
    if (operation === 'SPLIT' && query.trim().length < 3) {
      return 'Describe what you are looking for — Split needs a question.';
    }
    return null;
  }, [operation, fields, query]);

  const reset = useCallback(() => {
    setUpload(null);
    setError(null);
  }, []);

  const start = useCallback(
    async (file: File) => {
      setError(null);
      setUpload({ phase: 'preparing', fraction: 0 });

      try {
        const outcome = await uploadAndProcess({
          file,
          operation,
          projectId: target || null,
          ...inputs,
          onProgress: setUpload,
        });

        onClose();
        reset();
        // Straight to the document. The job is already running, and the detail
        // page polls it — landing on a list and making the user find the row
        // they just created would be a step for no reason.
        router.push(`/documents/${outcome.document.id}`);
      } catch (cause) {
        setUpload(null);
        setError(
          cause instanceof ApiError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'That upload could not be completed.',
        );
      }
    },
    [operation, target, inputs, onClose, reset, router],
  );

  const busy = upload !== null;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        reset();
        onClose();
      }}
      title="New document"
      description="Upload a PDF, then choose what Shade should produce from it."
      size="lg"
      footer={
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            reset();
            onClose();
          }}
        >
          Cancel
        </Button>
      }
    >
      <div className="space-y-5">
        {/* ── Operation ──────────────────────────────────────────────────── */}
        <fieldset disabled={busy}>
          <legend className="text-[0.8125rem] font-medium text-ink">Operation</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {OPERATIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setOperation(value)}
                aria-pressed={operation === value}
                className={cn(
                  'rounded-[var(--radius-card)] border p-3 text-left transition-colors duration-150 ease-[var(--ease-out-soft)]',
                  operation === value
                    ? 'border-accent-line bg-accent-soft'
                    : 'border-line bg-raised hover:border-line-strong',
                )}
              >
                <span
                  className={cn(
                    'block text-[0.8125rem] font-semibold',
                    operation === value ? 'text-accent-bright' : 'text-ink',
                  )}
                >
                  {OPERATION_LABELS[value]}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-ink-muted">
                  {OPERATION_BLURBS[value]}
                </span>
              </button>
            ))}
          </div>
        </fieldset>

        {/* ── Operation-specific options ─────────────────────────────────── */}
        {operation === 'PARSE' ? (
          <div className="space-y-2 rounded-[var(--radius-card)] border border-line bg-raised p-3.5">
            <Toggle
              label="Extract images"
              hint="Write figures out as separate files and reference them from the Markdown."
              checked={parseInput.extractImages}
              disabled={busy}
              onChange={(extractImages) => setParseInput((prev) => ({ ...prev, extractImages }))}
            />
            <Toggle
              label="Keep headers and footers"
              hint="Off by default — running heads and page numbers are usually noise in the Markdown."
              checked={parseInput.keepFurniture}
              disabled={busy}
              onChange={(keepFurniture) => setParseInput((prev) => ({ ...prev, keepFurniture }))}
            />
          </div>
        ) : null}

        {operation === 'EXTRACT' ? (
          <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-raised p-3.5">
            <Field label="Schema name">
              {({ id }) => (
                <Input
                  id={id}
                  value={schemaName}
                  disabled={busy}
                  maxLength={80}
                  placeholder="Invoice"
                  onChange={(event) => setSchemaName(event.target.value)}
                />
              )}
            </Field>

            <div>
              <p className="text-[0.8125rem] font-medium text-ink">Fields</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                Each field becomes a key in the output JSON, with a confidence and the page it was
                found on.
              </p>

              <div className="mt-2 space-y-2">
                {fields.map((field, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <Input
                      value={field.name}
                      disabled={busy}
                      placeholder="total_amount"
                      aria-label={`Field ${index + 1} name`}
                      className="min-w-0 flex-1 font-mono text-[0.8125rem]"
                      onChange={(event) =>
                        updateField(setFields, index, { name: event.target.value })
                      }
                    />
                    <Select
                      value={field.type}
                      disabled={busy}
                      aria-label={`Field ${index + 1} type`}
                      className="w-36 shrink-0"
                      onChange={(event) =>
                        updateField(setFields, index, {
                          type: event.target.value as SchemaFieldType,
                        })
                      }
                    >
                      {SCHEMA_FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      disabled={busy || fields.length === 1}
                      aria-label={`Remove field ${index + 1}`}
                      onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}
                      className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-faint"
                    >
                      <svg className="size-3.5" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                        <path
                          d="M6 6l8 8M14 6l-8 8"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                disabled={busy}
                onClick={() =>
                  setFields((prev) => [
                    ...prev,
                    { name: '', type: 'string', description: '', required: false },
                  ])
                }
              >
                Add field
              </Button>
            </div>
          </div>
        ) : null}

        {operation === 'SPLIT' ? (
          <div className="space-y-3 rounded-[var(--radius-card)] border border-line bg-raised p-3.5">
            <Field
              label="What are you looking for?"
              hint="Split retrieves the passages that answer this, ranked, with the page each one is on."
            >
              {({ id }) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={query}
                  disabled={busy}
                  maxLength={400}
                  placeholder="What are the payment terms and the late fee?"
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </Field>

            <Field label="Maximum passages">
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  disabled={busy}
                  className="w-24"
                  onChange={(event) =>
                    setLimit(Math.max(1, Math.min(50, Number(event.target.value) || 1)))
                  }
                />
              )}
            </Field>
          </div>
        ) : null}

        {/* ── Destination ────────────────────────────────────────────────── */}
        <Field label="Project" hint="Optional. Documents without a project still appear in History.">
          {({ id }) => (
            <Select
              id={id}
              value={target}
              disabled={busy}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">No project</option>
              {(projectList.data?.data ?? []).map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* ── File ───────────────────────────────────────────────────────── */}
        {busy ? (
          <UploadStatus operation={operation} upload={upload} />
        ) : (
          <UploadDropzone compact onFile={(file) => void start(file)} />
        )}

        {problem && !busy ? (
          <p role="alert" className="text-[0.8125rem] text-warning">
            {problem}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-[0.8125rem] text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

interface SchemaFieldDraft {
  name: string;
  type: SchemaFieldType;
  description: string;
  required: boolean;
}

const DEFAULT_FIELDS: SchemaFieldDraft[] = [
  { name: 'invoice_number', type: 'string', description: '', required: true },
  { name: 'total_amount', type: 'number', description: '', required: true },
  { name: 'due_date', type: 'date', description: '', required: false },
];

function updateField(
  setFields: React.Dispatch<React.SetStateAction<SchemaFieldDraft[]>>,
  index: number,
  patch: Partial<SchemaFieldDraft>,
) {
  setFields((prev) => prev.map((field, i) => (i === index ? { ...field, ...patch } : field)));
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg px-1 py-1.5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-[0.8125rem] font-medium text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Upload feedback inside the dialog.
 *
 * Deliberately short: three phases, one line each. The full stage-by-stage
 * panel belongs to the workspace, where the job is the whole screen — here the
 * dialog is a means to an end, and the end is the document page the user is
 * about to be sent to.
 */
function UploadStatus({
  operation,
  upload,
}: {
  operation: Operation;
  upload: UploadProgress;
}) {
  const label =
    upload.phase === 'preparing'
      ? 'Preparing upload…'
      : upload.phase === 'uploading'
        ? 'Uploading…'
        : `Starting ${OPERATION_LABELS[operation].toLowerCase()}…`;

  // Only the byte-transfer phase has a real fraction. The other two are quick
  // and unmeasurable, and a bar that animates to 60% while nothing is happening
  // is a lie the user can catch.
  const percent = upload.phase === 'uploading' ? Math.round(upload.fraction * 100) : null;

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-raised p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.8125rem] font-medium text-ink">{label}</p>
        {percent !== null ? (
          <span className="font-mono text-[0.6875rem] tabular-nums text-ink-faint">{percent}%</span>
        ) : null}
      </div>

      {percent === null ? (
        <IndeterminateBar className="mt-2.5" />
      ) : (
        <Progress value={percent} className="mt-2.5" />
      )}
    </div>
  );
}
